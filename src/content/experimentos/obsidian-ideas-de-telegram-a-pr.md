---
titulo: "obsidian-ideas: de un enlace en Telegram a un PR abierto"
resumen: "El bot que más uso hoy: convierte un enlace suelto en una nota de Obsidian y, si encaja con algo concreto que un proyecto puede hacer, abre una tarea autónoma sin que yo tenga que decidirlo."
estado: pruebas
unidad: "U-18"
serie: bitacora
fecha: 2026-09-03
---

De todo lo que tengo montado, `obsidian-ideas` es lo que uso más a diario, sin comparación. No es el proyecto más ambicioso de esta casa, pero es el único que toco varias veces al día: pego un enlace en Telegram y, unos segundos después, tengo una nota buscable en mi vault y, a veces, una tarea ya encolada para uno de mis propios proyectos.

El problema que resuelve es aburrido de enunciar: antes, un enlace interesante llegaba por Telegram, lo leía (o no), y ahí se quedaba — no había un sitio donde cayera de forma sistemática, y desde luego nadie decidía si merecía convertirse en trabajo real. La decisión de diseño que hace interesante a este bot no es la captura en sí, es dejar que el propio flujo decida si una idea vale la pena, en vez de que yo tenga que acordarme de revisar una bandeja de entrada.

<figure class="fig-svg">
<svg viewBox="0 0 760 260" role="img" aria-label="Flujo completo: Telegram envía un mensaje o PDF, se extrae el contenido (texto, varias URLs, tuit o PDF), se resume y etiqueta vía LLM, se guarda como nota en el vault, se evalúa el encaje contra los proyectos activos y, si encaja, se despacha una tarea a agent-loops que puede terminar en un PR, con aviso de vuelta a Telegram">
  <g font-family="IBM Plex Mono, monospace" font-size="11">
    <rect x="8" y="10" width="140" height="46" rx="4" fill="#1a1f26" stroke="#2c333d"/>
    <text x="22" y="30" fill="#e9e5da" font-size="12">TELEGRAM</text>
    <text x="22" y="46" fill="#8a97a5" font-size="9">mensaje o PDF</text>
    <line x1="148" y1="33" x2="188" y2="33" stroke="#8a97a5" marker-end="url(#a1)"/>
    <rect x="190" y="10" width="180" height="46" rx="4" fill="#1a1f26" stroke="#2c333d"/>
    <text x="204" y="30" fill="#e9e5da" font-size="12">EXTRACCIÓN</text>
    <text x="204" y="46" fill="#8a97a5" font-size="9">texto · URLs · tuit · PDF</text>
    <line x1="280" y1="56" x2="280" y2="90" stroke="#8a97a5" marker-end="url(#a1)"/>
    <rect x="190" y="92" width="180" height="46" rx="4" fill="#1a1f26" stroke="#ffb454"/>
    <text x="204" y="112" fill="#ffb454" font-size="12">RESUMEN + TAGS</text>
    <text x="204" y="128" fill="#8a97a5" font-size="9">LLM, vocabulario cerrado</text>
    <line x1="280" y1="138" x2="280" y2="172" stroke="#8a97a5" marker-end="url(#a1)"/>
    <rect x="190" y="174" width="180" height="46" rx="4" fill="#1a1f26" stroke="#2c333d"/>
    <text x="204" y="194" fill="#e9e5da" font-size="12">NOTA EN EL VAULT</text>
    <text x="204" y="210" fill="#8a97a5" font-size="9">Markdown, con frontmatter</text>
    <line x1="370" y1="197" x2="410" y2="197" stroke="#8a97a5" marker-end="url(#a1)"/>
    <rect x="412" y="174" width="180" height="46" rx="4" fill="#1a1f26" stroke="#2c333d"/>
    <text x="426" y="194" fill="#e9e5da" font-size="12">ENCAJE</text>
    <text x="426" y="210" fill="#8a97a5" font-size="9">¿alguno de mis proyectos?</text>
    <line x1="592" y1="197" x2="632" y2="197" stroke="#7adb8f" marker-end="url(#a2)"/>
    <text x="596" y="188" fill="#7adb8f" font-size="9">sí, concreto</text>
    <rect x="634" y="174" width="120" height="46" rx="4" fill="#1a1f26" stroke="#7adb8f"/>
    <text x="646" y="194" fill="#7adb8f" font-size="12">AGENT-LOOPS</text>
    <text x="646" y="210" fill="#8a97a5" font-size="9">POST /api/tasks</text>
    <line x1="694" y1="174" x2="694" y2="138" stroke="#7adb8f" marker-end="url(#a2)"/>
    <rect x="604" y="92" width="150" height="46" rx="4" fill="#1a1f26" stroke="#7adb8f"/>
    <text x="618" y="112" fill="#7adb8f" font-size="12">PR abierto</text>
    <text x="618" y="128" fill="#8a97a5" font-size="9">rama task/&lt;id&gt;</text>
    <line x1="604" y1="115" x2="380" y2="33" stroke="#7adb8f" stroke-dasharray="2 3" marker-end="url(#a2)"/>
    <text x="420" y="70" fill="#7adb8f" font-size="9">aviso de vuelta a Telegram</text>
    <defs>
      <marker id="a1" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#8a97a5"/></marker>
      <marker id="a2" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#7adb8f"/></marker>
    </defs>
  </g>
