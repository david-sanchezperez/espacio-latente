# 06 — Análisis de Compatibilidad: Horizon ↔ El Radar

> **TAS-6**: Análisis de compatibilidad entre Horizon y la arquitectura/pipeline de El Radar.

---

## 1. Resumen Ejecutivo

Horizon y El Radar son **arquitectónicamente incompatibles** como runtimes (Python/proceso vs Cloudflare Workers/serverless). Sin embargo, comparten una **filosofía técnica** notablemente alineada: ambos son sistemas de agregación de noticias con deduplicación, scoring con IA y resumen. La integración viable es **por extracción de patrones**: identificar qué técnicas de Horizon pueden reimplementarse en el runtime de Workers y cuáles son económicamente inviables bajo las restricciones del free tier de Cloudflare.

---

## 2. Matriz de Compatibilidad por Dimensión

### 2.1 Runtime y Plataforma

| Dimensión | Horizon | El Radar | Compatibilidad |
|---|---|---|---|
| **Lenguaje** | Python 3.11+ | JavaScript/TypeScript (ES modules) | ❌ Incompatible |
| **Runtime** | Proceso asíncrono (`asyncio`) | Cloudflare Workers (V8 isolates) | ❌ Incompatible |
| **Despliegue** | Docker Compose / `uv run horizon` | `wrangler deploy` (serverless) | ❌ Incompatible |
| **Ejecución** | Pipeline secuencial continuo | Event-driven (cron → queue → consumer) | 🔶 Patrones similares, runtimes distintos |
| **Límites** | Sin límite artificial (solo rate limits de APIs) | 50 subrequests/invocación (free tier) | 🔶 Diferencia fundamental que condiciona todo |
| **Escalado** | Manual (Docker, recursos de máquina) | Automático (Cloudflare) | 🔶 Modelos opuestos |

**Conclusión**: No hay compatibilidad de runtime. Cualquier adopción requiere reimplementación en TypeScript.

---

### 2.2 Modelo de Ejecución y Pipeline

| Horizon | El Radar | Gap |
|---|---|---|
| Pipeline lineal: `fetch → url_dedup → classify → analyze → filter → topic_dedup → enrich → summarize → deliver` | Pipeline por lotes: `cron → queue batch → [fetch → url_dedup → semantic_dedup → evaluate → publish] × N → daily_panorama` | Estructural |
| Todo en una ejecución continua | Particionado en mensajes de cola | Estructural |
| Procesamiento por perfil (clasifica antes de analizar) | Procesamiento por fuente (evalúa cada fuente por separado) | Funcional |
| Sin límite de tiempo | 10ms CPU default (configurable a 300s) | Operacional |

**Hallazgo clave**: El pipeline de Horizon es conceptualmente superior para calidad (clasificación pre-analítica, dedup semántica post-filtrado, enriquecimiento con búsqueda), pero está diseñado para un entorno sin límites de subrequests. El pipeline de El Radar está optimizado para sobrevivir con 50 subrequests.

---

### 2.3 Deduplicación

| Dimensión | Horizon | El Radar | Compatibilidad |
|---|---|---|---|
| **Dedup por URL** | Normalización avanzada (tracking params, puertos, trailing slash) | Comparación exacta en KV Set | 🟢 Compatible — la técnica de Horizon puede adoptarse directamente |
| **Stripping de tracking params** | `utm_*`, `fbclid`, `gclid`, etc. (13+ params) | ❌ No implementado | 🟢 Quick win — implementable en JS puro, 0 subrequests |
| **Dedup semántica** | LLM-based (títulos+tags+summaries en una sola llamada) | Vectorial (bge-m3 + Vectorize, coseno, 2 umbrales) | 🟡 Diferentes pero complementarias |
| **Memoria cross-run** | ❌ No tiene (solo intra-run) | ✅ Vectorize con ventana 90 días + KV histórico + KV descartados | 🟢 El Radar es superior aquí |
| **Dedup cross-fuente** | ✅ Agrupa por URL normalizada + perfil | ✅ Agrupa por similitud semántica (≥0.93) | 🟡 Ambos lo hacen, con mecanismos distintos |
| **Fusión de contenido** | Concatena contenido de duplicados al primario | Fusiona `fuentesAdicionales` en el item primario | 🟢 Mismo patrón, implementación distinta |

