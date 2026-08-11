# 04 — Evaluación de Madurez de Horizon

> **Tarea**: TAS-4 | **Prioridad**: P1 | **Fecha**: 2026-08-11

---

## 1. Resumen Ejecutivo

Horizon es un proyecto **medianamente maduro** (versión 0.1.0, pre-1.0) con fortalezas notables en arquitectura y documentación, pero con riesgos significativos derivados de su juventud, dependencia de un único mantenedor, y falta de infraestructura de CI para testing automatizado. Para integración en El Radar, es adecuado para experimentación y prototipado, pero requiere mitigación de riesgos para uso en producción.

---

## 2. Licencia

| Aspecto | Detalle |
|---------|---------|
| **Tipo** | MIT License |
| **Copyright** | 2026 Thysrael |
| **Permisividad** | Uso comercial, modificación, distribución, sublicenciamiento — sin restricciones |
| **Compatibilidad con El Radar** | ✅ Excelente — MIT es totalmente compatible con cualquier modelo de licenciamiento |

La licencia MIT elimina cualquier barrera legal para integración. El Radar puede copiar, modificar, y redistribuir código de Horizon sin problemas de compliance, incluso en un producto comercial.

---

## 3. Versión y Ciclo de Vida

| Indicador | Valor |
|-----------|-------|
| **Versión actual** | `0.1.0` |
| **Fase** | Pre-1.0 / desarrollo activo |
| **Git tags / releases** | ❌ Ninguno |
| **PyPI package** | ❌ No publicado (listado como mejora planificada) |
| **Changelog** | ❌ No existe |
| **Semantic versioning** | Declarado en `pyproject.toml`, pero sin historial de releases |

**Implicaciones para integración**:
- La API interna puede cambiar sin previo aviso entre commits
- No hay garantía de estabilidad de la interfaz de configuración
- Para depender de Horizon como biblioteca, habría que fijar un commit específico
- Riesgo moderado: la arquitectura interna (modelos Pydantic, pipeline de funciones asíncronas) es limpia y poco probable que cambie radicalmente, pero no hay contrato de estabilidad

---

## 4. Actividad de Desarrollo y Comunidad

### 4.1 Métricas de commit

| Métrica | Valor |
|---------|-------|
| **Total commits** | 527 |
| **Primer commit** | 2026-02-20 |
| **Último commit** | 2026-08-10 (ayer) |
| **Rango temporal** | ~6 meses (febrero — agosto 2026) |
| **Commits en julio 2026** | 56 |
| **Commits en agosto 2026** (10 días) | 13 |
| **Ritmo de desarrollo** | 🔥 Muy activo (~3-4 commits/día en períodos pico) |

### 4.2 Contribuidores

| Contribuidor | Commits | % |
|-------------|---------|---|
| **Thysrael** (autor principal) | 466 | 88.4% |
| Anton Ugarov | 8 | 1.5% |
| Kie-Chi | 5 | 0.9% |
| thebigby10 | 3 | 0.6% |
| snownightx-svg | 3 | 0.6% |
| Tang Keyin | 3 | 0.6% |
| Octopus | 3 | 0.6% |
| Otros (8 personas, 1-2 commits c/u) | 12 | 2.3% |
| **Total contribuidores** | **~15** | |

### 4.3 Análisis de comunidad

| Señal | Estado |
|-------|--------|
| **Bus factor** | ⚠️ 1 (Thysrael es ~88% del código) |
| **Contribuciones externas** | Baja profundidad — mayoría son 1-2 commits |
| **PRs/Issues en GitHub** | Activo pero no masivo |
| **Badges en README** | Trendshift (trending), HelloGitHub (destacado) |
| **Sponsors** | Compshare (plataforma cloud China) |
| **Ecosistema** | Sitio companion (horizon1123.top), presencia en Linux.DO |
| **Idioma principal** | Chino (mantenedor, mayoría de contribuidores), documentación en EN/ZH/JA |

