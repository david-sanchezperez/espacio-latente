---
titulo: "Tokenización y embeddings: la puerta de entrada al modelo"
resumen: "Tercer módulo de la serie 'Por dentro de los LLM': cómo se trocea el texto antes de que el modelo lo vea, por qué escribir en español te sale un 45 % más caro, y qué ocurre exactamente en la primera capa."
estado: pruebas
unidad: "U-09"
serie: fundamentos
fecha: 2026-07-28
---

En el [post anterior](/lab/01-espacio-latente) dábamos por hecho el primer paso: que una palabra se convierte en un vector. Toca abrir esa caja, porque dentro hay dos operaciones distintas que casi siempre se cuentan como si fueran una sola.

1. **Tokenización**: partir el texto en trozos y asignar a cada trozo un número entero. Es determinista, no tiene nada que aprender en tiempo de inferencia y no usa la red neuronal para nada.
2. **Embedding**: convertir cada uno de esos enteros en un vector denso. Es una búsqueda en una tabla — una tabla que sí se ha aprendido durante el entrenamiento.

La distinción parece de matiz y no lo es. Casi todos los comportamientos raros de un LLM que solemos atribuir al "razonamiento" del modelo —que no sepa contar las letras de una palabra, que el español le salga más caro que el inglés, que un número largo se le atragante— ocurren en el paso 1, antes de que la red haya visto absolutamente nada.

<figure class="fig-svg">
<svg viewBox="0 0 760 200" role="img" aria-label="Diagrama del camino que recorre el texto: tokenizador, identificadores enteros, tabla de embeddings, suma posicional y capas de atención">
  <defs>
    <marker id="fl" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M0,0 L10,5 L0,10 z" fill="#8a97a5"/>
    </marker>
  </defs>
  <g font-family="IBM Plex Mono, monospace" font-size="11">
    <text x="8" y="20" fill="#8a97a5" font-size="10" letter-spacing="1.2">SIN RED NEURONAL</text>
    <text x="392" y="20" fill="#ffb454" font-size="10" letter-spacing="1.2">PARÁMETROS APRENDIDOS</text>
    <line x1="380" y1="8" x2="380" y2="192" stroke="#2c333d" stroke-width="1" stroke-dasharray="4 4"/>
    <rect x="8" y="60" width="112" height="52" rx="3" fill="#1a1f26" stroke="#2c333d"/>
    <text x="64" y="82" fill="#e9e5da" text-anchor="middle">"el gato"</text>
    <text x="64" y="99" fill="#8a97a5" font-size="9" text-anchor="middle">texto</text>
    <rect x="150" y="60" width="112" height="52" rx="3" fill="#1a1f26" stroke="#2c333d"/>
    <text x="206" y="82" fill="#e9e5da" text-anchor="middle">el · g · ato</text>
    <text x="206" y="99" fill="#8a97a5" font-size="9" text-anchor="middle">tokenizador (BPE)</text>
    <rect x="292" y="60" width="76" height="52" rx="3" fill="#1a1f26" stroke="#2c333d"/>
    <text x="330" y="82" fill="#e9e5da" text-anchor="middle" font-size="10">[301, 342, 998]</text>
    <text x="330" y="99" fill="#8a97a5" font-size="9" text-anchor="middle">ids</text>
    <rect x="400" y="60" width="112" height="52" rx="3" fill="#1a1f26" stroke="#ffb454"/>
    <text x="456" y="82" fill="#ffb454" text-anchor="middle">E[ids]</text>
    <text x="456" y="99" fill="#8a97a5" font-size="9" text-anchor="middle">tabla de embeddings</text>
    <rect x="542" y="60" width="94" height="52" rx="3" fill="#1a1f26" stroke="#2c333d"/>
    <text x="589" y="82" fill="#e9e5da" text-anchor="middle">+ posición</text>
    <text x="589" y="99" fill="#8a97a5" font-size="9" text-anchor="middle">RoPE</text>
    <rect x="666" y="60" width="86" height="52" rx="3" fill="#1a1f26" stroke="#ffb454"/>
    <text x="709" y="82" fill="#ffb454" text-anchor="middle">atención</text>
    <text x="709" y="99" fill="#8a97a5" font-size="9" text-anchor="middle">× N capas</text>
    <line x1="122" y1="86" x2="146" y2="86" stroke="#8a97a5" marker-end="url(#fl)"/>
    <line x1="264" y1="86" x2="288" y2="86" stroke="#8a97a5" marker-end="url(#fl)"/>
    <line x1="370" y1="86" x2="396" y2="86" stroke="#8a97a5" marker-end="url(#fl)"/>
    <line x1="514" y1="86" x2="538" y2="86" stroke="#8a97a5" marker-end="url(#fl)"/>
    <line x1="638" y1="86" x2="662" y2="86" stroke="#8a97a5" marker-end="url(#fl)"/>
    <text x="8" y="150" fill="#8a97a5" font-size="10">Este post cubre los cuatro primeros bloques: todo lo que ocurre</text>
    <text x="8" y="166" fill="#8a97a5" font-size="10">antes de que empiece el trabajo del que hablan los otros posts de la serie.</text>
  </g>
</svg>
<figcaption>El camino completo. La frontera importante no es visual: a la izquierda no hay nada aprendido, solo un algoritmo de compresión.</figcaption>
</figure>

## Por qué no se parte por palabras

