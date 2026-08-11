# 03 — Técnicas de resumen multilingüe en Horizon

## Resumen ejecutivo

Horizon implementa un sistema de resumen multilingüe en **dos capas** claramente
separadas: (1) generación de contenido enriquecido por IA (abstractivo,
profile-driven, multilingüe) y (2) renderizado programático de ese contenido a
Markdown localizado. Soporta **inglés y chino simplificado** como idiomas de
salida, con una arquitectura extensible a cualquier idioma. **No usa modelos
especializados de summarization**: todo el pipeline de generación de texto pasa
por el mismo modelo LLM configurado por el usuario (Claude, GPT, Gemini, etc.).

---

## 1. Arquitectura del pipeline de resumen

El pipeline completo tiene **tres etapas de IA** más una etapa de renderizado:

```
FETCH → DEDUP → CLASSIFY → ANALYZE → FILTER → ENRICH → RENDER_SUMMARY
                   |           |                    |
              [LLM call 1]  [LLM call 2]       [LLM calls 3-N]
```

### Etapa 1: Classification (clasificación de perfil)

- **Archivo**: `src/ai/classifier.py` + `src/ai/prompting/classification.py`
- **Prompt**: `profiles/<id>/match.md` define qué contenido pertenece a cada perfil
- **Salida**: `{ profile, confidence, reason }` — asigna el ítem a un processing profile
- **Modo de clasificación**: dos modos: `source_override` (explícito en config) o `ai_match` (el LLM elige entre los perfiles cargados)
- **Modelo**: el mismo LLM configurado (no un modelo especializado)
- **Multilingüe**: No — esta etapa es puramente de routing, opera sobre el contenido fuente en su idioma original

### Etapa 2: Analysis (análisis y scoring)

- **Archivo**: `src/ai/analyzer.py` + `src/ai/prompting/analysis.py`
- **Prompt**: `profiles/<id>/analysis.md` define la rúbrica de scoring 0-10
- **Salida**: `{ score (0-10), reason, summary (one-sentence), tags }`
- **El "summary" de esta etapa** es un resumen de **una sola frase** en el idioma del contenido fuente, generado como subproducto del scoring — no es el resumen final del briefing
- **No es multilingüe**: el análisis se hace sobre el contenido fuente tal cual, sin traducción
- **Estrategia**: Abstractiva. El LLM evalúa y condensa en una frase.
- **Content budget**: Configurable por perfil (`analysis_max_chars`, default 1000; blog 16000)
- **Retry**: 3 reintentos con backoff exponencial, más 1 intento de reparación con temperatura 0

### Etapa 3: Enrichment (enriquecimiento multilingüe — la capa principal de resumen)

- **Archivo**: `src/ai/enricher.py` + `src/ai/prompting/enrichment.py`
- **Esta es la etapa que genera el contenido localizado** para cada idioma configurado en `ai.languages`
- **Flujo por item**:
  1. Tool planning: el LLM decide si necesita búsqueda web para algún bloque
  2. Ejecución de herramientas (solo `web_search` por ahora)
  3. Para **cada idioma** en `ai.languages`, genera un `ContentArtifact` completo:
     - Título localizado
     - Bloques de contenido localizados (según el perfil)
     - Referencias a fuentes externas

- **Prompt**: `profiles/<id>/enrichment.md` define el rol del editor, los bloques a generar y las reglas de escritura
- **Instrucción de idioma**: `"Write the complete artifact in Simplified Chinese (language tag zh)"` o `"Write the complete artifact in language en"`
- **Estrategia**: **Abstractiva pura** — el LLM genera texto nuevo en el idioma destino a partir del contenido fuente (que puede estar en cualquier idioma). No hay paso intermedio de traducción.
- **Normalización post-generación**: `src/ai/localization.py` — para `zh`, convierte Traditional Chinese → Simplified Chinese vía `OpenCC (t2s)`. Para `en` y otros idiomas, no aplica normalización.
- **Validación estricta**: Pydantic models validan que los bloques no estén vacíos, que los IDs correspondan al perfil, que los `source_refs` sean válidos
- **Retry**: 2 intentos con reparación (se informa al LLM del error de validación para que corrija)
- **Sin alucinaciones**: reglas `EVIDENCE_RULES` y `UNTRUSTED_INPUT_RULE` compartidas en todas las etapas

### Etapa 4: Summarizer (renderizado programático a Markdown)

- **Archivo**: `src/ai/summarizer.py`
- **No usa IA** — es rendering determinístico de los `ContentArtifact` ya generados
- **Funciones**:
  - `generate_summary()`: briefing diario completo en Markdown con TOC, agrupado por perfil
  - `generate_webhook_overview()`: vista compacta para webhooks
  - `generate_webhook_item()`: mensaje individual por item
