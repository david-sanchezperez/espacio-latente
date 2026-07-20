/**
 * Contabilidad de llamadas LLM (fase 1 de v0.2 — ver DEVLOG.md). Registra
 * cada llamada a un modelo, y una fila de resumen por pasada, en D1
 * (`radar_llamadas_llm`). Puramente observacional: un fallo aquí NUNCA debe
 * tirar abajo el pipeline, así que toda escritura es best-effort con catch
 * propio.
 */
import { PRECIOS_USD_POR_TOKEN } from './config.js';

const CARACTERES_POR_TOKEN_ESTIMADO = 4; // solo para estimar coste cuando la llamada falló y no hay `usage` real

/** Crea un contador de subrequests externos (fetch a dominios fuera de Cloudflare) para una pasada. */
export function crearContadorSubrequests() {
  return { externos: 0 };
}

/** Envoltorio de fetch que cuenta la llamada ANTES de esperar la respuesta — así un timeout/error también cuenta. */
export function fetchContado(contador, url, opciones) {
  if (contador) contador.externos++;
  return fetch(url, opciones);
}

export function calcularCoste(modelo, tokensIn, tokensOut) {
  const precio = PRECIOS_USD_POR_TOKEN[modelo];
  if (!precio) return 0;
  return tokensIn * precio.entrada + tokensOut * precio.salida;
}

export function estimarTokens(texto) {
  return Math.ceil((texto || '').length / CARACTERES_POR_TOKEN_ESTIMADO);
}

/**
 * Registra una llamada a un modelo. `resultado` es 'ok' cuando `tokensIn`/
 * `tokensOut` vienen del campo `usage` real de la respuesta del proveedor;
 * 'error_estimado' cuando la llamada falló y los tokens son una estimación
 * por longitud de texto (ver `estimarTokens`) — nunca se mezclan ambos
 * casos bajo 'ok'.
 */
export async function registrarLlamada(env, fila) {
  const {
    pasada,
    modelo,
    proposito,
    tokensIn,
    tokensOut,
    itemLink = null,
    fuente = null,
    resultado,
  } = fila;
  const costeUsd = calcularCoste(modelo, tokensIn, tokensOut);
  try {
    await env.RADAR_DB.prepare(
      `INSERT INTO radar_llamadas_llm
        (pasada, timestamp, modelo, proposito, tokens_in, tokens_out, coste_usd, item_link, fuente, resultado)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(pasada, new Date().toISOString(), modelo, proposito, tokensIn, tokensOut, costeUsd, itemLink, fuente, resultado)
      .run();
  } catch (err) {
    console.error(`[radar] fallo escribiendo en D1 (llamada ${proposito}/${modelo}): ${err.message}`);
  }
  return costeUsd;
}

/** Fila de resumen al cierre de una pasada — mismo D1, proposito: 'meta_pasada'. */
export async function registrarMetaPasada(env, { pasada, subrequestsTotal, itemsProcesados, duracionMs }) {
  try {
    await env.RADAR_DB.prepare(
      `INSERT INTO radar_llamadas_llm
        (pasada, timestamp, modelo, proposito, tokens_in, tokens_out, coste_usd, item_link, fuente, resultado,
         subrequests_total, items_procesados, duracion_ms)
       VALUES (?, ?, NULL, 'meta_pasada', 0, 0, 0, NULL, NULL, 'ok', ?, ?, ?)`
    )
      .bind(pasada, new Date().toISOString(), subrequestsTotal, itemsProcesados, duracionMs)
      .run();
  } catch (err) {
    console.error(`[radar] fallo escribiendo meta_pasada en D1 (${pasada}): ${err.message}`);
  }
}
