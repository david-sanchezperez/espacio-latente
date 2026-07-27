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
 *
 * Y por eso mismo el embedding y la inserción se hacen POR LOTES, no por
 * item: `bge-m3` acepta varios textos en una llamada y Vectorize acepta
 * varios vectores en un `insert`, así que lo que costaba 2 subrequests por
 * item cuesta ahora ~2 por lote. La consulta (`buscarVecinos`) es la única
 * que sigue siendo una por item — no hay forma de agrupar búsquedas.
 */
import { MODELOS, MEMORIA } from './config.js';

/**
 * Genera los embeddings de varios textos en UNA sola llamada a Workers AI.
 * `bge-m3` acepta un array en `text`, así que N items nuevos de una fuente
 * cuestan 1 subrequest en vez de N — la diferencia que hace que la memoria
 * semántica quepa en el presupuesto (antes ~46% de los items acababan en
 * `sin_presupuesto`, ver DEVLOG.md).
 *
 * Devuelve un array alineado con `textos` (misma longitud, mismo orden), con
 * `null` en las posiciones sin vector. Si la llamada entera falla, devuelve
 * un array de `null`s — el llamador trata cada `null` como "sin memoria
 * semántica para este item" y sigue el camino normal.
 */
export async function generarEmbeddings(env, textos, contador = null) {
  if (!textos.length) return [];
  const vectores = new Array(textos.length).fill(null);
  // Workers AI acota el tamaño del batch de embeddings; los lotes reales de
  // este pipeline son de pocos items, pero una fuente sin `limite` puede
  // traer 20 de golpe: trocear evita depender del límite exacto del modelo.
  for (let inicio = 0; inicio < textos.length; inicio += MEMORIA.EMBEDDINGS_POR_LLAMADA) {
    const trozo = textos.slice(inicio, inicio + MEMORIA.EMBEDDINGS_POR_LLAMADA);
    try {
      if (contador) contador.externos++;
      const respuesta = await env.AI.run(MODELOS.EMBEDDING, { text: trozo });
      const datos = respuesta?.data || [];
      trozo.forEach((_, i) => {
        const vector = datos[i];
        if (Array.isArray(vector) && vector.length > 0) vectores[inicio + i] = vector;
      });
    } catch (err) {
      console.error(`[radar] fallo generando embeddings (${trozo.length} textos): ${err.message}`);
    }
  }
  return vectores;
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

/**
 * Guarda de una vez los vectores de lo publicado en esta pasada, para que
 * futuras pasadas los encuentren como vecinos. Un solo `insert` para todo el
 * lote (Vectorize acepta el array) en vez de uno por pieza: mismo ahorro de
 * subrequests que `generarEmbeddings`.
 * `entradas`: [{ link, titulo, fecha, vector }].
 */
export async function guardarVectores(env, entradas, contador = null) {
  if (!entradas.length) return;
  try {
    const vectores = await Promise.all(
      entradas.map(async ({ link, titulo, fecha, vector }) => ({
        id: await idDesdeLink(link),
        values: vector,
        metadata: { link, titulo, fecha },
      }))
    );
    if (contador) contador.externos++;
    await env.RADAR_VECTORIZE.insert(vectores);
  } catch (err) {
    console.error(`[radar] fallo guardando ${entradas.length} vectores en Vectorize: ${err.message}`);
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