- **Localización de UI**: Labels en `en` y `zh` para encabezados, etiquetas, fechas, mensajes de empty state
- **Seguridad**: HTML escaping + Markdown escaping de todo texto no confiable, validación estricta de URLs (solo http/https)
- **Pangu spacing**: Para chino, inserta espacios entre caracteres CJK y ASCII (`大规模 LLM` en vez de `大规模LLM`)

---

## 2. Estrategia de resumen: detalle por perfil

Cada processing profile define **qué bloques** genera y **cómo** debe escribirlos el
LLM. Esto hace que la "estrategia" varíe según el tipo de contenido:

### Perfil `tech-news` (noticias tecnológicas)

| Bloque | Tipo | Descripción |
|--------|------|-------------|
| `summary` | **Primario** (requerido) | 3-5 frases: qué pasó, por qué importa, detalles técnicos clave. Sin subencabezados. |
| `background` | Requerido | 2-3 frases de contexto necesario. Puede usar `web_search`. |
| `impact` | Opcional | 1 frase sobre la consecuencia concreta para los afectados. |
| `community_discussion` | Opcional | 1-2 frases resumiendo consenso/desacuerdo de los comentarios. |

**Estrategia**: Abstractiva con estructura fija. El bloque `summary` es el cuerpo
principal (se renderiza sin heading, directamente bajo el título).

### Perfil `tech-blog` (artículos técnicos largos)

| Bloque | Tipo | Descripción |
|--------|------|-------------|
| `background` | Requerido | 1-2 frases: problema y motivación |
| `solution` | Requerido | La mayor parte del espacio: insight central, mecanismos, evidencia |
| `takeaway` | Requerido | 1-2 frases: tesis o conclusión del autor |

**Estrategia**: Narrativa conectada de 5-8 frases entre los tres bloques (~150-250
palabras en inglés, ~300-500 caracteres en chino). No es un resumen sección por
sección, sino una reconstrucción coherente del argumento. Content budget ampliado
(24000 chars, sampling head-middle-tail).

### Perfil `finance-news` (noticias financieras)

| Bloque | Tipo | Descripción |
|--------|------|-------------|
| `summary` | **Primario** (requerido) | 1-2 frases: evento + cifra/política más relevante |
| `background` | Requerido | 1 frase de contexto (máximo 2) |
| `impact` | Opcional | 1 frase: consecuencia material directa, solo si hay evidencia |

**Estrategia**: Máxima brevedad (3-4 frases total, máximo 5). Lenguaje para no
especialistas. Distingue hechos de pronósticos/rumores. Content budget reducido
(analysis: 4000, enrichment: 8000, sampling: prefix).

### Perfil `ai-creator` (caso especial — solo chino)

| Bloque | Tipo | Descripción |
|--------|------|-------------|
| `summary` | **Primario** (requerido) | 2-4 frases en chino: qué pasó, detalles verificables |
| `why_now` | Opcional | 1-2 frases: por qué es relevante ahora |
| `content_angle` | Opcional | 1 ángulo concreto para crear contenido |
| `community_discussion` | Opcional | Resumen de comentarios si los hay |

**Estrategia**: Íntegramente en chino (el `enrichment.md` está escrito en chino).
Orientado a ayudar a creadores de contenido a decidir si una noticia merece un
vídeo/post.

---

## 3. Idiomas soportados

### Configuración

```json
{
  "ai": {
    "languages": ["en", "zh"]
  }
}
```

- `languages` es un array en `AIConfig` (validado con regex `^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$`)
- Por defecto: `["en"]` (solo inglés)
- Cada idioma listado genera un `ContentArtifact` independiente y un archivo de summary separado
- El renderizado Markdown (`summarizer.py`) usa labels específicos por idioma (`LABELS["en"]`, `LABELS["zh"]`)
- Webhooks pueden filtrar por idioma (`webhook.languages: ["zh"]`)

### Idiomas actualmente implementados con localización completa

| Idioma | Código | Labels UI | Normalización | Pangu | Perfiles con display_name |
|--------|--------|-----------|---------------|-------|--------------------------|
| English | `en` | ✓ (LABELS["en"]) | Sin normalización | No | Nombres por defecto |
| Chinese (Simplified) | `zh` | ✓ (LABELS["zh"]) | OpenCC t2s | Sí | tech-news→科技新闻, tech-blog→科技博客, finance-news→财经新闻, ai-creator→AI创作者雷达 |

