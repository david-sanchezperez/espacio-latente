-- Fase 1 de v0.2 (ver DEVLOG.md): contabilidad de llamadas LLM del radar.
-- Una fila por llamada a modelo (proposito: 'relevancia_resumen', 'comparacion', ...)
-- y una fila de cierre por pasada (proposito: 'meta_pasada') con el conteo de
-- subrequests externos observado, para validar el margen real frente al
-- límite de 50 subrequests/invocación del plan free de Workers.
--
-- Fase 2 (memoria semántica, ver DEVLOG.md): columnas adicionales para filas
-- proposito 'dedup_semantica' — una por item nuevo evaluado contra
-- Vectorize, con la clasificación resultante y el vecino más parecido.
--
-- Aplicar con:
--   npx wrangler d1 execute radar-costes --file=schema.sql            (local)
--   npx wrangler d1 execute radar-costes --file=schema.sql --remote   (producción)
--
-- Sobre una base ya creada con el schema de fase 1 (sin estas columnas),
-- aplicar antes la migración:
--   npx wrangler d1 execute radar-costes --remote --command \
--     "ALTER TABLE radar_llamadas_llm ADD COLUMN clasificacion TEXT; \
--      ALTER TABLE radar_llamadas_llm ADD COLUMN similitud_top REAL; \
--      ALTER TABLE radar_llamadas_llm ADD COLUMN vecino_link TEXT;"

CREATE TABLE IF NOT EXISTS radar_llamadas_llm (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pasada TEXT NOT NULL,               -- ej. "2026-07-20-am", "2026-07-20-manual", "2026-07-20-comparacion"
  timestamp TEXT NOT NULL,            -- ISO 8601, hora de escritura de la fila
  modelo TEXT,                        -- NULL en filas meta_pasada/dedup_semantica
  proposito TEXT NOT NULL,            -- 'relevancia_resumen' | 'comparacion' | 'meta_pasada' | 'dedup_semantica'
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  coste_usd REAL NOT NULL DEFAULT 0,
  item_link TEXT,
  fuente TEXT,
  resultado TEXT NOT NULL,            -- 'ok' | 'error_estimado'
  subrequests_total INTEGER,          -- solo en filas meta_pasada
  items_procesados INTEGER,           -- solo en filas meta_pasada
  duracion_ms INTEGER,                -- solo en filas meta_pasada
  clasificacion TEXT,                 -- solo en filas dedup_semantica: 'duplicado' | 'relacionado' | 'nuevo'
  similitud_top REAL,                 -- solo en filas dedup_semantica: score coseno del vecino más parecido
  vecino_link TEXT                    -- solo en filas dedup_semantica: link de ese vecino
);

CREATE INDEX IF NOT EXISTS idx_radar_llamadas_pasada ON radar_llamadas_llm (pasada);
CREATE INDEX IF NOT EXISTS idx_radar_llamadas_proposito ON radar_llamadas_llm (proposito);
