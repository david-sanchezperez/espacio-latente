---
titulo: "Attention Is All You Need: la semilla de la IA generativa moderna"
resumen: "El paper de 2017 que cambió el paradigma: de leer palabra a palabra a que todas se consulten entre sí a la vez."
estado: pruebas
unidad: "U-02"
fecha: 2026-07-16
---

## El problema: leer en fila india

Antes de 2017, casi todo el procesamiento de lenguaje se apoyaba en RNN y su
variante más robusta, LSTM. Su forma de trabajar es secuencial: leen la
frase palabra a palabra, y en cada paso actualizan un único "estado" que
arrastran hasta el final.

```
"el"  →  "gato"  →  duerme"  →  ...  →  estado final
```

Si conoces sistemas distribuidos, esto te va a sonar: es un pipeline de un
solo hilo. Cada paso solo puede empezar cuando termina el anterior, y toda
la información de la frase tiene que sobrevivir comprimida en ese único
estado que se va reescribiendo. Cuanto más larga es la frase, más se diluye
lo que había al principio — el equivalente lingüístico del *vanishing
gradient*: la señal se atenúa a medida que atraviesa más pasos.

Dos consecuencias directas:

- **No se puede paralelizar.** El paso 10 depende del paso 9, que depende
  del 8... No hay forma de repartir el cómputo en varias GPU a la vez para
  una misma frase, así que entrenar es lento.
- **Las dependencias largas se pierden.** Si el sujeto de una frase está a
  30 palabras del verbo que lo necesita, esa relación tiene que sobrevivir
  comprimida durante 30 pasos de reescritura de estado. En la práctica, se
  degrada.

El paper de Vaswani et al. (Google Brain, 2017) parte de una pregunta
incómoda: **¿y si prescindimos por completo de la secuencialidad?**

## El giro: que todos hablen con todos a la vez

La respuesta que da el paper es la arquitectura *Transformer*, y su pieza
central es el mecanismo de **atención** (de ahí el título: *atención es
todo lo que necesitas*).

En vez de un pipeline donde cada token espera su turno, cada token consulta
**directamente y en paralelo** a todos los demás tokens de la frase para
decidir cuánto le importa cada uno. Es el mismo salto que separa un sistema
donde los nodos se comunican en cadena de uno donde cada nodo puede
consultar a cualquier otro nodo directamente, todos a la vez:

```
RNN (secuencial):        el → gato → duerme

Transformer (atención):     el
                            ╱ │ ╲
                        gato ─┼─ duerme
                            ╲ │ ╱
                    (cada token consulta a todos los demás en paralelo)
```

Nada se pierde por el camino porque nada tiene que *viajar* por el camino:
cualquier token puede mirar directamente a cualquier otro, esté a una
palabra de distancia o a cien.

## Por qué hace falta: la ambigüedad que resuelve la atención

Antes de entrar en la mecánica, merece la pena ver *qué* problema concreto
resuelve la atención. Coge esta palabra:

> "Vimos el **banco** desde la orilla del río."
> "El **banco** me aprobó el préstamo."

Misma palabra, significado completamente distinto. Un humano lo resuelve
sin pensarlo: mira el resto de la frase — "río", "orilla" en un caso,
"préstamo" en el otro — y con eso decide qué significa "banco" *en ese
contexto*.

Eso es literalmente lo que hace la atención: cada palabra construye su
significado consultando, con distinto peso, a las demás palabras de la
frase. "Banco" no tiene un significado fijo guardado en una tabla; su
representación se recalcula cada vez en función de su contexto.

## Las matemáticas, con carga real pero digerible

Aquí es donde la mayoría de explicaciones se paran en la metáfora. Vamos un
paso más allá, con un ejemplo pequeño que se puede seguir a mano.

Cada token no se compara con los demás directamente: primero se proyecta en
tres vectores distintos, llamados **Query**, **Key** y **Value** (Q, K, V).
La forma más intuitiva de verlo es como una búsqueda:

- **Query**: lo que este token está "preguntando" — qué tipo de información
  necesita.
