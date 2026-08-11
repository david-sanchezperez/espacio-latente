# Técnicas de Deduplicación en Horizon

> Documentación detallada de algoritmos, umbrales, embeddings, hashing y estrategias de similitud.

## Resumen ejecutivo

Horizon implementa **dos niveles de deduplicación** independientes y complementarios: uno determinista basado en URL y otro semántico basado en IA. Ambos operan en etapas distintas del pipeline con criterios configurados por perfil.

---

## 1. Deduplicación determinista por URL (cross-source)

### Ubicación en el pipeline

Ocurre en la etapa **3 del pipeline** (`merge_cross_source_duplicates`), inmediatamente después de la recolección (`fetch_all_sources`) y antes del análisis con IA.

### Algoritmo

Archivo relevante: `src/orchestrator.py`, función `_deduplication_url_key()` y `merge_cross_source_duplicates()`.

1. **Normalización de URL** (`_deduplication_url_key`):
   - Convierte el esquema a minúsculas (`scheme.lower()`)
   - Convierte el hostname a minúsculas
   - Elimina el puerto cuando es el puerto por defecto (`http:80`, `https:443`)
   - Elimina trailing slash de la path (`path.rstrip("/")`)
   - **Limpia tracking parameters**: elimina todos los parámetros `utm_*` y una lista de 13+ parámetros de tracking conocidos:
     ```
     _ga, dclid, fbclid, gclid, igshid, li_fat_id, 
     mc_cid, mc_eid, msclkid, ttclid, twclid, vero_id
     ```
   - Los parámetros de query restantes se preservan en orden original

2. **Agrupación por clave compuesta**: `(url_normalizada, perfil_solicitado)` — misma URL con distinto perfil explícito se trata como items separados.

3. **Selección del primario**: dentro de cada grupo de duplicados, se elige el item con `content` más largo como primario.

4. **Fusión de metadata**: el primario hereda todos los metadatos no presentes de los duplicados (engagement, subreddit, discussion URLs, etc.)

5. **Concatenación de contenido**: el contenido de los duplicados se añade al final del primario con prefijo `--- From {source_type} ---`.

6. **Registro de fuentes**: se guarda en `metadata["merged_sources"]` la lista de source types fusionados.

### Características clave

| Aspecto | Detalle |
|---|---|
| **Tipo** | Determinista, basado en reglas de URL |
| **Embeddings** | No usa |
| **Hashing** | No usa hash criptográfico; clave compuesta por tupla Python |
| **Umbral** | Coincidencia exacta de URL normalizada (binario) |
| **Contexto** | Respeta el perfil solicitado: misma URL + distinto perfil = items distintos |
| **Costo** | Cero llamadas a IA |
| **Configurabilidad** | No configurable — siempre activo |

---

## 2. Deduplicación semántica por tópicos (topic dedup)

### Ubicación en el pipeline

Ocurre en la etapa **5** del pipeline (`merge_topic_duplicates`), después del análisis con IA y filtrado por score, pero antes del enrichment. Se ejecuta **por perfil** y es configurable por usuario.

### Algoritmo

Archivos relevantes: `src/orchestrator.py` (función `merge_topic_duplicates`), `src/ai/prompting/deduplication.py`.

1. **Ordenación previa**: los items ya están ordenados por score descendente (el primario de cada grupo es siempre el de mayor score).

2. **Construcción del prompt**: para cada item se envía al LLM:
   - `[índice] Título`
   - `Tags: tag1, tag2, ...`
   - `Summary: resumen de una frase`

3. **Llamada única al LLM**: todos los items de un mismo perfil se envían en **una sola llamada** a la IA (no N llamadas).

4. **Respuesta esperada**:
   ```json
   {
     "duplicates": [[<primary_idx>, <dup_idx>, ...], ...]
   }
   ```
   - Solo se listan los grupos con 2+ items
   - El primer índice de cada grupo es el primario a conservar
   - `{"duplicates": []}` indica que no hay duplicados

5. **Fusión de contenido**: los comentarios/contenido del duplicado se concatenan al primario con prefijo `--- From {source_type} ---`.

6. **Fallback**: si la llamada a IA falla o la respuesta no se puede parsear, se devuelven todos los items sin modificar (fail-open).

### System prompt de deduplicación

```
You are a news deduplication assistant. Identify groups of news items 
that cover the exact same real-world event, release, or announcement.

Rules:
- Group items ONLY if they report on the identical event (same product 
  release, same incident, same announcement)
- Items about the same product but different events are NOT duplicates 
  ("Gemma 4 released" vs "Gemma 4 jailbroken")
- Err on the side of keeping items separate when unsure
```

### Características clave