### Extensibilidad

El sistema es extensible a cualquier idioma:
1. Añadir el código a `ai.languages` en config (ej. `"ja"`, `"fr"`)
2. Opcional: añadir `LABELS["ja"]` en `summarizer.py` para localizar encabezados/fechas
3. Opcional: añadir `display_names` en `profile.json` para nombres de perfil localizados
4. Opcional: añadir normalización en `localization.py` si el idioma lo requiere
5. El LLM recibe `"Write the complete artifact in language ja"` y genera en ese idioma

**Limitación**: Sin labels localizados, el summary usará los labels en inglés como
fallback (ej. "Source", "Background", "Tags").

---

## 4. Modelos y frameworks

### Modelos

Horizon **no tiene un modelo fijo de summarization**. El mismo LLM configurado
para todo el pipeline se usa también para enrichment. Proveedores soportados:

| Proveedor | Modelos típicos | Calidad esperada para resumen |
|-----------|----------------|-------------------------------|
| Anthropic | Claude Sonnet 4.5, Claude 3.5 Sonnet | Excelente (mejor razonamiento) |
| OpenAI | GPT-4, GPT-4o | Excelente |
| Gemini | Gemini 2.0 Flash, 1.5 Flash | Buena (más rápido, más barato) |
| DeepSeek | deepseek-chat | Buena |
| Doubao | doubao-pro-32k | Buena (optimizado para chino) |
| MiniMax | MiniMax-M3 | Buena (optimizado para chino) |
| Aliyun DashScope | qwen-plus | Buena (optimizado para chino) |
| Azure OpenAI | gpt-4o-production | Excelente |
| Ollama | llama3.1 (local) | Variable (depende del modelo local) |

- **Temperatura**: 0 para enrichment (determinístico, reproductible)
- **Concurrencia configurable**: `analysis_concurrency` y `enrichment_concurrency`
- **Provider chain**: Soporta fallback entre proveedores (`provider_chain`)

### Coste del enrichment

El enrichment es la etapa más cara del pipeline:
- **Tool planning**: 1 llamada LLM por item (decide si necesita web_search)
- **Generación base** (bloques sin tools): 1 llamada LLM por item, por idioma
- **Generación con tools** (bloques con web_search): 1 llamada LLM adicional por bloque con tools
- **Total típico para tech-news con 2 idiomas**: 3-4 llamadas LLM por item

Ejemplo: 10 items → ~30-40 llamadas LLM en enrichment (más ~10 en analysis).

### Frameworks

- **Librería principal**: LiteLLM no se usa. Horizon tiene su propio `AIClient`
  (`src/ai/client.py`) con adaptadores por proveedor (Anthropic SDK, OpenAI SDK,
  Google GenAI SDK)
- **Validación de output**: Pydantic v2 (`BaseModel.model_validate()`)
- **Retry**: Tenacity (`@retry` con backoff exponencial)
- **HTTP**: httpx (cliente async compartido)
- **Normalización de chino**: OpenCC (`t2s` — Traditional to Simplified)
- **Progreso en terminal**: Rich (spinners, barras de progreso)

---

## 5. Comparación con El Radar

| Dimensión | Horizon | El Radar (actual) |
|-----------|---------|-------------------|
| **Estrategia de resumen** | Abstractiva multibloque (3-5 bloques por perfil) | Abstractiva simple (1 resumen de 2-3 frases) |
| **Idiomas** | en + zh (extensible a cualquier código IETF) | Solo español (prompt fijo en español) |
| **Modelo** | Multi-provider configurable (9 proveedores) | Claude Haiku (producción) + Workers AI llama-3.2 (para comparación) |
| **Profundidad** | Background, impacto, discusión comunitaria, contexto web | Solo "qué pasó" en 2-3 frases |
| **Estructura** | Bloques tipados por perfil (summary, background, impact, etc.) | Texto corrido sin estructura |
| **Contexto editorial** | Web search para background (solo en bloques que lo declaran) | Memoria semántica (Vectorize) para enlazar cobertura pasada |
| **Validación** | Pydantic estricto (bloques no vacíos, IDs válidos, source_refs) | Regex simple (RELEVANCIA/RESUMEN), fail-open |
| **Localización UI** | Labels localizados (en/zh) para encabezados, fechas, etiquetas | No aplica (solo español) |
| **Panorama diario** | No (el summary es solo renderizado de items) | Sí (`generarPanorama`: 2-4 frases conectando temas del día) |
| **Content budget** | Configurable por perfil (1000-24000 chars, prefix o head-middle-tail) | Fijo: ~2000 tokens (~8000 chars) |
| **Carga de artículo completo** | Sí (trafilatura para RSS, configurable por fuente) | Sí (`articulo.js` extrae texto completo vía fetch + limpieza HTML) |
| **Coste por item** | Alto (3-4 llamadas LLM en enrichment + 1 en analysis) | Bajo (1 llamada a Haiku por item, ~$0.0015-0.002/llamada) |