- **Key**: la "etiqueta" con la que cada token se ofrece a ser encontrado.
- **Value**: el contenido real que ese token aporta si es elegido.

Es, literalmente, un mecanismo de búsqueda: tu Query se compara contra
todas las Keys disponibles, y te llevas una mezcla de los Values,
ponderada por cuánto encajaba cada Key con tu Query.

En un Transformer real, Q, K y V salen de multiplicar el embedding de cada
palabra por tres matrices de pesos (W_Q, W_K, W_V) que se aprenden durante
el entrenamiento. Para que el cálculo quepa a mano, en este ejemplo
simplificamos y usamos directamente el embedding como si fuera Q, K y V a
la vez — la mecánica que importa (producto escalar, escalado, softmax,
suma ponderada) es exactamente la misma.

Toma la frase "el gato duerme", con embeddings de juguete de 2 dimensiones:

```python
x_el     = [1, 0]
x_gato   = [0, 1]
x_duerme = [1, 1]
```

Para calcular la nueva representación de "gato" tras pasar por atención:

**1. Producto escalar de su Query contra cada Key** (cuánto se parecen):

```
score(gato, el)     = [0,1]·[1,0] = 0
score(gato, gato)   = [0,1]·[0,1] = 1
score(gato, duerme) = [0,1]·[1,1] = 1
```

**2. Escalado** por √d_k (d_k = dimensión de los vectores; aquí, en el
ejemplo de juguete, 2, así que √2 ≈ 1.41 — en el Transformer real, con
8 cabezas repartiéndose 512 dimensiones, d_k = 64). Sin este escalado, en
vectores grandes los productos escalares crecen mucho, el softmax se
satura —casi todo el peso cae en una sola palabra— y sus gradientes se
vuelven minúsculos: el mismo *vanishing gradient* que ya vimos con las
RNN, ahora emboscado dentro del propio mecanismo que se suponía iba a
resolverlo:

```
0 / 1.41 = 0.00
1 / 1.41 = 0.71
1 / 1.41 = 0.71
```

**3. Softmax** — convierte esas puntuaciones en pesos que suman 1 (cuánta
"atención" le presta "gato" a cada palabra):

```
pesos ≈ [0.20, 0.40, 0.40]   # el, gato, duerme
```

**4. Suma ponderada de los Values** con esos pesos:

```
salida_gato = 0.20·[1,0] + 0.40·[0,1] + 0.40·[1,1]
            = [0.60, 0.80]
```

El resultado, `[0.60, 0.80]`, es la nueva representación de "gato" — ya no
es solo "gato" en abstracto, es "gato" *después de mirar a su contexto*:
un 40% viene de sí mismo, un 40% de "duerme" (el verbo que lo predica) y
solo un 20% del artículo "el", que aporta poca información. El modelo no
sabe gramática — pero el patrón de pesos termina pareciéndose mucho a lo
que un lingüista subrayaría a mano.

## Pruébalo tú: atención en vivo

El ejemplo de arriba está calculado a mano para "gato". Aquí puedes
recalcularlo para las tres palabras y ver cómo cambian los pesos —
mismos embeddings de juguete, mismo cálculo, en vivo:

<div class="attn-demo" id="attn-demo">
  <div class="attn-demo-pick">
    <span class="attn-demo-label">Query:</span>
    <button type="button" class="attn-tok" data-tok="0">el</button>
    <button type="button" class="attn-tok" data-tok="1">gato</button>
    <button type="button" class="attn-tok" data-tok="2">duerme</button>
  </div>
  <div class="attn-demo-rows" id="attn-demo-rows"></div>
  <div class="attn-demo-out">
    <span class="attn-demo-label">salida =</span>
    <code id="attn-demo-out-vec">—</code>
  </div>
</div>

