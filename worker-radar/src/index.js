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
 * `RADAR_QUEUE`, más un mensaje retrasado de cierre de pasada que genera el
 * panorama del día una sola vez. Cada mensaje se procesa en su propia
 * invocación del consumer, con su propio presupuesto de 50 subrequests
 * externos — ver DEVLOG.md para el porqué (una sola invocación con las 28
 * fuentes agotaba el límite, confirmado en producción con 59).
 *
 * Despliegue:
 *   cd worker-radar
 *   npx wrangler kv namespace create RADAR_KV   (una vez; copia el id a wrangler.toml)
 *   npx wrangler queues create radar-fuentes    (una vez)
 *   npx wrangler deploy --config ./wrangler.toml
 */
import { FUENTES, prioridadClase, elegirFuentePrincipal } from './sources.js';
import { obtenerItems } from './feed.js';
import { resumir, revisarComoEditor, esReleaseSignificativo, generarPanorama, generarImporta } from './resumen.js';
import { obtenerTextoArticulo } from './articulo.js';
import { renderDigest, renderArchivoIndice, renderError, renderFeedAtom, renderRobots, renderSitemap } from './paginas.js';
import { ARCHIVO, COLA, DESCARTADOS, MEMORIA, PRESUPUESTO } from './config.js';
import { crearContadorSubrequests, registrarMetaPasada, registrarDedup, resumenDia } from './costes.js';
import { generarEmbeddings, buscarVecinos, guardarVectores, clasificarVecinos } from './memoria.js';

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
      if (partes[0] === 'robots.txt' && partes.length === 1) {
        return new Response(renderRobots(), {
          headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'max-age=86400' },
        });
      }
      if (partes[0] === 'sitemap.xml' && partes.length === 1) {
        return new Response(renderSitemap(await fechasConArchivo(env)), {
          headers: { 'Content-Type': 'application/xml; charset=utf-8' },
        });
      }
      if (partes[0] === 'comparar' && request.method === 'POST') {
        return await paginaComparar(request, env);
      }
      if (partes[0] === 'backfill-fase4' && request.method === 'POST') {
        return await backfillFase4(request, env);
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
   * Consumer de la cola `radar-fuentes`. Dos tipos de mensaje:
   *   - lote de fuentes (`COLA.FUENTES_POR_LOTE`), procesado con
   *     `ejecutarDigest` igual que antes de la migración — el cambio es solo
   *     cuántas fuentes entran en cada invocación, no la lógica de
   *     dedup/resumen/publicación.
   *   - cierre de pasada (`tipo: 'panorama'`), que sintetiza el día UNA vez
   *     en vez de una por lote (ver `cerrarPasada`).
   * `max_concurrency = 1` (wrangler.toml) evita que dos mensajes escriban a
   * la vez en la misma clave de KV del día.
   */
  async queue(batch, env, ctx) {
    for (const mensaje of batch.messages) {
      const { fuentes, pasada, tipo } = mensaje.body;
      try {
        if (tipo === 'panorama') {
          await cerrarPasada(env, pasada);
        } else {
          await ejecutarDigest(env, fuentes, pasada);
        }
        mensaje.ack();
      } catch (err) {
        console.error(`[radar] fallo procesando mensaje de cola (pasada ${pasada}, tipo ${tipo || 'fuentes'}): ${err.message}`);
        mensaje.retry();
      }
    }
  },
};

/**
 * Reparte `fuentes` en lotes de `COLA.FUENTES_POR_LOTE` y encola un mensaje
 * por lote, más un mensaje retrasado de cierre de pasada para el panorama.
 * El panorama va aparte porque es una síntesis del día entero: generarlo en
 * cada lote (como se hacía) gastaba una llamada a Haiku por lote para
 * sobrescribir el resultado anterior.
 */
async function encolarPorLotes(env, fuentes, pasada) {
  const lotes = [];
  for (let i = 0; i < fuentes.length; i += COLA.FUENTES_POR_LOTE) {
    lotes.push(fuentes.slice(i, i + COLA.FUENTES_POR_LOTE));
  }
  await Promise.all(lotes.map((lote) => env.RADAR_QUEUE.send({ fuentes: lote, pasada })));
  await env.RADAR_QUEUE.send(
    { tipo: 'panorama', pasada },
    { delaySeconds: COLA.RETRASO_PANORAMA_SEGUNDOS }
  );
  return lotes.length;
}