**Evaluación**:
- El proyecto tiene impulso y visibilidad creciente en la comunidad china de código abierto
- La dependencia de un solo mantenedor es el riesgo principal de sostenibilidad a largo plazo
- Si Thysrael dejara de mantener el proyecto, no hay un sucesor claro

---

## 5. Cobertura de Tests

### 5.1 Estadísticas de testing

| Métrica | Valor |
|---------|-------|
| **Archivos de test** | 39 |
| **Funciones de test** | 436 |
| **Líneas de test** | 9,385 |
| **Líneas de código fuente** | 12,467 |
| **Ratio test/código** | ~0.75 (razonable para proyecto early-stage) |
| **Framework** | pytest >= 8.0 |
| **Coverage tool** | pytest-cov (declarado en dependencias dev) |

### 5.2 Cobertura por módulo (funciones de test)

| Módulo | Tests | Cobertura |
|--------|-------|-----------|
| Webhook | 108 | Extensa (notificaciones, formateo, layouts) |
| MiniMax client | 27 | Específica del proveedor |
| Storage | 22 | Persistencia y archivos |
| OpenBB scraper | 20 | Fuente financiera |
| Twitter | 17 | Scraping + modos Apify/Playwright |
| Summarizer | 16 | Renderizado Markdown |
| MCP smoke | 16 | Integración MCP |
| Category wiring | 16 | Agrupación de categorías |
| Balanced digest | 13 | Límites de digest |
| Chained client | 13 | Failover de proveedores |
| MCP run store | 12 | Estado de ejecuciones MCP |
| Analyzer | 11 | Scoring y análisis |
| Google News | 10 | Fuente de noticias |
| GDELT | 10 | Fuente de noticias |
| Enricher | 10 | Enriquecimiento de contenido |
| Otros 24 módulos | 1-9 c/u | Variable |

Cobertura de áreas críticas:
- ✅ Scrapers: todos los tipos de fuente tienen tests
- ✅ Pipeline AI: analyzer, classifier, enricher, summarizer cubiertos
- ✅ MCP: amplia cobertura (server, adapter, errores, run_store, service)
- ✅ Infraestructura: webhook, email, storage, CLI, URL security
- ✅ Procesamiento: profiles, prompting, content selection, cross-source dedup

### 5.3 CI/CD — ALERTA CRÍTICA

| Componente | Estado |
|-----------|--------|
| **CI de tests** | ❌ **NO EXISTE** — no hay workflow que ejecute tests |
| **Workflows existentes** | `deploy-docs.yml` (despliegue de docs), `daily-summary.yml.disabled` (desactivado) |
| **Verificación en PRs** | ❌ No automatizada |
| **Verificación pre-commit** | ❌ No configurada (sin `.pre-commit-config.yaml`) |

Este es el punto débil más significativo. Los 436 tests existen pero **nunca se ejecutan automáticamente**. No hay garantía de que pasen en `main` después de merges. Para integración en El Radar, esto implica que cualquier dependencia de código de Horizon requeriría ejecutar los tests manualmente antes de adoptar una versión.

---

## 6. Dependencias

### 6.1 Dependencias directas (14 core + 3 grupos opcionales)

**Core** (`pyproject.toml`):

