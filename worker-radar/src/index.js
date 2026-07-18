/**
 * Worker: espacio-latente-radar
 * Cron dos veces al día: recorre las fuentes, filtra lo nuevo, lo resume
 * con Workers AI y lo guarda en KV por fecha. El fetch handler sirve el
 * digest (hoy + ayer) y el archivo por fecha, sin necesidad de rebuild
 * del sitio estático — ver worker-radar/README.md para el porqué de esta
 * arquitectura.
 *
 * Despliegue:
 *   cd worker-radar
 *   npx wrangler kv namespace create RADAR_KV   (una vez; copia el id a wrangler.toml)
 *   npx wrangler deploy
 */
import { FUENTES } from './sources.js';
import { obtenerItems } from './feed.js';
import { resumir, esRelevantePorPalabraClave, esReleaseSignificativo } from './resumen.js';
import { renderDigest, renderArchivoIndice, renderError } from './paginas.js';

const TTL_DIA = 60 * 60 * 24 * 400; // ~13 meses de archivo

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const partes = url.pathname.split('/').filter(Boolean);

    try {
      if (partes.length === 0) {
        return await paginaHoy(env);
      }
      if (partes[0] === 'archivo' && partes.length === 1) {
        return await paginaArchivoIndice(env);
      }
      if (partes[0] === 'archivo' && partes.length === 2 && /^\d{4}-\d{2}-\d{2}$/.test(partes[1])) {
        return await paginaDia(env, partes[1]);
      }
      if (partes[0] === 'ejecutar' && request.method === 'POST') {
        return await ejecutarManual(request, env);
      }
      return new Response('No encontrado', { status: 404 });
    } catch (err) {
      return new Response(renderError(err.message), {
        status: 500,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }
  },

  async scheduled(event, env, ctx) {
    // Repartimos las fuentes entre las dos pasadas diarias para no acercarnos
    // al límite de subpeticiones por invocación del plan gratuito de Workers.
    // Cada fuente se revisa una vez al día (no dos) — ver diseño en el chat.
    const esPasadaManana = event.cron === '0 7 * * *';
    const fuentes = FUENTES.filter((_, i) => (i % 2 === 0) === esPasadaManana);
    ctx.waitUntil(ejecutarDigest(env, fuentes));
  },
};

/**
 * Disparo manual del digest, protegido por secreto — útil para forzar una
 * pasada fuera de horario o para depurar sin esperar al cron.
 *   curl -X POST https://radar.espacio-latente.com/ejecutar -H "X-Radar-Secret: ..."
 *   curl -X POST ".../ejecutar?mitad=manana"   # o "tarde" — para probar un reparto sin agotar el límite
 */
async function ejecutarManual(request, env) {
  const secreto = request.headers.get('X-Radar-Secret');
  if (!env.RADAR_SECRET || secreto !== env.RADAR_SECRET) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const mitad = new URL(request.url).searchParams.get('mitad');
  const fuentes =
    mitad === 'manana' || mitad === 'tarde'
      ? FUENTES.filter((_, i) => (i % 2 === 0) === (mitad === 'manana'))
      : FUENTES;
  const resultado = await ejecutarDigest(env, fuentes);
  return new Response(JSON.stringify(resultado, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
}

async function paginaHoy(env) {
  const hoy = fechaISO(0);
  const ayer = fechaISO(-1);
  const itemsHoy = await leerDia(env, hoy);
  const itemsAyer = await leerDia(env, ayer);
  return new Response(renderDigest({ hoy, ayer, itemsHoy, itemsAyer }), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

async function paginaDia(env, fecha) {
  const items = await leerDia(env, fecha);
  return new Response(renderDigest({ hoy: fecha, ayer: null, itemsHoy: items, itemsAyer: [], soloUnDia: true }), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

async function paginaArchivoIndice(env) {
  const lista = await env.RADAR_KV.list({ prefix: 'radar:items:' });
  const fechas = lista.keys
    .map((k) => k.name.replace('radar:items:', ''))
    .sort()
    .reverse();
  return new Response(renderArchivoIndice(fechas), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

async function leerDia(env, fecha) {
  const raw = await env.RADAR_KV.get(`radar:items:${fecha}`);
  return raw ? JSON.parse(raw) : [];
}

function fechaISO(offsetDias) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDias);
  return d.toISOString().slice(0, 10);
}

async function ejecutarDigest(env, fuentes) {
  const hoy = fechaISO(0);
  const ayer = fechaISO(-1);

  // Dedupe contra lo ya publicado hoy y ayer — 2 lecturas KV para todo el
  // run, en vez de una por pieza (eso es lo que agotaba el límite de
  // subpeticiones del plan gratuito). Solo hace falta esta ventana: es lo
  // único que la web llega a mostrar.
  const existentesHoy = await leerDia(env, hoy);
  const existentesAyer = await leerDia(env, ayer);
  const vistos = new Set([...existentesHoy, ...existentesAyer].map((it) => it.link));

  const nuevos = [];
  const porFuente = {};
  const errores = {};

  for (const fuente of fuentes) {
    let items;
    try {
      items = await obtenerItems(fuente);
    } catch (err) {
      console.error(`[radar] fallo obteniendo "${fuente.nombre}": ${err.message}`);
      errores[fuente.nombre] = err.message;
      continue;
    }

    let contador = 0;
    let descartados = 0;
    for (const item of items) {
      if (!item.titulo || !item.link) continue;
      if (vistos.has(item.link)) continue;
      if (fuente.filtrarPorPalabraClave && !esRelevantePorPalabraClave(item)) continue;
      if (fuente.tipo === 'github_release' && !esReleaseSignificativo(fuente, item)) continue;

      vistos.add(item.link);
      const { relevante, resumen } = await resumir(env, item, fuente);
      if (!relevante) {
        descartados++;
        continue;
      }
      nuevos.push({
        titulo: item.titulo,
        resumen,
        link: item.link,
        fuente: fuente.nombre,
      });
      contador++;
    }
    porFuente[fuente.nombre] = descartados > 0 ? `${contador} (+${descartados} descartadas)` : contador;
  }

  if (nuevos.length > 0) {
    const claveDia = `radar:items:${hoy}`;
    await env.RADAR_KV.put(claveDia, JSON.stringify([...existentesHoy, ...nuevos]), { expirationTtl: TTL_DIA });
  }

  const fuentesConError = Object.keys(errores).length;
  const resumenLinea = `[radar] pasada ${hoy}: ${nuevos.length} nuevas, ${fuentesConError}/${fuentes.length} fuentes con error`;
  if (fuentesConError === fuentes.length && fuentes.length > 0) {
    // Fallo total: todas las fuentes de esta pasada fallaron. Sin canal de
    // alertas activo por ahora — esto queda como la señal a buscar con
    // `wrangler tail` o en el dashboard si algo raro pasa.
    console.error(`${resumenLinea} — FALLO TOTAL DE LA PASADA`);
  } else {
    console.log(resumenLinea);
  }

  return { fecha: hoy, totalNuevos: nuevos.length, porFuente, errores };
}
