---
titulo: "¿Qué es el espacio latente? La geometría del significado"
resumen: "Primer módulo de la serie 'Por dentro de los LLM': por qué el significado se puede medir como distancia y dirección entre vectores."
estado: pruebas
unidad: "U-03"
serie: fundamentos
fecha: 2026-07-24
---

# ¿Qué es el espacio latente?

Este blog se llama *Espacio Latente* y hasta ahora no habíamos explicado qué significa eso. Toca arreglarlo.

Cuando hablamos de "espacio latente" nos referimos a un espacio matemático de muchas dimensiones donde una red neuronal representa el *significado* de algo — una palabra, una frase, una imagen — como un punto (un vector de números). La idea central, y la que hace que esto sea interesante y no solo una curiosidad matemática, es esta:

> Los conceptos que aparecen en contextos parecidos tienden a situarse cerca en ese espacio. Y muchas relaciones entre conceptos se convierten en direcciones geométricas.

Esto no es una metáfora. Es medible y se puede dibujar — con matices que iremos afinando a lo largo del post.

## De símbolos a vectores

Un ordenador no entiende la palabra "gato". Para poder hacer álgebra con lenguaje, primero hay que convertir cada palabra (o trozo de palabra, ver el próximo post sobre tokenización) en un vector: una lista de números.

La forma más tonta de hacerlo es *one-hot encoding*: un vector larguísimo, casi todo ceros, con un único 1 en la posición que le toca a esa palabra. El problema es que en ese espacio "gato" y "perro" están tan lejos como "gato" y "termodinámica". No hay noción de parecido.

La intuición visual, antes de cualquier fórmula, es esta: imagina un mapa donde los animales quedan agrupados en una zona y los vehículos en otra, simplemente porque el modelo los ha visto usados en contextos parecidos:

```
              gato   perro
                  tigre

  ──────────────────────────────
                       coche
                          avión
```

Eso es, a grandes rasgos, lo que vamos a construir y medir en este post — con vectores de verdad, no con un dibujo hecho a mano.

Los **embeddings** resuelven esto entrenando un vector denso (de, digamos, 300 o 4096 dimensiones) por palabra, ajustado para que el modelo prediga bien su contexto. El resultado, de forma emergente, es que palabras que aparecen en contextos parecidos acaban con vectores parecidos. *(Nota rápida: "embedding" es solo el punto de partida de un token; en un rato vamos a ver que dentro del modelo esa representación sigue cambiando — con nombre propio y todo.)*

```python
import numpy as np
from sklearn.decomposition import PCA
import matplotlib.pyplot as plt

# Simulamos embeddings de juguete en 4 dimensiones para intuición
# (en un modelo real serían cientos o miles de dimensiones)
palabras = ["rey", "reina", "hombre", "mujer", "perro", "gato", "cachorro"]
embeddings = np.array([
    [0.90, 0.85, 0.10, 0.05],  # rey
    [0.88, 0.10, 0.12, 0.05],  # reina
    [0.20, 0.80, 0.05, 0.10],  # hombre
    [0.18, 0.08, 0.06, 0.09],  # mujer
    [0.05, 0.40, 0.85, 0.20],  # perro
    [0.06, 0.10, 0.83, 0.22],  # gato
    [0.04, 0.35, 0.80, 0.70],  # cachorro
])

pca = PCA(n_components=2)
coords = pca.fit_transform(embeddings)

plt.figure(figsize=(6, 6))
for palabra, (x, y) in zip(palabras, coords):
    plt.scatter(x, y)
    plt.annotate(palabra, (x, y), textcoords="offset points", xytext=(5, 5))
plt.title("Proyección 2D de un espacio latente de juguete")
plt.savefig("espacio_latente_toy.png", dpi=150)
```

Con embeddings clásicos como word2vec o GloVe pasaba algo curioso, y es lo que hizo famosa esta idea: ciertas **relaciones** semánticas se convertían en **vectores de desplazamiento** casi constantes en todo el espacio. El ejemplo clásico:

