---
titulo: "El bake-off del modelo local: 5 candidatos, 3 fallos silenciosos, 1 ganador"
resumen: "GLM-5.2 se quedó sin saldo como maker de la granja de agentes. Construir una comparativa justa entre 5 modelos locales destapó un fallo que no era de los modelos — y terminó en un modelo gratuito a la altura de Claude Sonnet 5 en el harness, con matices en producción."
estado: pruebas
unidad: "U-13"
serie: bitacora
fecha: 2026-08-11
---

En [la granja de agentes](/lab/granja-de-agentes) dejé una pregunta abierta a propósito: qué modelo corre dentro de cada contenedor cuando el agente **maker** implementa una tarea. En ese momento era `glm-5.2`, vía API, de pago. Funcionaba bien y no había prisa por tocarlo.

La prisa llegó sola: `glm-5.2` se quedó sin saldo. ~$10 en 5 días, solo en el rol maker — unos $60/mes al ritmo real de uso. Con eso sobre la mesa, la pregunta ya no era teórica: ¿hay algún modelo que corra en mi propia GPU (una RTX 3090 Ti de 24GB) y aguante el mismo trabajo, gratis?

La respuesta corta es sí. La interesante es cómo se llegó ahí, y un fallo por el camino que no era donde parecía.

## El harness: local-llm-arena

