---
titulo: "El bake-off, round 2: Devstral defiende el título contra Qwen3.8"
resumen: "La comparativa de 5 candidatos del round 1 tenía un problema de metodología escondido: un muestreo aleatorio hacía que dos corridas de Terminal-bench no fueran comparables entre sí. Corregido eso, la revancha contra el candidato más serio (Qwen3.8-27B) se decide 3 baterías a 2. Un tercer candidato, BTL-4-Compact —cuantizado a 2.3 bits de fábrica—, se queda fuera: HumanEval flojo y una corrida de Terminal-bench que ni siquiera pudo completarse por límite térmico."
estado: pruebas
unidad: "U-14"
serie: bitacora
fecha: 2026-08-19
---

En [el bake-off original](/lab/bake-off-modelo-local) Devstral ganó a 4 candidatos con una batería corta: código propio (30 problemas) y agente propio (6 tareas). Suficiente para descartar 3 modelos con fallos reales de tool-calling, pero corto para asentar un campeón — 36 preguntas totales es poco margen quando dos modelos quedan cerca.

Cuando apareció un candidato serio (**Qwen3.8-27B**, denso, MoE con solo 16 de 64 capas manteniendo KV cache), tocaba una comparativa a fondo: HumanEval real (60 problemas), la batería propia de código y agente, y **Terminal-bench** — tareas de terminal completas dentro de Docker, la prueba más pesada y realista que tiene el harness.

## El muestreo aleatorio que invalidó la primera corrida

Terminal-bench se lanzó con `--n-tasks 10` para ambos modelos, contando con que "10 tareas" significaba las mismas 10 tareas. No es así: `--n-tasks` en la CLI de `tb` muestrea un **subconjunto aleatorio distinto en cada corrida**. Comparando los resultados, solo 1 de las 10 tareas de Devstral coincidía con las 10 de Qwen3.8 — los marcadores de esa primera pasada (0/10 y 1/10) no medían lo mismo y se descartaron enteros.

