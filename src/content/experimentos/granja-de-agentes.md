---
titulo: "La granja de agentes: un orquestador que reparte tareas entre agentes de código"
resumen: "Cómo tengo montada la infraestructura que decompone tareas, las reparte entre agentes maker/checker en contenedores Docker, y por qué construirla sobre el fork de agent-loops (Daniel Fernández) en vez de reescribirla desde cero."
estado: pruebas
unidad: "U-11"
serie: bitacora
fecha: 2026-08-02
---

Tengo dos proyectos activos — `espacio-latente` (este sitio) y `ai-trading-lab` — y una lista de tareas más larga que las horas que les puedo dedicar. La idea de la **granja de agentes** es simple de enunciar y no tan simple de montar bien: un orquestador que coge una tarea, la descompone, la reparte entre agentes que corren en contenedores aislados, verifica el resultado con un segundo agente, y me avisa por Telegram. Sin que yo tenga que estar delante.

Esta bitácora cuenta cómo está montado hoy, qué decisiones se han tomado y por qué, y qué queda pendiente.

<figure class="fig-svg">
<svg viewBox="0 0 720 340" role="img" aria-label="Arquitectura: Telegram al orquestador, el orquestador consulta y actualiza el board SQLite, el dispatcher lanza contenedores Docker con agentes maker o checker, y el resultado vuelve como RESULT_JSON">
  <g font-family="IBM Plex Mono, monospace" font-size="11">
    <rect x="8" y="10" width="150" height="50" rx="4" fill="#1a1f26" stroke="#2c333d"/>
    <text x="28" y="32" fill="#e9e5da" font-size="12">TELEGRAM</text>
    <text x="28" y="48" fill="#8a97a5" font-size="9">/new /tasks /status</text>
    <line x1="158" y1="35" x2="210" y2="35" stroke="#8a97a5" marker-end="url(#arr)"/>
    <rect x="212" y="10" width="180" height="50" rx="4" fill="#1a1f26" stroke="#ffb454"/>
    <text x="228" y="32" fill="#ffb454" font-size="12">ORCHESTRATOR API</text>
    <text x="228" y="48" fill="#8a97a5" font-size="9">POST /api/tasks · /api/boards</text>
    <line x1="302" y1="60" x2="302" y2="100" stroke="#8a97a5" marker-end="url(#arr)"/>
    <rect x="132" y="102" width="340" height="60" rx="4" fill="#1a1f26" stroke="#2c333d"/>
    <text x="148" y="124" fill="#e9e5da" font-size="12">BOARD (SQLite)</text>
    <text x="148" y="140" fill="#8a97a5" font-size="9">1 board por proyecto: espacio-latente · ai-trading-lab</text>
    <text x="148" y="153" fill="#5c6b7a" font-size="9">triage → todo → ready → running → done / blocked / gave_up</text>
    <line x1="302" y1="162" x2="302" y2="200" stroke="#8a97a5" marker-end="url(#arr)"/>
    <rect x="132" y="202" width="340" height="46" rx="4" fill="#1a1f26" stroke="#2c333d"/>
    <text x="148" y="222" fill="#e9e5da" font-size="12">DISPATCHER</text>
    <text x="148" y="238" fill="#8a97a5" font-size="9">tick cada 30s: promociona, reclama, lanza contenedores</text>
    <line x1="302" y1="248" x2="200" y2="277" stroke="#8a97a5" marker-end="url(#arr)"/>
    <line x1="302" y1="248" x2="500" y2="277" stroke="#8a97a5" marker-end="url(#arr)"/>
    <rect x="60" y="280" width="280" height="50" rx="4" fill="#1a1f26" stroke="#2c333d"/>
    <text x="76" y="300" fill="#e9e5da" font-size="12">MAKER</text>
    <text x="76" y="316" fill="#8a97a5" font-size="9">contenedor Docker · backend/frontend/devops/sre</text>
    <rect x="360" y="280" width="280" height="50" rx="4" fill="#1a1f26" stroke="#7adb8f"/>
    <text x="376" y="300" fill="#7adb8f" font-size="12">CHECKER</text>
    <text x="376" y="316" fill="#8a97a5" font-size="9">contenedor Docker · qa/security, verifica al maker</text>
    <line x1="350" y1="279" x2="350" y2="250" stroke="#ffb454" stroke-dasharray="2 3" marker-end="url(#arrorange)"/>
    <text x="356" y="269" fill="#ffb454" font-size="9">RESULT_JSON:</text>
    <rect x="500" y="102" width="180" height="60" rx="4" fill="#1a1f26" stroke="#7adb8f"/>
    <text x="516" y="124" fill="#7adb8f" font-size="11">MEMANTO</text>
    <text x="516" y="140" fill="#8a97a5" font-size="8">memoria por board, on-prem</text>
    <text x="516" y="153" fill="#5c6b7a" font-size="8">Ollama + Moorcheh, en el sobremesa</text>
    <defs>
      <marker id="arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
        <path d="M0,0 L6,3 L0,6 Z" fill="#8a97a5"/>
      </marker>
      <marker id="arrorange" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
        <path d="M0,0 L6,3 L0,6 Z" fill="#ffb454"/>
      </marker>
    </defs>
  </g>
