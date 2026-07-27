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

// Memoria corta de lo YA evaluado y descartado (baja relevancia, o duplicado
// de una pieza fuera de la ventana de hoy). Sin esto, un item que Haiku
// puntúa 1-3 no deja rastro en ninguna parte y vuelve a pagarse en la
// siguiente pasada que lo encuentre, porque `feed.js` mira las últimas ~30h y
// cada fuente se revisa cada 24h: la ventana se solapa. 72h de TTL cubre ese
// solape con margen sin bloquear nada de forma permanente.
export const DESCARTADOS = {
  TTL_SEGUNDOS: 60 * 60 * 72,
};

// Migración a Queues (ver DEVLOG.md): tamaño de lote de fuentes por mensaje.
// Con 5 fuentes + sus items nuevos por mensaje, el peor caso observado en
// producción (28 fuentes/31 items en una sola invocación = 59 subrequests)
// queda repartido en lotes muy por debajo del límite de 50.
export const COLA = {
  FUENTES_POR_LOTE: 5,
  // Retraso del mensaje de cierre de pasada (panorama) respecto a los lotes
  // de fuentes. Queues no garantiza orden de entrega, así que el panorama no
  // se encola "el último": se encola retrasado, para que los lotes hayan
  // terminado cuando llegue. Si aun así llegara antes de tiempo, el panorama
  // se generaría sobre menos piezas — no es un fallo, solo una síntesis menos
  // completa, y la siguiente pasada la rehace.
  RETRASO_PANORAMA_SEGUNDOS: 90,
};

// Tope duro de subrequests externos por invocación (el límite real del plan
// free es 50). Al superarlo se deja de procesar items nuevos en esta
// invocación: los que queden sin ver NO se marcan como vistos, así que la
// siguiente pasada los recoge. Es la opción (1) que el DEVLOG de fase 2 dejó
// evaluada pero sin implementar — la garantía dura que
// `MEMORIA.PRESUPUESTO_SUBREQUESTS_MAX` por sí solo no daba, porque Haiku
// nunca se salta.
export const PRESUPUESTO = {
  SUBREQUESTS_DURO: 45,
};

// Fase 2 de v0.2 (ver DEVLOG.md): memoria semántica en Vectorize. Dos
// umbrales sobre la misma búsqueda (coseno, 0-1) para dos decisiones
// distintas — arrancan como estimación razonada, no medida: revisar con
// `similitud_top`/`clasificacion` reales en D1 (proposito 'dedup_semantica')
// tras unos días y ajustar aquí si hace falta.
export const MEMORIA = {
  TOP_K: 3,
  // Cuántos textos van en cada llamada de embeddings. `bge-m3` acepta un
  // array en `text`, así que los items nuevos de una fuente se embeben de
  // una vez (1 subrequest en vez de N) — ver `generarEmbeddings`. 20 es el
  // techo de items que una fuente sin `limite` puede traer (feed.js), así
  // que en la práctica es siempre una sola llamada por fuente.
  EMBEDDINGS_POR_LLAMADA: 20,
  // >= esto: misma noticia que ya tenemos hoy, distinta fuente → se fusiona
  // como fuente adicional en vez de resumir nuevo.
  UMBRAL_DUPLICADO: 0.93,
  // >= esto (y < UMBRAL_DUPLICADO): cobertura pasada relacionada → se pasa
  // como contexto a Haiku para enriquecer el resumen, sin fusionar.
  // Calibrado con datos reales (2026-07-21, ver DEVLOG.md), no a ojo: el
  // único par genuinamente relacionado observado hasta ahora ("Chinese AI
  // models: another Sputnik moment" vs "...Moonshot Kimi K3, Alibaba Qwen",
  // ambos de The Verge) marcó 0.731 — por debajo del 0.80 original, que
  // nunca lo habría detectado. El ruido (pares sin relación real, ej. un
  // paper de XAI vs una app de cámara) se quedó en 0.44-0.591. Bajado a
  // 0.65 para dejar margen a ambos lados de esa separación.
  UMBRAL_RELACIONADO: 0.65,
  // Ventana de retención del índice — más allá de esto ya no aporta como
  // contexto "reciente" (ver hipótesis de fase 4 en el DEVLOG: a ~30
  // items/día caben con margen en el free tier de Vectorize).
  VENTANA_DIAS_CONTEXTO: 90,
  // Verificado en producción: env.AI.run()/Vectorize SÍ cuentan contra el
  // límite de 50 subrequests/invocación (ver memoria.js). Por debajo de este
  // umbral de contadorSubrequests.externos se sigue intentando memoria
  // semántica; por encima, se salta para el resto del lote y el item sigue el
  // camino normal (Haiku sin contexto/dedup) — mejor perder memoria semántica
  // que perder una noticia real por agotar el presupuesto de subrequests.
  //
  // Subido de 30 a 38 al pasar embeddings e inserciones a lotes: antes cada
  // item costaba ~3 subrequests de memoria (embed + consulta + inserción) y
  // el corte saltaba en casi la mitad de los items de una pasada grande (36
  // de 79 en `sin_presupuesto`, ver DEVLOG.md); ahora cuesta ~1 (la consulta)
  // más dos llamadas compartidas por lote. Quien pone la garantía dura frente
  // al límite de 50 ya no es este número sino `PRESUPUESTO.SUBREQUESTS_DURO`.
  PRESUPUESTO_SUBREQUESTS_MAX: 38,
};