</svg>
<figcaption>El camino completo de una idea, de Telegram a un PR: captura, resumen, nota, encaje contra proyectos y, condicionalmente, despacho a un orquestador de agentes.</figcaption>
</figure>

## Captura y extracción: un mensaje puede traer varias fuentes

Al principio `obsidian-ideas` solo cogía la primera URL de un mensaje. Funcionaba mientras el uso real era "pega un enlace suelto", pero se rompía en el caso que más me interesaba: una noticia que cita dos o tres fuentes primarias, donde el resumen que quiero es de todo el conjunto, no del primer link que aparece en el texto.

La corrección fue quirúrgica. `extract_url()` (una sola URL, la primera que encontrara con `re.search`) pasó a ser `extract_urls()`, que devuelve todas las que aparecen en el mensaje, deduplicadas y en orden:

```python
def extract_urls(message: str) -> list[str]:
    """Todas las URLs del mensaje, en orden y sin duplicados."""
    return list(dict.fromkeys(URL_RE.findall(message)))
```

Y la lógica de traer contenido para cada una — que antes vivía repartida en condicionales dentro de `process_message` — se extrajo a un único punto de entrada, `fetch_link_content()`, que decide entre las tres rutas que ya existían:

- **Web genérica** → `trafilatura`, que limpia el HTML y se queda con el texto del artículo.
- **Tuit** (`x.com`/`twitter.com`) → la API oEmbed pública de X, porque el HTML de un tuit no trae el contenido renderizado (va todo por JS) y montar un scraper de verdad para eso no valía la pena.
- **PDF** → detección por los cuatro primeros bytes (`%PDF`) y extracción de texto con `pypdf`.

`process_message()` ahora descarga el contenido de cada URL encontrada, las concatena con una etiqueta (`[url]\ntexto...`) y manda ese conjunto al resumen — una sola llamada al LLM, no una por enlace.

## Tags: vocabulario cerrado, no lo que se le ocurra al LLM

Cada nota recibe entre 1 y 3 tags de una lista fija (`ALLOWED_TAGS`, en `notes.py`) — el prompt se la pasa al LLM y le pide que elija de ahí, nunca que invente una nueva. Después de la respuesta, además, se filtra explícitamente: `[t for t in result.get("tags", []) if t in ALLOWED_TAGS]`. No es solo una instrucción en el prompt, es una comprobación en código — un modelo que alucine un tag fuera de la lista no lo cuela.

También puedo forzar un tag yo mismo con un `#hashtag` en el mensaje (debe coincidir con la lista); se añade a los que elija el LLM y se ve en la respuesta del bot. Sin esto, el archivo se vuelve inservible al cabo de unos meses: si el LLM puede inventar tags libremente, cada nota acaba con una variación distinta de la misma idea y `/tag` deja de servir para nada.

## El encaje: comparar contra lo que un proyecto declara que sabe hacer

Cada nota guardada se compara contra la lista de mis proyectos activos. Esa lista (`projects.md` + `repos.json`) la construye `generate_projects.py`, que corre en local (no dentro del contenedor, porque necesita ver todos mis repos) y para cada uno:

- Lee el `README.md` y se queda con el título más la introducción completa hasta el primer `## ` — no solo el primer párrafo, para que un README con TL;DR más contexto no se quede en una frase suelta.
- Busca, opcionalmente, un bloque `capabilities` en `AGENTS.md`: una lista de cosas muy concretas que ese proyecto sabe pedir que se le hagan, cada una con un `when` (cuándo aplica) y una `action` (qué hacer).

<figure class="fig-svg">
<svg viewBox="0 0 760 170" role="img" aria-label="generate_projects.py recorre los repos locales, lee README.md y el bloque capabilities opcional de AGENTS.md, y escribe projects.md y repos.json; el clasificador de encaje prioriza una capacidad declarada sobre una relación temática genérica">
  <g font-family="IBM Plex Mono, monospace" font-size="11">
    <rect x="8" y="20" width="150" height="100" rx="4" fill="#1a1f26" stroke="#2c333d"/>
    <text x="20" y="40" fill="#e9e5da" font-size="11">~/code/&lt;repo&gt;</text>
    <text x="20" y="60" fill="#8a97a5" font-size="9">README.md</text>
    <text x="20" y="76" fill="#8a97a5" font-size="9">AGENTS.md</text>
    <text x="20" y="92" fill="#5c6b7a" font-size="8">bloque yaml</text>
    <text x="20" y="104" fill="#5c6b7a" font-size="8">capabilities: opcional</text>
    <line x1="158" y1="70" x2="198" y2="70" stroke="#8a97a5" marker-end="url(#b1)"/>
    <rect x="200" y="20" width="200" height="100" rx="4" fill="#1a1f26" stroke="#ffb454"/>
    <text x="214" y="42" fill="#ffb454" font-size="12">generate_projects.py</text>
    <text x="214" y="60" fill="#8a97a5" font-size="9">extract_description()</text>
    <text x="214" y="76" fill="#8a97a5" font-size="9">extract_capabilities()</text>
    <text x="214" y="92" fill="#8a97a5" font-size="9">repo_remote() (git origin)</text>
    <line x1="400" y1="70" x2="440" y2="70" stroke="#8a97a5" marker-end="url(#b1)"/>
    <rect x="442" y="20" width="140" height="46" rx="4" fill="#1a1f26" stroke="#2c333d"/>
    <text x="456" y="40" fill="#e9e5da" font-size="11">projects.md</text>
    <text x="456" y="56" fill="#8a97a5" font-size="9">para el prompt</text>
    <rect x="442" y="74" width="140" height="46" rx="4" fill="#1a1f26" stroke="#2c333d"/>
    <text x="456" y="94" fill="#e9e5da" font-size="11">repos.json</text>
    <text x="456" y="110" fill="#8a97a5" font-size="9">url + rama + caps</text>
    <line x1="582" y1="70" x2="622" y2="70" stroke="#7adb8f" marker-end="url(#b2)"/>
    <rect x="624" y="20" width="128" height="100" rx="4" fill="#1a1f26" stroke="#7adb8f"/>
    <text x="636" y="42" fill="#7adb8f" font-size="11">evaluate_fit()</text>
    <text x="636" y="60" fill="#8a97a5" font-size="9">capacidad declarada</text>
    <text x="636" y="74" fill="#8a97a5" font-size="9">pesa más que</text>
    <text x="636" y="88" fill="#8a97a5" font-size="9">"tema relacionado"</text>
    <defs>
      <marker id="b1" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#8a97a5"/></marker>
      <marker id="b2" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#7adb8f"/></marker>
    </defs>
  </g>
</svg>
<figcaption><code>projects.md</code>/<code>repos.json</code> son el catálogo contra el que se evalúa cada nota. Una capacidad declarada explícitamente (con su <code>when</code>/<code>action</code>) es una señal mucho más fuerte que "el tema suena relacionado", y el prompt de <code>evaluate_fit()</code> está instruido para priorizarla.</figcaption>
</figure>

`evaluate_fit()` es exigente a propósito: el prompt le pide al LLM que solo marque encaje si la iniciativa es concreta y accionable, nunca una relación temática vaga. Si hay encaje, la nota lleva de vuelta un `project_slug`, un `task_title` y un `task_body` listos para convertirse en tarea.