</svg>
<figcaption>El camino de una tarea: Telegram → API → board SQLite → dispatcher → contenedor (maker, y opcionalmente checker) → resultado estructurado de vuelta al board como <code>RESULT_JSON</code> (<code>status</code>/<code>summary</code>/<code>learnings</code>/<code>files_changed</code>). Memanto consulta y escribe memoria por proyecto en cada paso.</figcaption>
</figure>

## La base: un fork, no un proyecto propio

La granja está construida sobre [`agent-loops`](https://github.com/danifernandezs/agent-loops), de [Daniel Fernández](https://github.com/danifernandezs) — un repo suyo que cloné hace tiempo. Antes de construir nada encima me hice la pregunta obvia: ¿lo uso solo porque ya lo tengo clonado, o de verdad aguanta el peso?

La respuesta, tras auditar el código, fue que sí aguanta: ~5.300 líneas repartidas en módulos con una responsabilidad clara cada uno (`board.js`, `dispatcher.js`, `docker-runner.js`, `git-manager.js`, el conector de Telegram), con un test por módulo. No es deuda técnica escondida — es prácticamente la misma arquitectura a la que yo habría llegado: orquestador + cola + runner de Docker + bot. El riesgo real no era la calidad del código, era heredar decisiones de diseño ajenas sin darme cuenta. Ese riesgo se gestiona sobre la marcha, no reescribiendo 5.300 líneas para llegar al mismo sitio.

## Lo que ya estaba construido

Un orquestador Node.js con SQLite como "board" (tablero kanban), que:

- Descompone una tarea de alto nivel en subtareas vía LLM (`decomposer.js`).
- Lanza un contenedor Docker por subtarea, con un perfil de agente (`backend`, `frontend`, `qa`, `security`, `devops`, `sre`) y sus reglas propias.
- Distingue **maker** (implementa) de **checker** (`qa`/`security`, verifica lo que hizo el maker antes de dar la tarea por cerrada).
- Escribe un `BOARD.md` legible y responde por Telegram.

Lo que le faltaba para servir a dos proyectos reales a la vez, y lo que he cerrado hoy, son tres piezas.

## Pieza A — multi-board de verdad

La tabla `boards` existía en el esquema pero no había forma de crear uno ni de decirle a una tarea a qué board pertenece salvo por su `id` numérico. Ahora:

- `POST /api/boards` crea un board (`{slug, name, description}`), con 409 si el slug ya existe.
- `GET`/`POST /api/tasks` aceptan `board: "espacio-latente"` además del `board_id` numérico — así Telegram y yo pensamos en slugs, no en ids.
- En Telegram, `/new`, `/tasks`, `/status` y `/task` ahora **exigen** el slug como primer argumento, sin caer a un board por defecto en silencio. Prefiero un error explícito a que una tarea aparezca en el board equivocado sin que nadie se entere.

## Pieza B — un contrato en vez de adivinar logs

Esta era la pieza que más me preocupaba de la auditoría original. El orquestador se enteraba de si un agente había terminado bien **leyendo el log de texto plano del contenedor**, con tres heurísticas distintas buscando frases como `SESSION_COMPLETE:` o `Session complete!`. Frágil, y sobre todo: esas frases no las pedía ningún prompt actual — la plantilla decía «escribe un iteration-summary» y el parser buscaba un marcador que nadie emitía.

Ahora el contrato es explícito. Las seis plantillas de agente (`agents/templates/*.template`) exigen que el último mensaje del agente termine con:

```
RESULT_JSON:
{"status":"success","summary":"...","learnings":["..."],"files_changed":["..."]}
```

Y `dispatcher.js` ya no adivina: busca el marcador, valida el JSON, y si no aparece o no parsea **no lo esconde** — emite un evento `result_protocol_missing` visible en el board. Un runtime mal configurado se detecta en vez de disfrazarse de éxito silencioso. `learnings` es, además, el campo que va a alimentar memoria persistente en la siguiente pieza.

## Pieza D — agrupación visual (cosmética, pero no gratis)

El board interno mantiene el enum de estados original (`triage/todo/ready/running/blocked/done/archived/gave_up`) porque todo el dispatcher ya razona sobre él. Pero para mirarlo de un vistazo, cuatro columnas dicen más que ocho estados: **Ready · In Progress · Ready to Verify · Done/Discarded**.

Lo interesante de "Ready to Verify" es que no es un estado nuevo — es una tarea `ready` cuyo `assignee` es un checker (`qa`/`security`) y cuyos hermanos maker ya han terminado. Esa condición ya existía en el dispatcher (`hasRunningSiblings`, la usa para decidir si lanza el checker o lo deja esperando); lo único que hice fue exponerla como vista, sin tocar el estado real.

## Pieza C — memoria persistente, y por qué no vive donde yo pensaba

Antes de esta pieza, cada tarea empezaba de cero: nada de lo aprendido en una tarea llegaba a la siguiente. La idea era sencilla — antes de generar el spec de una tarea, consultar una memoria acotada al proyecto (mismo namespace que el board slug), y al terminar, escribir de vuelta usando el campo `learnings` del contrato de la Pieza B. Lo interesante no fue el código (poco: `queryMemories`/`writeMemory`, fail-open, dos puntos de enganche), sino dónde vive esa memoria.

**Herramienta:** [memanto](https://github.com/moorcheh-ai/memanto) — `remember`/`recall`/`answer` sobre un motor de búsqueda semántica (Moorcheh) que se puede correr en su nube gratuita o on-prem. Descarté la nube por el mismo motivo de siempre en este blog: los datos de mis proyectos saliendo de mi red por una comodidad que además no hacía falta. Miré también [Mem0](https://github.com/mem0ai/mem0) — más abierto y maduro — pero su imagen oficial solo trae proveedores cloud (OpenAI/Anthropic/Gemini) para el LLM; montarlo 100% local habría exigido reconstruir su imagen Docker.

**Dónde, y por qué no donde pensaba.** Mi primer instinto fue el NAS (Synology DS220+, siempre encendido). Craso error: un Celeron J4025 de 2 núcleos no da para correr Ollama con un LLM local a una latencia razonable, tuviera los contenedores que tuviera parados. El sitio correcto estaba delante de mis narices: el sobremesa, que ya corre un modelo de 35B para otro proyecto (Hermes, vía llama.cpp) y tiene una RTX 3090 Ti y 64 GB de RAM de sobra. El único "pero" — no está encendido 24/7 — pesa menos de lo que parece: coincide con cuándo trabajo, y ya hay Wake-on-LAN integrado para otros flujos.

Aquí entra un principio que ya se aplicó en otro proyecto de esta casa: **mantener el peso del modelo en local**, sin depender de una API externa como cerebro del sistema. Ese criterio, más que el benchmark de turno, fue el que decidió la arquitectura.

**Lo que costó montarlo (para cuando lo vuelva a instalar):**
- La última versión publicada de memanto (0.2.12) tiene un bug de compatibilidad con la versión actual de su motor — instalado directo desde el repo en vez de PyPI.
- El motor por defecto quiere el puerto 8080, que ya usaba el servidor de Hermes — reasignado sin tocar lo que ya funcionaba.
- Permisos de volumen Docker (el contenedor corre con un uid que no es el mío).
- Ollama solo escuchaba en `127.0.0.1`, invisible para un contenedor — el mismo ajuste (`--host 0.0.0.0`) que ya hizo falta para el propio Hermes, aplicado ahora al servicio de embeddings.

Con eso resuelto: dos agentes de memoria activos (`espacio-latente`, `ai-trading-lab`, uno por proyecto), probados de punta a punta con datos reales, y con persistencia — sobreviven a un reinicio del sobremesa sin que nadie tenga que iniciar sesión.

<figure class="fig-svg">
<svg viewBox="0 0 720 210" role="img" aria-label="Pila de memanto en el sobremesa: Ollama sirve embeddings y LLM al motor Moorcheh en Docker, que a su vez sirve la API REST de memanto; el orquestador consulta por HTTP; los tres procesos sobreviven a un reinicio">
  <g font-family="IBM Plex Mono, monospace" font-size="11">
    <rect x="8" y="8" width="704" height="150" rx="4" fill="#161a20" stroke="#3a4048" stroke-dasharray="3 3"/>
    <text x="24" y="26" fill="#5c6b7a" font-size="9" letter-spacing="1">SOBREMESA (192.168.1.32) · systemd --user, persiste tras reinicio</text>
    <rect x="24" y="40" width="150" height="72" rx="4" fill="#1a1f26" stroke="#2c333d"/>
    <text x="38" y="60" fill="#e9e5da" font-size="12">OLLAMA</text>
    <text x="38" y="76" fill="#8a97a5" font-size="9">:11434 (0.0.0.0)</text>
    <text x="38" y="90" fill="#5c6b7a" font-size="8">nomic-embed-text</text>
    <text x="38" y="102" fill="#5c6b7a" font-size="8">qwen2.5</text>
    <line x1="174" y1="76" x2="216" y2="76" stroke="#8a97a5" marker-end="url(#arr2)"/>
    <rect x="218" y="40" width="180" height="72" rx="4" fill="#1a1f26" stroke="#7adb8f"/>
    <text x="232" y="60" fill="#7adb8f" font-size="12">MOTOR MOORCHEH</text>
    <text x="232" y="76" fill="#8a97a5" font-size="9">:8090 (Docker)</text>
    <text x="232" y="90" fill="#5c6b7a" font-size="8">restart: unless-stopped</text>
    <text x="232" y="102" fill="#5c6b7a" font-size="8">Apache-2.0</text>
    <line x1="398" y1="76" x2="440" y2="76" stroke="#8a97a5" marker-end="url(#arr2)"/>
    <rect x="442" y="40" width="180" height="72" rx="4" fill="#1a1f26" stroke="#ffb454"/>
    <text x="456" y="60" fill="#ffb454" font-size="12">MEMANTO API</text>
    <text x="456" y="76" fill="#8a97a5" font-size="9">:8000 (memanto.service)</text>
    <text x="456" y="90" fill="#5c6b7a" font-size="8">remember · recall · answer</text>
    <text x="456" y="102" fill="#5c6b7a" font-size="8">linger activo, sin login</text>
    <line x1="622" y1="76" x2="660" y2="76" stroke="#ffb454" stroke-dasharray="2 3" marker-end="url(#arr2)"/>
    <text x="626" y="130" fill="#8a97a5" font-size="9">orquestador</text>
    <text x="626" y="142" fill="#5c6b7a" font-size="8">HTTP :8000</text>
    <defs>
      <marker id="arr2" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
        <path d="M0,0 L6,3 L0,6 Z" fill="#8a97a5"/>
      </marker>
    </defs>
  </g>
</svg>
<figcaption>Tres procesos encadenados, cada uno con su propia persistencia (systemd de sistema, política de reinicio de Docker, systemd de usuario con linger) — ninguno depende de que yo tenga sesión iniciada.</figcaption>
</figure>

## Un auditor de deuda como parte del ciclo, no como extra

Después de cerrar las cuatro piezas, hice a mano un barrido de código muerto sobre `agent-loops` — exports sin caller, tests huérfanos. Encontré unas cuantas cosas. Luego probé [ponytail](https://github.com/DietrichGebert/ponytail), un plugin de Claude Code que fuerza una disciplina de "el código que nunca se escribe no hay que mantenerlo" y trae un comando de auditoría de todo el repo (`/ponytail-audit`). Lo corrí sobre el mismo repo que ya había mirado a mano, y encontró cosas que a mí se me habían escapado — incluida una duplicación que yo mismo acababa de introducir esa misma tarde (dos funciones casi idénticas para la misma condición, una en `dispatcher.js` y otra en `status-renderer.js`, en vez de una sola en `board.js`).

Cada hallazgo se verificó antes de tocar nada — que de verdad no tuviera caller, que los tests siguieran en verde después del cambio — y solo entonces se aplicó. Sin eso, "auditoría automática" es solo una lista de sugerencias sin criterio.

La conclusión práctica: esto no es una herramienta que se prueba una vez y se archiva, es un paso que tiene sentido repetir cada vez que el código crece — así que pasa a formar parte del ciclo de trabajo de este proyecto, no de una sesión suelta. Un timer de `systemd` de usuario (domingos 21:00, el mismo patrón que ya usaba para la revisión diaria de `ai-trading-lab`) lo dispara solo, repo por repo:

<figure class="fig-svg">
<svg viewBox="0 0 720 190" role="img" aria-label="Ciclo de higiene semanal: audita, verifica cada hallazgo a mano, mide tests antes y después, y solo aplica si no hay regresión; siempre commit local, nunca push">
  <g font-family="IBM Plex Mono, monospace" font-size="11">
    <rect x="4" y="20" width="118" height="44" rx="4" fill="#1a1f26" stroke="#2c333d"/>
    <text x="16" y="38" fill="#e9e5da" font-size="10">ponytail-audit</text>
    <text x="16" y="52" fill="#8a97a5" font-size="8">repo completo</text>
    <line x1="122" y1="42" x2="152" y2="42" stroke="#8a97a5" marker-end="url(#arr3)"/>
    <rect x="154" y="20" width="118" height="44" rx="4" fill="#1a1f26" stroke="#2c333d"/>
    <text x="166" y="38" fill="#e9e5da" font-size="10">verificar a mano</text>
    <text x="166" y="52" fill="#8a97a5" font-size="8">grep de callers reales</text>
    <line x1="272" y1="42" x2="302" y2="42" stroke="#8a97a5" marker-end="url(#arr3)"/>
    <rect x="304" y="20" width="118" height="44" rx="4" fill="#1a1f26" stroke="#2c333d"/>
    <text x="316" y="38" fill="#e9e5da" font-size="10">tests: baseline</text>
    <text x="316" y="52" fill="#8a97a5" font-size="8">antes de tocar nada</text>
    <line x1="422" y1="42" x2="452" y2="42" stroke="#8a97a5" marker-end="url(#arr3)"/>
    <rect x="454" y="20" width="118" height="44" rx="4" fill="#1a1f26" stroke="#2c333d"/>
    <text x="466" y="38" fill="#e9e5da" font-size="10">aplicar + tests</text>
    <text x="466" y="52" fill="#8a97a5" font-size="8">¿misma cobertura?</text>
    <line x1="513" y1="64" x2="513" y2="96" stroke="#8a97a5" marker-end="url(#arr3)"/>
    <path d="M470,100 L556,100 L513,138 Z" fill="none" stroke="#5c6b7a"/>
    <text x="513" y="115" fill="#8a97a5" font-size="8" text-anchor="middle">¿regresión?</text>
    <line x1="470" y1="118" x2="330" y2="118" stroke="#ff8a8a" marker-end="url(#arrred)"/>
    <text x="336" y="112" fill="#ff8a8a" font-size="8">sí → revertir</text>
    <line x1="513" y1="138" x2="513" y2="160" stroke="#7adb8f" marker-end="url(#arrgreen)"/>
    <rect x="404" y="162" width="220" height="26" rx="4" fill="#1a1f26" stroke="#7adb8f"/>
    <text x="416" y="180" fill="#7adb8f" font-size="10">no → commit local (nunca push)</text>
    <defs>
      <marker id="arr3" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#8a97a5"/></marker>
      <marker id="arrred" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#ff8a8a"/></marker>
      <marker id="arrgreen" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#7adb8f"/></marker>
    </defs>
  </g>
</svg>
<figcaption>Primera ejecución real (2026-08-03): 6 repos auditados, 5 commits locales aplicados en 3 de ellos, 0 pushes. Un flag muerto de ~1200 líneas se detectó y se dejó anotado para revisión manual en vez de tocarlo sin supervisión — borrar un subsistema entero no es una decisión para un cron.</figcaption>
</figure>

## Lo que sigue sin decidir, a propósito

El runtime que corre dentro de cada contenedor (`iteratr` + `opencode`, hoy) podría cambiar a Claude Code CLI más adelante. Esa decisión se ha dejado fuera a propósito: todo lo construido en esta fase —el protocolo `RESULT_JSON`, el multi-board, la agrupación visual— es agnóstico a qué modelo o runtime hay dentro del contenedor. Si cambia el runtime, solo hace falta que el hook de fin de sesión emita el mismo marcador.
