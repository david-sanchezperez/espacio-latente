# DEVLOG — Radar v0.2

Diario de decisiones de la evolución del radar hacia un pipeline de IA
optimizado y observable (cascada de modelos, dedup semántica, memoria
editorial en Vectorize, presupuesto diario, dashboard). Una entrada por
fase, append-only.

## Fase 1 — Contabilidad (2026-07-20)

**Objetivo**: instrumentar cada llamada a un modelo con modelo/tokens
in-out/coste/propósito, sin cambiar el output publicado ni el
comportamiento del pipeline. Base para medir antes de optimizar.

**Stack decidido para toda v0.2** (no solo fase 1): Vectorize en vez de
ChromaDB, Workers AI (`bge-m3`) para embeddings, D1 en vez de SQLite local
para métricas, `config.js` en vez de YAML, `wrangler dev` + `/ejecutar` en
vez de `make run`. Todo nativo de Cloudflare, sin mover el pipeline fuera
del Worker.

**Qué se implementó**:
- `config.js`: modelos, precios USD/token, umbral de relevancia, TTL de
  archivo — centraliza lo que antes estaba repartido entre `resumen.js` e
  `index.js`.
- `schema.sql` + binding `RADAR_DB` (D1): tabla única
  `radar_llamadas_llm`. Una fila por llamada a modelo
  (`proposito: 'relevancia_resumen'` o `'comparacion'`) y una fila de
  cierre por pasada (`proposito: 'meta_pasada'`) con
  `subrequests_total`, `items_procesados`, `duracion_ms`.
- `costes.js`: `fetchContado()` envuelve cada fetch externo (feeds RSS,
  API de Anthropic, extracción de artículo) e incrementa un contador de
  subrequests **antes** de esperar la respuesta — así un timeout o un
  reintento futuro cuentan igual que una llamada exitosa. Llamadas a
  bindings nativos (Workers AI, KV, D1) no pasan por aquí: comparten un
  techo interno distinto y mucho más alto que el límite de 50
  subrequests externos del plan free.
- `resumir()` en `resumen.js` ahora captura `usage` real de la respuesta
  (tanto de Anthropic como de Workers AI) y registra la llamada en D1.
  Si la llamada falla, se registra igual con `resultado: 'error_estimado'`
  y tokens estimados por longitud de texto (nunca se mezcla con `'ok'`,
  que siempre implica tokens reales de la API).
- Todo el registro en D1 es best-effort: un fallo de escritura se loguea
  y no interrumpe el pipeline (mismo principio de fail-open que ya regía
  el resumen).

**Qué NO cambió**: el prompt de resumen, el umbral de relevancia (sigue
en 4), qué se publica o cómo se sirve. Puramente observacional.

**Límites del free tier verificados contra la documentación oficial de
Cloudflare (no de memoria) antes de implementar**:
- CPU time: 10ms/invocación por defecto (configurable hasta 300000ms) —
  el pipeline es I/O-bound, no es el límite que importa aquí.
- Subrequests externos: **50/invocación**, y el propio código ya evidenciaba
  que esto obligó a repartir las fuentes en dos pasadas. Es el límite real
  a vigilar según crezca el volumen — de ahí el conteo en vivo en vez de
  esperar a `wrangler tail`.
- D1: 5M filas leídas/día, 100K escritas/día, 5GB storage — sin riesgo
  al volumen actual (decenas-cientos de filas/día).
- Workers AI: 10.000 neuronas/día gratis; `bge-m3` ≈ 1075
  neuronas/millón de tokens — margen amplio para fase 2.
- Vectorize: 5M dimensiones almacenadas/mes gratis, 30M consultadas/mes.
  Con `bge-m3` (1024 dims) son **~4880 vectores almacenables en el free
  tier** — el techo real del stack, ver nota para fase 4 más abajo.

**Métricas de cierre** (a rellenar tras unos días de datos reales en
`radar_llamadas_llm` — la razón de instrumentar antes de decidir):
- Llamadas/día, coste/día.
- **Coste medio por item publicado** (no solo coste/día) — línea base
  para medir el ahorro real de la dedup semántica en fase 2.
- Subrequests externos máximos observados por pasada, frente al techo de 50.
- Distribución de tokens in/out por proveedor.

