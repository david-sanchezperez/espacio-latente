# 5. Arquitectura y Pipeline de El Radar

> **TAS-5**: Análisis de la arquitectura y pipeline actual de El Radar (radar.espacio-latente.com) para contexto de integración con técnicas de Horizon.

---

## 1. Resumen ejecutivo

El Radar es un digest diario de noticias de IA/ML/LLMs, operado como un **único Cloudflare Worker** (JS/TS) que se ejecuta dos veces al día vía cron (07:00 y 19:00 UTC). Procesa **28 fuentes RSS/Atom curadas manualmente**, las filtra por relevancia con Claude Haiku, las des-duplica semánticamente con embeddings `bge-m3` + Vectorize, y las publica en KV. Todo el pipeline es **full serverless** sobre el free tier de Cloudflare, con optimizaciones agresivas de subrequests (límite duro: 50/invocación) documentadas en detalle en un DEVLOG de 440 líneas.

**Pila tecnológica completa**:
- **Runtime**: Cloudflare Workers (V8 isolates, JS/ES modules)
- **Colas**: Cloudflare Queues (reparto de fuentes en lotes de 5)
- **Almacenamiento**: Workers KV (publicación, archivo, descarte temporal)
- **Base de datos**: D1 (SQLite-compatible) — contabilidad de costes y decisiones de pipeline
- **Vectores**: Vectorize (1024 dims, coseno) — dedup semántica + memoria editorial
- **Embeddings**: Workers AI (`@cf/baai/bge-m3`, 1024 dimensiones)
- **Resumen/evaluación**: Claude Haiku 4.5 vía API de Anthropic (producción); Llama 3.2 3B vía Workers AI (solo comparación)
- **Sitio web principal**: Astro 5 (build estático, independiente del radar)
- **Tests**: Node.js test runner nativo (`node --test`), 6 ficheros de test

---

## 2. Arquitectura de despliegue

```
┌──────────────────────────────────────────────────────────┐
│                 espacio-latente.com                        │
│  ┌──────────────────────┐   ┌───────────────────────────┐│
│  │  Astro (build estático)│   │  radar.espacio-latente.com ││
│  │  src/content/          │   │  Cloudflare Worker        ││
│  │  src/pages/            │   │  (worker-radar/)           ││
│  │  src/layouts/          │   │                           ││
│  │  src/components/       │   │  fetch() ──► RSS feeds    ││
│  └──────────────────────┘   │  fetch() ──► Anthropic API  ││
│                              │  AI.run() ──► bge-m3       ││
│                              │  Vectorize ─► radar-memoria││
│                              │  KV ──► radar:items:*      ││
│                              │  D1 ──► radar_llamadas_llm ││
│                              │  Queue ◄── radar-fuentes   ││
│                              └───────────────────────────┘│
└──────────────────────────────────────────────────────────┘
```

El Worker actúa simultáneamente como **productor** (cron y endpoint `/ejecutar` encolan mensajes) y **consumidor** (el handler `queue()` procesa cada lote de fuentes). Además sirve las páginas del digest (`/`, `/archivo`, `/archivo/FECHA`), el feed Atom (`/feed.xml`), `robots.txt` y `sitemap.xml`.

**Separación de responsabilidades**: el sitio principal (`espacio-latente.com`) es un build estático de Astro, independiente del radar. El radar vive en el subdominio `radar.espacio-latente.com` y se sirve completamente desde el Worker, sin build previo. Esta separación permite iterar en el pipeline sin tocar el sitio principal.

---

## 3. Pipeline de procesamiento (flujo completo)

### 3.1 Fase de disparo

Dos mecanismos de entrada:

1. **Cron** (`scheduled`, dos veces/día): reparte las 28 fuentes en dos mitades (14 cada pasada, índice par/impar), encola lotes de 5 fuentes en la cola `radar-fuentes` + un mensaje retrasado de cierre (`tipo: 'panorama'`) para la síntesis del día.