```python
# vector("rey") - vector("hombre") + vector("mujer") ≈ vector("reina")
resultado = embeddings[0] - embeddings[2] + embeddings[3]

# Buscamos la palabra real más cercana a ese punto (vecino más próximo)
from scipy.spatial.distance import cosine

distancias = {p: cosine(resultado, e) for p, e in zip(palabras, embeddings)}
print(sorted(distancias.items(), key=lambda x: x[1]))
```

En espacios como este existe una dirección dominante, aproximadamente paralela, asociada a la transformación "masculino → femenino" — no es literalmente el mismo vector para cada par de palabras, pero sí una tendencia consistente. Eso es lo que queremos decir con que el significado tiene **geometría**: no solo importa dónde está un punto, importa también la dirección y la distancia entre puntos.

Esta propiedad tan limpia se cumple mejor en embeddings clásicos que en los transformers modernos, donde el significado real se termina de construir capas más adentro y la aritmética vectorial se vuelve más aproximada. Pero la idea de fondo — relaciones útiles convertidas en estructura geométrica — se mantiene, y es uno de los pilares de la interpretabilidad mecanicista (post 4 de esta serie).

## ¿Qué mide exactamente la "cercanía"?

Casi nunca se usa la distancia euclídea de toda la vida. Se usa la **similitud coseno**: el ángulo entre dos vectores, ignorando su longitud.

```python
def similitud_coseno(a, b):
    return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))
```

¿Por qué el ángulo y no la distancia? Porque en espacios de muchas dimensiones, la *dirección* de un vector suele capturar mejor el significado que su magnitud, que a menudo solo refleja la frecuencia con la que ha aparecido una palabra en el entrenamiento. Dos vectores pueden tener longitudes muy distintas y, aun así, apuntar prácticamente en la misma dirección — la similitud coseno considera esos vectores muy parecidos, mientras que la distancia euclídea los penalizaría solo por tener magnitudes diferentes.

## Pruébalo tú: cercanía en un espacio de juguete

Esto es exactamente lo que produce el script de PCA de más arriba, con las
coordenadas reales que calcula. Elige dos palabras y comprueba la
similitud coseno entre sus embeddings de 4 dimensiones — el mismo cálculo
que la función `similitud_coseno` de antes, en vivo:

<div class="emb-demo" id="emb-demo">
  <svg class="emb-demo-svg" viewBox="0 0 400 260" id="emb-demo-svg" role="img" aria-label="Proyección PCA de los embeddings de juguete">
    <line id="emb-demo-line" class="emb-line" x1="0" y1="0" x2="0" y2="0" />
    <g id="emb-demo-nodes"></g>
  </svg>
  <div class="emb-demo-out" id="emb-demo-out">Elige dos palabras para comparar su similitud coseno.</div>
</div>

