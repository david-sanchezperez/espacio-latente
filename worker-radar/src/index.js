/**
 * Worker: espacio-latente-radar
 * Cron dos veces al día: recorre las fuentes, filtra lo nuevo, lo resume
 * con Workers AI y lo guarda en KV por fecha. El fetch handler sirve el
 * digest (hoy + ayer) y el archivo por fecha, sin necesidad de rebuild
 * del sitio estático — ver worker-radar/README.md para el porqué de esta
 * arquitectura.
 *
 * El cron y /ejecutar no procesan las fuentes directamente: las reparten en
 * lotes pequeños (`COLA.FUENTES_POR_LOTE`) y encolan un mensaje por lote en
 * `RADAR_QUEUE`. Cada mensaje se procesa en su propia invocación del
 * consumer, con su propio presupuesto de 50 subrequests externos — ver
 * DEVLOG.md para el porqué (una sola invocación con las 28 fuentes agotaba
 * el límite, confirmado en producción con 59).
 *
 * Despliegue:
 *   cd worker-radar
 *   npx wrangler kv namespace create RADAR_KV   (una vez; copia el id a wrangler.toml)
 *   npx wrangler queues create radar-fuentes    (una vez)
 *   npx wrangler deploy --config ./wrangler.toml
 */
import { FUENTES } from './sources.js';
import { obtenerItems } from './feed.js';
import { resumir, esReleaseSignificativo, generarPanorama } from './resumen.js';
import { obtenerTextoArticulo } from './articulo.js';
import { renderDigest, renderArchivoIndice, renderError, renderFeedAtom } from './paginas.js';
import { ARCHIVO, COLA, MEMORIA } from './config.js';
import { crearContadorSubrequests, registrarMetaPasada, registrarDedup } from './costes.js';
import { generarEmbedding, buscarVecinos, guardarVector, clasificarVecinos } from './memoria.js';

const TTL_DIA = ARCHIVO.TTL_DIA_SEGUNDOS;

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
      if (partes[0] === 'feed.xml' && partes.length === 1) {
        return await paginaFeed(env, url.origin);
      }
      if (partes[0] === 'comparar' && request.method === 'POST') {
        return await paginaComparar(request, env);
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
    const pasada = `${fechaISO(0)}-${esPasadaManana ? 'am' : 'pm'}`;
    ctx.waitUntil(encolarPorLotes(env, fuentes, pasada));
  },

  /**
   * Consumer de la cola `radar-fuentes`. Un mensaje = un lote pequeño de
   * fuentes (`COLA.FUENTES_POR_LOTE`), procesado con `ejecutarDigest` igual
   * que antes de la migración — el cambio es solo cuántas fuentes entran en
   * cada invocación, no la lógica de dedup/resumen/publicación.
   * `max_concurrency = 1` (wrangler.toml) evita que dos mensajes escriban a
   * la vez en la misma clave de KV del día.
   */
  async queue(batch, env, ctx) {
    for (const mensaje of batch.messages) {
      const { fuentes, pasada } = mensaje.body;
      try {
        await ejecutarDigest(env, fuentes, pasada);
        mensaje.ack();
      } catch (err) {
        console.error(`[radar] fallo procesando lote de cola (pasada ${pasada}): ${err.message}`);
        mensaje.retry();
      }
    }
  },
};

/** Reparte `fuentes` en lotes de `COLA.FUENTES_POR_LOTE` y encola un mensaje por lote. */
async function encolarPorLotes(env, fuentes, pasada) {
  const lotes = [];
  for (let i = 0; i < fuentes.length; i += COLA.FUENTES_POR_LOTE) {
    lotes.push(fuentes.slice(i, i + COLA.FUENTES_POR_LOTE));
  }
  await Promise.all(lotes.map((lote) => env.RADAR_QUEUE.send({ fuentes: lote, pasada })));
  return lotes.length;
}