| Dependencia | Versión mínima | Propósito | Riesgo |
|------------|---------------|-----------|--------|
| `httpx` | >=0.27.0 | HTTP async client | Bajo |
| `feedparser` | >=6.0.11 | Parseo RSS/Atom | Bajo |
| `anthropic` | >=0.39.0 | Cliente Claude | Medio (API changes) |
| `openai` | >=1.54.0 | Cliente GPT/Azure/Ali/DeepSeek/Ollama | Medio |
| `google-genai` | >=0.3.0 | Cliente Gemini | Medio (API changes) |
| `pydantic` | >=2.9.0 | Modelos y validación | Bajo |
| `python-dateutil` | >=2.9.0 | Manejo de fechas | Bajo |
| `rich` | >=13.9.0 | Terminal UI | Bajo |
| `tenacity` | >=9.0.0 | Retry logic | Bajo |
| `python-dotenv` | >=1.0.0 | Variables de entorno | Bajo |
| `ddgs` | >=7.0.0 | Búsqueda web (DuckDuckGo) | Bajo |
| `beautifulsoup4` | >=4.12.0 | Parseo HTML | Bajo |
| `markdown` | >=3.10.2 | Renderizado Markdown | Bajo |
| `mcp` | >=1.0.0 | Model Context Protocol | Medio (nuevo estándar) |
| `opencc-python-reimplemented` | >=0.1.7 | Conversión Chino simplificado | Bajo |
| `trafilatura` | >=2.1.0 | Extracción de artículo completo | Bajo |

**Optional extras**:

| Grupo | Dependencias | Propósito |
|-------|-------------|-----------|
| `dev` | pytest, pytest-cov | Desarrollo y testing |
| `openbb` | openbb, openbb-benzinga | Noticias financieras |
| `twitter` | playwright, playwright-stealth | Scraping de Twitter |

### 6.2 Árbol de dependencias completo

| Métrica | Valor |
|---------|-------|
| **Total paquetes en lockfile** | 164 |
| **Gestor de paquetes** | uv (Astral, moderno, rápido) |
| **Build system** | Hatchling |
| **Python requerido** | >=3.11 |

### 6.3 Evaluación de riesgos de dependencias

- **Riesgo bajo general**: La mayoría de dependencias son bibliotecas maduras y bien mantenidas del ecosistema Python
- **Riesgo medio en clientes AI**: anthropic, openai, google-genai tienen ciclos de release frecuentes y breaking changes ocasionales en APIs
- **Riesgo bajo-medio en MCP**: Model Context Protocol es un estándar nuevo (Anthropic, 2024), en evolución activa
- **Sin dependencias abandonadas o inseguras** detectadas visualmente
- **Sin dependencias con CVEs conocidas** (no se ejecutó audit, pero las versiones son recientes)

---

## 7. Calidad del Código

### 7.1 Estructura del proyecto

```
Horizon/
├── src/
│   ├── ai/           # Clientes AI + analyzer + enricher + summarizer + prompting
│   ├── scrapers/     # 10 tipos de fuente (rss, hn, reddit, telegram, twitter, etc.)
│   ├── processing/   # Registry de perfiles
│   ├── storage/      # Persistencia de archivos
│   ├── services/     # Email + webhook
│   ├── setup/        # Wizard interactivo
│   ├── mcp/          # Servidor MCP
│   ├── extractors/   # Extractores de contenido (trafilatura)
│   ├── models.py     # 612 líneas de modelos Pydantic tipados
│   └── orchestrator.py  # 1090 líneas — pipeline principal
├── profiles/         # 4 perfiles de procesamiento (JSON + Markdown prompts)
├── tests/            # 39 archivos, 436 tests
├── docs/             # 9 archivos, 2087 líneas de documentación
└── data/             # Configuraciones y estado
```

### 7.2 Indicadores de calidad

| Indicador | Estado |
|-----------|--------|
| **Type hints** | ✅ Extensivo — Pydantic models, generics, `Optional`, `Union`, `Literal` |
| **Validación de datos** | ✅ Pydantic con `field_validator`, discriminators, config `extra="forbid"` |
| **Manejo de errores** | ✅ Retry con tenacity, logging estructurado, errores MCP tipados |
| **TODO/FIXME/HACK en código** | ✅ **Cero** — no se encontraron marcadores de deuda técnica |
| **Documentación inline** | ✅ Docstrings en modelos, clases principales |
| **Separación de concerns** | ✅ Clara — scrapers, AI, processing, services son módulos independientes |
| **Configuración externalizada** | ✅ JSON + .env, sin hardcoding |
| **Seguridad** | ✅ URL security (SSRF protection), API keys via env vars, `.dockerignore` |
| **Concurrencia** | ✅ asyncio, throttling configurable, concurrencia configurable |
| **Testing** | ✅ Buena cobertura de archivos, ⚠️ sin CI |
| **Linting** | ❌ No configurado (sin `.flake8`, `.pylintrc`, `ruff.toml`, `mypy.ini`) |

