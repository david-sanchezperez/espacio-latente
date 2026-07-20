-- Fase 1 de v0.2 (ver DEVLOG.md): contabilidad de llamadas LLM del radar.
-- Una fila por llamada a modelo (proposito: 'relevancia_resumen', 'comparacion', ...)
-- y una fila de cierre por pasada (proposito: 'meta_pasada') con el conteo de
-- subrequests externos observado, para validar el margen real frente al
-- límite de 50 subrequests/invocación del plan free de Workers.
--
-- Aplicar con:
--   npx wrangler d1 execute radar-costes --file=schema.sql            (local)
--   npx wrangler d1 execute radar-costes --file=schema.sql --remote   (producción)

CREATE TABLE IF NOT EXISTS radar_llamadas_llm (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pasada TEXT NOT NULL,               -- ej. "2026-07-20-am", "2026-07-20-manual", "2026-07-20-comparacion"
  timestamp TEXT NOT NULL,            -- ISO 8601, hora de escritura de la fila
  modelo TEXT,                        -- NULL en filas meta_pasada
  proposito TEXT NOT NULL,            -- 'relevancia_resumen' | 'comparacion' | 'meta_pasada'
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  coste_usd REAL NOT NULL DEFAULT 0,
  item_link TEXT,
  fuente TEXT,
  resultado TEXT NOT NULL,            -- 'ok' | 'error_estimado'
  subrequests_total INTEGER,          -- solo en filas meta_pasada
  items_procesados INTEGER,           -- solo en filas meta_pasada
  duracion_ms INTEGER                 -- solo en filas meta_pasada
);

CREATE INDEX IF NOT EXISTS idx_radar_llamadas_pasada ON radar_llamadas_llm (pasada);
CREATE INDEX IF NOT EXISTS idx_radar_llamadas_proposito ON radar_llamadas_llm (proposito);
