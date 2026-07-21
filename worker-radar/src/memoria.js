/**
 * Memoria semántica del radar (fase 2 de v0.2 — ver DEVLOG.md). Un embedding
 * por item nuevo (Workers AI, `bge-m3`) se compara contra Vectorize para dos
 * decisiones, no una: si el vecino más parecido supera `MEMORIA.UMBRAL_DUPLICADO`
 * es la misma noticia que ya tenemos hoy desde otra fuente (fusionar, no
 * volver a resumir); si supera `MEMORIA.UMBRAL_RELACIONADO` pero no el de
 * duplicado, es cobertura pasada relacionada (contexto para Haiku, no
 * fusión). Ambos comparten índice y embedding — solo cambia el umbral.
 *
 * Igual que el resto de la contabilidad: best-effort. Un fallo aquí nunca
 * debe tirar el pipeline — sin memoria semántica, el item simplemente se
 * trata como si no tuviera vecinos (se resume y publica como hoy, sin fase 2).
 *
 * IMPORTANTE (verificado en producción, corrige una suposición de fase 1):
 * `env.AI.run()` y las llamadas a `env.RADAR_VECTORIZE.*` SÍ cuentan contra
 * el límite de 50 subrequests/invocación del plan free — no comparten un
 * techo interno distinto y más alto, como asumía el DEVLOG de fase 1. Se
 * confirmó con `/backfill-memoria` sobre 69 items en una sola invocación:
 * los primeros 50 `env.AI.run()` funcionaron, el 51 en adelante falló con
 * "Too many subrequests by single Worker invocation". Por eso estas
 * funciones aceptan el mismo `contador` que `fetchContado` (costes.js) — así
 * `subrequests_total` en D1 refleja el gasto real, y `index.js` puede cortar
 * la memoria semántica antes de quedarse sin presupuesto para Haiku.
 */
import { MODELOS, MEMORIA } from './config.js';

/**
 * Genera el embedding de un texto. Devuelve `null` si Workers AI falla (no
 * hay binding roto que valga la pena reintentar aquí) — el llamador debe
 * tratar `null` como "sin memoria semántica disponible para este item".
 */
export async function generarEmbedding(env, texto, contador = null) {
  try {
    if (contador) contador.externos++;
    const respuesta = await env.AI.run(MODELOS.EMBEDDING, { text: [texto] });
    const vector = respuesta?.data?.[0];
    return Array.isArray(vector) && vector.length > 0 ? vector : null;
  } catch (err) {
    console.error(`[radar] fallo generando embedding: ${err.message}`);
    return null;
  }
}

/**
 * Busca los vecinos más parecidos a `vector` en el índice. Sin filtro de
 * metadata en la consulta (evita depender de índices de metadata en
 * Vectorize) — la ventana de "contexto reciente" (`VENTANA_DIAS_CONTEXTO`)
 * se aplica después, en JS, sobre la fecha guardada en cada vecino.
 * Devuelve [] si Vectorize falla o el índice está vacío.
 */
export async function buscarVecinos(env, vector, topK = MEMORIA.TOP_K, contador = null) {
  try {
    if (contador) contador.externos++;
    const resultado = await env.RADAR_VECTORIZE.query(vector, { topK, returnMetadata: 'all' });
    return (resultado?.matches || []).map((m) => ({
      score: m.score,
      link: m.metadata?.link,
      titulo: m.metadata?.titulo,
      fecha: m.metadata?.fecha,
    }));
  } catch (err) {
    console.error(`[radar] fallo consultando Vectorize: ${err.message}`);
    return [];
  }
}

/** Guarda el vector de un item ya publicado, para que futuras pasadas lo encuentren como vecino. */
export async function guardarVector(env, { link, titulo, fecha }, vector, contador = null) {
  try {
    if (contador) contador.externos++;
    const id = await idDesdeLink(link);
    await env.RADAR_VECTORIZE.insert([{ id, values: vector, metadata: { link, titulo, fecha } }]);
  } catch (err) {
    console.error(`[radar] fallo guardando vector en Vectorize (${link}): ${err.message}`);
  }
}

/**
 * Clasifica los vecinos de un item nuevo contra los dos umbrales. `hoy` es
 * la fecha ISO (YYYY-MM-DD) de la pasada actual, para descartar como
 * "relacionado" vecinos que en realidad son de hoy mismo (esos ya se
 * evalúan como posible duplicado, no como contexto histórico).
 */
export function clasificarVecinos(vecinos, hoy) {
  const mejor = vecinos[0];
  if (mejor && mejor.score >= MEMORIA.UMBRAL_DUPLICADO) {
    return { tipo: 'duplicado', vecino: mejor };
  }
  const limiteVentana = new Date(hoy);
  limiteVentana.setUTCDate(limiteVentana.getUTCDate() - MEMORIA.VENTANA_DIAS_CONTEXTO);
  const relacionado = vecinos.find(
    (v) => v.score >= MEMORIA.UMBRAL_RELACIONADO && v.fecha && (v.fecha.slice(0, 10) !== hoy) && new Date(v.fecha) >= limiteVentana
  );
  if (relacionado) return { tipo: 'relacionado', vecino: relacionado };
  return { tipo: 'nuevo', vecino: mejor || null };
}

/** SHA-256 del link, truncado — Vectorize exige ids compactos y los links no tienen longitud acotada. */
async function idDesdeLink(link) {
  const datos = new TextEncoder().encode(link);
  const hash = await crypto.subtle.digest('SHA-256', datos);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}