**Abierto para fases siguientes**:
- *Fase 2*: cada item nuevo sumará 1 llamada a Workers AI (embedding) +
  1 consulta a Vectorize antes de Haiku. Verificar con los subrequests
  reales de fase 1 cuánto margen queda antes del límite de 50 (los
  bindings de Workers AI/Vectorize no cuentan ahí, solo Haiku y los
  fetch de feeds).
- *Fase 4 (memoria editorial)* — hipótesis a validar con volúmenes
  reales: el archivo completo en Vectorize no cabe en el free tier
  indefinidamente (~4880 vectores), pero probablemente no hace falta.
  El caso de uso ("¿es esta la tercera noticia sobre X este mes?") es de
  ventana corta. Con una ventana deslizante de 90 días a ritmo actual
  (~30 items/día) son ~2700 vectores: cabe con margen. KV sigue
  teniendo el histórico completo por si algún día hiciera falta
  reindexar más atrás. Decisión de diseño pendiente de confirmar con los
  números reales que fase 1 empieza a recoger ahora.

**Pendiente de verificar en producción** (no reproducible en local): el
nombre exacto de las claves de `usage` que devuelve Workers AI para
`llama-3.2-3b-instruct` no está confirmado en la documentación pública —
`llamarWorkersAI()` prueba las dos convenciones habituales con fallback a
0. Como esta ruta hoy solo se ejerce vía `/comparar` (producción usa
Haiku), no bloquea el cierre de fase 1, pero conviene confirmarlo con
`wrangler tail` en la primera comparación real.

**Pendiente de aplicar en producción** (no hecho en esta sesión, requiere
acceso a la cuenta de Cloudflare):
```
npx wrangler d1 create radar-costes
# copiar el database_id devuelto a wrangler.toml (sustituye el placeholder)
npx wrangler d1 execute radar-costes --file=schema.sql --remote
npx wrangler deploy
```

## Fase 1 — cierre (2026-07-20)

Aplicado en producción: D1 creada y schema ejecutado en remoto, worker
desplegado, `RADAR_SECRET` rotado. Una pasada manual de verificación vía
`/ejecutar` confirmó el registro end-to-end en `radar_llamadas_llm` (items
procesados, coste real de Haiku, fila `meta_pasada`).

Esa misma pasada de verificación, al correr sobre las 28 fuentes en una
sola invocación (sin `?mitad=`), confirmó en vivo el riesgo que esta fase
solo había anotado en teoría: **59 subrequests externos**, por encima del
límite de 50 del free tier — 8 fuentes fallaron con "Too many subrequests".
No era hipotético para fase 2 (embeddings): ya pasaba en fase 1, con el
volumen de fuentes actual.

**Decisión sobre cómo evitarlo, evaluada y descartada la alternativa de
pago**: Workers Paid ($5/mes) sube el límite de subrequests a 1000, pero
esto sube dinero real por resolver algo que Cloudflare Queues resuelve
gratis (10.000 operaciones/día en el free tier, muy por encima de este
volumen). Se descartó también migrar el vector store a infraestructura
propia (NAS Synology) o usar hardware local (equipo de trading) para
cómputo por lotes — ninguna de las dos resolvía un problema real: el cupo
de Vectorize (~4880 vectores) ya cubre con margen la ventana de 90 días
prevista, y el coste real de Haiku medido en D1 (~$0.0015-0.002/llamada)
hace que ahorrar cambiando de proveedor de LLM en trabajos por lotes no
compense la complejidad operativa de depender de hardware con
disponibilidad parcial (el equipo de trading sigue el calendario de
NASDAQ, apagado fines de semana/festivos — no cubre ni siquiera la pasada
de las 07:00 UTC en ninguna época del año).

**Migración a Queues, implementada y verificada**:
- `wrangler.toml`: nuevo binding `RADAR_QUEUE` (productor y consumer de la
  cola `radar-fuentes`), `max_batch_size = 1` y `max_concurrency = 1` —
  evita que dos mensajes escriban a la vez en la misma clave de KV del día
  (la dedup/publish de `ejecutarDigest` no es segura ante escrituras
  concurrentes).