2. **Manual** (`POST /ejecutar`, protegido por secreto `X-Radar-Secret`): mismo flujo que el cron, con soporte para filtrar por mitad (`?mitad=manana` o `?mitad=tarde`). Responde inmediatamente con cuántos lotes se encolaron; el resultado real es asíncrono.

### 3.2 Fase de consumo (por lote)

Cada mensaje de la cola contiene un array de ≤5 fuentes y se procesa en `ejecutarDigest()`:

```
PARA CADA fuente en el lote:
  1. fetch RSS/Atom ────────────────────────► 1 subrequest externo
  2. Parsear feed (parser regex sin DOM) ───► lista de items
  3. Filtrar: ya vistos (KV), ya descartados, fuera de ventana 30h,
     releases no significativos (rc/beta/parches)
  4. SI hay candidatos Y hay presupuesto de memoria:
     generarEmbeddings(todos los candidatos a la vez) ─► 1 subrequest AI.run()
  5. PARA CADA candidato:
     a. buscarVecinos en Vectorize ─────────► 1 subrequest Vectorize.query()
     b. clasificarVecinos: duplicado (≥0.93) / relacionado (≥0.65) / nuevo
     c. SI duplicado de hoy → fusionar fuentes
        SI duplicado de ayer → descartar (página ya servida)
        SI no → resumir con Haiku ──────────► 1 subrequest fetch Anthropic
     d. Acumular vectores para inserción al final del lote
  6. SI hubo items nuevos o fusiones → guardar en KV (radar:items:FECHA)
  7. Guardar vectores acumulados en Vectorize ─► 1 subrequest Vectorize.insert()
  8. Anotar descartados en KV (TTL 72h)
  9. Registrar meta_pasada en D1
```

### 3.3 Fase de cierre (panorama)

Un mensaje retrasado (`delaySeconds: 90`) dispara `cerrarPasada()`, que:
- Lee los items publicados hoy desde KV
- Verifica que no se haya generado ya para el mismo número de piezas (idempotencia)
- Llama a Haiku UNA vez para sintetizar 2-4 frases que conecten lo más relevante del día
- Guarda el panorama en KV (`radar:panorama:FECHA`)

### 3.4 Fase de serving

Todas las páginas se renderizan desde el Worker sin build previo:
- **Home** (`/`): items de hoy + ayer, panorama del día (si existe), coste del día (desde D1)
- **Archivo** (`/archivo/FECHA`): un día específico
- **Índice** (`/archivo`): lista de fechas con digest guardado
- **Atom** (`/feed.xml`): hoy + ayer en formato Atom (RFC 4287)
- **robots.txt**, **sitemap.xml**: generados dinámicamente desde KV

---

## 4. Componentes del pipeline en detalle

### 4.1 Fuentes (`sources.js`)

28 fuentes RSS/Atom en 6 categorías, curadas manualmente:

| Categoría | Fuentes | Ejemplos |
|---|---|---|
| Laboratorios oficiales | 3 | OpenAI, DeepMind, Google Research |
| Espejos no oficiales | 3 | Meta AI (GitHub mirror), Anthropic (2 mirrors) |
| Blogs personales | 5 | Simon Willison, Sebastian Raschka, Lilian Weng, Karpathy |
| Newsletters | 3 | Latent Space, Import AI, fast.ai |
| Medios tecnológicos | 4 | Ars Technica, The Verge, MIT Tech Review, TechCrunch |
| Papers/blogs técnicos | 3 | arXiv cs.CL, arXiv cs.LG, Hugging Face Blog |
| Comunidad | 1 | Hacker News (`limite: 12`) |
| GitHub Releases | 6 | transformers, vLLM, LangChain, Ollama, Anthropic SDK, OpenAI SDK |

Las fuentes de GitHub Releases tienen reglas especiales (`esReleaseSignificativo`): solo bumps minor/major, fuera rc/beta/alpha/preview, y en monorepos (LangChain) solo el paquete raíz.

### 4.2 Parser de feeds (`feed.js`)

