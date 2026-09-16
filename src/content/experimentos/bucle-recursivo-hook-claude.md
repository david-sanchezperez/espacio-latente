---
titulo: "44.000 llamadas en 10 horas: un hook que se llamaba a sí mismo"
resumen: "Un hook personal entró en bucle infinito invocando su propia herramienta de IA durante casi 11 horas sin que nadie se enterara. La causa, la guarda que lo corrige, y el patrón general que aplica a cualquier automatización capaz de disparar su propio disparador."
estado: pruebas
unidad: "U-21"
serie: bitacora
fecha: 2026-09-17
---

El 12 de agosto de 2026, a las 15:50, un hook personal mío empezó a invocar `claude -p` en bucle. Lo maté a mano casi 11 horas después, tras notar la CPU alta. Para entonces había hecho unas **44.000 llamadas** — unas 70 por minuto de media, una cada 0,86 segundos, durante 10,5 horas seguidas.

No lo descubrí por ningún sistema de monitorización — no tenía ninguno pensado para esto. Lo descubrí por accidente, y esa es la primera parte incómoda de esta historia: no hay ninguna heroicidad de observabilidad aquí, hubo suerte.

## El hook, y por qué parecía inofensivo

[claude-session-digest](https://github.com/david-sanchezperez/claude-session-digest) es un proyecto mío que genera un resumen automático al final de cada sesión de Claude Code, vía un hook `SessionEnd`. Ese hook llama a `bin/summarize.sh`, que a su vez invoca `claude -p --resume` para pedirle al propio modelo que resuma la sesión que acaba de terminar.

Aquí está el problema, una vez se nombra: **esa invocación de `claude -p` es en sí misma una sesión de Claude Code**. Y una sesión de Claude Code, al terminar, dispara `SessionEnd`. El mismo hook que la había lanzado.

```
SessionEnd
    ↓
summarize.sh
    ↓
claude -p
    ↓
nueva sesión de Claude Code
    ↓
SessionEnd
    ↓
    ...
```

`claude-session-digest` estaba protegido, pero no por diseño — por accidente. Su filtro `is-substantial.sh` exige que la sesión tenga ediciones o commits reales antes de generar un resumen, y una sesión de resumen no edita nada, así que nunca pasaba el filtro. Protección real, garantía cero: bastaba con que ese filtro cambiara de criterio en el futuro para que dejara de proteger nada.

El hook que sí entró en bucle era otro, uno personal y más viejo (`~/.claude/hooks/session-summary.sh`), sin ese filtro ni ningún otro. Cada resumen disparaba otro resumen. 44.000 veces.

## El fix: una guarda explícita

```sh
# Guard: bin/summarize.sh shells out to `claude -p`, which is itself a Claude
# Code session subject to this same SessionEnd hook. Without this, a summary
# session would trigger its own summary, forever (see incident 2026-08-13:
# a hook without this guard looped ~44k times over ~10h before being killed).
[ -n "${CSD_HOOK_RUNNING:-}" ] && exit 0
export CSD_HOOK_RUNNING=1
```

Funciona porque `claude -p` hereda el entorno del proceso que lo lanza: la sesión hija ve `CSD_HOOK_RUNNING=1` ya fijada por su padre, y sale antes de invocar otro resumen. Es una guarda contra recursión descendente en la propia cadena de procesos — no un mutex global ni nada que coordine entre procesos independientes. Si el hook ya está corriendo en esta cadena, la segunda invocación sale inmediatamente. El hook viejo sin filtro se retiró — no quedaba motivo para mantenerlo una vez identificado como la causa.

## El patrón, más allá de este caso concreto

La causa no es exótica ni específica de Claude Code. Es un patrón general: **cualquier automatización capaz de volver a invocarse a sí misma tiene que tratar la recursión como un riesgo de diseño, no como algo que se descubre por accidente.**

Un cron que dispara un agente que puede volver a tocar la configuración del propio cron. Un webhook cuya acción puede volver a disparar ese mismo webhook. Un hook de fin de sesión que llama a una herramienta que es, ella misma, una nueva sesión. Mismo problema de fondo en los tres: el disparador y la acción comparten el mismo canal, y nada impide que la acción vuelva a activar el disparador.

No tengo cifra real de coste ni del proceso exacto que disparó la CPU — no guardé esa granularidad en su momento y no la voy a inventar ahora, más de un mes después. Mi sospecha, sin dato que la respalde con precisión, es que el caché de prompts de Anthropic amortiguó buena parte del coste de 44.000 llamadas casi idénticas — pero es una inferencia, no una cifra medida. Lo que sí es un hecho, con o sin caché: nada en el diseño de este hook garantizaba un límite. Si hubiera fallado sin ese amortiguador, el coste habría dependido enteramente de la suerte, no del diseño.

Y hay una pregunta que la guarda no responde, y no voy a fingir que sí: **¿por qué un proceso personal podía hacer 44.000 llamadas sin toparse con ningún presupuesto, límite de tasa o circuit breaker independiente?** La guarda arregla este fallo concreto. No responde por qué no había ningún límite ajeno al propio mecanismo que falló — ese es un problema distinto, de diseño de sistemas autónomos en general, no de este hook en particular.

## Lo que queda, sin cerrar en falso

El hook responsable ya no existe, y a día de hoy no queda ningún otro hook en este equipo que invoque `claude` sin la misma guarda. Eso está verificado, no es una promesa a futuro.

Lo que sigue siendo cierto es lo incómodo del principio: lo detecté por CPU alta, no por diseño. No hay una alerta que hubiera avisado antes si el patrón se hubiera dado con menos consumo de CPU, o de forma más silenciosa. Esa es la parte que no se resuelve con una guarda de dos líneas, y la dejo tal cual — documentar el límite, no maquillarlo.

Código real de la guarda, en [el commit del fix](https://github.com/david-sanchezperez/claude-session-digest/commit/c2c9cbf4eb01fcb438289de612d6c76a93637668), dentro de [claude-session-digest](https://github.com/david-sanchezperez/claude-session-digest).