- `config.js`: `COLA.FUENTES_POR_LOTE = 5`.
- `index.js`: `scheduled()` y `ejecutarManual()` ya no llaman a
  `ejecutarDigest` directamente — reparten las fuentes en lotes de 5 y
  encolan un mensaje por lote (`encolarPorLotes`). El nuevo handler
  `queue()` consume cada mensaje y llama a `ejecutarDigest` igual que
  antes, pero solo sobre ese lote — la lógica de dedup/resumen/publicación
  no cambió, solo cuántas fuentes entran en cada invocación.
  `ejecutarManual` ahora responde de inmediato con el nº de lotes
  encolados en vez del resultado síncrono; el resultado real se ve en
  D1/el digest público.
- Verificado en producción: pasada manual con 14 fuentes → 3 lotes → cada
  uno registró su propia fila `meta_pasada` con 4-8 subrequests (antes: una
  sola invocación con 55-59). Sin errores de "Too many subrequests" en
  ningún lote.

## Fase 2 — memoria semántica (2026-07-21)

**Objetivo**: dos usos del mismo índice Vectorize sobre el mismo embedding
(`bge-m3`) — dedup del día (fusionar cobertura repetida de una noticia desde
varias fuentes, sin fusionar, en vez de resumir dos veces) y memoria
editorial (enlazar la noticia de hoy con cobertura pasada relacionada, como
contexto que Haiku puede mencionar en el resumen). Fusionadas en una sola
implementación por decisión explícita, en vez de dos fases separadas como
sugería el plan original — comparten infraestructura.

**Qué se implementó**:
- Índice Vectorize `radar-memoria` (1024 dims, coseno) + binding
  `RADAR_VECTORIZE`.
- `memoria.js`: `generarEmbedding` (Workers AI `bge-m3`), `buscarVecinos`
  (consulta sin filtro de metadata — la ventana de 90 días se aplica en JS
  sobre la fecha del vecino), `clasificarVecinos` (dos umbrales:
  `UMBRAL_DUPLICADO` 0.93, `UMBRAL_RELACIONADO` 0.80 — estimados a ojo,
  pendientes de calibrar con `similitud_top`/`clasificacion` reales en D1),
  `guardarVector` (id = SHA-256 truncado del link).
- `index.js` (`ejecutarDigest`): antes de llamar a Haiku, cada item nuevo se
  clasifica. `duplicado` → se fusiona como fuente adicional en el item ya
  presente en la ventana de esta pasada (`existentesHoy`/`nuevos`); si el
  vecino es de un día anterior (ya servido, no mutable con seguridad), se
  descarta sin más. `relacionado` → se pasa como contexto a `resumir()`.
  `nuevo` → camino normal. Solo se guarda vector de lo que se publica de
  verdad (nunca de lo descartado por baja relevancia).
- `resumen.js`: bloque "CONTEXTO PROPIO" opcional en el prompt — Haiku puede
  mencionar la relación en el resumen, pero tiene prohibido escribir URLs;
  el link real lo añade el código aparte (`item.contexto`), nunca el modelo,
  para no depender de que un LLM reproduzca una URL fielmente.
- `paginas.js`: fuentes fusionadas se muestran unidas (`Fuente A · Fuente B`);
  el contexto histórico se renderiza como línea aparte con link real, tanto
  en el HTML como (en texto plano) en el feed Atom.
- D1: nuevas columnas `clasificacion`/`similitud_top`/`vecino_link` en
  `radar_llamadas_llm`, propósito `dedup_semantica` — una fila por item
  evaluado, igual que fase 1 se apoyó en `meta_pasada` para calibrar
  subrequests, aquí sirve para calibrar los umbrales con datos reales.
- `/backfill-memoria` (temporal, protegido, con `?desde=N` para reanudar por
  tandas): embebe e inserta en Vectorize lo ya publicado hoy/ayer en KV, que
  nunca pasó por `guardarVector` al haberse publicado antes de este
  despliegue. Quitar una vez completado (mismo criterio que `/diagnostico`
  en fase 1).

**Hallazgo importante que corrige una suposición de fase 1** (verificado en
producción, no de memoria): `env.AI.run()` y las llamadas a
`env.RADAR_VECTORIZE.*` **sí cuentan** contra el límite de 50
subrequests/invocación — NO comparten "un techo interno distinto y mucho más
alto" como se asumió al diseñar la contabilidad de fase 1. Se confirmó
corriendo `/backfill-memoria` sobre 69 items en una sola invocación: los
primeros 50 `env.AI.run()` funcionaron, del 51 en adelante fallaron con
"Too many subrequests by single Worker invocation". Esto importa porque cada
item nuevo en el pipeline de producción ahora gasta 2-3 subrequests más
(embed + consulta + posible inserción) de los que el reparto en lotes de
fase 1 (`COLA.FUENTES_POR_LOTE = 5`) tenía presupuestados, pensado solo para
las llamadas a Haiku y a los feeds.