| Aspecto | Detalle |
|---|---|
| **Tipo** | Semántico, basado en LLM |
| **Embeddings** | No usa embeddings vectoriales |
| **Similitud** | Evaluada por el LLM (comprensión semántica, no coseno) |
| **Modelo** | El mismo configurado para análisis (cualquier provider soportado) |
| **Umbral** | Decisión binaria del LLM (duplicado o no), sin score numérico |
| **Costo** | 1 llamada a IA por perfil con items (idealmente pocos grupos grandes) |
| **Configurabilidad** | `topic_dedup: true/false` por perfil en `profile_settings` |

---

## 3. Comparación con la deduplicación de El Radar

| Dimensión | Horizon | El Radar |
|---|---|---|
| **Dedup por URL** | Sí (normalización avanzada: tracking params, puertos, trailing slash) | Sí (comparación exacta de link en KV) |
| **Dedup semántica** | LLM-based (evalúa títulos+tags+summaries juntos) | Vectorial (embeddings `bge-m3` + Vectorize con coseno) |
| **Modelo de embedding** | No usa embeddings para dedup | `bge-m3` (Workers AI) |
| **Umbral de similitud** | Criterio cualitativo del LLM | `UMBRAL_DUPLICADO: 0.93` (coseno), calibrado empíricamente |
| **Memoria histórica** | No — solo compara items dentro de la misma pasada | Sí — Vectorize con ventana de 90 días, TTL en KV |
| **Fusión** | Concatena contenido de duplicados al primario | Fusiona fuentes adicionales (`fuentesAdicionales`) |
| **Costo** | 1 llamada LLM por perfil | 1 embedding + 1 consulta Vectorize por item (por lote ahorra) |
| **Dedup cross-pasada** | No (solo intra-run) | Sí (Vectorize mantiene histórico, KV evita reprocesar) |
| **Memoria de descartados** | No | Sí (`radar:descartados:{fecha}`, TTL 72h) |

---

## 4. Diagrama de flujo de deduplicación en Horizon

```
┌─────────────────────────────────────────────────────────────┐
│                    PIPELINE DE DEDUPLICACIÓN                 │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. FETCH (todas las fuentes en paralelo)                   │
│     │                                                       │
│     ▼                                                       │
│  2. DEDUP POR URL (determinista)                            │
│     ├── Normalizar URL (esquema↓, host↓, puerto default→ø,  │
│     │   strip tracking params, path rstrip /)               │
│     ├── Agrupar por (url_norm, profile)                     │
│     ├── Primario = más contenido                            │
│     └── Fusionar metadata + concatenar contenido            │
│     │                                                       │
│     ▼                                                       │
│  3. ANALYZE (IA: clasificar, puntuar 0-10, resumir, tags)   │
│     │                                                       │
│     ▼                                                       │
│  4. FILTER (pasar solo items ≥ threshold por perfil)        │
│     │                                                       │
│     ▼                                                       │
│  5. TOPIC DEDUP (semántico, por perfil)                     │
│     ├── Agrupar items por perfil                            │
│     ├── Si perfil tiene topic_dedup: true                   │
│     │   ├── Enviar títulos+tags+summaries al LLM            │
│     │   ├── LLM devuelve grupos de duplicados               │
│     │   └── Fusionar contenido de duplicados → primario     │
│     └── Si perfil tiene topic_dedup: false → sin cambios    │
│     │                                                       │
│     ▼                                                       │
│  6. ENRICH (web search, generar bloques localizados)        │
│     │                                                       │
│     ▼                                                       │
│  7. SUMMARIZE → DELIVER                                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 5. Fortalezas y limitaciones

### Fortalezas
- **Dos niveles complementarios**: URL (rápido, determinista) + semántico (inteligente)
- **Limpieza de tracking params**: evita falsos duplicados por UTMs
- **Respeto de perfiles**: misma URL con distinto perfil no se fusiona incorrectamente
- **Fail-open**: si la dedup semántica falla, se preservan todos los items
- **Configurable por perfil**: desactivar para blogs/tutorials donde no aplica

### Limitaciones
- **Sin memoria cross-run**: la dedup semántica solo compara items de la misma ejecución. Una noticia que sale en dos pasadas distintas (ej. mañana y tarde) no se detecta.
- **Sin embeddings vectoriales**: depende exclusivamente del razonamiento del LLM, sin similaridad numérica como fallback
- **Sin umbral calibrable**: la decisión del LLM es binaria, sin score intermedio para ajustar sensibilidad
- **Costo de LLM**: una llamada adicional por perfil (aunque agrupa todos los items)
- **Sin registro histórico de descartados**: items descartados en una pasada se re-evalúan en la siguiente