<script>
(function () {
  const root = document.getElementById('emb-demo');
  if (!root) return;

  const palabras = ['rey', 'reina', 'hombre', 'mujer', 'perro', 'gato', 'cachorro'];
  const embeddings = [
    [0.90, 0.85, 0.10, 0.05],
    [0.88, 0.10, 0.12, 0.05],
    [0.20, 0.80, 0.05, 0.10],
    [0.18, 0.08, 0.06, 0.09],
    [0.05, 0.40, 0.85, 0.20],
    [0.06, 0.10, 0.83, 0.22],
    [0.04, 0.35, 0.80, 0.70],
  ];
  // Coordenadas 2D reales tras aplicar PCA a los vectores de arriba.
  const coords = [
    [30.0, 205.2], [86.0, 30.0], [139.8, 230.0], [191.2, 61.4],
    [334.6, 167.3], [350.9, 96.3], [370.0, 175.0],
  ];

  const svg = root.querySelector('#emb-demo-svg');
  const nodesG = root.querySelector('#emb-demo-nodes');
  const line = root.querySelector('#emb-demo-line');
  const out = root.querySelector('#emb-demo-out');
  const ns = 'http://www.w3.org/2000/svg';

  function similitudCoseno(a, b) {
    const dot = a.reduce((s, v, i) => s + v * b[i], 0);
    const norm = (v) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    return dot / (norm(a) * norm(b));
  }

  let seleccion = [];

  palabras.forEach((palabra, i) => {
    const [x, y] = coords[i];
    const g = document.createElementNS(ns, 'g');
    g.setAttribute('class', 'emb-node');
    g.setAttribute('data-i', String(i));
    g.innerHTML = `
      <circle cx="${x}" cy="${y}" r="6"></circle>
      <text x="${x}" y="${y - 12}">${palabra}</text>
    `;
    g.addEventListener('click', () => {
      if (seleccion.includes(i)) {
        seleccion = [];
      } else if (seleccion.length < 2) {
        seleccion.push(i);
      } else {
        seleccion = [i];
      }
      render();
    });
    nodesG.appendChild(g);
  });

  function render() {
    [...nodesG.querySelectorAll('.emb-node')].forEach((g) => {
      g.classList.toggle('is-selected', seleccion.includes(Number(g.dataset.i)));
    });

    if (seleccion.length === 2) {
      const [a, b] = seleccion;
      const [ax, ay] = coords[a];
      const [bx, by] = coords[b];
      line.setAttribute('x1', ax);
      line.setAttribute('y1', ay);
      line.setAttribute('x2', bx);
      line.setAttribute('y2', by);
      line.classList.add('is-active');
      const sim = similitudCoseno(embeddings[a], embeddings[b]);
      out.innerHTML = `similitud_coseno(<code>${palabras[a]}</code>, <code>${palabras[b]}</code>) = <code>${sim.toFixed(3)}</code>`;
    } else {
      line.classList.remove('is-active');
      out.textContent = seleccion.length === 1
        ? `${palabras[seleccion[0]]} — elige una segunda palabra para comparar.`
        : 'Elige dos palabras para comparar su similitud coseno.';
    }
  }

  render();
})();
</script>

Fíjate en el eje horizontal: los animales (`perro`, `gato`, `cachorro`)
quedan lejos de las personas (`rey`, `reina`, `hombre`, `mujer`) — es la
dirección dominante en estos datos de juguete. El eje vertical separa
más finamente por género dentro de cada grupo. Ninguna de las cuatro
dimensiones originales "significa" esto explícitamente; es la combinación
de las cuatro, vista desde el ángulo que más varianza captura, lo que deja
ver el patrón.

## De embeddings estáticos a embeddings contextuales

Hasta aquí, cada palabra tiene un único vector fijo. Pero "banco" en "me senté en el banco del parque" y "banco" en "fui al banco a sacar dinero" deberían significar cosas distintas.

Esto es exactamente lo que resuelve el mecanismo de **atención** (el paper que vimos en el post anterior). Para ser precisos: en cada capa del transformer, la representación de cada token se actualiza utilizando información del resto de tokens de la frase; cada cabeza de atención aporta una forma distinta de mirar ese contexto, y esa representación —el **hidden state**— va evolucionando capa tras capa, no se calcula de golpe en un único paso.

Aquí conviene ser precisos con el vocabulario: en sentido estricto, un transformer no tiene *un único* espacio latente. El embedding es solo el vector de entrada; cada capa produce su propio hidden state, distinto del anterior. En esta serie hablamos de "espacio latente" de forma un poco más laxa, como el conjunto de esas representaciones internas — es la simplificación habitual en divulgación, y a partir de aquí ya tienes el contexto para leerla con propiedad.

La comparación que mejor resume la diferencia con lo anterior: **word2vec aprende un único mapa fijo de palabras. Un transformer genera un mapa nuevo para cada frase.** El espacio latente, en un transformer, no es un mapa estático — es un mapa que se redibuja cada vez que cambia el contexto.

```python
# Pseudocódigo conceptual (no ejecutable, solo para intuición)
embedding_banco_estatico = modelo_word2vec["banco"]          # siempre el mismo vector

embedding_banco_contextual_1 = transformer("me senté en el banco del parque")["banco"]
embedding_banco_contextual_2 = transformer("fui al banco a sacar dinero")["banco"]

# embedding_banco_contextual_1 != embedding_banco_contextual_2
```

## ¿Por qué llamarlo "latente"?