**Recomendaciones**:
- **Implementar stripping de tracking params**: esfuerzo bajo, beneficio inmediato, 0 subrequests adicionales. Código de Horizon es directamente traducible a JS.
- **Mantener ambos enfoques de dedup semántica**: el LLM-based de Horizon detecta mejor "mismo evento con distinta redacción" que el coseno, pero cuesta 1 llamada LLM. El vectorial del Radar es más barato (embedding local) y tiene memoria cross-run. Evaluar combinar ambos en el futuro.

---

### 2.4 Pipeline de IA

| Dimensión | Horizon | El Radar | Compatibilidad |
|---|---|---|---|
| **Etapas de IA** | 4 (classify → analyze → enrich → summarize) | 1 (evaluate + summarize unificado) | 🔶 Gap estructural |
| **Llamadas LLM por item** | 3-4 (classify, analyze, enrich × N idiomas) | 1 | 🔴 3-4× más llamadas — inviable en free tier |
| **Modelos** | 9 providers (Claude, GPT, Gemini, DeepSeek, Doubao, MiniMax, Ollama, Azure, Ali) | Claude Haiku 4.5 (producción), Llama 3.2 3B (comparación) | 🟡 Horizon tiene más opciones, pero El Radar solo usa una |
| **Clasificación pre-analítica** | Sí (por perfil: tech-news, tech-blog, finance-news, ai-creator) | No (evalúa directamente con Haiku) | 🟡 Potencialmente valioso, pero añade 1 llamada LLM |
| **Scoring** | 0-10 numérico + resumen de 1 frase | Relevancia 1-5 + resumen 2-3 frases | 🟢 Conceptualmente similar |
| **Estructura de resumen** | Bloques tipados (summary, background, impact, community_discussion) | 2-3 frases monolíticas | 🟡 Más rico pero más caro en tokens |
| **Enriquecimiento** | Web search (DuckDuckGo) para background | Contexto editorial vía Vectorize (archivo propio) | 🔶 Enfoques distintos |

**Análisis de coste**:

| Técnica de Horizon | Coste en subrequests | Coste en tokens | Viable en free tier? |
|---|---|---|---|
| Clasificación por perfil | +1 LLM call (fetch Anthropic) | ~200 tokens in + ~50 out | ⚠️ Marginal — ~4 subrequests/día adicionales |
| Scoring 0-10 con resumen 1 frase | Ya incluido en la llamada actual | Similar al actual | ✅ Sin cambio |
| Enriquecimiento multilingüe (×2 idiomas) | +2 LLM calls/item | ~500-1000 tokens out adicionales | 🔴 Inviable — 2× a 3× más subrequests |
| Web search (DuckDuckGo) | +1 fetch por item | N/A | 🔴 Inviable — rompe el presupuesto |
| Bloques tipados en resumen | 0 subrequests adicionales | +100-200 tokens out | 🟡 Marginal — evaluar si cabe en presupuesto |

**Conclusión**: La clasificación por perfil y los bloques tipados son las técnicas de IA de Horizon más viables para El Radar. El enriquecimiento multilingüe y la búsqueda web son aspiracionales pero requieren salir del free tier.

---

### 2.5 Fuentes y Scraping

| Dimensión | Horizon | El Radar | Compatibilidad |
|---|---|---|---|
| **Tipos de fuente** | 10 (RSS, HN, Reddit, Telegram, Twitter, GitHub, OpenBB, OSSInsight, GDELT, Google News) | 1 (RSS/Atom, 28 fuentes curadas) | 🟡 Horizon tiene más diversidad |
| **Parser RSS** | `feedparser` (librería Python madura) | Parser regex propio (sin DOM en Workers) | 🔶 Mecanismos diferentes, mismo propósito |
| **GitHub Releases** | Scraper dedicado con filtros | 6 fuentes RSS + filtro JS (`esReleaseSignificativo`) | 🟢 Mismo enfoque |
| **Reddit, HN, Twitter** | Scrapers nativos | No implementado | 🟡 Fuentes adicionales potenciales |
| **Google News, GDELT** | Scrapers de noticias globales | No implementado | 🟡 Potencialmente valioso pero más subrequests |
| **Curación** | Mixta (config + fuentes automáticas) | Manual (28 fuentes curadas por calidad) | 🟡 Filosofías diferentes |