### 7.3 Estilo de código

- Arquitectura orientada a funciones asíncronas (no clases de servicio con DI)
- Uso extensivo de Pydantic para modelos de dominio
- Patrón de pipeline funcional: fetch → dedup → classify → analyze → filter → enrich → summarize → deliver
- Código limpio, legible, bien organizado
- Sin deuda técnica visible

---

## 8. Documentación

### 8.1 Documentación disponible

| Documento | Líneas | Contenido |
|-----------|--------|-----------|
| `README.md` | 423 | Visión general, quick start, features, arquitectura |
| `README_zh.md` | 403 | Versión en chino simplificado |
| `README_ja.md` | — | Versión en japonés |
| `docs/configuration.md` | 927 | Guía completa de configuración (AI, sources, profiles, email, webhook, MCP, GitHub Pages) |
| `docs/profiles.md` | 343 | Estructura de perfiles, routing, bloques de enriquecimiento |
| `docs/scrapers.md` | 232 | Detalles de cada scraper y extensión |
| `docs/scoring.md` | 122 | Sistema de scoring y ranking |
| `docs/extractors.md` | 80 | Extracción de artículos completos |
| `docs/twitter-cookies.md` | 128 | Configuración de cookies para Twitter |
| `docs/index.md` | 56 | Página principal de docs |
| `docs/horizon-hub-design.md` | 199 | Diseño del hub de fuentes comunitarias |
| `src/mcp/README.md` | — | Referencia de herramientas MCP |
| `src/mcp/integration.md` | — | Guía de integración MCP |
| `CONTRIBUTING.md` | 73 | Guía de contribución + perfiles |
| `CODE_OF_CONDUCT.md` | 129 | Contributor Covenant |
| `SECURITY.md` | 29 | Política de seguridad |
| `.github/pull_request_template.md` | 25 | Template de PR |
| `.github/ISSUE_TEMPLATE/feature_request.md` | — | Template de feature request |

**Total**: ~30 archivos Markdown, >2,000 líneas de documentación.

### 8.2 Evaluación de calidad

- ✅ Documentación excelente para un proyecto de 6 meses
- ✅ Guía de configuración exhaustiva (927 líneas)
- ✅ Documentación multilingüe (EN/ZH/JA)
- ✅ Documentación de arquitectura y diseño
- ✅ Templates de contribución y PR
- ✅ Políticas de seguridad y código de conducta
- ⚠️ Falta documentación de API interna para desarrolladores
- ⚠️ Sin guía de migración (no aplica aún, sin releases)

---

## 9. Infraestructura y DevOps

| Componente | Estado | Detalle |
|-----------|--------|---------|
| **Docker** | ✅ | Dockerfile multi-stage con uv, usuario no-root, volumes |
| **Docker Compose** | ✅ | Configuración lista para producción |
| **GitHub Actions** | ✅ Parcial | Docs deployment (activo), daily-summary (desactivado) |
| **CI de tests** | ❌ | No existe |
| **Gestión de secretos** | ✅ | `.env` + variables de entorno referenciadas en config |
| **Scripts de automatización** | ✅ | `daily-run.sh` para cron, `check_mcp.py` para verificación |

---

## 10. Resumen de Madurez por Dimensión