<script>
(function () {
  const emb = { 0: [1, 0], 1: [0, 1], 2: [1, 1] };
  const names = { 0: 'el', 1: 'gato', 2: 'duerme' };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
  const root = document.getElementById('attn-demo');
  if (!root) return;
  const rows = root.querySelector('#attn-demo-rows');
  const outVec = root.querySelector('#attn-demo-out-vec');
  const buttons = [...root.querySelectorAll('.attn-tok')];

  function render(qIdx) {
    buttons.forEach((b) => b.classList.toggle('is-active', Number(b.dataset.tok) === qIdx));
    const q = emb[qIdx];
    const scaled = [0, 1, 2].map((k) => dot(q, emb[k]) / Math.SQRT2);
    const expv = scaled.map((s) => Math.exp(s));
    const sum = expv.reduce((a, b) => a + b, 0);
    const weights = expv.map((e) => e / sum);
    const out = [0, 1].map((d) => weights.reduce((acc, w, k) => acc + w * emb[k][d], 0));

    rows.innerHTML = [0, 1, 2].map((k) => `
      <div class="attn-demo-row">
        <span class="attn-demo-name">${names[k]}</span>
        <div class="attn-demo-bar"><div class="attn-demo-bar-fill" style="width:${(weights[k] * 100).toFixed(0)}%"></div></div>
        <span class="attn-demo-pct">${(weights[k] * 100).toFixed(0)}%</span>
      </div>
    `).join('');
    outVec.textContent = `[${out[0].toFixed(2)}, ${out[1].toFixed(2)}]`;
  }

  buttons.forEach((b) => b.addEventListener('click', () => render(Number(b.dataset.tok))));
  render(1);
})();
</script>

## Multi-head attention: varios observadores a la vez

Una sola pasada de atención capta un tipo de relación. Pero el lenguaje
tiene varias capas de relación simultáneas: sintáctica ("duerme" concuerda
con "gato"), referencial (a qué se refiere "él"), temática (de qué trata
la frase)...

La solución del paper es correr **varias cabezas de atención en paralelo**
(el Transformer original usa ocho), cada una con sus propias matrices
W_Q/W_K/W_V, aprendidas de forma independiente. Es, otra vez, la misma
lógica distribuida: en vez de un único observador intentando captar todo a
la vez, varios observadores especializados miran la misma frase desde
ángulos distintos, en paralelo, y al final se combinan sus resultados.

## Encoder y decoder: dos mitades con trabajos distintos