## Despacho: un contrato mínimo, no una integración pesada

El bot no está atado a ningún orquestador concreto — solo espera tres endpoints, con la forma de [agent-loops](https://github.com/danifernandezs/agent-loops):

| Endpoint | Propósito |
|---|---|
| `GET /api/boards` | listar tableros existentes |
| `POST /api/boards` | crear uno si falta (409 si el slug ya existe) |
| `POST /api/tasks` | crear la tarea (`title`, `body`, `repo_url`, `repo_branch`, `board`) |

`AGENT_LOOPS_URL` es opcional: sin ella, el bot sigue capturando y buscando notas, simplemente nunca despacha nada. Y cuando sí despacha, nunca toca `main` directamente — la tarea abre su propia rama (`task/<id>`) y, si llega a buen puerto, un PR.

## Qué pasa si el orquestador no responde

El caso que más me importaba resolver: mi sobremesa, que es donde corre el orquestador y el modelo local, no está encendido 24/7. Si una nota encaja con un proyecto pero `dispatch_task()` falla (típicamente porque el equipo está apagado), la nota no se pierde — se marca `pending` y queda a la espera.

Hasta hace unos días, ese reintento solo pasaba una vez a la semana, en el digest de los lunes. Desde hoy hay dos vías más rápidas:

- **`/reintentar`** — bajo demanda, encola de golpe todas las notas `pending`.
- **Reintento automático cada 20 minutos**, dentro del mismo job periódico que ya sincronizaba el estado de las tareas despachadas (`sync_tasks`) — así que en cuanto el equipo vuelve a estar encendido, la cola se vacía sola sin que yo tenga que acordarme de nada.

```python
async def sync_tasks(context: ContextTypes.DEFAULT_TYPE) -> None:
    try:
        retry_pending(VAULT_DIR, load_repos())
    except Exception:
        log.exception("Error reintentando pendientes en el sync periódico")
    ...
```

Ese mismo job es el que me avisa por Telegram cuando una tarea despachada llega a un estado terminal (`done`, `blocked`, `gave_up`) o, más recientemente, cuando se le abre un PR — antes tenía que preguntar yo con `/tareas`; ahora me entero sin preguntar.

## El panel: una lista filtrable, no un tablero que se arrastra

`dashboard.py` sirve una vista web sencilla del vault (`http.server`, sin framework — la misma filosofía que el resto del bot). No es un kanban con columnas donde arrastras tarjetas; es una lista de notas con una barra de resumen por estado arriba (`⏳ sin encolar · 🕒 en cola · ⚙️ trabajándose · 🚧 bloqueada · ✅ terminada`, cada una con su recuento), donde cada chip filtra la lista al clicar. Cada tarjeta lleva su insignia de estado, enlace directo a agent-loops o al PR si existe, y — si la nota sigue `pending` — un enlace de "reintentar ahora" que llama al mismo `retry_one()` que usa el bot.

## Cierre: qué se toca, y qué se dejó fuera

En algo más de mil líneas de Python conviven la API de Telegram, tres formas distintas de extraer contenido (web, tuit, PDF), un LLM para resumen y para clasificación de encaje, orquestación de tareas contra una API externa, y un panel web sin dependencias nuevas. Ninguna pieza es sofisticada por sí sola — lo interesante es que encajan sin que ninguna sepa demasiado de las demás: `summarize.py` no sabe qué es `agent-loops`, `dispatch.py` no sabe cómo se resume una nota.

Lo que se dejó fuera a propósito: seguir enlaces dentro de los enlaces (si un artículo cita otro artículo, ese segundo no se descarga). Indexar contenido de forma recursiva es un problema real, pero no el que tenía delante — el caso de uso que motivó el cambio era "una noticia con varias fuentes citadas en el propio mensaje", no "un rastreador de la web". Se añade el día que haga falta, no antes.

---

**Actualización (03/09/2026):** el resumen multi-URL, el aviso de PR abierto y el reintento automático cada 20 minutos descritos arriba se desplegaron a producción hoy mismo — es la foto del bot tal como corre ahora, no un plan a futuro.