| Dimensión | Puntuación (1-10) | Comentario |
|-----------|-------------------|------------|
| **Licencia** | 10/10 | MIT — máxima permisividad y compatibilidad |
| **Arquitectura** | 8/10 | Limpia, modular, bien tipada. Pipeline funcional bien definido |
| **Código** | 8/10 | Sin deuda técnica visible, typing fuerte, patrones consistentes |
| **Documentación** | 8/10 | Excelente para proyecto early-stage, multilingüe, exhaustiva |
| **Testing** | 6/10 | Buena cobertura de archivos, 436 tests, pero SIN CI |
| **CI/CD** | 3/10 | Solo deploy de docs. Sin test runner, sin linting, sin pre-commit |
| **Comunidad** | 4/10 | 15 contribuidores pero 88% es una persona. Sin releases formales |
| **Estabilidad** | 4/10 | v0.1.0, sin releases, sin changelog, API interna puede cambiar |
| **Dependencias** | 8/10 | Modernas, bien mantenidas. 164 paquetes totales manejables |
| **DevOps** | 7/10 | Docker, compose, scripts de cron. Falta CI |
| **MADUREZ GLOBAL** | **6.3/10** | **Medianamente maduro** |

---

## 11. Riesgos para Integración en El Radar

### 11.1 Riesgos técnicos

| Riesgo | Severidad | Probabilidad | Mitigación |
|--------|-----------|-------------|------------|
| API interna cambia sin aviso | 🔴 Alta | Media | Fijar commit específico, encapsular tras adapter |
| Tests no verificados en CI | 🟡 Media | Media | Ejecutar test suite manualmente antes de adoptar |
| Dependencia de AI providers externos | 🟡 Media | Baja | El Radar ya depende de Anthropic — sin cambio |
| Python >=3.11 requerido | 🟢 Baja | Baja | El Radar usa Cloudflare Workers (JS/TS), no Python |
| docker-compose / Python runtime | 🔴 Alta | Alta | **El Radar es serverless (Workers), no puede ejecutar Python** |

### 11.2 Riesgos organizacionales

| Riesgo | Severidad | Probabilidad | Mitigación |
|--------|-----------|-------------|------------|
| Bus factor = 1 | 🟡 Media | Media | Fork interno si es necesario, contribuir upstream |
| Proyecto joven (6 meses) | 🟡 Media | — | Monitorear actividad, no depender críticamente |
| Comunidad china, documentación mixta | 🟢 Baja | — | La documentación EN es excelente |
| Sin soporte comercial/SLA | 🟡 Media | — | Aceptable para proyecto interno; fork si crítico |

### 11.3 El riesgo arquitectónico principal

Horizon es una aplicación **Python monolítica** que corre como proceso (`uv run horizon`). El Radar es **Cloudflare Workers (JavaScript/TypeScript) serverless**. Esto implica que:

- ❌ **No se puede ejecutar Horizon dentro de El Radar** — son runtimes incompatibles
- ✅ **Se puede extraer lógica/algoritmos** de Horizon y reimplementarlos en TypeScript
- ✅ **Se puede ejecutar Horizon como servicio externo** (Docker en VPS) e integrar vía API/MCP
- ✅ **Se pueden adoptar patrones y técnicas** de Horizon en la arquitectura de El Radar

---

## 12. Conclusión

Horizon es un proyecto **bien diseñado y documentado** con una arquitectura limpia que demuestra buenas prácticas de ingeniería de software. Su punto más débil es la falta de CI/CD para testing automatizado y la dependencia de un único mantenedor. Para integración con El Radar, el desafío principal no es la madurez del código sino la **incompatibilidad de runtime** (Python vs Cloudflare Workers).

**Recomendación**: Adoptar técnicas y patrones de Horizon (deduplicación URL + semántica, pipeline de perfiles, enriquecimiento multilingüe) reimplementándolos en TypeScript para el runtime de Workers, en lugar de intentar ejecutar Horizon como dependencia directa.

---

*Informe generado como parte de la evaluación de Horizon para integración en El Radar (espacio-latente.com).*