**Recomendación**: Las fuentes adicionales de Horizon (Reddit, HN) podrían añadirse a El Radar si hay presupuesto de subrequests. La curación manual de El Radar es una fortaleza que no debería perderse.

---

### 2.6 Almacenamiento y Estado

| Dimensión | Horizon | El Radar |
|---|---|---|
| **Publicaciones** | Archivos JSON en disco (`storage/`) | Workers KV (`radar:items:FECHA`) |
| **Histórico** | Archivos con timestamp en nombre | KV con TTL ~13 meses |
| **Estado de duplicados** | No persistente (solo intra-run) | KV (`radar:descartados:FECHA`, TTL 72h) + Vectorize (90 días) |
| **Costes/analytics** | Logging en consola + token tracking en memoria | D1 (`radar_llamadas_llm`) |
| **Configuración** | `config.json` + `.env` | `config.js` + secrets de Workers |
| **Perfiles de procesamiento** | JSON + Markdown en `profiles/` | Código hardcodeado en `resumen.js` |

**Análisis**:
- El modelo de almacenamiento de Horizon (archivos locales) es incompatible con Workers (efímero, sin filesystem). Pero KV ya cubre esta necesidad.
- La contabilidad en D1 de El Radar es **superior** a la de Horizon (más granular, persistente, visible públicamente). Horizon podría beneficiarse de adoptar este patrón.
- La separación de perfiles en archivos JSON/Markdown de Horizon es una buena práctica que El Radar podría adoptar para hacer el sistema de evaluación más configurable.

---

### 2.7 Entrega (Delivery)

| Dimensión | Horizon | El Radar | Compatibilidad |
|---|---|---|---|
| **Web** | ❌ No tiene servidor web integrado | ✅ Páginas HTML + Atom servidas desde Worker | 🟡 Diferente — El Radar es autosuficiente |
| **GitHub Pages** | ✅ Publica archivos Markdown en repo | ❌ No implementado | 🟢 Fácil de añadir |
| **Email** | ✅ SMTP con plantillas HTML | ❌ No implementado | 🟢 Factible con Workers (MailChannels, Resend) |
| **Webhook** | ✅ Slack/Discord/Feishu/DingTalk/ntfy | ✅ Webhook de alerta opcional (Slack/Discord/ntfy) | 🟢 Ya implementado |
| **Atom/RSS** | ❌ No implementado | ✅ Feed Atom RFC 4287 | 🟡 El Radar es superior aquí |
| **MCP Server** | ✅ Protocolo MCP para clientes IA | ❌ No implementado | 🟢 Potencialmente valioso para integración con asistentes |

**Recomendaciones**:
- **Email delivery**: quick win. Usar MailChannels (gratis en Cloudflare) o Resend para enviar el digest por email. Horizon tiene plantillas HTML de referencia.
- **GitHub Pages**: publicar archivo JSON/Markdown del digest en el repo de espacio-latente.com. Trivial de implementar con Workers.
- **MCP Server**: aspiracional. Permitiría que asistentes IA consulten el archivo del Radar.

---

### 2.8 Configuración y Perfiles

| Dimensión | Horizon | El Radar | Gap |
|---|---|---|---|
| **Perfiles de procesamiento** | 4 perfiles con prompts, thresholds, bloques y reglas distintas | 1 prompt monolítico (`SISTEMA_RESUMEN`, ~1,700 chars) | Horizon es más modular |
| **Configuración externalizada** | `config.json` completo + `.env` | `config.js` (mixto código + valores) | Similar |
| **Idiomas** | `ai.languages: ["en", "zh"]` configurable | Hardcodeado: español | Horizon es más flexible |
| **Thresholds** | `score_threshold`, `topic_dedup` por perfil | `UMBRAL_RELEVANCIA = 4`, umbrales de similitud en constantes | Similar nivel |
| **Sources** | JSON config con tipo, parámetros, perfil | Array JS con URL, categoría, nombre | Similar |