Parser RSS/Atom por **regex** (sin DOM parser — el runtime de Workers no incluye DOMParser para XML arbitrario). Soporta:
- `<item>` (RSS) y `<entry>` (Atom)
- CDATA, namespaces
- Múltiples formatos de `<link>` (Atom con `href`, RSS como contenido)
- Limpieza de HTML escapado en dos pasadas (WordPress/derivados escapan el HTML dentro de `<description>`)
- Filtro de antigüedad: últimas ~30h (con fallback: sin fecha = incluir)

### 4.3 Evaluación y resumen (`resumen.js`)

**Modelo principal**: Claude Haiku 4.5 vía API de Anthropic (requiere `ANTHROPIC_API_KEY` como secret de Workers).

**Prompt del sistema** (`SISTEMA_RESUMEN`): ~1,700 caracteres de instrucciones que cubren:
- Rol: evaluador para "El Radar", digest para audiencia técnica de IA/ML
- **Anti-inyección**: ignora frases que parezcan comandos dentro del contenido
- **Confianza en fuentes verificadas**: da por reales nombres de modelos/productos que no reconozcas
- **Idioma**: español con términos técnicos en inglés (fine-tuning, embeddings, benchmark)
- **Formato de respuesta**: `RELEVANCIA: <1-5>\nRESUMEN: <2-3 frases>`
- **Criterio de relevancia**: 1-2 = no IA central, 3 = tangencial, 4-5 = IA con sustancia real
- **Contexto propio**: si hay bloque "CONTEXTO PROPIO", menciónalo si aplica (sin URLs)

**Umbral de publicación**: `RELEVANCIA >= 4` (de 1-5).

**Fallo abierto** (fail-open): si la API falla o el formato de respuesta no se reconoce, se publica igual (solo con el título). Si falla la API, se registra en D1 con `resultado: 'error_estimado'` y tokens estimados por longitud de texto.

**Modelo alternativo** (solo comparación): Llama 3.2 3B vía Workers AI (`@cf/meta/llama-3.2-3b-instruct`). No se usa en producción — las comparaciones reales mostraron que Haiku produce resúmenes "sistemáticamente más ricos (fechas, cifras concretas)".

### 4.4 Memoria semántica (`memoria.js`)

Un mismo índice Vectorize (`radar-memoria`, 1024 dims, coseno) sirve dos propósitos:

**a) Deduplicación del día**: si un item nuevo tiene similitud coseno ≥ 0.93 con algo ya en Vectorize que es de HOY, se fusiona como `fuentesAdicionales` en el item existente en vez de crear uno nuevo.

**b) Memoria editorial**: si la similitud está entre 0.65 y 0.93 con algo de días anteriores (ventana de 90 días), se pasa como contexto al prompt de resumen para que Haiku pueda enriquecer la pieza mencionando la relación.

**Clasificación** (`clasificarVecinos`):
- `duplicado`: score ≥ 0.93
- `relacionado`: score ≥ 0.65, fecha ≠ hoy, dentro de ventana 90 días
- `nuevo`: no supera ningún umbral

**Optimización clave — embeddings e inserciones por lote**: los embeddings de todos los candidatos de una fuente se generan en UNA llamada a `AI.run()` (bge-m3 acepta array de textos), y los vectores de todo el lote se insertan en Vectorize en UNA llamada `insert()`. Solo las consultas (`query()`) son una por item. Esto redujo el coste de memoria semántica de ~3N a N+2 subrequests por lote.

**Umbrales calibrados con datos reales** (ver DEVLOG fase 2):
- `UMBRAL_DUPLICADO`: 0.93 (sin calibrar aún — ningún par real lo ha ejercitado)
- `UMBRAL_RELACIONADO`: 0.65 (calibrado: el único par genuinamente relacionado observado marcó 0.731; el ruido se quedó en 0.44-0.591)

### 4.5 Contabilidad (`costes.js`)

Base de datos D1 (`radar-costes`) con tabla única `radar_llamadas_llm`. Una fila por:
- Llamada a modelo (`proposito: 'relevancia_resumen'`, `'panorama_diario'`, `'comparacion'`)
- Decisión de memoria semántica (`proposito: 'dedup_semantica'`): clasificación, similitud, vecino
- Resumen de pasada (`proposito: 'meta_pasada'`): subrequests totales, items procesados, duración