---

## 6. Hallazgos clave para El Radar

### Lo que Horizon hace mejor

1. **Resumen multinivel**: La separación analysis → enrichment permite tener
   un scoring rápido (1 frase) y un resumen rico (múltiples bloques) sin
   duplicar esfuerzo. El Radar actualmente hace ambas cosas en una sola
   llamada.

2. **Bloques tipados**: La estructura de bloques (summary, background, impact,
   community_discussion) produce resúmenes más informativos y mejor
   organizados que el texto corrido actual.

3. **Background con web search**: Para noticias que requieren contexto
   adicional (ej. "X empresa lanza Y producto"), el bloque `background` con
   `web_search` añade valor real que el snippet del RSS no trae.

4. **Multilingüismo real**: La generación directa en el idioma destino (sin
   traducir) produce texto más natural. El Radar podría beneficiarse de
   generar en inglés además de español para ampliar audiencia.

5. **Content budget por tipo de contenido**: Tratar distinto una noticia
   corta (4000 chars bastan) de un artículo técnico largo (24000 chars con
   head-middle-tail) es una optimización inteligente.

### Lo que El Radar hace mejor

1. **Panorama diario**: La síntesis de 2-4 frases que conecta los temas del
   día (`generarPanorama`) es una feature que Horizon no tiene y que añade
   mucho valor editorial. Horizon solo renderiza items individuales.

2. **Memoria semántica como contexto editorial**: Usar Vectorize no solo
   para dedup sino para enlazar cobertura pasada relacionada ("hace 3 días
   cubrimos X, hoy Y es la continuación") es más ligero y barato que el
   web_search de Horizon (que requiere una llamada LLM adicional).

3. **Coste por item**: 1 llamada a Haiku por item (~$0.002) vs 3-5 llamadas
   en Horizon (~$0.01-0.05/item con 2 idiomas). Para un digest diario de
   10-15 items, la diferencia es significativa.

4. **Optimización para free tier**: El Radar está diseñado desde cero para
   vivir en el free tier de Cloudflare Workers (50 subrequests/invocación,
   colas, lotes pequeños). Horizon asume un entorno sin esas restricciones.

### Oportunidades de adopción parcial

1. **Estructura de bloques sin multi-llamada**: El Radar podría adoptar la
   idea de "bloques tipados" (summary + background + impact) pidiéndoselo a
   Haiku en una sola llamada, con un prompt estructurado. Mismo coste, más
   valor editorial.

2. **Content budget variable**: Distinguir entre snippet de RSS (2000 chars
   bastan) y artículo completo extraído (16000 chars para blogs) como hace
   Horizon con `analysis_max_chars` por perfil.

3. **Idiomas adicionales**: Si alguna vez interesa publicar en inglés, la
   arquitectura de Horizon (generación directa, no traducción) es el camino
   correcto. El prompt multilingüe de Horizon es directamente reutilizable.

4. **Display names localizados**: Los nombres de fuente/sección localizados
   (`display_names` en profiles) son una mejora cosmética de bajo esfuerzo.

---

## 7. Referencias

- `Horizon/src/ai/enricher.py` — ContentEnricher: generación multilingüe por perfil
- `Horizon/src/ai/summarizer.py` — DailySummarizer: renderizado programático Markdown
- `Horizon/src/ai/prompting/enrichment.py` — Construcción de prompts de enrichment
- `Horizon/src/ai/localization.py` — Normalización OpenCC (t2s) para chino
- `Horizon/src/ai/analyzer.py` — ContentAnalyzer: scoring + resumen de 1 frase
- `Horizon/src/ai/classifier.py` — ContentClassifier: routing a perfil
- `Horizon/profiles/*/profile.json` — Definición de bloques por perfil
- `Horizon/profiles/*/enrichment.md` — Prompts de enrichment por perfil
- `Horizon/profiles/*/analysis.md` — Rúbricas de scoring por perfil
- `Horizon/docs/profiles.md` — Documentación de perfiles y bloques
- `Horizon/docs/configuration.md` — Guía de configuración (AI providers, idiomas)
- `worker-radar/src/resumen.js` — Sistema de resumen actual de El Radar
- `worker-radar/DEVLOG.md` — Diario de decisiones de El Radar