Hasta aquí hemos hablado de "atención" en genérico, pero el paper original
no resuelve un problema abstracto: resuelve traducción automática ("el
gato duerme" → "the cat sleeps"). Para eso, el Transformer se organiza en
dos mitades con trabajos distintos, cada una apilada 6 veces:

- **El encoder** lee la frase de entrada completa (en español) y produce
  una representación enriquecida de cada palabra, con el contexto de toda
  la frase ya incorporado. Es el bloque de atención que hemos visto hasta
  ahora: cada token consulta a todos los demás, sin restricción, porque
  toda la frase ya está disponible de golpe.
- **El decoder** genera la frase de salida (en inglés) palabra a palabra,
  y en cada paso hace dos consultas distintas: primero a lo que ya ha
  generado él mismo, y después al encoder, para decidir en qué parte de
  la frase original debe fijarse para producir la siguiente palabra.

Cada bloque —de encoder o de decoder— no es solo atención: es atención
seguida de una **red feed-forward** (dos capas lineales con una ReLU en
medio —512 → 2048 → 512 en el Transformer original— aplicada a cada
posición por separado, con los mismos pesos para todas), y cada una de
las dos piezas va envuelta en una **conexión residual + normalización**
("Add & Norm"): la salida de la capa se suma a su propia entrada antes de
normalizarse. Es el mismo truco que evita el *vanishing gradient* en redes
muy profundas —aquí con 6 capas apiladas a cada lado—: cada capa solo tiene
que aprender una *corrección* sobre lo que ya traía, no reconstruir la
señal entera desde cero.

![Arquitectura encoder-decoder del Transformer, con atención enmascarada y cross-attention](/images/transformer-arquitectura.svg)

Dos matices que suelen generar confusión:

- **La atención del decoder está "enmascarada".** Al generar la palabra
  número 5, el decoder no puede consultar las palabras 6, 7, 8... porque
  en el momento de generar aún no existen — es autorregresivo, igual que
  la RNN que estábamos sustituyendo. Es el mismo principio que un log de
  commits: puedes leer todo lo que ya está confirmado, nunca lo que
  todavía no se ha escrito. Por eso se llama *masked* self-attention: se
  fuerza a que el score de un token contra cualquier token futuro sea
  `-∞` antes del softmax, para que su peso acabe siendo exactamente 0.
- **La cross-attention es donde ocurre la traducción propiamente dicha.**
  Ahí el Query sale del decoder ("¿qué necesito para generar la siguiente
  palabra en inglés?") pero la Key y el Value salen del encoder ("esto es
  lo que dice la frase en español"). Es la misma mecánica de Q/K/V de
  antes, solo que las tres ya no vienen de la misma frase.

## Viéndolo moverse

Los diagramas de arriba están quietos. Esto no: pulsa "Paso" y sigue el
dato subiendo bloque a bloque por el encoder, y luego cómo el decoder
genera la traducción palabra a palabra, reutilizando cada vez la misma
K, V que calculó el encoder una sola vez.

<div class="flow-demo" id="flow-demo">
  <div class="flow-demo-caption" id="flow-caption">Pulsa "Paso" para empezar.</div>
  <div class="flow-demo-grid">
    <div class="flow-col">
      <div class="flow-col-title">ENCODER</div>
      <div class="flow-box" data-id="enc-an2">Add &amp; Norm</div>
      <div class="flow-box" data-id="enc-ff">Feed Forward</div>
      <div class="flow-box" data-id="enc-an1">Add &amp; Norm</div>
      <div class="flow-box" data-id="enc-mha">Multi-Head Attention</div>
      <div class="flow-box" data-id="enc-emb">Input Embedding<br><span class="flow-sub">"el gato duerme"</span></div>
    </div>
    <div class="flow-mid">
      <div class="flow-kv" data-id="kv-arrow">K, V →</div>
    </div>
    <div class="flow-col">
      <div class="flow-col-title">DECODER</div>
      <div class="flow-box" data-id="dec-softmax">Linear + Softmax</div>
      <div class="flow-box" data-id="dec-an-c">Add &amp; Norm</div>
      <div class="flow-box" data-id="dec-ff">Feed Forward</div>
      <div class="flow-box" data-id="dec-an-b">Add &amp; Norm</div>
      <div class="flow-box" data-id="dec-cross">Cross-Attention</div>
      <div class="flow-box" data-id="dec-an-a">Add &amp; Norm</div>
      <div class="flow-box" data-id="dec-masked">Masked Attention</div>
      <div class="flow-box" data-id="dec-emb">Output Embedding<br><span class="flow-sub" id="flow-dec-input">&lt;inicio&gt;</span></div>
    </div>
  </div>
  <div class="flow-demo-output">Generado: <span id="flow-output">—</span></div>
  <div class="flow-demo-controls">
    <button type="button" id="flow-step">Paso ▶</button>
    <button type="button" id="flow-play">▶ Reproducir</button>
    <button type="button" id="flow-reset">Reiniciar</button>
  </div>
</div>

<script>
(function () {
  const root = document.getElementById('flow-demo');
  if (!root) return;
  const caption = root.querySelector('#flow-caption');
  const output = root.querySelector('#flow-output');
  const decInput = root.querySelector('#flow-dec-input');
  const boxes = [...root.querySelectorAll('.flow-box')];
  const kvArrow = root.querySelector('.flow-kv');
  const btnStep = root.querySelector('#flow-step');
  const btnPlay = root.querySelector('#flow-play');
  const btnReset = root.querySelector('#flow-reset');

  const tokens = ['the', 'cat', 'sleeps'];

  function decoderCycle(tokenIdx) {
    const soFar = tokens.slice(0, tokenIdx);
    const inputLabel = soFar.length ? soFar.join(' ') : '<inicio>';
    const frames = [
      { hl: ['dec-emb'], kv: false, cap: `El decoder recibe lo generado hasta ahora: "${inputLabel}".`, dec: inputLabel },
      { hl: ['dec-masked'], kv: false, cap: 'Masked self-attention: solo puede mirar las palabras que él mismo ya generó, nunca las futuras.', dec: inputLabel },
      { hl: ['dec-an-a'], kv: false, cap: 'Add & Norm sobre la salida de la atención enmascarada.', dec: inputLabel },
      { hl: ['dec-cross'], kv: true, cap: 'Cross-attention: el Query sale de aquí, la Key y el Value son las que calculó el encoder — se reutilizan sin recalcular.', dec: inputLabel },
      { hl: ['dec-an-b'], kv: false, cap: 'Add & Norm sobre la salida de la cross-attention.', dec: inputLabel },
      { hl: ['dec-ff'], kv: false, cap: 'Feed-forward: se procesa cada posición por separado.', dec: inputLabel },
      { hl: ['dec-an-c'], kv: false, cap: 'Add & Norm final de este bloque decoder.', dec: inputLabel },
      { hl: ['dec-softmax'], kv: false, cap: `Linear + Softmax elige la siguiente palabra → "${tokens[tokenIdx]}".`, dec: inputLabel, reveal: tokenIdx + 1 },
    ];
    return frames;
  }

  const frames = [
    { hl: ['enc-emb'], kv: false, cap: 'El encoder recibe "el gato duerme" — se suma la codificación posicional a cada embedding.', dec: '<inicio>' },
    { hl: ['enc-mha'], kv: false, cap: 'Self-attention: cada token consulta a todos los demás (el mismo cálculo del ejemplo de "gato" de más arriba).', dec: '<inicio>' },
    { hl: ['enc-an1'], kv: false, cap: 'Add & Norm: se suma la entrada original (residual) y se normaliza.', dec: '<inicio>' },
    { hl: ['enc-ff'], kv: false, cap: 'Feed-forward: cada posición se procesa por separado con la misma red.', dec: '<inicio>' },
    { hl: ['enc-an2'], kv: false, cap: 'Add & Norm final del encoder. Esta salida ya no vuelve a cambiar.', dec: '<inicio>' },
    { hl: [], kv: true, cap: 'El encoder entrega K y V al decoder — se calculan una sola vez y se reutilizan en cada palabra que genere el decoder.', dec: '<inicio>' },
    ...decoderCycle(0),
    ...decoderCycle(1),
    ...decoderCycle(2),
    { hl: ['dec-softmax'], kv: false, cap: 'Frase completa: "the cat sleeps". Pulsa Reiniciar para volver a verlo.', dec: tokens.join(' '), reveal: 3 },
  ];

  let i = -1;
  let playing = false;
  let timer = null;

  function render() {
    boxes.forEach((b) => b.classList.toggle('is-active', i >= 0 && frames[i].hl.includes(b.dataset.id)));
    kvArrow.classList.toggle('is-active', i >= 0 && frames[i].kv);
    caption.textContent = i >= 0 ? frames[i].cap : 'Pulsa "Paso" para empezar.';
    decInput.textContent = i >= 0 ? frames[i].dec : '<inicio>';
    const revealCount = i >= 0 ? (frames[i].reveal || 0) : 0;
    output.textContent = revealCount > 0 ? tokens.slice(0, revealCount).join(' ') : '—';
  }

  function step() {
    if (i >= frames.length - 1) {
      stop();
      return;
    }
    i += 1;
    render();
  }

  function stop() {
    playing = false;
    if (timer) clearInterval(timer);
    timer = null;
    btnPlay.textContent = '▶ Reproducir';
  }

  btnStep.addEventListener('click', () => {
    stop();
    step();
  });

  btnPlay.addEventListener('click', () => {
    if (playing) {
      stop();
      return;
    }
    playing = true;
    btnPlay.textContent = '❚❚ Pausar';
    timer = setInterval(step, 900);
  });

  btnReset.addEventListener('click', () => {
    stop();
    i = -1;
    render();
  });

  render();
})();
</script>

Esta distinción explica algo que el artículo daba por hecho antes: **no
todos los modelos actuales usan las dos mitades.** BERT es solo el
encoder (bidireccional, pensado para *entender* texto, no generarlo). GPT
y Claude son solo el decoder —con su atención enmascarada— usado en
solitario, sin cross-attention porque no hay una "frase origen" separada:
el modelo se consulta únicamente a sí mismo, prediciendo el siguiente
token a partir de todo lo que ya escribió. El paper original, con sus dos
mitades completas, seguía pensado para traducción; el salto a "un único
decoder que genera cualquier cosa" vino después, con GPT.

## Positional encoding: recuperar el orden sin secuencia

Aquí aparece un problema que el propio diseño provoca: si todos los
tokens se consultan entre sí a la vez, ¿cómo sabe el modelo si "perro
muerde hombre" es distinto de "hombre muerde perro"? La atención, tal
cual la hemos descrito, es ciega al orden.

Es exactamente el mismo problema que resuelven los **vector clocks** en
sistemas distribuidos: cuando no hay un reloj global ni un orden de
llegada garantizado, necesitas inyectar explícitamente una marca que
codifique la posición relativa de cada evento. El Transformer hace lo
mismo con *positional encoding*: a cada embedding se le suma un vector que
codifica su posición en la frase (usando funciones seno/coseno de
distinta frecuencia), antes de que empiece cualquier cálculo de atención.
No es que el modelo "recuerde" el orden mientras procesa —como haría una
RNN— es que el orden queda grabado en el propio dato, una sola vez, al
principio.

El paper también probó la alternativa más obvia —tratar la posición como
un embedding más, aprendido durante el entrenamiento— y dio resultados
casi idénticos. Se quedaron con seno/coseno por una apuesta a futuro: en
teoría, permite al modelo extrapolar a frases más largas que cualquiera
de las vistas durante el entrenamiento.

## Por qué esto destrabó todo

| | RNN / LSTM | Transformer |
|---|---|---|
| Procesamiento | Secuencial, paso a paso | Paralelo, todos los tokens a la vez |
| Dependencias largas | Se degradan con la distancia | Conexión directa, sin importar la distancia |
| Entrenamiento | Lento, difícil de paralelizar | Rápido en GPU/TPU, altamente paralelizable |
| Escalabilidad | Limitada | Modelos de miles de millones de parámetros |

La paralelización no es un detalle de ingeniería menor: es lo que permitió
entrenar con órdenes de magnitud más datos y más parámetros en tiempos
razonables. Sin eso, no habría GPT, ni BERT, ni Claude tal y como los
conocemos.

Los números del propio paper lo confirman: su modelo grande alcanzó 28.4
BLEU en traducción inglés-alemán y 41.8 en inglés-francés —superando el
estado del arte anterior—, entrenado en 3.5 días sobre 8 GPUs. Para una
tarea que hasta entonces se medía en semanas de entrenamiento, ese salto
de velocidad fue tan noticia como la mejora en calidad de traducción.

En 2017 esto parecía un paper académico más, con buenos resultados en
traducción automática. En 2026 esa misma arquitectura está en tu teléfono,
en tu navegador, en las herramientas con las que trabajas todos los días.
No es que antes no existiera IA — existía, y bien distinta: modelos
especializados para cada tarea. Lo que cambia con este paper es que, por
primera vez, una única arquitectura general —el Transformer, construido
enteramente sobre atención— se convierte en la base reutilizable de casi
todo lo que hoy llamamos IA generativa.

## Referencia

Vaswani, A., Shazeer, N., Parmar, N., Uszkoreit, J., Jones, L., Gomez,
A. N., Kaiser, Ł., & Polosukhin, I. (2017). *Attention Is All You Need*.
[arXiv:1706.03762](https://arxiv.org/abs/1706.03762).

## Notas de campo

*(Aquí documento mis propias dudas y hallazgos al escribir esto: qué parte
de la analogía distribuida se sostiene mejor bajo escrutinio, qué preguntas
me hicisteis vosotros al leerlo, qué dejaría para una segunda píldora sobre
la arquitectura Transformer completa...)*