La opción intuitiva es partir por espacios: un token, una palabra. No se hace, y hay tres razones.

La primera es el tamaño del vocabulario. Si cada palabra necesita su propia entrada en la tabla, el español pide cientos de miles de entradas solo para las formas verbales conjugadas: *comer*, *como*, *comes*, *comía*, *comeríamos*, *comiéndoselo*. Cada entrada es una fila de la matriz de embeddings, y esa matriz se multiplica también al final del modelo para producir las probabilidades de salida. Vocabulario grande significa modelo caro por los dos extremos.

La segunda es que siempre habrá una palabra que no esté en la lista. Nombres propios, erratas, términos nuevos, código fuente. Un vocabulario cerrado por palabras convierte todo eso en el mismo token `<UNK>`, y la información se pierde antes de empezar. Este es, literalmente, el problema que el paper fundacional de BPE en NLP se propuso resolver: se titula [*Neural Machine Translation of Rare Words with Subword Units*](https://arxiv.org/abs/1508.07909) (Sennrich, Haddow y Birch, ACL 2016), y su objetivo declarado era la **traducción con vocabulario abierto**.

La tercera es la contraria: partir por caracteres resuelve las dos anteriores —vocabulario diminuto, nada queda fuera— pero alarga muchísimo las secuencias. Y como el coste de la atención crece con el cuadrado de la longitud (lo vimos en el [post sobre Attention](/lab/attention-is-all-you-need)), multiplicar por cinco el número de posiciones multiplica por veinticinco el coste de cada capa de atención.

La solución de consenso es quedarse en medio: **subpalabras**. Que las palabras frecuentes ocupen un solo token y que las raras se descompongan en trozos ya vistos. Nada queda fuera del vocabulario, y las secuencias no se disparan.

## BPE: el algoritmo, y por qué es tan tonto

El método más extendido es **Byte Pair Encoding**. Su origen no tiene nada que ver con el lenguaje natural: es un algoritmo de compresión que Philip Gage publicó en 1994 en *The C Users Journal*, y que Sennrich et al. reutilizaron veintidós años después para trocear palabras. La idea entera cabe en una frase: *busca el par de símbolos adyacentes más frecuente del corpus, fusiónalo en un símbolo nuevo, y repite N veces*.

```python
from collections import Counter

def entrenar_bpe(corpus, n_fusiones):
    # Cada palabra empieza troceada en caracteres sueltos
    vocab = {tuple(palabra): freq for palabra, freq in Counter(corpus).items()}
    fusiones = []

    for _ in range(n_fusiones):
        pares = Counter()
        for simbolos, freq in vocab.items():
            for i in range(len(simbolos) - 1):
                pares[simbolos[i], simbolos[i + 1]] += freq

        if not pares:
            break

        mejor = pares.most_common(1)[0][0]     # el par más frecuente
        fusiones.append(mejor)
        vocab = {aplicar(simbolos, mejor): freq for simbolos, freq in vocab.items()}

    return fusiones                            # el orden importa: se aplican en secuencia
```

Lo importante de este algoritmo es lo que **no** hace. No sabe qué es una raíz, ni un sufijo, ni una sílaba. No conoce la gramática del español ni la existencia de las palabras. Se limita a contar pares de bytes. Que el resultado se parezca a menudo a la morfología real —que separe `com` + `iendo`— es un accidente estadístico: los sufijos son frecuentes y por eso se fusionan pronto. Cuando no coincide con la morfología, tampoco pasa nada: el modelo aprende a trabajar con los trozos que le den.

Las **fusiones se aplican siempre en el orden en que se aprendieron**, y ahí está la clave para entender el resultado. Un token no existe si no existen antes todos los trozos de los que se compone.

Merece la pena mencionar que BPE no es la única opción. [SentencePiece](https://arxiv.org/abs/1808.06226) (Kudo y Richardson, 2018) fue el primero en entrenar directamente sobre texto crudo, sin dar por hecho que las palabras vienen separadas por espacios — algo que en japonés o chino simplemente no ocurre. Y el algoritmo **unigram** de Kudo ataca el mismo problema desde el lado opuesto: en lugar de partir de caracteres e ir fusionando, arranca de un vocabulario enorme y va eliminando las unidades que menos aportan. En la práctica, casi todos los modelos que usas hoy son BPE o alguna variante suya.

## Pruébalo tú: BPE paso a paso

Aquí abajo hay un BPE de juguete entrenado sobre un corpus minúsculo de palabras en español (`gato`, `gatos`, `perro`, `perros`, `casa`, `casas`…). Solo tiene once fusiones, en este orden:

`ga` · `to` · `gato` · `os` · `ito` · `ca` · `sa` · `casa` · `pe` · `rr` · `perr`

Elige una palabra y ve aplicando fusiones una a una. Fíjate en cuáles acaban en un solo token y cuáles se quedan hechas trizas:

<div class="tok-demo" id="tok-demo">
  <div class="tok-demo-palabras" id="tok-demo-palabras"></div>
  <div class="tok-demo-tokens" id="tok-demo-tokens"></div>
  <div class="tok-demo-regla" id="tok-demo-regla">Pulsa «siguiente fusión» para empezar.</div>
  <div class="tok-demo-controles">
    <button type="button" id="tok-demo-siguiente">siguiente fusión →</button>
    <button type="button" id="tok-demo-todo">aplicar todas</button>
    <button type="button" id="tok-demo-reset">reiniciar</button>
  </div>
  <div class="tok-demo-out" id="tok-demo-out"></div>
</div>

<script>
(function () {
  const root = document.getElementById('tok-demo');
  if (!root) return;
  const FUSIONES = [
    ['g', 'a'], ['t', 'o'], ['ga', 'to'], ['o', 's'], ['i', 'to'],
    ['c', 'a'], ['s', 'a'], ['ca', 'sa'], ['p', 'e'], ['r', 'r'], ['pe', 'rr'],
  ];
  const PALABRAS = ['gato', 'gatos', 'gatito', 'gatitos', 'casa', 'casas', 'casita', 'perro', 'perros'];
  const elPalabras = root.querySelector('#tok-demo-palabras');
  const elTokens = root.querySelector('#tok-demo-tokens');
  const elRegla = root.querySelector('#tok-demo-regla');
  const elOut = root.querySelector('#tok-demo-out');
  const btnSiguiente = root.querySelector('#tok-demo-siguiente');
  const btnTodo = root.querySelector('#tok-demo-todo');
  const btnReset = root.querySelector('#tok-demo-reset');
  let palabra = 'gatos';
  let paso = 0;
  let tokens = [];
  let ultimaFusion = null;
  // Aplica una fusión a la secuencia entera, de izquierda a derecha.
  function fusionar(seq, [a, b]) {
    const salida = [];
    let cambios = 0;
    for (let i = 0; i < seq.length; i++) {
      if (seq[i] === a && seq[i + 1] === b) {
        salida.push(a + b);
        i++;
        cambios++;
      } else {
        salida.push(seq[i]);
      }
    }
    return { salida, cambios };
  }
  function reiniciar() {
    tokens = palabra.split('');
    paso = 0;
    ultimaFusion = null;
    render();
  }
  function siguiente() {
    while (paso < FUSIONES.length) {
      const fusion = FUSIONES[paso];
      paso++;
      const { salida, cambios } = fusionar(tokens, fusion);
      if (cambios > 0) {
        tokens = salida;
        ultimaFusion = fusion;
        render();
        return true;
      }
    }
    ultimaFusion = null;
    render();
    return false;
  }
  PALABRAS.forEach((p) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = p;
    b.addEventListener('click', () => {
      palabra = p;
      [...elPalabras.children].forEach((c) => c.classList.toggle('is-active', c === b));
      reiniciar();
    });
    if (p === palabra) b.classList.add('is-active');
    elPalabras.appendChild(b);
  });
  btnSiguiente.addEventListener('click', siguiente);
  btnTodo.addEventListener('click', () => { while (siguiente()) { /* hasta agotar */ } });
  btnReset.addEventListener('click', reiniciar);
  function render() {
    elTokens.innerHTML = '';
    tokens.forEach((t) => {
      const span = document.createElement('span');
      span.className = 'tok-chip';
      if (t.length > 1) span.classList.add('is-fusionado');
      span.textContent = t;
      elTokens.appendChild(span);
    });
    const agotado = paso >= FUSIONES.length;
    elRegla.textContent = ultimaFusion
      ? `fusión aplicada: "${ultimaFusion[0]}" + "${ultimaFusion[1]}" → "${ultimaFusion[0] + ultimaFusion[1]}"`
      : agotado
        ? 'no quedan fusiones aplicables: este es el troceado final.'
        : 'pulsa «siguiente fusión» para empezar.';
    btnSiguiente.disabled = agotado;
    btnTodo.disabled = agotado;
    elOut.innerHTML = `<code>"${palabra}"</code> → <code>${tokens.length}</code> token${tokens.length === 1 ? '' : 's'}`;
  }
  reiniciar();
})();
</script>

Merece la pena comparar tres casos concretos:

- **`gato`** acaba en **un solo token**. Estaba en el corpus, era frecuente, y las fusiones `ga` + `to` → `gato` se aprendieron.
- **`gatos`** acaba en **dos**: `gato` + `s`. La fusión `os` existe, pero llega después de `gato`, y para cuando le toca el turno la `o` ya está dentro de otro token. El orden decide el resultado.
- **`casita`** acaba **hecha trizas**, en cinco tokens, pese a ser una palabra normalísima del español. Simplemente no estaba en el corpus del tokenizador, y ninguna de las fusiones aprendidas encaja.

Ese tercer caso es el que importa. Un tokenizador no es neutral: está entrenado sobre un corpus, trata bien lo que ese corpus contenía y mal todo lo demás.

## Del juguete a la realidad: midiéndolo de verdad

Hasta aquí, intuición. Vamos a medir. Los tokenizadores de OpenAI son públicos a través de [`tiktoken`](https://github.com/openai/tiktoken), así que se puede comprobar en treinta segundos qué le pasa al español. Escribí ocho pares de frases —traducción propia, mezclando lenguaje técnico y cotidiano— y conté los tokens de cada versión con dos generaciones de tokenizador: `cl100k_base` (el de GPT-4) y `o200k_base` (el de los modelos posteriores).

<figure class="fig-svg">
<svg viewBox="0 0 700 210" role="img" aria-label="Gráfico de barras: el mismo contenido cuesta 157 tokens en español y 108 en inglés con cl100k_base, y 128 frente a 108 con o200k_base">
  <g font-family="IBM Plex Mono, monospace" font-size="11">
    <text x="0" y="14" fill="#8a97a5" font-size="10" letter-spacing="1">MISMO CONTENIDO · 8 PARES DE FRASES · TOKENS TOTALES</text>
    <text x="0" y="52" fill="#8a97a5" font-size="10">cl100k_base</text>
    <text x="0" y="66" fill="#5c6b7a" font-size="9">GPT-4</text>
    <rect x="96" y="38" width="314" height="17" rx="2" fill="#ffb454"/>
    <text x="418" y="51" fill="#ffb454">157 ES</text>
    <rect x="96" y="60" width="216" height="17" rx="2" fill="#8a97a5"/>
    <text x="320" y="73" fill="#8a97a5">108 EN</text>
    <text x="498" y="62" fill="#ffb454" font-size="13">1,45×</text>
    <text x="0" y="128" fill="#8a97a5" font-size="10">o200k_base</text>
    <text x="0" y="142" fill="#5c6b7a" font-size="9">GPT-4o y posteriores</text>
    <rect x="96" y="114" width="256" height="17" rx="2" fill="#ffb454"/>
    <text x="360" y="127" fill="#ffb454">128 ES</text>
    <rect x="96" y="136" width="216" height="17" rx="2" fill="#8a97a5"/>
    <text x="320" y="149" fill="#8a97a5">108 EN</text>
    <text x="498" y="138" fill="#7adb8f" font-size="13">1,19×</text>
    <line x1="96" y1="170" x2="660" y2="170" stroke="#2c333d"/>
    <text x="0" y="192" fill="#8a97a5" font-size="10">El sobrecoste del español se ha reducido a la mitad entre una generación</text>
    <text x="0" y="205" fill="#8a97a5" font-size="10">de tokenizador y la siguiente. Reducido, no eliminado.</text>
  </g>
</svg>
<figcaption>Medición propia con <code>tiktoken</code>; el script completo está al final del post. Ocho pares de frases son una muestra pequeña: tómalo como orden de magnitud, no como benchmark.</figcaption>
</figure>

Dos lecturas. La primera: con el tokenizador de GPT-4, **el mismo contenido en español cuesta un 45 % más que en inglés**. La segunda, más esperanzadora: con `o200k_base` ese sobrecoste baja al 19 %. Alguien decidió invertir vocabulario en cubrir mejor otros idiomas, y se nota.

Esto no es una peculiaridad de mi muestra. El trabajo de referencia es [*Language Model Tokenizers Introduce Unfairness Between Languages*](https://proceedings.neurips.cc/paper_files/paper/2023/hash/74bb24dca8334adce292883b4b651eda-Abstract-Conference.html) (Petrov, La Malfa, Torr y Bibi, NeurIPS 2023), que midió 17 tokenizadores y encontró diferencias de **hasta 15 veces** en la longitud del mismo texto según el idioma. El español, con alfabeto latino y buena representación en los corpus, está entre los casos más benignos. Hay idiomas para los que la penalización es de otro orden.

Y hay algo que conviene dejar dicho, porque es el argumento central de ese paper: como el precio por token y el tamaño de la ventana de contexto son **iguales para todos**, esta disparidad se traduce directamente en que unas comunidades lingüísticas pagan más, esperan más y les cabe menos contexto que a otras. Por el mismo servicio.

## Pruébalo tú: troceos reales

Estos son troceos reales, calculados con `tiktoken` y pegados aquí tal cual. Compara cada palabra española con su equivalente inglesa, y compara las dos generaciones de tokenizador:

<div class="tok-real" id="tok-real">
  <div class="tok-real-controles">
    <button type="button" data-enc="cl100k_base" class="is-active">cl100k_base (GPT-4)</button>
    <button type="button" data-enc="o200k_base">o200k_base (GPT-4o+)</button>
  </div>
  <table class="tok-real-tabla">
    <thead><tr><th>texto</th><th>troceado</th><th class="num">tokens</th></tr></thead>
    <tbody id="tok-real-cuerpo"></tbody>
  </table>
  <p class="tok-real-nota" id="tok-real-nota"></p>
</div>

<script>
(function () {
  const root = document.getElementById('tok-real');
  if (!root) return;
  // Salida literal de tiktoken. El "␣" representa el espacio inicial:
  // en texto real las palabras casi nunca empiezan la frase, y el espacio
  // que las precede forma parte del token.
  const DATOS = {
    cl100k_base: [
      [' gato', [' g', 'ato']],
      [' cat', [' cat']],
      [' ferrocarril', [' fer', 'roc', 'arr', 'il']],
      [' railway', [' railway']],
      [' desafortunadamente', [' des', 'afort', 'un', 'adamente']],
      [' unfortunately', [' unfortunately']],
      ['1234567', ['123', '456', '7']],
      ['2026-07-28', ['202', '6', '-', '07', '-', '28']],
    ],
    o200k_base: [
      [' gato', [' gato']],
      [' cat', [' cat']],
      [' ferrocarril', [' fer', 'roc', 'arr', 'il']],
      [' railway', [' railway']],
      [' desafortunadamente', [' desaf', 'ortun', 'adamente']],
      [' unfortunately', [' unfortunately']],
      ['1234567', ['123', '456', '7']],
      ['2026-07-28', ['202', '6', '-', '07', '-', '28']],
    ],
  };
  const NOTAS = {
    cl100k_base: 'Con el tokenizador de GPT-4, «gato» cuesta el doble que «cat» y «ferrocarril» cuatro veces más que «railway».',
    o200k_base: '«gato» ya cabe en un token, igual que «cat». «ferrocarril» sigue partido en cuatro: la mejora es real pero desigual.',
  };
  const cuerpo = root.querySelector('#tok-real-cuerpo');
  const nota = root.querySelector('#tok-real-nota');
  const botones = [...root.querySelectorAll('.tok-real-controles button')];
  function pintar(enc) {
    cuerpo.innerHTML = '';
    DATOS[enc].forEach(([texto, trozos]) => {
      const tr = document.createElement('tr');
      const visible = texto.replace(/^ /, '␣');
      const tdTexto = document.createElement('td');
      tdTexto.className = 'tok-real-texto';
      tdTexto.textContent = visible;
      const tdTrozos = document.createElement('td');
      trozos.forEach((t) => {
        const chip = document.createElement('span');
        chip.className = 'tok-chip is-real';
        chip.textContent = t.replace(/^ /, '␣');
        tdTrozos.appendChild(chip);
      });
      const tdNum = document.createElement('td');
      tdNum.className = 'num';
      tdNum.textContent = trozos.length;
      if (trozos.length === 1) tdNum.classList.add('is-bueno');
      if (trozos.length >= 4) tdNum.classList.add('is-malo');
      tr.append(tdTexto, tdTrozos, tdNum);
      cuerpo.appendChild(tr);
    });
    nota.textContent = NOTAS[enc];
  }
  botones.forEach((b) => {
    b.addEventListener('click', () => {
      botones.forEach((o) => o.classList.toggle('is-active', o === b));
      pintar(b.dataset.enc);
    });
  });
  pintar('cl100k_base');
})();
</script>

Fíjate en `railway` y `unfortunately`: **un solo token cada una**. Sus equivalentes españolas, `ferrocarril` y `desafortunadamente`, cuestan cuatro y tres. No es que sean palabras más raras en términos absolutos; es que eran más raras *en el corpus con el que se entrenó el tokenizador*.

## Por qué no sabe contar las erres

Con estos datos delante, un clásico de internet se explica solo:

```
Usuario:  ¿cuántas erres tiene "ferrocarril"?
Modelo:   Dos.
```

El modelo no está contando mal. Es que **nunca ha visto las letras**. Ha visto cuatro enteros, y mira dónde caen las erres al trocear:

```
' fer' | 'roc' | 'arr' | 'il'
    ↑     ↑      ↑↑
```

Las cuatro erres están repartidas entre tres tokens distintos, y ninguno de ellos "contiene" el concepto de letra erre de forma accesible. Pedirle a un LLM que cuente caracteres es como pedirte a ti que cuentes los píxeles de una foto que estás mirando: la información está ahí en algún sentido, pero no en el formato en el que la percibes.

Lo mismo explica lo de la aritmética. Fíjate en `1234567`, que se trocea como `123` | `456` | `7`: agrupaciones de tres dígitos **de izquierda a derecha**. El algoritmo de la suma que aprendimos en el colegio funciona al revés, de derecha a izquierda, arrastrando el acarreo — y con este troceado la estructura de unidades, decenas y centenas simplemente no existe en la entrada. No es una hipótesis de salón: [Singh y Strouse (2024)](https://arxiv.org/abs/2402.14903) demostraron que forzar el agrupamiento de derecha a izquierda mejora de forma consistente el rendimiento aritmético, y modelos como Llama o PaLM optaron directamente por darle a cada dígito su propio token.

Y la fecha de hoy, `2026-07-28`, cuesta **seis tokens**: `202` | `6` | `-` | `07` | `-` | `28`. Si estás metiendo miles de fechas en formato ISO dentro del contexto de un agente, ahí tienes un coste que probablemente dabas por gratis.

## BPE no es el único método

BPE domina, pero no está solo. Las otras dos familias que verás en producción hacen lo mismo —trocear en subpalabras— con criterios distintos:

| Método | Cómo decide el vocabulario | Dónde lo verás |
|---|---|---|
| **BPE** (byte-level) | Fusiona el par adyacente más frecuente, de forma voraz y por rango. Al partir de los 256 bytes, ninguna palabra queda fuera del vocabulario | GPT, Llama, Mistral |
| **WordPiece** | También fusiona, pero elige el par que más aumenta la verosimilitud del corpus, no el más frecuente en bruto: favorece pares cuya frecuencia conjunta destaca frente al producto de sus partes. Marca continuación con `##` | BERT y su familia |
| **Unigram** | Al revés: arranca de un vocabulario grande y **poda** los tokens cuya eliminación cuesta menos verosimilitud. Es probabilístico — una misma cadena admite varios troceados con distinta probabilidad | T5, ALBERT, muchos multilingües |

Dos matices que casi nadie aclara:

**SentencePiece no es un algoritmo, es una biblioteca.** Implementa BPE *y* Unigram, así que ver "SentencePiece" en la ficha de un modelo no te dice cuál de los dos usa. Su aportación real es otra: tratar la entrada como un flujo de Unicode crudo, sin pre-trocear por espacios, codificando el espacio como `▁`. Eso es lo que la hace agnóstica del idioma, y es imprescindible para japonés, chino o tailandés, que no separan palabras con espacios.

**Que Unigram sea probabilístico habilita algo que BPE no puede hacer.** Como una misma cadena admite varios troceados válidos con distinta probabilidad, puedes muestrear uno distinto en cada época de entrenamiento, a modo de aumento de datos — es la *subword regularization* de [Kudo (2018)](https://arxiv.org/abs/1804.10959). Con BPE clásico el troceado es determinista y esa puerta está cerrada.

### Y en Claude no puedes mirar

Todo lo que hemos medido aquí sale de `tiktoken` porque OpenAI publica sus vocabularios. **Anthropic no publica el de Claude**: no hay fichero de fusiones que inspeccionar ni forma de trocear en local. Se cuenta llamando al endpoint `count_tokens` de la API — y no vale estimar con `tiktoken`, que es de otro proveedor y se queda corto.

El detalle que merece la pena: **el conteo es específico de cada modelo, y cambia entre versiones**. Claude Opus 4.7 estrenó un tokenizador nuevo, y Sonnet 5, al adoptarlo, produce alrededor de un 30 % más tokens que Sonnet 4.6 *para el mismo texto*, con el mismo precio por token. Es la demostración más limpia de la tesis de este post: el troceado no es un detalle de implementación, es una variable económica que puede cambiar bajo tus pies sin que cambie ni una línea de tu código.

Y fuera de producción hay una línea de investigación que ataca la raíz del problema: modelos **sin tokenizador**, que trabajan directamente sobre bytes ([ByT5](https://arxiv.org/abs/2105.13626)) o que agrupan bytes en parches de forma dinámica según la entropía del siguiente byte ([Byte Latent Transformer](https://arxiv.org/abs/2412.09871)). Resuelven de golpe lo de contar letras y el sesgo de idioma, pero alargan mucho la secuencia y la atención es cuadrática — por eso todavía no han desplazado a BPE.

## De enteros a vectores: la tabla de embeddings

Con el texto ya convertido en una lista de enteros, empieza la red. Y el primer paso es más simple de lo que sugiere el nombre: una **búsqueda en una tabla**.

```python
import numpy as np

VOCAB = 100_277       # cuántos tokens distintos conoce el modelo (cl100k_base)
D_MODELO = 4_096      # dimensiones del espacio latente

# Esta matriz es un parámetro aprendido: se entrena como cualquier otro peso.
E = np.random.randn(VOCAB, D_MODELO) * 0.02

ids = [1045, 318, 257, 3797]          # el texto, ya tokenizado
vectores = E[ids]                      # (4, 4096) — eso es todo
```

`E[ids]` no es una metáfora: la capa de embedding es literalmente esa indexación. Se la suele describir como una multiplicación por un vector one-hot, y matemáticamente lo es, pero nadie la implementa así porque multiplicar por una matriz llena de ceros para quedarte con una fila es tirar el dinero.

Tres consecuencias que se siguen de esto:

**La tabla es enorme.** Con los 100.277 tokens de `cl100k_base` y 4.096 dimensiones son más de 410 millones de parámetros solo en la entrada. En modelos pequeños, la matriz de embeddings puede ser una fracción nada despreciable del total — y aquí está la tensión de diseño real del tokenizador: **más vocabulario significa secuencias más cortas pero una tabla más gorda**. Pasar de `cl100k_base` a `o200k_base` (de ~100k a ~200k tokens) es exactamente esa apuesta: duplicar la tabla para que el texto —sobre todo el que no está en inglés— ocupe menos posiciones.

**Muchos modelos reutilizan la tabla dos veces.** Es el truco del *weight tying*, propuesto por [Press y Wolf (EACL 2017)](https://aclanthology.org/E17-2025/): la misma matriz que convierte enteros en vectores se usa, transpuesta, para convertir el último hidden state en probabilidades sobre el vocabulario. Ahorra parámetros y, según el paper original, mejora la perplejidad. GPT-2 lo hace; muchos modelos actuales también.

**Estos vectores todavía no saben nada del contexto.** El vector de `banco` que sale de la tabla es idéntico en "el banco del parque" y en "el banco central". Es el punto de partida, no el significado. Lo que convierte ese vector genérico en algo que distingue los dos sentidos es la pila de capas de atención que viene después — exactamente el paso del que hablábamos al final del post anterior, cuando distinguíamos embeddings estáticos de representaciones contextuales.

## Falta una pieza: la posición

Tal cual lo hemos descrito hay un agujero. La tabla se indexa por token, así que "el perro mordió al cartero" y "el cartero mordió al perro" producen exactamente el mismo conjunto de vectores. Y la atención tampoco tiene noción de orden: mira todas las posiciones a la vez. Sin arreglar esto, un transformer sería una bolsa de palabras carísima.

La solución es inyectar la posición explícitamente. El paper de Attention original sumaba unas señales sinusoidales al embedding; hoy lo habitual es **RoPE** ([Su et al., 2021](https://arxiv.org/abs/2104.09864)), que en lugar de sumar nada **rota** los vectores de consulta y clave en función de su posición. Tiene una propiedad elegante: al calcular el producto escalar entre dos posiciones, las rotaciones se cancelan de forma que el resultado depende solo de la *distancia relativa* entre ambas, no de dónde estén en absoluto. Eso es lo que permite que un modelo entrenado con contextos cortos se estire luego a contextos largos con relativa gracia.

```python
h = aplicar_rope(E[ids])   # y a partir de aquí, capas de atención
```

## Cómo se hacía hace cinco años

Merece la pena parar aquí, porque la palabra "embedding" significaba algo bastante distinto hace no tanto.

| | ~2015-2018 | Ahora |
|---|---|---|
| **Qué era** | word2vec, GloVe, fastText: vectores **estáticos**, uno por palabra, entrenados aparte con su propio objetivo y descargados como un fichero de pesos | Una tabla de consulta aprendida **a la vez** que el resto del modelo, sin objetivo propio |
| **Contexto** | Ninguno. `banco` (asiento) y `banco` (entidad) compartían vector, y no había forma de separarlos | Tampoco — pero ya no es un defecto, porque el contexto lo aportan las capas de atención |
| **Posición** | Embeddings posicionales aprendidos, una fila por posición, **sumados** al vector del token | RoPE: una rotación aplicada en cada capa de atención |
| **Unidad** | La palabra. Lo que no estaba en el vocabulario se perdía — de ahí el token `<UNK>` | El byte. El fuera de vocabulario no existe |

Aquellos vectores estáticos eran el modelo entero, no su primera capa: los descargabas ya entrenados y los usabas como entrada de lo que fuera. De ahí viene el ejemplo que todo el mundo ha visto alguna vez, `rey - hombre + mujer ≈ reina`. Era una propiedad que se le exigía al embedding **por sí solo**, porque no había nada detrás que la construyera. [ELMo (2018)](https://arxiv.org/abs/1802.05365) fue la bisagra: el primero en dar vectores distintos a la misma palabra según la frase en la que apareciera.

Y aquí está el cambio conceptual de verdad, que es fácil leer al revés: **el embedding moderno es deliberadamente tonto**. No es que hayamos empeorado la primera capa; es que la inteligencia se ha mudado de sitio. Hace diez años le pedíamos al embedding que capturara el significado él solo. Hoy le pedimos que sea un buen punto de partida y nada más, porque desambiguar es trabajo de la pila de atención. La tabla `E` de la que hablábamos arriba es más tonta que un word2vec de 2013, y el modelo que la rodea es incomparablemente mejor.

### Ojo: hay dos cosas llamadas "embedding"

Esta es la confusión más común del tema, y conviene desactivarla:

1. **La capa de entrada de un LLM** — la tabla `E[ids]` de este post. Un vector por *token*, interna al modelo, nunca la ves.
2. **Embeddings de frase para búsqueda semántica** — `text-embedding-3`, `bge-m3`. Un vector por *documento*, de modelos entrenados específicamente para que la distancia coseno entre dos textos signifique algo.

Comparten el nombre y la intuición geométrica, pero no el propósito ni el entrenamiento. Los del tipo 2 son los que mueven el RAG y la búsqueda semántica — y son, literalmente, los que usa el radar de este sitio para no publicar dos veces la misma noticia contada por dos medios distintos, algo que conté en detalle en [el segundo episodio de la bitácora](/lab/bitacora-radar-02).

## Lo que se lleva uno de aquí

**El tokenizador es infraestructura, no inteligencia.** Es un algoritmo de compresión de 1994, determinista, entrenado sobre un corpus concreto, que decide qué le llega al modelo. Nada de lo que ocurre ahí es "razonamiento", y buena parte de las limitaciones más citadas de los LLM viven en ese paso.

**Los tokens son la unidad económica del sistema.** Coste, latencia y ventana de contexto se miden todos en tokens, y cuántos tokens gasta tu texto depende de un corpus de entrenamiento que no elegiste y en el que tu idioma probablemente estaba infrarrepresentado. En mi muestra: un 45 % más caro con el tokenizador de GPT-4, un 19 % con el siguiente.

**El embedding es solo una búsqueda en una tabla.** Ahí no hay magia; hay un punto de partida. Toda la riqueza de la que hablábamos en el post del espacio latente —el contexto, la desambiguación, la estructura— se construye después, capa a capa.

## Qué viene después

El siguiente módulo de la serie construye un espacio latente desde cero con un **autoencoder**: una red que aprende a comprimir y reconstruir sin que nadie le diga qué debe representar cada dimensión. Es la forma más visual de ver *emerger* un espacio latente, y el antecesor conceptual directo de la arquitectura encoder-decoder del paper de Attention.

## Para jugar

Este es el script exacto que produce los números del gráfico de más arriba. Son treinta segundos y un `pip install`:

```bash
pip install tiktoken
```

```python
import tiktoken

PARES = [
    ("El modelo no entiende las palabras: solo ve una lista de números enteros.",
     "The model does not understand words: it only sees a list of integers."),
    ("La tokenización ocurre antes de que la red neuronal haya visto nada.",
     "Tokenization happens before the neural network has seen anything at all."),
    ("Ayer por la tarde estuve arreglando la bicicleta en el garaje de mi hermano.",
     "Yesterday afternoon I was fixing the bicycle in my brother's garage."),
    ("Cada llamada a la API se factura por tokens, tanto de entrada como de salida.",
     "Every API call is billed by tokens, both input and output."),
    ("Si el presupuesto es limitado, conviene medir antes de optimizar cualquier cosa.",
     "If the budget is limited, it is worth measuring before optimizing anything."),
    ("Los embeddings son simplemente filas de una tabla que se ha aprendido durante el entrenamiento.",
     "Embeddings are simply rows of a table that was learned during training."),
    ("El perro del vecino ladra todas las noches y no me deja dormir tranquilo.",
     "The neighbour's dog barks every night and does not let me sleep properly."),
    ("Esta arquitectura reduce la latencia, pero aumenta el coste de infraestructura.",
     "This architecture reduces latency, but increases infrastructure cost."),
]

for nombre in ("cl100k_base", "o200k_base"):
    enc = tiktoken.get_encoding(nombre)
    es = sum(len(enc.encode(a)) for a, _ in PARES)
    en = sum(len(enc.encode(b)) for _, b in PARES)
    print(f"{nombre:12}  ES {es:4}   EN {en:4}   ratio {es/en:.2f}x")

# Y para ver el troceado de cualquier cosa:
enc = tiktoken.get_encoding("cl100k_base")
for texto in [" ferrocarril", " railway", "1234567", "2026-07-28"]:
    ids = enc.encode(texto)
    print(f"{texto!r:16} → {len(ids)} tok  {[enc.decode([i]) for i in ids]}")
```

Pásale un párrafo tuyo en los dos idiomas. Y luego pásale un identificador de tu propio código, un UUID o una fecha ISO: ver cuántos tokens cuesta un campo que creías gratis es la manera más rápida de entender por qué esto importa.

Si quieres bajar un nivel más y construir el tokenizador entero, la referencia obligada es [`minbpe`](https://github.com/karpathy/minbpe) de Andrej Karpathy: una implementación mínima y legible de BPE, con [la clase entera en texto](https://github.com/karpathy/minbpe/blob/master/lecture.md) y un ejercicio guiado para reproducir el tokenizador de GPT-4.

## Fuentes

- Sennrich, Haddow y Birch — [*Neural Machine Translation of Rare Words with Subword Units*](https://arxiv.org/abs/1508.07909) (ACL 2016). El paper que trae BPE al procesamiento de lenguaje.
- Gage — *A New Algorithm for Data Compression*, The C Users Journal, 1994. El BPE original, como algoritmo de compresión.
- Kudo y Richardson — [*SentencePiece*](https://arxiv.org/abs/1808.06226) (EMNLP 2018) y Kudo — [*Subword Regularization*](https://arxiv.org/abs/1804.10959) (ACL 2018). La alternativa unigram y el tokenizado sin pre-segmentación por espacios.
- Radford et al. — [*Language Models are Unsupervised Multitask Learners*](https://cdn.openai.com/better-language-models/language_models_are_unsupervised_multitask_learners.pdf) (2019). GPT-2 y el BPE a nivel de bytes: vocabulario de 50.257 = 256 bytes + 50.000 fusiones + 1 token especial.
- Petrov, La Malfa, Torr y Bibi — [*Language Model Tokenizers Introduce Unfairness Between Languages*](https://proceedings.neurips.cc/paper_files/paper/2023/hash/74bb24dca8334adce292883b4b651eda-Abstract-Conference.html) (NeurIPS 2023). 17 tokenizadores, hasta 15× de diferencia entre idiomas, y el argumento de coste y contexto.
- Singh y Strouse — [*Tokenization counts: the impact of tokenization on arithmetic in frontier LLMs*](https://arxiv.org/abs/2402.14903) (2024). El troceado de números y la aritmética.
- Devlin, Chang, Lee y Toutanova — [*BERT*](https://arxiv.org/abs/1810.04805) (NAACL 2019). WordPiece y el marcador `##` de continuación.
- Mikolov, Chen, Corrado y Dean — [*Efficient Estimation of Word Representations in Vector Space*](https://arxiv.org/abs/1301.3781) (2013). word2vec y los embeddings estáticos.
- Pennington, Socher y Manning — [*GloVe*](https://aclanthology.org/D14-1162/) (EMNLP 2014); Bojanowski, Grave, Joulin y Mikolov — [*Enriching Word Vectors with Subword Information*](https://arxiv.org/abs/1607.04606) (TACL 2017). Las otras dos familias de vectores estáticos.
- Peters et al. — [*Deep Contextualized Word Representations*](https://arxiv.org/abs/1802.05365) (NAACL 2018). ELMo: la bisagra entre estático y contextual.
- Xue et al. — [*ByT5*](https://arxiv.org/abs/2105.13626) (TACL 2022) y Pagnoni et al. — [*Byte Latent Transformer*](https://arxiv.org/abs/2412.09871) (2024). Modelos sin tokenizador.
- Anthropic — [*Token counting*](https://platform.claude.com/docs/en/build-with-claude/token-counting). La única forma de contar tokens de Claude, cuyo tokenizador no es público.
- Press y Wolf — [*Using the Output Embedding to Improve Language Models*](https://aclanthology.org/E17-2025/) (EACL 2017). Weight tying.
- Su, Lu, Pan, Murtadha, Wen y Liu — [*RoFormer: Enhanced Transformer with Rotary Position Embedding*](https://arxiv.org/abs/2104.09864) (2021). RoPE.
- EleutherAI — [*Rotary Embeddings: A Relative Revolution*](https://blog.eleuther.ai/rotary-embeddings/). La explicación más legible de por qué RoPE funciona.
- Karpathy — [`minbpe`](https://github.com/karpathy/minbpe) y la clase [*Let's build the GPT Tokenizer*](https://github.com/karpathy/minbpe/blob/master/lecture.md).
- OpenAI — [`tiktoken`](https://github.com/openai/tiktoken). La librería con la que están medidos todos los datos propios de este post.