"Latente" significa oculto, presente pero no directamente observable. El espacio latente no es algo que el modelo nos enseña explícitamente — es una representación interna, comprimida, que emerge del entrenamiento. Nadie le dice al modelo "esta dimensión representa género" o "esta dimensión representa formalidad". Esas estructuras aparecen solas porque son útiles para la tarea (predecir la siguiente palabra, o reconstruir una entrada, como veremos en el próximo post). Las dimensiones individuales rara vez tienen una interpretación humana clara y aislada; el significado suele estar distribuido entre muchas de ellas a la vez, combinándose de formas que no siempre son fáciles de leer a simple vista — un problema al que volveremos de lleno cuando hablemos de interpretabilidad mecanicista.

Una tentación natural, sobre todo la primera vez que oyes que un modelo tiene "4096 dimensiones", es imaginar que cada una debe representar algo concreto y nombrable. En la práctica casi nunca ocurre así de limpio: el significado está repartido entre combinaciones de dimensiones que trabajan conjuntamente, no en casillas aisladas con una etiqueta cada una.

Esa es la gran idea que van a compartir todos los posts de esta serie: los modelos no almacenan reglas explícitas, almacenan geometría. Cuando un LLM "aprende", no está memorizando un libro de reglas — está aprendiendo a deformar un espacio matemático para que los conceptos relacionados queden cerca entre sí y las relaciones útiles se conviertan en geometría. Entender un modelo, hasta cierto punto, es entender la forma de ese espacio.

## Para jugar

Un notebook con embeddings reales de un modelo pequeño (`sentence-transformers`), proyecciones con PCA y t-SNE, y aritmética vectorial:

```bash
pip install sentence-transformers scikit-learn matplotlib
```

```python
from sentence_transformers import SentenceTransformer

modelo = SentenceTransformer("paraphrase-multilingual-MiniLM-L12-v2")
frases = ["el gato duerme en el sofá", "un felino descansa en el sillón", "la bolsa subió un 2%"]
vectores = modelo.encode(frases)

print(similitud_coseno(vectores[0], vectores[1]))  # alto: mismo significado
print(similitud_coseno(vectores[0], vectores[2]))  # bajo: temas distintos
```

Y un segundo script que genera las tres imágenes que acompañan a este post en la versión publicada: el mapa 2D de juguete, una proyección PCA en 3D con embeddings reales, y el mismo espacio visto con t-SNE (que separa mejor los grupos a costa de distorsionar las distancias globales):

```python
from mpl_toolkits.mplot3d import Axes3D  # noqa: F401
from sklearn.manifold import TSNE

def graficar_3d(vectores, etiquetas, titulo, archivo):
    pca3 = PCA(n_components=3)
    coords3 = pca3.fit_transform(vectores)
    fig = plt.figure(figsize=(7, 7))
    ax = fig.add_subplot(111, projection="3d")
    ax.scatter(coords3[:, 0], coords3[:, 1], coords3[:, 2])
    for etiqueta, (x, y, z) in zip(etiquetas, coords3):
        ax.text(x, y, z, etiqueta)
    ax.set_title(titulo)
    plt.savefig(archivo, dpi=150)

def graficar_tsne(vectores, etiquetas, titulo, archivo):
    tsne = TSNE(n_components=2, perplexity=min(5, len(vectores) - 1), random_state=0)
    coords = tsne.fit_transform(vectores)
    plt.figure(figsize=(6, 6))
    plt.scatter(coords[:, 0], coords[:, 1])
    for etiqueta, (x, y) in zip(etiquetas, coords):
        plt.annotate(etiqueta, (x, y))
    plt.title(titulo)
    plt.savefig(archivo, dpi=150)
```

## Qué viene después

En el próximo post vamos a construir un espacio latente desde cero con un **autoencoder**: una red que aprende a comprimir datos a un espacio de baja dimensión y reconstruirlos, sin que nadie le diga qué debe representar cada dimensión. Es el ejemplo más directo y visual de cómo "emerge" un espacio latente — y es, además, el antecesor conceptual directo de la arquitectura encoder-decoder que aparece en el paper de Attention.