**Recomendación**: Adoptar el modelo de perfiles de Horizon (archivos JSON con prompt + thresholds + reglas de bloque) haría a El Radar más configurable sin cambiar el runtime. El perfil `tech-news` de Horizon es directamente aplicable al dominio de El Radar (noticias de IA/ML).

---

### 2.9 Modelo de Costes

| Dimensión | Horizon | El Radar |
|---|---|---|
| **Coste LLM** | ~$0.05-0.15/item (3-4 llamadas × multi-idioma) | ~$0.001-0.003/item (1 llamada Haiku) |
| **Coste infraestructura** | VPS/Docker (~$5-20/mes) + APIs | $0 (free tier Cloudflare) + API Anthropic (~$1-2/mes) |
| **Coste diario total** | ~$0.50-5.00/día (depende de fuentes y modelos) | ~$0.03-0.06/día |
| **Límite de escalado** | Recursos de la máquina | Límites del free tier (50 subrequests) |
| **Optimización** | Throttling, concurrencia configurable | Batching agresivo, contador de subrequests, fail-open |

**Impacto de adoptar técnicas de Horizon**:

| Técnica adoptada | Coste adicional/día | % aumento |
|---|---|---|
| Stripping de tracking params | $0 | 0% |
| Clasificación por perfil | +$0.01-0.02 | +25-50% |
| Bloques tipados en resumen | +$0.005-0.01 | +10-25% |
| Enriquecimiento multilingüe | +$0.03-0.06 | +100-150% |
| Web search enrichment | +$0.01-0.02 (fetch) + tokens | +30-50% |
| Email delivery | $0 (MailChannels free) | 0% |
| GitHub Pages publishing | $0 | 0% |

---

### 2.10 Testing y Calidad

| Dimensión | Horizon | El Radar |
|---|---|---|
| **Tests** | 436 tests, 39 archivos, pytest | ~30 tests, 6 archivos, `node --test` |
| **CI** | ❌ No existe | ❌ No analizado (probablemente manual) |
| **Cobertura** | Buena (scrapers, AI, MCP, storage) | Buena (feed, digest, memoria, costes, releases) |
| **Tipo de tests** | Unitarios + smoke tests MCP | Unitarios + integración con mocks de Workers |
| **Linting** | ❌ No configurado | ❌ No analizado |

---

## 3. Análisis de Compatibilidad por Componente del Pipeline

### 3.1 Fase de Recolección (Fetch)

```
Horizon:  fetch_all_sources() → paralelo con asyncio.gather(), throttling por fuente
El Radar:  por lote de 5 fuentes vía Queue → secuencial dentro del lote → fetch RSS
```

**Compatibilidad**: 🟡 **Media**. Ambos hacen fetch RSS. La diferencia es el mecanismo de paralelismo (asyncio vs lotes en Queue). Las fuentes adicionales de Horizon (Reddit, HN) podrían añadirse al Radar si hay presupuesto de subrequests, pero requerirían scrapers nuevos en JS.

### 3.2 Deduplicación por URL

```
Horizon:  _deduplication_url_key() → normalización avanzada → agrupar → fusionar
El Radar:  comparación exacta de link en KV Set → si ya visto → descartar
```

**Compatibilidad**: 🟢 **Alta**. La técnica de normalización de URL de Horizon es directamente portable a JS. La fusión de fuentes de El Radar (`fuentesAdicionales`) es más elegante que la concatenación de contenido de Horizon.

**Código portable** (de Horizon `orchestrator.py:53-78` a JS para Workers):

