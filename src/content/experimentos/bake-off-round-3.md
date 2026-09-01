---
titulo: "El bake-off, round 3: Ornith empata con Devstral y no lo destrona"
resumen: "Tercer aspirante a la RTX 3090 Ti: Ornith-1.5-35B, ~3 veces más rápido que el campeón. Con contexto extendido a 128k completa por fin la batería de Terminal-bench pendiente desde el round 2 — y empata 7/10 con Devstral. Empatar no es superar: el título se queda donde estaba."
estado: pruebas
unidad: "U-17"
serie: bitacora
fecha: 2026-08-28
---

En el [round 2](/lab/bake-off-round-2) Devstral defendió el título contra
Qwen3.8-27B ganando Terminal-bench 7/10 contra 6/10. Quedó pendiente un tercer
aspirante, **Ornith-1.5-35B**, evaluado entonces con HumanEval y las baterías
propias pero sin Terminal-bench — orden explícita para no lanzar esa prueba
esa noche. Con la variante de contexto extendido a 128k (`-c 131072
--cache-type-k q4_0 --cache-type-v q4_0`, la config real de producción) tocaba
cerrar el veredicto que faltaba.

## Precisión: empate técnico, ligera ventaja de Qwen3.8

| test | Devstral | Qwen3.8-27B | Ornith-1.5-35B (128k) |
|---|---|---|---|
| Código propio (n=30) | 28/30 | 29/30 | 28/30 |
| Agente propio (n=6) | 4/6 | 6/6 | 5/6 |
| Terminal-bench (n=10) | **7/10** | 6/10 | **7/10** |

<figure class="fig-svg">
<svg viewBox="0 0 620 220" role="img" aria-label="Gráfico de barras: tasa de acierto de Devstral, Qwen3.8-27B y Ornith-1.5-35B en código propio, agente propio y Terminal-bench">
  <g font-family="IBM Plex Mono, monospace" font-size="11">
    <text x="0" y="16" fill="#e9e5da" font-size="12">Código propio (n=30)</text>
    <rect x="0" y="24" width="299" height="14" fill="#ffb454"/>
    <text x="305" y="35" fill="#ffb454">93% (28/30) Devstral</text>
    <rect x="0" y="42" width="309" height="14" fill="#7adb8f"/>
    <text x="315" y="53" fill="#7adb8f">97% (29/30) Qwen3.8</text>
    <rect x="0" y="60" width="299" height="14" fill="#89ddff"/>
    <text x="305" y="71" fill="#89ddff">93% (28/30) Ornith</text>

    <text x="0" y="96" fill="#e9e5da" font-size="12">Agente propio (n=6)</text>
    <rect x="0" y="104" width="213" height="14" fill="#ffb454"/>
    <text x="219" y="115" fill="#ffb454">67% (4/6) Devstral</text>
    <rect x="0" y="122" width="320" height="14" fill="#7adb8f"/>
    <text x="326" y="133" fill="#7adb8f">100% (6/6) Qwen3.8</text>
    <rect x="0" y="140" width="266" height="14" fill="#89ddff"/>
    <text x="272" y="151" fill="#89ddff">83% (5/6) Ornith</text>

    <text x="0" y="176" fill="#e9e5da" font-size="12">Terminal-bench (n=10, Docker)</text>
    <rect x="0" y="184" width="224" height="14" fill="#ffb454"/>
    <text x="230" y="195" fill="#ffb454">70% (7/10) Devstral</text>
    <rect x="0" y="202" width="192" height="14" fill="#7adb8f"/>
    <text x="198" y="213" fill="#7adb8f">60% (6/10) Qwen3.8</text>
  </g>
</svg>
<figcaption>Ornith queda entre los otros dos en las baterías cortas — ni el mejor ni el peor.</figcaption>
</figure>

