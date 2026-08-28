---
titulo: "Offloadear expertos MoE en llama.cpp: dónde está el muro y por qué más bits no compró nada"
resumen: "Sweep de --n-cpu-moe en una 3090 Ti con un modelo MoE de 35B: la velocidad degrada suave hasta un muro de admisión, y subir de Q4 a Q6 para poder offloadear cuesta más de la mitad del throughput sin ganar calidad medible."
estado: pruebas
unidad: "U-16"
serie: bitacora
fecha: 2026-08-28
---

Todos los modelos densos de esta serie de bake-offs —Devstral, Qwen3.8— caben
enteros en la GPU o no caben, sin término medio. Un modelo **MoE** (Mixture
of Experts) rompe esa dicotomía: solo una fracción de sus parámetros se activa
por token, así que `llama.cpp` puede dejar las capas de atención en la GPU y
mandar los expertos —la parte más pesada— a la RAM del sistema con
`--n-cpu-moe` (`-ncmoe`). La pregunta que quería responder era simple: ¿cuánto
cuesta eso en velocidad, y compensa alguna vez pagarlo para poder subir de
cuantización?

Hardware: la misma RTX 3090 Ti de 24GB y 64GB de RAM dual-channel de siempre.
Modelo: **Ornith-1.5-35B-A3B** (arquitectura `qwen35moe`, 40 capas, 256
expertos con 8 activos por token, ~3B parámetros activos de 35.5B totales) —
lo bastante grande para forzar un offload real, a diferencia de
`DeepSeek-Coder-V2-Lite` (16B), que cabe entero en 9.7GB y no sirve para este
experimento.

## El sweep con el modelo que ya cabía entero (Q4_K_M)

Con la cuantización que ya tenía en disco (Q4_K_M, 21.7GB), el modelo entero
cabe en los 24GB de la tarjeta. Offloadear aquí es opcional, así que sirve
como línea base de cómo degrada la velocidad capa a capa:

| `--n-cpu-moe` | VRAM pico | pp512 (tok/s) | tg128 (tok/s) |
|--:|--:|--:|--:|
| 0  | 22.0 GB | 3741 | **189.0** |
| 8  | 18.2 GB | 1449 | 128.6 |
| 16 | 14.7 GB | 986  | 95.3 |
| 24 | 11.1 GB | 748  | 72.7 |
| 32 | 7.6 GB  | 603  | 56.0 |
| 40 | 3.8 GB  | 517  | 50.8 |

(Tabla completa, de 4 en 4 capas, en el repo — aquí solo los puntos que
cuentan la forma de la curva.) No hay ningún salto brusco: la degradación es
suave y continua, de 189 a 51 tok/s de generación entre 0 y 40 capas
offloadeadas. Con Q4_K_M el punto óptimo es simplemente `-ncmoe 0` —
offloadear aquí solo tiene sentido si hace falta liberar VRAM para otra cosa
(más contexto, otro proceso), no para que el modelo quepa.

## El sweep con la cuantización que no cabe entera (Q6_K)

Para forzar un offload *obligatorio* descargué la misma arquitectura en
Q6_K (28.4GB, no cabe en 24GB de VRAM):

| `--n-cpu-moe` | VRAM pico | pp512 (tok/s) | tg128 (tok/s) | Resultado |
|--:|--:|--:|--:|--:|
| 0–8  | — | — | — | **OOM** al cargar |
| 12 | 22.4 GB | 899 | **87.8** | primer punto que carga |
| 16 | 19.9 GB | 768 | 75.1 | |
| 24 | 14.8 GB | 575 | 57.6 | |
| 32 | 9.7 GB  | 465 | 47.1 | |
| 40 | 4.4 GB  | 389 | 39.4 | |

Aquí sí hay un muro real, pero no es de rendimiento — es de **admisión**: por
debajo de `-ncmoe 12` el proceso ni siquiera arranca, y a partir de ahí cae en
la misma curva suave de antes. Con `ncmoe=12` quedan solo ~1.2GB de margen
sobre 24GB totales, demasiado justo para nada más que el propio benchmark;
para uso real el punto operativo razonable es `ncmoe=16` (19.9GB, ~4GB de
margen), sacrificando ~15% de tok/s de generación por ese colchón.

## La comparación que importa: ¿compensa subir de Q4 a Q6 si eso te obliga a offloadear?

Con las mismas baterías de calidad que uso en los bake-offs de modelo
(HumanEval, código propio, agente propio), Q4_K_M full-GPU contra Q6_K +
offload en el punto operativo (`ncmoe=16`):

| | Q4_K_M, full GPU | Q6_K + offload (`ncmoe=16`) |
|---|--:|--:|
| HumanEval (n=60) | 47/60 (78.3%) | 48/60 (80.0%) |
| Código propio (n=30) | 27/30 (90%) | 27/30 (90%) |
| Agente propio (n=6) | 6/6 (100%) | 6/6 (100%) |
| tok/s generación | 185.4 | 70.8 |
| TTFT | 0.133s | 0.63s |

La diferencia de +1/60 en HumanEval es ruido de muestreo, no señal — con
pass@1 determinista por greedy sampling, un problema de diferencia sobre 60
no prueba nada; haría falta repetir con varios seeds o subir a los 164
problemas completos. Código y agente dan el mismo resultado exacto en ambos
quants. A cambio, Q6_K + offload cuesta **más de la mitad del throughput de
generación y casi 5x el tiempo hasta el primer token**.

Con un modelo A3B (~3B parámetros activos por token), subir de 4 a 6 bits en
los pesos no compra calidad medible en estas tareas — a esa escala de
activación, Q4_K_M ya no es el cuello de botella de precisión. **Q4_K_M
full-GPU gana en todos los ejes**: misma calidad, más del doble de velocidad,
sin depender del ancho de banda de la RAM.

## Por qué cae tanto, y no solo en generación

Lo que más me sorprendió no fue la caída en generación —esperable, cada
token offloadeado paga la latencia de RAM— sino que el *prompt processing*
también se desploma un 75-79%. La razón es que `--n-cpu-moe` manda **todos**
los expertos de esa capa a RAM, no solo los 8 de 256 que se activarían para
ese prompt concreto: da igual que el cálculo real solo toque una fracción
mínima, la capa entera paga el viaje.

## Conclusión práctica

- El offload de expertos MoE no tiene un cliff de rendimiento gradual: tiene
  un muro de admisión (cabe / no cabe) y, dentro de él, una curva suave y
  predecible (~2-3% de tok/s por capa offloadeada adicional).
- Si el modelo ya cabe entero en VRAM con la cuantización actual, no hay
  ninguna razón para offloadear nada.
- Si no cabe, y la alternativa es subir de cuantización para "ganar
  calidad", conviene medirlo antes de asumirlo: aquí no compensó — la
  cuantización más alta no dio una mejora medible y costó más de la mitad
  del throughput.
- Esto es específico de un modelo con poca activación por parámetro total
  (A3B). No extrapola sin más a Devstral ni a Qwen3.8 — son modelos densos,
  sin expertos, así que `--n-cpu-moe` no les aplica en absoluto.

---

*El comando de reproducción (`llama-bench` con el sweep de `--n-cpu-moe`) y
el harness de calidad (`candidate_bench.py`, con HumanEval, código y agente)
están en [local-llm-arena](https://github.com/david-sanchezperez/local-llm-arena),
repo público de los bake-offs de esta serie. Las tablas de este experimento
concreto son locales por ahora, no forman parte del repo.*