```javascript
const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  '_ga', 'dclid', 'fbclid', 'gclid', 'igshid', 'li_fat_id',
  'mc_cid', 'mc_eid', 'msclkid', 'ttclid', 'twclid', 'vero_id',
]);

function normalizeUrl(url) {
  const parsed = new URL(url);
  // Strip tracking params
  const cleanParams = new URLSearchParams();
  for (const [key, value] of parsed.searchParams) {
    if (!key.startsWith('utm_') && !TRACKING_PARAMS.has(key)) {
      cleanParams.append(key, value);
    }
  }
  parsed.search = cleanParams.toString();
  // Normalize
  parsed.hostname = parsed.hostname.toLowerCase();
  if ((parsed.protocol === 'http:' && parsed.port === '80') ||
      (parsed.protocol === 'https:' && parsed.port === '443')) {
    parsed.port = '';
  }
  parsed.pathname = parsed.pathname.replace(/\/$/, '') || '/';
  return parsed.toString();
}
```

### 3.3 Deduplicación Semántica

```
Horizon:  LLM evalúa "mismo evento" → binario (duplicado/no) → sin memoria cross-run
El Radar:  bge-m3 + Vectorize coseno → 2 umbrales (0.93/0.65) → memoria cross-run 90 días
```

**Compatibilidad**: 🟡 **Media-Alta**. Son complementarios, no excluyentes:

- **Horizon approach** (LLM dedup): mejor para detectar el mismo evento con distinta redacción y vocabulario. Coste: 1 llamada LLM por lote de items. Podría añadirse como paso adicional entre la evaluación y la publicación.
- **El Radar approach** (vectorial): mejor para detectar similitud semántica con memoria histórica. Coste: embedding + query Vectorize por item. Ya implementado y optimizado para batching.

**Recomendación**: Mantener el enfoque vectorial del Radar (más barato, memoria cross-run) y evaluar añadir LLM dedup de Horizon como capa adicional para casos donde el coseno falle (ej. mismo evento reportado con vocabulario radicalmente diferente).

### 3.4 Evaluación/Scoring

```
Horizon:  classify(perfil) → analyze(score 0-10 + summary + tags)
El Radar:  evaluate(relevancia 1-5 + resumen 2-3 frases) — una sola llamada
```

**Compatibilidad**: 🟡 **Media**. La clasificación pre-analítica de Horizon es valiosa pero añade 1 llamada LLM. La evaluación de El Radar es más eficiente (una llamada hace todo). 

**Análisis coste-beneficio**:
- **Sin clasificación**: Haiku evalúa todo con el mismo criterio. Una noticia de paper académico y un release de producto se evalúan igual. El prompt actual maneja esto razonablemente bien.
- **Con clasificación**: Primero clasificar (tech-news, tech-blog, release), luego evaluar con criterios específicos. Mejor precisión pero +1 llamada LLM por item (~$0.001 adicional).

### 3.5 Resumen y Enriquecimiento

```
Horizon:  enrich(perfil, idioma) → bloques tipados × N idiomas → summarizer(render Markdown)
El Radar:  resumen integrado en la llamada de evaluación (2-3 frases) → render HTML directo
```

**Compatibilidad**: 🟡 **Media-Baja**. 

- **Bloques tipados** (summary, background, impact): compatible conceptualmente. Requiere cambiar el prompt de Haiku para que devuelva JSON estructurado en vez de texto libre. Aumenta tokens de salida ~30-50%.
- **Multilingüe**: inviable en free tier. Cada idioma adicional requiere 1 llamada LLM extra por item.
- **Renderizado Markdown**: El Radar ya renderiza HTML, no Markdown. Pero la estructura de bloques (summary → párrafo, impact → cita destacada) mejoraría la presentación.

### 3.6 Entrega

```
Horizon:  email (SMTP/HTML) + webhook (Slack/Discord/Feishu) + GitHub Pages + MCP
El Radar:  web (HTML + Atom) + webhook (alerta)
```

**Compatibilidad**: 🟢 **Alta**. Las opciones de delivery de Horizon son aditivas. El Radar puede añadir email y GitHub Pages sin cambiar nada de su pipeline actual. Son features independientes que no compiten por subrequests (se ejecutan en requests separados).

---

## 4. Matriz de Viabilidad de Adopción

### 4.1 Quick Wins (bajo esfuerzo, alto impacto, viable en free tier)