Arreglo aplicado a [`terminal_bench_eval.py`](https://github.com/david-sanchezperez/local-llm-arena/blob/main/bench/terminal_bench_eval.py): un flag `--task-ids` que fija la lista exacta de tareas, en vez de dejar que la CLI subyacente elija. Para esta comparativa, 10 tareas fijas del dataset core, alfabéticas, excluyendo las de compilar un kernel completo (demasiado pesadas para caber en una corrida nocturna):

```
blind-maze-explorer-5x5, blind-maze-explorer-algorithm, cartpole-rl-training,
chess-best-move, conda-env-conflict-resolution, configure-git-webserver,
count-dataset-tokens, crack-7z-hash, csv-to-parquet,
decommissioning-service-with-sensitive-data
```

De paso salió un segundo bug de metodología: el umbral del vigilante térmico estaba en 83°C, que resultó ser la *"GPU Target Temperature"* que reporta `nvidia-smi` — el objetivo normal de la curva de ventilador, no un límite de seguridad. El throttle real de esta 3090 Ti es 94°C. Subido a 88°C, deja margen real sin cortar corridas largas por temperatura de funcionamiento normal.

## Precisión: 4 baterías, Devstral gana 3

<figure class="fig-svg">
<svg viewBox="0 0 620 290" role="img" aria-label="Gráfico de barras: tasa de acierto de Devstral y Qwen3.8-27B en HumanEval, código propio, agente propio y Terminal-bench">
  <g font-family="IBM Plex Mono, monospace" font-size="11">
    <text x="0" y="16" fill="#e9e5da" font-size="12">HumanEval (n=60)</text>
    <rect x="0" y="24" width="266" height="16" fill="#7adb8f"/>
    <text x="272" y="36" fill="#7adb8f">83% (50/60) Devstral</text>
    <rect x="0" y="44" width="246" height="16" fill="#ffb454"/>
    <text x="252" y="56" fill="#ffb454">77% (46/60) Qwen3.8</text>

    <text x="0" y="86" fill="#e9e5da" font-size="12">Código propio (n=30)</text>
    <rect x="0" y="94" width="299" height="16" fill="#ffb454"/>
    <text x="305" y="106" fill="#ffb454">93% (28/30) Devstral</text>
    <rect x="0" y="114" width="309" height="16" fill="#7adb8f"/>
    <text x="315" y="126" fill="#7adb8f">97% (29/30) Qwen3.8</text>

    <text x="0" y="156" fill="#e9e5da" font-size="12">Agente propio (n=6)</text>
    <rect x="0" y="164" width="213" height="16" fill="#ffb454"/>
    <text x="219" y="176" fill="#ffb454">67% (4/6) Devstral</text>
    <rect x="0" y="184" width="320" height="16" fill="#7adb8f"/>
    <text x="326" y="196" fill="#7adb8f">100% (6/6) Qwen3.8</text>

    <text x="0" y="226" fill="#e9e5da" font-size="12">Terminal-bench (n=10, Docker)</text>
    <rect x="0" y="234" width="224" height="16" fill="#7adb8f"/>
    <text x="230" y="246" fill="#7adb8f">70% (7/10) Devstral</text>
    <rect x="0" y="254" width="192" height="16" fill="#ffb454"/>
    <text x="198" y="266" fill="#ffb454">60% (6/10) Qwen3.8</text>
  </g>
</svg>
<figcaption>Verde = quien gana esa batería. Devstral se lleva HumanEval y Terminal-bench (las dos pruebas más pesadas); Qwen3.8 gana código propio y agente propio por un margen estrecho.</figcaption>
</figure>

| batería | Devstral | Qwen3.8-27B | gana |
|---|---|---|---|
| HumanEval (n=60) | 50/60 (83%) | 46/60 (77%) | **Devstral** |
| Código propio (n=30) | 28/30 (93%) | 29/30 (97%) | Qwen3.8 |
| Agente propio (n=6) | 4/6 (67%) | 6/6 (100%) | Qwen3.8 |
| Terminal-bench (n=10) | 7/10 (70%) | 6/10 (60%) | **Devstral** |

## Rendimiento: la brecha se mantiene

<figure class="fig-svg">
<svg viewBox="0 0 620 100" role="img" aria-label="Gráfico de barras: tokens por segundo de Devstral y Qwen3.8-27B">
  <g font-family="IBM Plex Mono, monospace" font-size="11">
    <text x="0" y="16" fill="#e9e5da" font-size="12">Tokens/segundo</text>
    <rect x="0" y="24" width="309" height="16" fill="#7adb8f"/>
    <text x="315" y="36" fill="#7adb8f">58.0 tok/s — TTFT 0.045s (Devstral)</text>
    <rect x="0" y="44" width="237" height="16" fill="#ffb454"/>
    <text x="243" y="56" fill="#ffb454">44.5 tok/s — TTFT 0.29-0.39s (Qwen3.8)</text>
  </g>
</svg>
<figcaption>Devstral es denso con atención completa; Qwen3.8 es un MoE híbrido que solo cachea KV en 16 de sus 64 capas. Bajo la config real de producción (128k de contexto, KV a 4 bits) esa arquitectura penaliza más a Devstral que a Qwen3.8 — y aun así Devstral sigue ganando en velocidad bruta.</figcaption>
</figure>

## Veredicto

**Devstral gana 3 de 5 baterías — incluidas las dos más pesadas y realistas (HumanEval completo y Terminal-bench) — y conserva el título.** Qwen3.8-27B no se promociona a producción; queda documentado, con su GGUF y su entrada de LiteLLM listos por si se quiere revisitar. La comparativa completa, con las notas de por qué los números del primer bake-off (contexto corto, KV sin cuantizar) no eran comparables con la config real de producción, está en el `leaderboard.md` de [local-llm-arena](https://github.com/david-sanchezperez/local-llm-arena).

## Tercer candidato: BTL-4-Compact, descartado

**BTL-4-Compact** es un MoE de 35B totales / 2.1B activos que Bad Theory Labs distribuye ya cuantizado a 2.3 bits por peso (`IQ2_XXS`, un único fichero de 9.97GB) — pensado de fábrica para hardware doméstico. Eso deja tanto margen de VRAM libre en la 3090 Ti que, por primera vez en esta serie, la comparativa no está limitada por memoria: se probó con caché KV a 8 bits (no 4, como el resto) y 128K de contexto, en vez de recortar para que quepa.

<figure class="fig-svg">
<svg viewBox="0 0 620 260" role="img" aria-label="Gráfico de barras: tasa de acierto de Devstral, Qwen3.8-27B y BTL-4-Compact en HumanEval, código propio y agente propio">
  <g font-family="IBM Plex Mono, monospace" font-size="11">
    <text x="0" y="16" fill="#e9e5da" font-size="12">HumanEval (n=60)</text>
    <rect x="0" y="24" width="266" height="14" fill="#7adb8f"/>
    <text x="272" y="35" fill="#7adb8f">83% (50/60) Devstral</text>
    <rect x="0" y="42" width="246" height="14" fill="#ffb454"/>
    <text x="252" y="53" fill="#ffb454">77% (46/60) Qwen3.8</text>
    <rect x="0" y="60" width="171" height="14" fill="#89ddff"/>
    <text x="177" y="71" fill="#89ddff">53% (32/60) BTL-4</text>

    <text x="0" y="96" fill="#e9e5da" font-size="12">Código propio (n=30)</text>
    <rect x="0" y="104" width="299" height="14" fill="#ffb454"/>
    <text x="305" y="115" fill="#ffb454">93% (28/30) Devstral</text>
    <rect x="0" y="122" width="309" height="14" fill="#7adb8f"/>
    <text x="315" y="133" fill="#7adb8f">97% (29/30) Qwen3.8</text>
    <rect x="0" y="140" width="299" height="14" fill="#89ddff"/>
    <text x="305" y="151" fill="#89ddff">93% (28/30) BTL-4</text>

    <text x="0" y="176" fill="#e9e5da" font-size="12">Agente propio (n=6)</text>
    <rect x="0" y="184" width="213" height="14" fill="#ffb454"/>
    <text x="219" y="195" fill="#ffb454">67% (4/6) Devstral</text>
    <rect x="0" y="202" width="320" height="14" fill="#7adb8f"/>
    <text x="326" y="213" fill="#7adb8f">100% (6/6) Qwen3.8</text>
    <rect x="0" y="220" width="320" height="14" fill="#89ddff"/>
    <text x="326" y="231" fill="#89ddff">100% (6/6) BTL-4</text>
  </g>
</svg>
<figcaption>BTL-4 iguala a Devstral en código propio y a Qwen3.8 en agente propio — pero se hunde en HumanEval, la única de las tres pruebas con muestra grande (60 problemas) y sin margen para que la varianza disimule el peor rendimiento real.</figcaption>
</figure>

En rendimiento bruto no hay color: al tener solo 2.1B de parámetros activos por token, BTL-4 vuela.

<figure class="fig-svg">
<svg viewBox="0 0 620 100" role="img" aria-label="Gráfico de barras: tokens por segundo de Devstral, Qwen3.8-27B y BTL-4-Compact">
  <g font-family="IBM Plex Mono, monospace" font-size="11">
    <text x="0" y="16" fill="#e9e5da" font-size="12">Tokens/segundo</text>
    <rect x="0" y="24" width="107" height="14" fill="#7adb8f"/>
    <text x="113" y="35" fill="#7adb8f">58.0 tok/s — TTFT 0.045s (Devstral)</text>
    <rect x="0" y="42" width="82" height="14" fill="#ffb454"/>
    <text x="88" y="53" fill="#ffb454">44.5 tok/s — TTFT 0.29-0.39s (Qwen3.8)</text>
    <rect x="0" y="60" width="320" height="14" fill="#89ddff"/>
    <text x="326" y="71" fill="#89ddff">173.3 tok/s — TTFT 0.159s (BTL-4)</text>
  </g>
</svg>
<figcaption>3x más rápido que Devstral. Con esta arquitectura MoE tan dispersa, la velocidad nunca fue la duda — la calidad sí.</figcaption>
</figure>

Y ahí es donde se cae: en el `AGENTS.md` de local-llm-arena, HumanEval es la única de las tres pruebas con muestra grande — 60 problemas frente a los 30 y 6 de las baterías propias — y BTL-4 pierde por 24 puntos frente a Qwen3.8. Con una muestra tan pequeña, código propio y agente propio pueden empatar por casualidad; HumanEval no deja ese margen.

Terminal-bench nunca llegó a completarse. El guardarraíl térmico (88°C) cortó la corrida tras la primera de las 10 tareas fijas — que sí resolvió (`conda-env-conflict-resolution` ✅) — sin que el resto llegara a intentarse. No es un 1/10 de fallos: es un dato incompleto, y no se relanzó una segunda vez porque el veredicto ya estaba decidido en HumanEval. Documentado tal cual, sin forzar un número que no se tiene.

**BTL-4-Compact no se promociona.** Gana en velocidad por un margen enorme y empata en las baterías cortas, pero un HumanEval 24 puntos por debajo del segundo puesto pesa más que ser 3 veces más rápido. Devstral sigue siendo el campeón.