El contador de subrequests (`crearContadorSubrequests`) es un objeto compartido que se pasa a todas las funciones y cuenta llamadas a `fetch()` externo, `AI.run()` y `Vectorize.*`. Esto permite dos topes de seguridad:
- `PRESUPUESTO_SUBREQUESTS_MAX = 38`: por debajo se intenta memoria semántica; por encima, se salta (mejor perder contexto que perder la noticia)
- `SUBREQUESTS_DURO = 45`: al llegar aquí, se deja de procesar en esta invocación (lo no visto lo recoge la siguiente pasada)

### 4.6 Presentación (`paginas.js`)

Renderizado completo en el Worker (HTML + CSS inline, sin frameworks):
- Diseño oscuro (--grafito: #12151a, --ambar: #ffb454 para acentos)
- Cada pieza: fuente(s) + estrellas de relevancia (★☆☆☆☆), título linkeado, resumen, contexto histórico
- Panorama del día con borde ámbar como vista de conjunto
- Coste del día en el pie (tokens in/out, llamadas, USD)
- Feed Atom (RFC 4287) con soporte de contexto editorial en texto plano
- `robots.txt` y `sitemap.xml` generados dinámicamente desde KV

### 4.7 Artículo completo (`articulo.js`)

Extracción de texto de artículo completo vía fetch + heurística de párrafos `<p>` (sin DOM parser):
- Filtra por densidad de enlaces (<50% = contenido, no nav/menú)
- Descarta párrafos cortos (<40 chars)
- Detecta y elimina frases de plantilla (sign in, subscribe, cookie, menu)
- Elimina duplicados exactos (menús mobile+desktop repetidos)
- Best-effort: si falla (paywall, JS rendering, PDF), devuelve null y se usa el snippet del RSS
- Actualmente solo se usa en el endpoint `/comparar`, no en producción

---

## 5. Gestión de límites del free tier

El diseño del pipeline está profundamente condicionado por el límite de **50 subrequests externos por invocación** del plan free de Cloudflare Workers. Toda la arquitectura de colas y lotes existe para respetar este límite:

| Límite | Valor | Riesgo para el radar | Mitigación |
|---|---|---|---|
| Subrequests/invocación | 50 | Confirmado: 59 en una sola invocación (28 fuentes) | Queues: lotes de 5 fuentes |
| CPU time/invocación | 10ms (configurable a 300s) | Pipeline es I/O-bound → no es el límite real | N/A |
| D1 filas leídas/día | 5M | Sin riesgo al volumen actual (decenas-cientos/día) | N/A |
| D1 filas escritas/día | 100K | Sin riesgo | N/A |
| Workers AI neuronas/día | 10,000 | bge-m3 ≈ 1,075/M tokens → margen amplio | N/A |
| Vectorize dimensiones/mes | 5M almacenadas, 30M consultadas | ~4,880 vectores almacenables en free tier | Ventana 90 días (~2,700 vectores a 30 items/día) |

**Evolución documentada** (DEVLOG):
- Fase 1: confirmación del límite con 59 subrequests en pasada manual
- Evaluación y descarte de Workers Paid ($5/mes) y hardware propio (trading rig, NAS)
- Migración a Queues: 14 fuentes → 3 lotes → 4-8 subrequests/lote (sin errores)
- Fase 2: descubrimiento de que `AI.run()` y Vectorize SÍ cuentan contra el límite (no comparten techo separado como se asumía)
- Fase 3: embeddings e inserciones por lote → `PRESUPUESTO_SUBREQUESTS_MAX` sube de 30 a 38
- Tope duro (`SUBREQUESTS_DURO = 45`): garantía de no exceder 50, incluso en peor caso

---

## 6. Flujo de datos y almacenamiento

```
┌─────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ 28 RSS  │───►│  Worker  │───►│    KV    │───►│  Páginas │
│ feeds   │    │  Queue   │    │ radar:   │    │ HTML     │
└─────────┘    │ consumer │    │ items:*  │    │ Atom     │
               └──────────┘    │ panorama │    └──────────┘
                    │          │ descart. │
                    │          └──────────┘
                    ▼
               ┌──────────┐    ┌──────────┐
               │ Vectorize│    │    D1    │
               │ radar-   │    │ radar_   │
               │ memoria  │    │ llamadas │
               └──────────┘    └──────────┘
```

**KV keys**:
- `radar:items:FECHA` — array JSON de items publicados (TTL: ~13 meses)
- `radar:panorama:FECHA` — texto del panorama diario (TTL: ~13 meses)
- `radar:panorama-items:FECHA` — contador de piezas sintetizadas para idempotencia (TTL: ~13 meses)
- `radar:descartados:FECHA` — links descartados por baja relevancia/duplicado (TTL: 72h)

**Vectorize** (`radar-memoria`):
- IDs: SHA-256 del link truncado a 32 chars
- Metadata: `{ link, titulo, fecha }`
- Ventana efectiva: 90 días (filtrada en JS, no en la query)
- Tamaño actual: 69 vectores (post-backfill)

**D1** (`radar_llamadas_llm`):
- Columnas: `pasada, timestamp, modelo, proposito, tokens_in, tokens_out, coste_usd, item_link, fuente, resultado`
- Columnas de fase 2: `subrequests_total, items_procesados, duracion_ms` (meta_pasada), `clasificacion, similitud_top, vecino_link` (dedup_semantica)

---

## 7. Modelo de datos de un item

```javascript
{
  titulo: "GPT-5 announced with major reasoning improvements",
  resumen: "OpenAI ha anunciado GPT-5, que incorpora...", // generado por Haiku
  link: "https://openai.com/news/gpt-5",
  fuente: "OpenAI News",                         // fuente principal
  fuentesAdicionales: ["The Verge · IA"],        // fusiones de otras fuentes
  fecha: "2026-07-21T14:30:00.000Z",
  relevancia: 5,                                 // 1-5, del propio Haiku
  contexto: {                                     // memoria editorial
    titulo: "GPT-5 benchmarks leaked",
    link: "https://..."
  }
}
```

---

## 8. Calidad, testing y observabilidad

### Tests

6 ficheros de test (`worker-radar/test/`), ejecutados con `node --test`:
- `feed.test.mjs` — parser de RSS/Atom, limpieza de HTML escapado
- `digest.test.mjs` — `ejecutarDigest` punta a punta con `env` falso (KV, D1, AI, Vectorize mock), cubre fusión, descarte, contexto histórico, fuente caída
- `memoria.test.mjs` — clasificación de vecinos, umbrales
- `memoria-lotes.test.mjs` — embeddings e inserciones por lote, alineamiento, conteo de subrequests
- `costes.test.mjs` — cálculo de costes, estimación de tokens
- `releases.test.mjs` — filtro de GitHub releases (rc, beta, patch, monorepo)

### Observabilidad

- D1 registra cada decisión y su coste → base para calibrar umbrales con datos reales
- `meta_pasada` en D1 → subrequests por pasada, items procesados, duración
- `dedup_semantica` en D1 → clasificación, similitud, vecino → calibración de umbrales
- Logs (`console.log/error`) → visibles vía `wrangler tail`
- Alerta opcional: `ALERTA_WEBHOOK` (Slack/Discord/ntfy) para fallo total de pasada
- Coste visible públicamente en el pie de cada página del digest

### Principio de diseño: fail-open

Todo el pipeline está diseñado para fallar "abierto" (mejor publicar de más que perder una noticia):
- Si Haiku falla → se publica solo con el título
- Si Vectorize falla → se trata como "sin memoria semántica", sigue camino normal
- Si D1 falla → no interrumpe el pipeline (best-effort)
- Si el panorama falla → el digest se sirve igual sin él

---

## 9. Costes operativos

Basados en los precios documentados en `config.js` y las métricas de pases reales:

| Componente | Coste unitario | Estimación diaria |
|---|---|---|
| Claude Haiku 4.5 | $1/M tokens in, $5/M tokens out | ~$0.03-0.06/día |
| Workers AI (bge-m3) | Incluido en free tier (10K neuronas/día) | $0 |
| KV, D1, Queues, Vectorize | Free tier | $0 |
| **Total estimado** | | **~$0.03-0.06/día (~$1-2/mes)** |

El coste se mantiene en el rango de "gasto personal, no empresarial" por diseño explícito — Workers Paid ($5/mes) fue evaluado y descartado porque Queues resuelve el límite de subrequests gratis.

---

## 10. Diferencias arquitectónicas clave con Horizon

| Dimensión | El Radar | Horizon |
|---|---|---|
| **Runtime** | Cloudflare Workers (JS, serverless, V8 isolates) | Python (proceso, `asyncio`) |
| **Despliegue** | `wrangler deploy`, un solo Worker | Docker Compose, proceso largo |
| **Fuentes** | 28 RSS/Atom curadas manualmente | 10 tipos (RSS, HN, Reddit, Telegram, Twitter, GitHub, OpenBB, OSSInsight, GDELT, Google News) |
| **Deduplicación** | Embeddings `bge-m3` + Vectorize (coseno, 2 umbrales) | URL determinista + LLM semántico por topic |
| **Resumen** | 1 LLM call/item (relevancia + resumen unificados) | 3-4 LLM calls/item (classify → analyze → enrich × N idiomas) |
| **Idiomas** | Solo español (con términos técnicos en inglés) | Multi-idioma (en + zh, extensible vía config) |
| **Estructura de resumen** | 2-3 frases monolíticas | Bloques tipados (summary, background, impact, community_discussion) |
| **Contexto** | Memoria editorial (Vectorize, mismo embedding) | Web search enrichment + profile-driven |
| **Entrega** | Web + Atom feed | Webhook, email, GitHub Pages, MCP server |
| **Coste** | ~$1-2/mes (optimizado para free tier) | ~$10-50+/mes (3-4 llamadas LLM/item) |
| **Límite de subrequests** | 50/invocación (free tier) — condiciona toda la arquitectura | Sin límite artificial (solo rate limits de APIs) |
| **Modelo de ejecución** | Event-driven (cron → queue → consumer) | Pipeline secuencial (main loop) |
| **Escalado** | Automático (Cloudflare) | Manual (Docker, recursos de máquina) |

---

## 11. Puntos de posible integración

Basado en el análisis de ambas arquitecturas, los puntos donde técnicas de Horizon podrían incorporarse a El Radar son:

1. **Deduplicación determinista por URL** (bajo esfuerzo): añadir stripping de tracking params a los links antes del dedup por KV — Horizon lo hace en `scrapers/`. El Radar ya tiene dedup por link exacto (Set en KV), pero no limpia UTMs.

2. **Estructura de resumen enriquecida** (esfuerzo medio): pasar de 2-3 frases monolíticas a bloques tipados (summary, impacto, contexto) — requeriría cambiar el prompt y el renderizado en `paginas.js`. El coste en tokens subiría, potencialmente rompiendo el presupuesto del free tier.

3. **Clasificación pre-resumen** (esfuerzo medio-alto): añadir una etapa de clasificación por perfil/tema antes de evaluar relevancia, como hace Horizon con `profiles/`. Podría mejorar la precisión del filtro de relevancia.

4. **Memoria editorial vía web search** (esfuerzo alto): Horizon enriquece con búsqueda web; El Radar solo usa su propio archivo. Añadir web search en el prompt de Haiku aumentaría el coste y los subrequests.

5. **Entrega multicanal** (esfuerzo bajo-medio): El Radar ya tiene Atom; añadir email o webhook sería sencillo con Workers. Horizon ya implementa esto.

**Recomendación preliminar**: los puntos 1 (URL dedup) y 5 (entrega multicanal) son quick wins de bajo riesgo. Los puntos 2-4 son aspiracionales pero requieren reevaluar el presupuesto de subrequests y el modelo de costes.

---

*Informe generado para TAS-5 del spec de evaluación Horizon/El Radar. Fecha: 2026-08-11.*