| Técnica | Subrequests adicionales | Esfuerzo | Riesgo | Prioridad |
|---|---|---|---|---|
| **Stripping de tracking params** | 0 | Bajo (~20 líneas JS) | Mínimo | 🔴 P0 |
| **Email delivery** | 0 (request separado) | Bajo-Medio | Bajo | 🟡 P1 |
| **GitHub Pages publishing** | 0 (request separado) | Bajo | Mínimo | 🟢 P2 |

### 4.2 Mejoras de Calidad (esfuerzo medio, impacto medio, evaluar coste)

| Técnica | Subrequests adicionales | Esfuerzo | Impacto | Prioridad |
|---|---|---|---|---|
| **Bloques tipados en resumen** | 0 (solo cambia prompt) | Medio | Mejor UX del digest | 🟡 P1 |
| **Clasificación por perfil** | +1 LLM call/item | Medio-Alto | Mejor filtrado | 🟢 P2 |
| **Sistema de perfiles externalizado** | 0 | Medio | Más configurable | 🟢 P2 |

### 4.3 Aspiracional (alto esfuerzo o coste, requiere salir del free tier)

| Técnica | Coste | Viable en free tier? | Prioridad |
|---|---|---|---|
| **Enriquecimiento multilingüe** | 2-3× tokens actuales | ❌ No | ⚪ P4 |
| **Web search enrichment** | +1 fetch/item | ❌ No | ⚪ P4 |
| **Fuentes adicionales (Reddit, HN, Twitter)** | +2-5 subrequests/lote | ⚠️ Marginal | 🟢 P3 |
| **LLM dedup semántica** | +1 LLM call/lote | ⚠️ Marginal | 🟢 P3 |
| **MCP Server** | N/A (request separado) | ✅ Sí (servicio independiente) | 🟢 P3 |

---

## 5. Análisis de Riesgos de Integración

### 5.1 Riesgos Técnicos

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| **Aumento de subrequests rompe el free tier** | Alta (si se adoptan técnicas multi-LLM) | Crítico | Implementar solo quick wins primero, medir impacto real |
| **Prompt engineering no portable** | Media | Medio | Los prompts de Horizon (en inglés y chino) necesitan adaptación al español + dominio de IA |
| **Complejidad del pipeline** | Media | Medio | Cada etapa añadida es un punto de fallo más. Mantener fail-open |
| **Divergencia de implementaciones** | Baja | Bajo | Documentar qué se adoptó de Horizon y por qué |

### 5.2 Riesgos Operacionales

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| **Aumento de coste Anthropic** | Alta (si se añaden llamadas) | Medio | Contabilidad D1 ya existe — monitorizar antes/después |
| **Degradación de latencia** | Media | Bajo | El pipeline ya es asíncrono (Queue) — no afecta al usuario |
| **Mantenimiento de código adoptado** | Baja | Bajo | Las quick wins son mínimas (<50 líneas). Las mejoras medias son auto-contenidas |

---

## 6. Conclusión

Horizon y El Radar son **incompatibles como runtimes** pero **altamente compatibles como filosofía técnica**. La integración viable no es "ejecutar Horizon dentro de El Radar" sino **"extraer las mejores ideas de Horizon y reimplementarlas en el contexto de Workers"**.

**Estrategia recomendada** (3 fases):

1. **Fase 1 — Quick Wins** (iteración inmediata):
   - Stripping de tracking params en URL dedup
   - Email delivery (newsletter diaria)
   
2. **Fase 2 — Mejoras de Calidad** (próximas semanas):
   - Bloques tipados en resúmenes
   - Externalización de perfiles de evaluación

3. **Fase 3 — Expansión** (requiere reevaluar free tier):
   - Clasificación por perfil pre-analítica
   - Fuentes adicionales (Reddit, HN)
   - LLM dedup semántica complementaria

La arquitectura actual de El Radar es sólida y eficiente para sus restricciones. Las técnicas de Horizon pueden mejorarla incrementalmente sin comprometer lo que ya funciona bien.

---

*Informe generado para TAS-6 del spec de evaluación Horizon/El Radar. Fecha: 2026-08-11.*