Para responder eso con datos y no con intuición ya existía [local-llm-arena](https://github.com/david-sanchezperez/local-llm-arena), el harness que uso para comparar modelos en varios ejes — código, tool-use/agente, rendimiento — con un cliente HTTP mínimo contra cualquier endpoint OpenAI-compatible, local o de pago. Lo que hacía falta era una forma de meter 5 candidatos nuevos en la comparativa sin liarla.

El problema físico: los 5 candidatos son modelos de 16-30B en cuantización de 4 bits, cada uno pesando 10-20GB. Mi GPU tiene 24GB, y producción (`llama-server` sirviendo el modelo activo) ya usa la mayoría. No caben dos a la vez.

La solución, [`scripts/candidate_bench.py`](https://github.com/david-sanchezperez/local-llm-arena/blob/main/scripts/candidate_bench.py): por cada candidato, para producción, sirve el candidato en un puerto temporal, corre la batería de tests contra él en aislamiento, guarda los resultados, y **restaura producción siempre** — incluso si algo falla a mitad, vía `try/finally`. Automatizar el intercambio en vez de hacerlo a mano fue lo que hizo viable evaluar 5 modelos en una tarde en vez de una semana.

<figure class="fig-svg">
<svg viewBox="0 0 720 220" role="img" aria-label="Flujo del bake-off: por cada candidato, parar produccion, servir el candidato en un puerto temporal, correr perf+code+agent, guardar resultados, restaurar produccion">
  <g font-family="IBM Plex Mono, monospace" font-size="11">
    <rect x="8" y="10" width="140" height="46" rx="4" fill="#1a1f26" stroke="#2c333d"/>
    <text x="24" y="30" fill="#e9e5da" font-size="11">producción</text>
    <text x="24" y="44" fill="#8a97a5" font-size="8">:8080, sirviendo</text>
    <line x1="148" y1="33" x2="188" y2="33" stroke="#8a97a5" marker-end="url(#a1)"/>
    <rect x="190" y="10" width="140" height="46" rx="4" fill="#1a1f26" stroke="#ff8a8a"/>
    <text x="206" y="30" fill="#ff8a8a" font-size="11">parar</text>
    <text x="206" y="44" fill="#8a97a5" font-size="8">libera VRAM</text>
    <line x1="330" y1="33" x2="370" y2="33" stroke="#8a97a5" marker-end="url(#a1)"/>
    <rect x="372" y="10" width="160" height="46" rx="4" fill="#1a1f26" stroke="#ffb454"/>
    <text x="388" y="30" fill="#ffb454" font-size="11">candidato :8081</text>
    <text x="388" y="44" fill="#8a97a5" font-size="8">servido temporal</text>
    <line x1="452" y1="56" x2="452" y2="90" stroke="#8a97a5" marker-end="url(#a1)"/>
    <rect x="332" y="92" width="240" height="46" rx="4" fill="#1a1f26" stroke="#2c333d"/>
    <text x="348" y="112" fill="#e9e5da" font-size="11">perf + code + agent</text>
    <text x="348" y="126" fill="#8a97a5" font-size="8">mismo harness, roster de 1</text>
    <line x1="332" y1="115" x2="270" y2="115" stroke="#8a97a5" marker-end="url(#a1)"/>
    <rect x="90" y="92" width="180" height="46" rx="4" fill="#1a1f26" stroke="#2c333d"/>
    <text x="106" y="112" fill="#e9e5da" font-size="11">results/candidates/&lt;id&gt;/</text>
    <text x="106" y="126" fill="#8a97a5" font-size="8">json + leaderboard.md</text>
    <line x1="180" y1="138" x2="180" y2="170" stroke="#7adb8f" marker-end="url(#a2)"/>
    <rect x="40" y="172" width="280" height="40" rx="4" fill="#1a1f26" stroke="#7adb8f"/>
    <text x="56" y="196" fill="#7adb8f" font-size="11">finally: restaurar producción</text>
    <text x="580" y="30" fill="#5c6b7a" font-size="9">×5 candidatos,</text>
    <text x="580" y="44" fill="#5c6b7a" font-size="9">uno detrás de otro</text>
  </g>
  <defs>
    <marker id="a1" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#8a97a5"/></marker>
    <marker id="a2" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#7adb8f"/></marker>
  </defs>
</svg>
<figcaption>El bloque <code>finally</code> es la pieza que importa: si algo revienta a mitad del benchmark, producción vuelve igualmente. Sin eso, un fallo en el candidato 3 deja la granja de agentes sin maker hasta que alguien se dé cuenta a mano.</figcaption>
</figure>

## 5 candidatos, misma vara de medir

Los 5 se eligieron por ser modelos de código/agente conocidos que caben en 24GB en cuantización de 4 bits: **Devstral** (Mistral, entrenado específicamente para tareas agénticas estilo SWE-bench), **Muse-Glimmer-30B**, **Qwen2.5-Coder-32B**, **GLM-4-32B** (pesos abiertos de la misma familia que la API de pago) y **DeepSeek-Coder-V2-Lite** (MoE, 16B total/2.4B activos — el más ligero del lote).

Primera pasada, resultados en bruto:

| modelo | código (30) | agente (6) | ttft | tok/s |
|---|---|---|---|---|
| **Devstral** | 30/30 | **6/6** | 0.045s | 58.0 |
| Muse-Glimmer-30B | 30/30 | 5/6 | 0.21s | 52.1 |
| Qwen2.5-Coder-32B | 30/30 | **0/6** | 0.08s | 41.7 |
| GLM-4-32B | 30/30 | **0/6** | 0.055s | 41.1 |
| DeepSeek-Coder-V2-Lite | 30/30 | **0/6** | 0.108s | **118.3** |

Todos empatan en código puro. La foto en tool-use, en cambio, tenía tres ceros que no cuadraban con lo que se sabe de estos modelos — GLM-4 y Qwen2.5-Coder tienen soporte de function-calling reconocido en la industria. Un cero así pide que lo mires antes de anotarlo como "el modelo no vale".

## El fallo no era el modelo

Mirar significa una llamada manual, sin el harness de por medio, con las mismas tools que usa la batería `agent`:

```
POST /v1/chat/completions  {"tools": [...], "messages": [...]}

→ GLM-4-32B responde:
  "list_files\n{\"path\": \".\"}\nEl directorio actual contiene..."
```

El modelo **sí llama a la tool** — nombre correcto, JSON correcto. Lo que pasa es que lo escribe como texto plano dentro de `content`, no en el campo `tool_calls` estructurado que espera el protocolo OpenAI. `llama-server`, con `--jinja`, sabe renderizar las tools en el prompt pero no trae un parser registrado para reconocer la respuesta de esa plantilla en concreto. El resultado: el harness ve `tool_calls: []`, interpreta que el modelo se rindió sin intentarlo, y anota 0/6 — cuando en realidad el modelo iba bien y quien se perdía la llamada era el propio servidor.

Repetido con Qwen2.5-Coder y DeepSeek-Coder-V2-Lite: cada uno con su propio formato de texto plano — Qwen envolviendo la llamada en `<tools>...</tools>`, DeepSeek con sus tokens especiales `｜tool▁calls▁begin｜`. Tres formatos, tres fallos de parseo, cero fallos reales de momento.

Arreglo: un parser de fallback en `common.py` — [`parse_fallback_tool_calls`](https://github.com/david-sanchezperez/local-llm-arena/blob/main/bench/common.py) — que reconoce los 3 formatos con regex y los convierte al `tool_calls` que el resto del harness espera, con su propio self-check (`python3 bench/common.py`) para no confiar a ciegas en tres expresiones regulares contra tokens Unicode.

Con el fix aplicado y repitiendo solo la batería `agent`:

| modelo | agente antes | agente después | qué cambió |
|---|---|---|---|
| Qwen2.5-Coder-32B | 0/6 | **2/6** | el fix era real: el modelo sí sabía, solo no se le escuchaba bien |
| GLM-4-32B | 0/6 | 0/6 | el parser ya reconoce sus llamadas (`fallback_parser_used: 5/6`) — y aun así, 0 pasa |
| DeepSeek-Coder-V2-Lite | 0/6 | 0/6 | igual: reconocidas 3/6, pass 0/6 |

Esta es la parte honesta del post: el fix mejoró a uno de los tres, y a los otros dos no. Con el parser ya reconociendo sus llamadas, GLM-4 y DeepSeek-Coder-Lite hacían 1-3 tool calls en tareas que necesitaban encadenar más — se paraban antes de terminar la cadena completa. Ahí ya no hay parser que arregle nada: es un límite real de esos dos modelos en esta cuantización siguiendo instrucciones multi-paso, no del harness que los mide.

## El ganador, contra la referencia de pago

Con eso resuelto, la comparativa que importa es Devstral y Glimmer-30B (los dos que ya iban bien desde el principio) contra `glm-5.2`, la referencia de pago que se estaba sustituyendo:

| modelo | código (30) | agente (6) | ttft | tok/s |
|---|---|---|---|---|
| **Devstral** | 30/30 | **6/6** (4.5 turnos) | 0.045s | 58.0 |
| Glimmer-30B | 30/30 | 5/6 (4.8 turnos) | 0.21s | 52.1 |
| *glm-5.2* (referencia, API) | 30/30 | 5/6 (3.7 turnos) | 4.0s | 119.0 |

Devstral iguala en código y **supera** a GLM-5.2 en tasa de éxito de agente, con un TTFT casi 90 veces mejor por no tener que salir a internet. Gratis, en mi propia GPU. Contrastado también contra Claude Sonnet 5 y DeepSeek V4 Flash en una pasada final con el harness completo, Devstral saca el mismo marcador que ambos en este harness acotado (6/6 los tres, 6 tareas de agente) — pierde en tok/s frente a infraestructura de datacenter (52.7 contra 97-101), lo esperable comparando una tarjeta doméstica contra la nube, y gana de largo en latencia por la misma razón que gana el resto: sin red de por medio. Ojo: "empata con Sonnet 5" es una frase que pesa más de lo que el dato sostiene — son 6 tareas cortas del harness, no producción; ver la actualización al final del post.

## Más bits no siempre es mejor: la lección que se repitió al revés

Con Devstral como ganador, la siguiente pregunta fue si un quant más alto lo mejoraría más todavía. En una migración anterior del modelo de producción (Qwen3.6, de TQ3 a IQ4_XS) subir la cuantización había sido una mejora limpia: más calidad *y* más velocidad, sin contrapartida, simplemente porque el quant anterior desperdiciaba VRAM en offload a CPU que no hacía falta.

Con Devstral en `UD-Q6_K_XL` (20.8GB, frente a los 14.3GB del `Q4_K_M` que ganó el bake-off) pasó justo lo contrario:

| config | código (30) | agente (6) | ttft | tok/s | VRAM |
|---|---|---|---|---|---|
| Q4_K_M (el que ganó) | 30/30 | 6/6 | 0.045s | 58.0 | 14.3GB |
| UD-Q6_K_XL (más bits) | 24/30 | 5/6 | **0.331s** | 42.2 | 23.1GB |

Con solo 1.5GB libres de 24GB, el servidor apenas tenía margen para los buffers de cómputo — y el rendimiento se desplomó en vez de mejorar: TTFT 7 veces peor, menos tok/s, y probablemente el código cayó por truncados bajo presión de memoria más que por peor calidad del modelo en sí. La lección de la vez anterior no se generaliza sin más: **"más bits" solo es una mejora limpia si sigue quedando margen de VRAM** — a partir de cierto punto, empieza a costar más de lo que da.

## La optimización que sí compensó: caché KV cuantizada

Con eso descartado, la pregunta útil era otra: ¿cómo aprovechar el margen que sí sobra con Q4_K_M (10GB libres a 8K de contexto) sin repetir el error del Q6? La caché KV en 8 bits en vez de 16 (`-ctk q8_0 -ctv q8_0`) reduce a la mitad la VRAM que consume el contexto:

| config | código | agente | ttft | tok/s | VRAM |
|---|---|---|---|---|---|
| KV f16, contexto 32K | 30/30 | 6/6 (4.5 turnos) | 0.045s | 58.0 | 21.1GB |
| KV q8_0, contexto 64K | 30/30 | 6/6 (4.0 turnos) | 0.061s | 52.7 | 21.6GB |

Mismo margen de VRAM, el doble de contexto útil, calidad idéntica, ~9% menos tok/s por el coste de (des)cuantizar la caché en cada paso — un cambio limpio dado que las tareas reales de la granja de agentes pueden traer specs largas. Aplicado en producción.

## Lo que quedó aplicado

`llama-server.service` sirve hoy `Devstral-Small-2-24B-Instruct-2512` en `Q4_K_M`, caché KV en 8 bits, 64K de contexto. `MAKER_MODEL=devstral` en `agent-loops`. De paso, dos cosas más que salieron a la luz montando todo esto: `agent-loops` reintentaba una tarea hasta agotar el cupo si el LLM local estaba caído durante un cambio de modelo, en vez de esperar sin penalizar — ahora comprueba el backend antes de gastar un intento; y LiteLLM corría como proceso suelto sin las variables de entorno persistidas, así que un reinicio manual le hacía perder las claves de las APIs de pago — ahora es un servicio de systemd de verdad, con `EnvironmentFile`.

Todo el código —el script del bake-off, el parser de fallback con su self-check, y la bitácora completa con más detalle del que cabe aquí— está en [local-llm-arena](https://github.com/david-sanchezperez/local-llm-arena), repo público. Si te sirve de plantilla para tu propia comparativa: la pieza que más se reutilizaría es el patrón `finally` del swap de modelos — sin eso, cualquier fallo a mitad de una tanda de benchmarks te deja sin servicio de producción hasta que alguien se dé cuenta a mano.

## Actualización (11/08): lo que el harness no capturó

El mismo día que se publicó esto, las dos primeras tareas reales de agente que le llegaron a Devstral en producción fallaron 0/2 — no por calidad de código, sino por `Context size has been exceeded` contra el límite de 64K configurado arriba. Una pedía investigar un repo de GitHub entero; la otra, redactar un prompt de sistema largo. Ninguna de las 6 tareas del harness se acerca a ese volumen de contexto, así que el bake-off nunca lo iba a ver.

Subido el límite a 131K, lo cual solo cupo en VRAM bajando la caché KV de 8 a 4 bits (`-ctk q4_0 -ctv q4_0`). Esa cuantización más agresiva no está validada todavía contra el harness — pendiente repetir la tabla de la sección anterior con esta config antes de darla por buena en producción.

Moraleja: un harness de 6 tareas cortas mide bien código y tool-calling, pero no dice nada sobre el techo de contexto real que necesita la carga de trabajo de producción. Eso solo lo enseña la producción.
