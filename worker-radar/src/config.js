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