**Mitigación aplicada**: `memoria.js` acepta el mismo `contador` que
`fetchContado` (costes.js) para `generarEmbedding`/`buscarVecinos`/
`guardarVector`, así `subrequests_total` en D1 refleja el gasto real.
`config.js` añade `MEMORIA.PRESUPUESTO_SUBREQUESTS_MAX = 40`: por debajo de
ese conteo se intenta memoria semántica; por encima, se salta fase 2 para el
resto del lote y el item sigue el camino normal (Haiku sin contexto/dedup,
`clasificacion: 'sin_presupuesto'` en D1) — mejor perder memoria semántica
puntualmente que perder una noticia real por agotar subrequests. Pendiente
de revisar con datos reales si `COLA.FUENTES_POR_LOTE` también debería
bajar, ahora que cada item cuesta más subrequests que en fase 1.

**Verificado en producción**: pasada manual (`/ejecutar?mitad=manana`, 14
fuentes → 3 lotes) corrió limpia tras el despliegue, sin errores; los 3
items nuevos de esa pasada no superaron el umbral de relevancia (no hubo
publicación, por tanto tampoco vector nuevo — comportamiento esperado, no un
fallo). `/backfill-memoria` corrido en dos tandas (`?desde=0` y `?desde=50`)
sobre el histórico existente: 69/69 items insertados en Vectorize
(`vectorCount: 69` confirmado con `wrangler vectorize info`), 0 fallos en la
segunda tanda — la primera había parado en 50 por el límite de subrequests
antes descrito, reproducible igual en dos corridas (no aleatorio), lo que
confirmó que era el límite y no un fallo transitorio.

**Ajuste de seguridad tras simular el caso extremo**: con
`PRESUPUESTO_SUBREQUESTS_MAX = 40`, un lote con una fuente sin `limite`
trayendo sus 20 items por defecto (`feed.js`) completamente nuevos de golpe
(solo plausible el primer día que se añade una fuente, o tras downtime
largo) daba ~52 subrequests — por encima del límite, arriesgando 1-2
fallos de Haiku al final del lote (fail-open: se publica solo con el
título, no se pierde la noticia, pero sí el resumen). Bajado a **30** para
dejar más margen; con el caso real observado (lotes de 4-8 subrequests,
0-3 items nuevos) el cambio no se nota.

**Cerrado**: `/backfill-memoria` retirado del Worker una vez completado el
backfill (mismo criterio que `/diagnostico` en fase 1) y redesplegado.
Pendiente para cuando haya volumen real: confirmar con una pasada normal
(cron o `/ejecutar`) que `duplicado`/`relacionado` se detectan
correctamente ahora que el índice tiene contenido, y revisar
`similitud_top`/`clasificacion` en D1 tras unos días para calibrar
`UMBRAL_DUPLICADO`/`UMBRAL_RELACIONADO` con datos reales en vez de la
estimación inicial.

**Decisión sobre el margen restante del límite de 50**: `PRESUPUESTO_SUBREQUESTS_MAX
= 30` no es una garantía matemática absoluta — Haiku nunca se salta, así que
un lote con dos fuentes distintas volcando de golpe sus ~20 items por
defecto (`feed.js`), todos nunca vistos, seguiría pudiendo superar 50 (ya
era un riesgo latente en el diseño de fase 1, con o sin embeddings, no
introducido por fase 2). Opciones evaluadas: (1) tope duro de items por
invocación, re-encolando el resto — solución limpia y gratis, pero no
implementada aún; (2) Workers Paid ($5/mes, sube el límite a 1000) — ya
descartado en fase 1 por la misma razón de entonces. Decisión: no tocar
nada más ahora — el patrón real observado (4-8 subrequests/lote) está lejos
del límite, y el escenario de riesgo (dos fuentes cargadas coincidiendo en
el mismo lote) es hipotético. Monitorizar `subrequests_total` en
`meta_pasada` (D1) y revisar con datos reales si el margen empieza a
estrecharse, en vez de resolver un problema que hoy no existe.