En Terminal-bench, mismas 10 tareas fijas que Devstral y Qwen3.8, Ornith
resolvió 7: `conda-env-conflict-resolution`, `blind-maze-explorer-algorithm`,
`blind-maze-explorer-5x5`, `cartpole-rl-training`, `csv-to-parquet`,
`count-dataset-tokens`, `crack-7z-hash`. Falló en
`decommissioning-service-with-sensitive-data`, `configure-git-webserver` y
`chess-best-move` — las mismas tres donde Devstral también flojea.

## Rendimiento: 3 veces más rápido

<figure class="fig-svg">
<svg viewBox="0 0 620 100" role="img" aria-label="Gráfico de barras: tokens por segundo de Devstral, Qwen3.8-27B y Ornith-1.5-35B">
  <g font-family="IBM Plex Mono, monospace" font-size="11">
    <text x="0" y="16" fill="#e9e5da" font-size="12">Tokens/segundo</text>
    <rect x="0" y="24" width="107" height="14" fill="#ffb454"/>
    <text x="113" y="35" fill="#ffb454">58.0 tok/s — TTFT 0.045s (Devstral)</text>
    <rect x="0" y="42" width="82" height="14" fill="#7adb8f"/>
    <text x="88" y="53" fill="#7adb8f">44.5 tok/s — TTFT 0.29-0.39s (Qwen3.8)</text>
    <rect x="0" y="60" width="320" height="14" fill="#89ddff"/>
    <text x="326" y="71" fill="#89ddff">179.2 tok/s — TTFT 0.132s (Ornith)</text>
  </g>
</svg>
<figcaption>Casi 3x la velocidad de Devstral. En un empate de calidad agéntica, esto pesaría — pero no hay empate real: Devstral sigue ganando donde importa.</figcaption>
</figure>

## El timeout que se quedó corto

El `terminal_bench_eval.py` lanza las 10 tareas con un timeout por defecto de
1800s (30 min) — suficiente para Devstral y Qwen3.8. Con Ornith no lo fue: a
los 30 minutos solo había completado 3 de las 10 tareas (las 3 resueltas) y
una cuarta se había quedado colgada sin avanzar. Ornith es notablemente más
"hablador" —más turnos, más iteración por tarea— que los otros dos modelos,
y eso se traduce en más tiempo de pared aunque genere tokens más rápido.

Hubo que relanzar las 7 tareas restantes por separado con `--timeout-s 5400`
(90 min), lo que sí bastó para completarlas. Queda anotado para la próxima
vez que se evalúe un modelo local con turnos largos: subir el timeout desde
el principio en vez de descubrirlo a mitad de corrida.

## Veredicto

**Ornith empata con Devstral en Terminal-bench (7/10 cada uno) — pero
empatar no es superar.** Devstral sigue siendo la producción real
(`llama-server.service`, `:8080`). Ornith no se ha promocionado: gana en
velocidad bruta por un margen enorme (~3x) pero no gana donde más pesa para
este caso de uso, que es la calidad agéntica real medida en Terminal-bench.
Con empate técnico, el campeón conserva el título por defecto — cambiar de
producción exige superar, no igualar.

## Actualización (28/08): Ornith sí se promocionó

El veredicto de arriba duró el mismo día. Ornith reemplazó a Devstral en
`llama-server.service` (`:8080`) el 28/08 — mismo día que este bake-off. Lo
que hizo cambiar de opinión no fue el empate en Terminal-bench, ya conocido
al escribir el veredicto: fue el margen de velocidad (~3x) frente al riesgo
que ya quedó documentado aquí — que Ornith se atasca más a menudo en tareas
agénticas largas. La apuesta es que el tiempo ahorrado en el grueso de las
tareas compensa revisar a mano el subconjunto que se cuelga. Si esa apuesta
no aguanta con producción real, aquí quedará anotado cuándo y por qué se
revierte.

---

*Los ESTADO.md completos de esta corrida, con el desglose de tareas y la
nota metodológica del timeout, están en
[local-llm-arena](https://github.com/david-sanchezperez/local-llm-arena),
en `results/candidates/ornith-1.5-35b-128k/`.*