/**
 * Disparo manual del digest, protegido por secreto — útil para forzar una
 * pasada fuera de horario o para depurar sin esperar al cron. Encola por
 * lotes igual que el cron (ver `encolarPorLotes`) en vez de procesar todo
 * de golpe — un /ejecutar sin `mitad` sobre las 28 fuentes fue precisamente
 * lo que agotó el límite de subrequests la primera vez que se probó.
 * Responde de inmediato con cuántos lotes se encolaron; los resultados
 * (nuevos items, errores, coste) se ven en D1/el digest público, no en la
 * respuesta — el procesado real ocurre después, de forma asíncrona.
 *   curl -X POST https://radar.espacio-latente.com/ejecutar -H "X-Radar-Secret: ..."
 *   curl -X POST ".../ejecutar?mitad=manana"   # o "tarde" — para probar solo un reparto
 */
async function ejecutarManual(request, env) {
  if (!autorizado(request, env)) return respuestaNoAutorizado();
  const mitad = new URL(request.url).searchParams.get('mitad');
  const fuentes =
    mitad === 'manana' || mitad === 'tarde'
      ? FUENTES.filter((_, i) => (i % 2 === 0) === (mitad === 'manana'))
      : FUENTES;
  const pasada = `${fechaISO(0)}-manual${mitad ? `-${mitad}` : ''}`;
  const lotesEncolados = await encolarPorLotes(env, fuentes, pasada);
  return new Response(JSON.stringify({ encolado: true, fuentes: fuentes.length, lotes: lotesEncolados, pasada }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Compara Workers AI vs Claude Haiku sobre las mismas piezas ya publicadas
 * hoy, leyendo el artículo completo para ambos (no el snippet corto del
 * RSS, que ya no tenemos guardado a estas alturas del pipeline). Protegido
 * por secreto, sin escribir nada en el digest público — es solo para juzgar
 * calidad a ojo antes de decidir si cambiar de proveedor.
 *   curl -X POST "https://radar.espacio-latente.com/comparar?n=5" -H "X-Radar-Secret: ..."
 *
 * Deliberadamente NO acepta una URL por parámetro — el fetch de artículo
 * solo opera sobre links que ya vienen del propio pipeline (fuentes fijas),
 * nunca sobre una URL arbitraria del caller.
 */
async function paginaComparar(request, env) {
  if (!autorizado(request, env)) return respuestaNoAutorizado();
  const inicio = Date.now();
  const n = Math.min(parseInt(new URL(request.url).searchParams.get('n') || '5', 10) || 5, 8);
  const itemsHoy = await leerDia(env, fechaISO(0));
  const itemsAyer = await leerDia(env, fechaISO(-1));
  const items = [...itemsHoy, ...itemsAyer].slice(0, n);
  const pasada = `${fechaISO(0)}-comparacion`;
  const contador = crearContadorSubrequests();

  const resultados = [];
  for (const item of items) {
    const textoArticulo = await obtenerTextoArticulo(item.link, contador);
    const itemParaResumir = { titulo: item.titulo, link: item.link, descripcion: '' };
    const fuenteFicticia = { nombre: item.fuente };
    const [workersAi, haiku] = await Promise.all([
      resumir(env, itemParaResumir, fuenteFicticia, { proveedor: 'workers-ai', textoArticulo, contador, pasada }),
      resumir(env, itemParaResumir, fuenteFicticia, { proveedor: 'haiku', textoArticulo, contador, pasada }),
    ]);
    resultados.push({
      titulo: item.titulo,
      link: item.link,
      articuloExtraido: textoArticulo ? `${textoArticulo.length} caracteres` : 'no se pudo leer, comparado solo con el título',
      'workers-ai': workersAi,
      haiku,
    });
  }

  await registrarMetaPasada(env, {
    pasada,
    subrequestsTotal: contador.externos,
    itemsProcesados: items.length,
    duracionMs: Date.now() - inicio,
  });

  return new Response(JSON.stringify(resultados, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
}

function autorizado(request, env) {
  const secreto = request.headers.get('X-Radar-Secret');
  return Boolean(env.RADAR_SECRET) && comparacionSegura(secreto, env.RADAR_SECRET);
}

function respuestaNoAutorizado() {
  return new Response(JSON.stringify({ error: 'No autorizado' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Comparación en tiempo constante — evita filtrar el secreto por temporización. */
function comparacionSegura(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = new TextEncoder().encode(a);
  const bufB = new TextEncoder().encode(b);
  if (bufA.length !== bufB.length) return false;
  let diferencia = 0;
  for (let i = 0; i < bufA.length; i++) diferencia |= bufA[i] ^ bufB[i];
  return diferencia === 0;
}

async function paginaHoy(env) {
  const hoy = fechaISO(0);
  const ayer = fechaISO(-1);
  const itemsHoy = await leerDia(env, hoy);
  const itemsAyer = await leerDia(env, ayer);
  const panoramaHoy = await env.RADAR_KV.get(`radar:panorama:${hoy}`);
  return new Response(renderDigest({ hoy, ayer, itemsHoy, itemsAyer, panoramaHoy }), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

async function paginaDia(env, fecha) {
  const items = await leerDia(env, fecha);
  const panoramaHoy = await env.RADAR_KV.get(`radar:panorama:${fecha}`);
  return new Response(
    renderDigest({ hoy: fecha, ayer: null, itemsHoy: items, itemsAyer: [], soloUnDia: true, panoramaHoy }),
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

async function paginaFeed(env, origen) {
  const hoy = fechaISO(0);
  const ayer = fechaISO(-1);
  const itemsHoy = await leerDia(env, hoy);
  const itemsAyer = await leerDia(env, ayer);
  return new Response(renderFeedAtom({ origen, items: [...itemsHoy, ...itemsAyer] }), {
    headers: { 'Content-Type': 'application/atom+xml; charset=utf-8' },
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

/**
 * Busca, por link, el item ya presente en esta pasada (hoy) al que fusionar
 * una cobertura duplicada. Solo mira `existentesHoy` (ya en KV) y `nuevos`
 * (recién resumidos en esta misma pasada) — nunca días anteriores, cuya
 * página ya se sirvió y no es segura de mutar retroactivamente.
 */
function buscarObjetivoFusion(link, existentesHoy, nuevos) {
  return nuevos.find((it) => it.link === link) || existentesHoy.find((it) => it.link === link);
}

function fechaISO(offsetDias) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDias);
  return d.toISOString().slice(0, 10);
}

async function ejecutarDigest(env, fuentes, pasada = `${fechaISO(0)}-sin-turno`) {
  const inicio = Date.now();
  const hoy = fechaISO(0);
  const ayer = fechaISO(-1);
  const contadorSubrequests = crearContadorSubrequests();
  let itemsProcesados = 0;

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
      items = await obtenerItems(fuente, contadorSubrequests);
    } catch (err) {
      console.error(`[radar] fallo obteniendo "${fuente.nombre}": ${err.message}`);
      errores[fuente.nombre] = err.message;
      continue;
    }

    let publicados = 0;
    let descartados = 0;
    let fusionados = 0;
    for (const item of items) {
      if (!item.titulo || !item.link) continue;
      if (vistos.has(item.link)) continue;
      if (fuente.tipo === 'github_release' && !esReleaseSignificativo(fuente, item)) continue;

      vistos.add(item.link);
      itemsProcesados++;

      // Fase 2 (memoria semántica, ver DEVLOG.md): antes de gastar una
      // llamada a Haiku, miramos si esto ya es una noticia que tenemos hoy
      // desde otra fuente (fusionar) o si hay cobertura pasada relacionada
      // (contexto para el resumen). Best-effort: si el embedding falla,
      // `vecinos` queda vacío y el item sigue el camino normal de siempre.
      //
      // env.AI.run()/Vectorize SÍ cuentan contra el límite de 50 subrequests
      // (verificado en producción, ver memoria.js) — por debajo del
      // presupuesto se intenta; por encima, se salta fase 2 para no dejar
      // sin margen a Haiku, que es lo que de verdad no puede fallar.
      let tipo = 'nuevo';
      let vecino = null;
      let embedding = null;
      if (contadorSubrequests.externos < MEMORIA.PRESUPUESTO_SUBREQUESTS_MAX) {
        const textoEmbedding = `${item.titulo}\n${(item.descripcion || '').slice(0, 500)}`;
        embedding = await generarEmbedding(env, textoEmbedding, contadorSubrequests);
        const vecinos = embedding ? await buscarVecinos(env, embedding, MEMORIA.TOP_K, contadorSubrequests) : [];
        ({ tipo, vecino } = clasificarVecinos(vecinos, hoy));
        await registrarDedup(env, {
          pasada,
          itemLink: item.link,
          clasificacion: tipo,
          similitudTop: vecino?.score,
          vecinoLink: vecino?.link,
        });
      } else {
        await registrarDedup(env, { pasada, itemLink: item.link, clasificacion: 'sin_presupuesto' });
      }

      if (tipo === 'duplicado') {
        const objetivo = buscarObjetivoFusion(vecino.link, existentesHoy, nuevos);
        if (objetivo) {
          objetivo.fuentesAdicionales = objetivo.fuentesAdicionales || [];
          if (!objetivo.fuentesAdicionales.includes(fuente.nombre)) objetivo.fuentesAdicionales.push(fuente.nombre);
          fusionados++;
        } else {
          // Duplicado de una pieza fuera de la ventana de hoy (ej. de ayer):
          // no hay nada que mutar de forma segura (esa página ya está
          // servida), así que simplemente no se republica.
          descartados++;
        }
        continue;
      }

      // Haiku, no Workers AI: en la comparación de hoy sus resúmenes fueron
      // sistemáticamente más ricos (fechas, cifras concretas) con el mismo
      // snippet de RSS. Decisión provisional — revisar si compensa el coste
      // a medida que crezca el volumen.
      const { relevante, resumen, contexto, relevancia } = await resumir(env, item, fuente, {
        proveedor: 'haiku',
        contador: contadorSubrequests,
        pasada,
        contexto: tipo === 'relacionado' ? vecino : null,
      });
      if (!relevante) {
        descartados++;
        continue;
      }
      const nuevo = {
        titulo: item.titulo,
        resumen,
        link: item.link,
        fuente: fuente.nombre,
        fecha: item.fecha || new Date().toISOString(),
        relevancia: relevancia ?? null,
      };
      if (contexto) nuevo.contexto = { titulo: contexto.titulo, link: contexto.link };
      nuevos.push(nuevo);
      publicados++;

      // Solo se guarda vector de lo que realmente se publica — así los
      // vecinos futuros son siempre piezas reales del digest, nunca ruido
      // descartado por baja relevancia.
      if (embedding) await guardarVector(env, { link: item.link, titulo: item.titulo, fecha: nuevo.fecha }, embedding, contadorSubrequests);
    }
    porFuente[fuente.nombre] =
      descartados > 0 || fusionados > 0
        ? `${publicados} (+${descartados} descartadas${fusionados > 0 ? `, +${fusionados} fusionadas` : ''})`
        : publicados;
  }

  if (nuevos.length > 0) {
    const claveDia = `radar:items:${hoy}`;
    const todosHoy = [...existentesHoy, ...nuevos];
    await env.RADAR_KV.put(claveDia, JSON.stringify(todosHoy), { expirationTtl: TTL_DIA });

    // Panorama del día: se recalcula sobre el acumulado cada vez que hay
    // piezas nuevas, así que refleja "lo publicado hasta ahora", no un cierre
    // de día fijo. Best-effort — si falla, el digest se sirve igual sin él.
    const panorama = await generarPanorama(env, todosHoy, { contador: contadorSubrequests, pasada });
    if (panorama) {
      await env.RADAR_KV.put(`radar:panorama:${hoy}`, panorama, { expirationTtl: TTL_DIA });
    }
  }

  await registrarMetaPasada(env, {
    pasada,
    subrequestsTotal: contadorSubrequests.externos,
    itemsProcesados,
    duracionMs: Date.now() - inicio,
  });

  const fuentesConError = Object.keys(errores).length;
  const resumenLinea = `[radar] pasada ${hoy}: ${nuevos.length} nuevas, ${fuentesConError}/${fuentes.length} fuentes con error, ${contadorSubrequests.externos} subrequests externos`;
  if (fuentesConError === fuentes.length && fuentes.length > 0) {
    // Fallo total: todas las fuentes de esta pasada fallaron. Sin canal de
    // alertas activo por ahora — esto queda como la señal a buscar con
    // `wrangler tail` o en el dashboard si algo raro pasa.
    console.error(`${resumenLinea} — FALLO TOTAL DE LA PASADA`);
  } else {
    console.log(resumenLinea);
  }

  return { fecha: hoy, totalNuevos: nuevos.length, porFuente, errores, subrequestsExternos: contadorSubrequests.externos };
}