/**
 * Cierre de pasada: regenera el panorama del día una sola vez, cuando todos
 * los lotes ya han publicado lo suyo. Idempotente y sin coste si no hay nada
 * nuevo — se guarda cuántas piezas se sintetizaron la última vez y, si el día
 * sigue teniendo las mismas, no se vuelve a llamar a Haiku (importante
 * porque un reintento de la cola volvería a pasar por aquí).
 */
async function cerrarPasada(env, pasada) {
  const hoy = fechaISO(0);
  const items = await leerDia(env, hoy);
  if (items.length === 0) return;

  const claveMeta = `radar:panorama-items:${hoy}`;
  const sintetizadas = parseInt((await env.RADAR_KV.get(claveMeta)) || '0', 10);
  if (sintetizadas === items.length) {
    console.log(`[radar] cierre ${pasada}: panorama ya al día (${items.length} piezas), no se regenera`);
    return;
  }

  const contador = crearContadorSubrequests();
  const panorama = await generarPanorama(env, items, { contador, pasada });
  if (!panorama) return; // best-effort: el digest se sirve igual sin panorama
  await env.RADAR_KV.put(`radar:panorama:${hoy}`, panorama, { expirationTtl: TTL_DIA });
  await env.RADAR_KV.put(claveMeta, String(items.length), { expirationTtl: TTL_DIA });
  console.log(`[radar] cierre ${pasada}: panorama regenerado sobre ${items.length} piezas`);
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
    // DeepSeek es opcional en la comparación: sin DEEPSEEK_API_KEY configurado
    // (fase 4, ver DEVLOG.md), se salta en vez de tumbar toda la comparación —
    // mismo criterio fail-open que el resto del endpoint.
    const [workersAi, haiku, deepseek] = await Promise.all([
      resumir(env, itemParaResumir, fuenteFicticia, { proveedor: 'workers-ai', textoArticulo, contador, pasada }),
      resumir(env, itemParaResumir, fuenteFicticia, { proveedor: 'haiku', textoArticulo, contador, pasada }),
      env.DEEPSEEK_API_KEY
        ? resumir(env, itemParaResumir, fuenteFicticia, { proveedor: 'deepseek', textoArticulo, contador, pasada })
        : Promise.resolve(null),
    ]);
    const resultado = {
      titulo: item.titulo,
      link: item.link,
      articuloExtraido: textoArticulo ? `${textoArticulo.length} caracteres` : 'no se pudo leer, comparado solo con el título',
      'workers-ai': workersAi,
      haiku,
    };
    if (deepseek) resultado.deepseek = deepseek;
    resultados.push(resultado);
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

/**
 * Backfill retroactivo de Fase 4 (ver DEVLOG.md), temporal — mismo criterio
 * que `/backfill-memoria` en fase 2: protegido, se retira del Worker una vez
 * completado. Sobre CADA día ya archivado en KV, sin volver a leer los
 * artículos originales ni repetir la evaluación de relevancia:
 *   1. Reordena la fuente principal de piezas fusionadas por prioridad de
 *      clase (`elegirFuentePrincipal`) — gratis, no llama a ningún modelo.
 *   2. Genera `porQueImporta` para piezas que no lo tengan (`generarImporta`)
 *      — 1 llamada a Haiku por pieza, ~$0.002 cada una.
 * Paginado con `?desde=N` (índice de día, cronológico ascendente) porque el
 * archivo completo no cabe en el presupuesto de subrequests de una sola
 * invocación; la respuesta indica `siguienteDesde` si quedó a medias.
 *   curl -X POST "https://radar.espacio-latente.com/backfill-fase4?desde=0" -H "X-Radar-Secret: ..."
 */
async function backfillFase4(request, env) {
  if (!autorizado(request, env)) return respuestaNoAutorizado();
  const inicio = Date.now();
  const desde = parseInt(new URL(request.url).searchParams.get('desde') || '0', 10) || 0;
  const fechasAsc = [...(await fechasConArchivo(env))].reverse();
  const contador = crearContadorSubrequests();
  const pasada = `backfill-fase4-desde-${desde}`;

  let diasProcesados = 0;
  let itemsReordenados = 0;
  let importaGenerados = 0;
  let siguienteDesde = null;

  for (let i = desde; i < fechasAsc.length; i++) {
    if (contador.externos >= PRESUPUESTO.SUBREQUESTS_DURO) {
      siguienteDesde = i;
      break;
    }
    const fecha = fechasAsc[i];
    const items = await leerDia(env, fecha);
    let cambios = false;
    let presupuestoAgotadoEnEsteDia = false;

    for (const item of items) {
      if (item.fuentesAdicionales?.length) {
        const principal = elegirFuentePrincipal([item.fuente, ...item.fuentesAdicionales]);
        if (principal !== item.fuente) {
          item.fuentesAdicionales = [item.fuente, ...item.fuentesAdicionales].filter((n) => n !== principal);
          item.fuente = principal;
          itemsReordenados++;
          cambios = true;
        }
      }
      if (!item.porQueImporta) {
        if (contador.externos >= PRESUPUESTO.SUBREQUESTS_DURO) {
          // Presupuesto agotado a MITAD de este día: no avanzar al siguiente
          // (`siguienteDesde` apunta a este mismo día `i`, no a `i + 1`) — si
          // no, las piezas de este día que aún faltan por procesar se
          // saltarían para siempre, porque el backfill solo avanza hacia
          // adelante por índice de día.
          presupuestoAgotadoEnEsteDia = true;
          continue;
        }
        const porQueImporta = await generarImporta(env, item, { contador, pasada });
        if (porQueImporta) {
          item.porQueImporta = porQueImporta;
          importaGenerados++;
          cambios = true;
        }
      }
    }

    if (cambios) {
      await env.RADAR_KV.put(`radar:items:${fecha}`, JSON.stringify(items), { expirationTtl: TTL_DIA });
    }
    diasProcesados++;
    if (presupuestoAgotadoEnEsteDia) {
      siguienteDesde = i;
      break;
    }
  }

  await registrarMetaPasada(env, {
    pasada,
    subrequestsTotal: contador.externos,
    itemsProcesados: importaGenerados,
    duracionMs: Date.now() - inicio,
  });

  return new Response(
    JSON.stringify(
      { diasProcesados, diasTotales: fechasAsc.length, itemsReordenados, importaGenerados, siguienteDesde },
      null,
      2
    ),
    { headers: { 'Content-Type': 'application/json' } }
  );
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
  const costesHoy = await resumenDia(env, hoy);
  return new Response(renderDigest({ hoy, ayer, itemsHoy, itemsAyer, panoramaHoy, costesHoy }), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

async function paginaDia(env, fecha) {
  const items = await leerDia(env, fecha);
  const panoramaHoy = await env.RADAR_KV.get(`radar:panorama:${fecha}`);
  const costesHoy = await resumenDia(env, fecha);
  return new Response(
    renderDigest({ hoy: fecha, ayer: null, itemsHoy: items, itemsAyer: [], soloUnDia: true, panoramaHoy, costesHoy }),
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

/** Fechas con digest guardado, de más reciente a más antigua. */
async function fechasConArchivo(env) {
  const lista = await env.RADAR_KV.list({ prefix: 'radar:items:' });
  return lista.keys
    .map((k) => k.name.replace('radar:items:', ''))
    .sort()
    .reverse();
}

async function paginaArchivoIndice(env) {
  return new Response(renderArchivoIndice(await fechasConArchivo(env)), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

async function leerDia(env, fecha) {
  const raw = await env.RADAR_KV.get(`radar:items:${fecha}`);
  return raw ? JSON.parse(raw) : [];
}

/**
 * Links ya evaluados y descartados (baja relevancia, o duplicado de una pieza
 * fuera de la ventana de hoy). Sin esta memoria corta, un item descartado no
 * deja rastro en ninguna parte y se vuelve a pagar en la siguiente pasada que
 * lo encuentre — `feed.js` mira las últimas ~30h y cada fuente se revisa cada
 * 24h, así que la ventana se solapa siempre. Ver `DESCARTADOS` en config.js.
 */
async function leerDescartados(env, fecha) {
  const raw = await env.RADAR_KV.get(`radar:descartados:${fecha}`);
  return raw ? JSON.parse(raw) : [];
}

async function anotarDescartados(env, fecha, links) {
  const union = [...new Set([...(await leerDescartados(env, fecha)), ...links])];
  await env.RADAR_KV.put(`radar:descartados:${fecha}`, JSON.stringify(union), {
    expirationTtl: DESCARTADOS.TTL_SEGUNDOS,
  });
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

/**
 * Texto que representa a un item en el espacio de embeddings: título + un
 * trozo de la descripción. Corto a propósito — el snippet largo del RSS
 * añade ruido de plantilla (créditos, "leer más") que empuja a todas las
 * piezas de una misma fuente a parecerse entre sí.
 */
function textoParaEmbedding(item) {
  return `${item.titulo}\n${(item.descripcion || '').slice(0, 500)}`;
}

function fechaISO(offsetDias) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDias);
  return d.toISOString().slice(0, 10);
}

/** Exportada solo para los tests (`test/digest.test.mjs`); en producción se llama desde `queue()`. */
export async function ejecutarDigest(env, fuentes, pasada = `${fechaISO(0)}-sin-turno`) {
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
  // Lo ya evaluado y descartado en las últimas pasadas: no se vuelve a pagar.
  const yaDescartados = new Set([...(await leerDescartados(env, hoy)), ...(await leerDescartados(env, ayer))]);
  const descartadosNuevos = [];
  const descartar = (link) => {
    yaDescartados.add(link);
    descartadosNuevos.push(link);
  };

  const nuevos = [];
  const vectoresPendientes = [];
  const porFuente = {};
  const errores = {};
  // Una fusión sobre una pieza que ya estaba en KV muta `existentesHoy`; si
  // el lote no publica nada nuevo, esa mutación se perdería sin este flag.
  let huboCambiosEnExistentes = false;
  let cortadoPorPresupuesto = false;

  for (const fuente of fuentes) {
    if (contadorSubrequests.externos >= PRESUPUESTO.SUBREQUESTS_DURO) {
      cortadoPorPresupuesto = true;
      break;
    }

    let items;
    try {
      items = await obtenerItems(fuente, contadorSubrequests);
    } catch (err) {
      console.error(`[radar] fallo obteniendo "${fuente.nombre}": ${err.message}`);
      errores[fuente.nombre] = err.message;
      continue;
    }

    // Primero se decide qué items son candidatos de verdad; así los
    // embeddings de todos ellos se piden en UNA llamada (ver
    // `generarEmbeddings`) en vez de una por item.
    const candidatos = [];
    let reciclados = 0;
    for (const item of items) {
      if (!item.titulo || !item.link) continue;
      if (vistos.has(item.link)) continue;
      if (yaDescartados.has(item.link)) {
        reciclados++;
        continue;
      }
      if (fuente.tipo === 'github_release' && !esReleaseSignificativo(fuente, item)) continue;
      vistos.add(item.link);
      candidatos.push(item);
    }

    // Fase 2 (memoria semántica, ver DEVLOG.md): antes de gastar una llamada
    // a Haiku, miramos si esto ya es una noticia que tenemos hoy desde otra
    // fuente (fusionar) o si hay cobertura pasada relacionada (contexto para
    // el resumen). Best-effort: sin embedding, el item sigue el camino normal.
    //
    // env.AI.run()/Vectorize SÍ cuentan contra el límite de 50 subrequests
    // (verificado en producción, ver memoria.js) — por debajo del presupuesto
    // se intenta; por encima, se salta fase 2 para no dejar sin margen a
    // Haiku, que es lo que de verdad no puede fallar.
    const embeddings =
      contadorSubrequests.externos < MEMORIA.PRESUPUESTO_SUBREQUESTS_MAX
        ? await generarEmbeddings(env, candidatos.map(textoParaEmbedding), contadorSubrequests)
        : [];

    let publicados = 0;
    let descartados = 0;
    let fusionados = 0;
    for (const [i, item] of candidatos.entries()) {
      // Tope duro: por encima de esto se deja de procesar. Lo que quede sin
      // ver no se ha escrito en KV, así que la siguiente pasada lo recoge —
      // mejor aplazar una noticia que reventar la invocación entera.
      if (contadorSubrequests.externos >= PRESUPUESTO.SUBREQUESTS_DURO) {
        cortadoPorPresupuesto = true;
        break;
      }
      itemsProcesados++;

      const embedding = embeddings[i] || null;
      const hayPresupuestoMemoria = contadorSubrequests.externos < MEMORIA.PRESUPUESTO_SUBREQUESTS_MAX;
      let tipo = 'nuevo';
      let vecino = null;
      if (embedding && hayPresupuestoMemoria) {
        const vecinos = await buscarVecinos(env, embedding, MEMORIA.TOP_K, contadorSubrequests);
        ({ tipo, vecino } = clasificarVecinos(vecinos, hoy));
        await registrarDedup(env, {
          pasada,
          itemLink: item.link,
          clasificacion: tipo,
          similitudTop: vecino?.score,
          vecinoLink: vecino?.link,
        });
      } else {
        await registrarDedup(env, {
          pasada,
          itemLink: item.link,
          // Dos motivos distintos para no tener memoria semántica de un item,
          // y conviene distinguirlos en D1: quedarse sin presupuesto es una
          // decisión del pipeline, que falle el embedding es un incidente.
          clasificacion: hayPresupuestoMemoria ? 'sin_embedding' : 'sin_presupuesto',
        });
      }

      if (tipo === 'duplicado') {
        const objetivo = buscarObjetivoFusion(vecino.link, existentesHoy, nuevos);
        if (objetivo) {
          objetivo.fuentesAdicionales = objetivo.fuentesAdicionales || [];
          const yaVista = objetivo.fuente === fuente.nombre || objetivo.fuentesAdicionales.includes(fuente.nombre);
          if (!yaVista) {
            // Fase 4 (ver DEVLOG.md, punto 6 del plan): al fusionar, preferir
            // como fuente principal la de mayor prioridad (primaria > experta
            // > investigación > media > comunidad, ver sources.js) — no la
            // que llegó primero. Si la nueva fuente pesa más que la actual,
            // se intercambian; si no, se añade como fuente adicional igual
            // que antes.
            if (prioridadClase(fuente.nombre) < prioridadClase(objetivo.fuente)) {
              objetivo.fuentesAdicionales.push(objetivo.fuente);
              objetivo.fuente = fuente.nombre;
            } else {
              objetivo.fuentesAdicionales.push(fuente.nombre);
            }
            if (existentesHoy.includes(objetivo)) huboCambiosEnExistentes = true;
          }
          fusionados++;
        } else {
          // Duplicado de una pieza fuera de la ventana de hoy (ej. de ayer):
          // no hay nada que mutar de forma segura (esa página ya está
          // servida), así que simplemente no se republica.
          descartar(item.link);
          descartados++;
        }
        continue;
      }

      // Fase 4 (ver DEVLOG.md): artículo completo en vez del snippet corto
      // del RSS, también en producción — hasta ahora `obtenerTextoArticulo`
      // solo se ejercía vía /comparar, precisamente para no gastar una
      // subrequest más por pieza. El coste real (Haiku, ~$0.0015-0.002/
      // llamada) es barato de sobra para pagarlo con más texto de entrada;
      // lo que sí sigue siendo un límite de la plataforma, no de dinero, es
      // el propio presupuesto de subrequests — por eso comparte el mismo
      // umbral que la memoria semántica (`MEMORIA.PRESUPUESTO_SUBREQUESTS_MAX`):
      // por debajo, se intenta; por encima, Haiku sigue recibiendo el
      // snippet del RSS en vez de quedarse sin resumir. Fail-open dentro de
      // `obtenerTextoArticulo` (paywall, bot-block, PDF, JS-only): `null`
      // hace que `resumir()` caiga sola al snippet, como ya hacía siempre.
      const textoArticulo =
        contadorSubrequests.externos < MEMORIA.PRESUPUESTO_SUBREQUESTS_MAX
          ? await obtenerTextoArticulo(item.link, contadorSubrequests)
          : null;

      // DeepSeek como primer juez, no Haiku (fase 5, ver DEVLOG.md): el
      // benchmark con artículos reales lo dejó igual o mejor de fiable que
      // Haiku a una fracción del coste, en particular detectando piezas de
      // bajo valor informativo (patrocinado, divulgativo) que Haiku a veces
      // aprobaba solo por encajar con el tema. Haiku pasa a ser el segundo
      // juez (ver más abajo): revisa SOLO lo que DeepSeek ya aprobó.
      const primerJuez = await resumir(env, item, fuente, {
        proveedor: 'deepseek',
        textoArticulo,
        contador: contadorSubrequests,
        pasada,
        contexto: tipo === 'relacionado' ? vecino : null,
      });
      if (!primerJuez.relevante) {
        descartar(item.link);
        descartados++;
        continue;
      }

      // Editor adversarial (fase 5): Haiku revisa el resumen del primer juez
      // buscando alucinaciones o sobreclaim antes de publicar — el rol en el
      // que el benchmark lo mostró más afinado. Solo se ejecuta aquí, sobre
      // lo que ya pasó el filtro de relevancia, así que el coste extra es
      // una fracción pequeña del volumen total evaluado cada día.
      const segundoJuez = await revisarComoEditor(env, item, fuente, primerJuez, {
        textoArticulo,
        contador: contadorSubrequests,
        pasada,
      });
      if (!segundoJuez.aprobado) {
        descartar(item.link);
        descartados++;
        continue;
      }

      const { contexto, relevancia, porQueImporta } = primerJuez;
      const resumen = segundoJuez.resumen;
      const nuevo = {
        titulo: item.titulo,
        resumen,
        link: item.link,
        fuente: fuente.nombre,
        fecha: item.fecha || new Date().toISOString(),
        relevancia: relevancia ?? null,
      };
      if (contexto) nuevo.contexto = { titulo: contexto.titulo, link: contexto.link };
      if (porQueImporta) nuevo.porQueImporta = porQueImporta;
      nuevos.push(nuevo);
      publicados++;

      // Solo se guarda vector de lo que realmente se publica — así los
      // vecinos futuros son siempre piezas reales del digest, nunca ruido
      // descartado por baja relevancia. Se acumulan y se insertan de una vez
      // al cerrar la pasada (ver `guardarVectores`).
      if (embedding) {
        vectoresPendientes.push({ link: item.link, titulo: item.titulo, fecha: nuevo.fecha, vector: embedding });
      }
    }

    const notas = [];
    if (descartados > 0) notas.push(`+${descartados} descartadas`);
    if (fusionados > 0) notas.push(`+${fusionados} fusionadas`);
    if (reciclados > 0) notas.push(`+${reciclados} ya descartadas antes`);
    porFuente[fuente.nombre] = notas.length ? `${publicados} (${notas.join(', ')})` : publicados;
  }

  if (nuevos.length > 0 || huboCambiosEnExistentes) {
    const claveDia = `radar:items:${hoy}`;
    await env.RADAR_KV.put(claveDia, JSON.stringify([...existentesHoy, ...nuevos]), { expirationTtl: TTL_DIA });
  }
  // El panorama ya no se genera aquí: lo hace el mensaje de cierre de pasada
  // (`cerrarPasada`), una vez por pasada en vez de una por lote.
  await guardarVectores(env, vectoresPendientes, contadorSubrequests);
  if (descartadosNuevos.length > 0) await anotarDescartados(env, hoy, descartadosNuevos);

  await registrarMetaPasada(env, {
    pasada,
    subrequestsTotal: contadorSubrequests.externos,
    itemsProcesados,
    duracionMs: Date.now() - inicio,
  });

  const fuentesConError = Object.keys(errores).length;
  const resumenLinea =
    `[radar] pasada ${hoy}: ${nuevos.length} nuevas, ${fuentesConError}/${fuentes.length} fuentes con error, ` +
    `${contadorSubrequests.externos} subrequests externos` +
    (cortadoPorPresupuesto ? ' — CORTADO por tope de subrequests, el resto va a la siguiente pasada' : '');
  if (fuentesConError === fuentes.length && fuentes.length > 0) {
    console.error(`${resumenLinea} — FALLO TOTAL DE LA PASADA`);
    await avisarFalloTotal(env, `${resumenLinea} — FALLO TOTAL DE LA PASADA (${Object.keys(errores).join(', ')})`);
  } else {
    console.log(resumenLinea);
  }

  return {
    fecha: hoy,
    totalNuevos: nuevos.length,
    porFuente,
    errores,
    subrequestsExternos: contadorSubrequests.externos,
    cortadoPorPresupuesto,
  };
}

/**
 * Aviso de que TODAS las fuentes de una pasada han fallado — la única señal
 * que de verdad merece interrumpir a alguien (una fuente caída es rutina; que
 * caigan todas suele significar que el propio Worker está roto).
 *
 * Opcional a propósito: si no hay `ALERTA_WEBHOOK` configurado, esto no hace
 * nada y el log de error sigue siendo la única señal, como hasta ahora. Para
 * activarlo basta un webhook que acepte `{ "text": "..." }` (Slack, Discord
 * con `/slack`, ntfy...):
 *   npx wrangler secret put ALERTA_WEBHOOK
 * Best-effort como toda la observabilidad del pipeline: si el aviso falla, se
 * loguea y no se propaga.
 */
async function avisarFalloTotal(env, mensaje) {
  if (!env.ALERTA_WEBHOOK) return;
  try {
    await fetch(env.ALERTA_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: mensaje }),
    });
  } catch (err) {
    console.error(`[radar] fallo enviando alerta de fallo total: ${err.message}`);
  }
}
