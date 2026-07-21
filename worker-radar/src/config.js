/**
 * Configuración central del radar: modelos, precios, umbrales, presupuesto.
 * Fase 1 de v0.2 (ver DEVLOG.md) — nace aquí para dejar de tener estas
 * constantes repartidas entre resumen.js e index.js. Deliberadamente JS y
 * no YAML: es el propio Worker quien lo importa, sin parseo ni dependencia
 * extra.
 */

export const MODELOS = {
  WORKERS_AI: '@cf/meta/llama-3.2-3b-instruct',
  HAIKU: 'claude-haiku-4-5',
  EMBEDDING: '@cf/baai/bge-m3',
};

// USD por token, de la documentación de precios de cada proveedor (no por
// neurona: así el coste guardado en D1 es comparable entre proveedores sin
// tener que convertir neuronas a dólares en cada consulta). Si un proveedor
// cambia precios, se actualiza aquí — el histórico en D1 ya guarda el coste
// calculado en su momento, no se recalcula retroactivamente.
export const PRECIOS_USD_POR_TOKEN = {
  [MODELOS.WORKERS_AI]: { entrada: 0.051 / 1_000_000, salida: 0.34 / 1_000_000 },
  [MODELOS.HAIKU]: { entrada: 1 / 1_000_000, salida: 5 / 1_000_000 },
};

export const RESUMEN = {
  LONGITUD_MAXIMA_CONTENIDO: 8000, // caracteres, ~2000 tokens — cubre snippet o artículo completo
  UMBRAL_RELEVANCIA: 4, // 1-5; a partir de aquí se considera "relevante" y se publica
};

export const ARCHIVO = {
  TTL_DIA_SEGUNDOS: 60 * 60 * 24 * 400, // ~13 meses de archivo en KV
};

// Migración a Queues (ver DEVLOG.md): tamaño de lote de fuentes por mensaje.
// Con 5 fuentes + sus items nuevos por mensaje, el peor caso observado en
// producción (28 fuentes/31 items en una sola invocación = 59 subrequests)
// queda repartido en lotes muy por debajo del límite de 50.
export const COLA = {
  FUENTES_POR_LOTE: 5,
};

// Fase 2 de v0.2 (ver DEVLOG.md): memoria semántica en Vectorize. Dos
// umbrales sobre la misma búsqueda (coseno, 0-1) para dos decisiones
// distintas — arrancan como estimación razonada, no medida: revisar con
// `similitud_top`/`clasificacion` reales en D1 (proposito 'dedup_semantica')
// tras unos días y ajustar aquí si hace falta.
export const MEMORIA = {
  TOP_K: 3,
  // >= esto: misma noticia que ya tenemos hoy, distinta fuente → se fusiona
  // como fuente adicional en vez de resumir nuevo.
  UMBRAL_DUPLICADO: 0.93,
  // >= esto (y < UMBRAL_DUPLICADO): cobertura pasada relacionada → se pasa
  // como contexto a Haiku para enriquecer el resumen, sin fusionar.
  UMBRAL_RELACIONADO: 0.80,
  // Ventana de retención del índice — más allá de esto ya no aporta como
  // contexto "reciente" (ver hipótesis de fase 4 en el DEVLOG: a ~30
  // items/día caben con margen en el free tier de Vectorize).
  VENTANA_DIAS_CONTEXTO: 90,
  // Verificado en producción: env.AI.run()/Vectorize SÍ cuentan contra el
  // límite de 50 subrequests/invocación (ver memoria.js). Por debajo de este
  // umbral de contadorSubrequests.externos se sigue intentando embedding;
  // por encima, se salta fase 2 para el resto del lote y el item sigue el
  // camino normal (Haiku sin contexto/dedup) — mejor perder memoria semántica
  // que perder una noticia real por agotar el presupuesto de subrequests.
  // Haiku nunca se salta (ver index.js), así que el margen entre este valor
  // y 50 es lo que queda para Haiku en el resto del lote una vez se corta la
  // memoria — 30 (no 40) dejó más colchón tras simular el caso extremo de
  // una fuente sin `limite` trayendo sus 20 items por defecto (feed.js)
  // completamente nuevos de golpe (solo plausible el primer día que se
  // añade una fuente, o tras downtime largo).
  PRESUPUESTO_SUBREQUESTS_MAX: 30,
};
