---
titulo: "El radar aprende a recordar: memoria semántica y una suposición que resultó falsa"
resumen: "Segundo episodio de la bitácora: cómo el radar dejó de repetir la misma noticia contada por dos medios distintos — y un límite de la plataforma que nadie había verificado hasta que falló de verdad."
estado: pruebas
unidad: "U-08"
serie: bitacora
fecha: 2026-07-21
---

El [episodio anterior](/lab/bitacora-radar-01) terminaba con una promesa: el radar iba a dejar de fiarse solo de enlaces exactos para saber qué ya había contado, y a empezar a fijarse en de qué trata cada noticia. Esa promesa ya está cumplida y en producción — y por el camino apareció algo más interesante que la propia función: una suposición de la entrada anterior que resultó ser falsa, y que solo se descubrió al intentarlo de verdad, no leyendo la documentación.

La idea central es sencilla, así que la dejo por delante antes de entrar en cómo se construyó: cada noticia nueva se compara con lo ya publicado, y solo puede pasar una de tres cosas. Es la misma noticia contada por otro medio → se fusiona, no se cuenta dos veces. Está relacionada con algo publicado hace semanas → se menciona esa relación como contexto. No se parece a nada → se publica como siempre. Lo que sigue es cómo se llegó a eso y qué se torció por el camino.

## El flujo, paso a paso

Antes de entrar en el detalle, así se ve el camino completo que sigue una noticia — elige un escenario y pulsa "Paso" para recorrerlo de principio a fin:

<div class="pipeline-demo" id="pipeline-demo">
  <div class="pipeline-demo-escenarios">
    <button type="button" data-escenario="nueva" class="is-active">Noticia nueva</button>
    <button type="button" data-escenario="relacionada">Noticia relacionada</button>
    <button type="button" data-escenario="duplicada">Noticia duplicada</button>
  </div>
  <div class="pipeline-demo-caption" id="pipeline-caption">Pulsa "Paso" para empezar.</div>
  <div class="pipeline-demo-pasos" id="pipeline-pasos"></div>
  <div class="pipeline-demo-controles">
    <button type="button" id="pipeline-step">Paso ▶</button>
    <button type="button" id="pipeline-reset">Reiniciar</button>
  </div>
</div>

<script>
(function () {
  const root = document.getElementById('pipeline-demo');
  if (!root) return;
  const caption = root.querySelector('#pipeline-caption');
  const pasosEl = root.querySelector('#pipeline-pasos');
  const stepBtn = root.querySelector('#pipeline-step');
  const resetBtn = root.querySelector('#pipeline-reset');
  const escenarioBtns = root.querySelectorAll('.pipeline-demo-escenarios button');

  const ESCENARIOS = {
    nueva: [
      { label: 'Leer fuentes', texto: 'El radar revisa sus fuentes (blogs de labs, newsletters, releases, arXiv...) y descarta lo que ya vio por enlace exacto.' },
      { label: 'Generar embedding', texto: 'La pieza que queda se convierte en un vector (bge-m3) que representa de qué trata, no solo su enlace.' },
      { label: 'Comparar con el índice', texto: 'Se consulta Vectorize: ¿hay algo parecido ya guardado de los últimos 90 días?' },
      { label: 'Clasificar: nuevo', texto: 'Nada lo bastante parecido (similitud por debajo de 0.65) — sigue el camino normal.' },
      { label: 'Resumir (Haiku)', texto: 'Haiku evalúa relevancia (1-5) y redacta el resumen a partir del título y el contenido.' },
      { label: 'Publicar + ★', texto: 'Si es relevante, se publica con su puntuación de relevancia visible como estrellas.' },
      { label: 'Guardar vector', texto: 'Su embedding se guarda en el índice — una noticia futura podrá compararse contra esta.' },
    ],
    relacionada: [
      { label: 'Leer fuentes', texto: 'El radar revisa sus fuentes y descarta lo que ya vio por enlace exacto.' },
      { label: 'Generar embedding', texto: 'La pieza que queda se convierte en un vector que representa de qué trata.' },
      { label: 'Comparar con el índice', texto: 'Se consulta Vectorize contra lo publicado en los últimos 90 días.' },
      { label: 'Clasificar: relacionado', texto: 'Similitud entre 0.65 y 0.93 con algo de hace semanas — no es la misma noticia, pero está conectada.' },
      { label: 'Resumir con contexto (Haiku)', texto: 'Haiku recibe esa pieza antigua como contexto: puede mencionar la relación si aporta algo real, o ignorarla si no.' },
      { label: 'Publicar + ★ + contexto', texto: 'Se publica con resumen, estrella de relevancia y un enlace real a la pieza de contexto — el enlace lo añade el código, nunca el modelo.' },
      { label: 'Guardar vector', texto: 'Su embedding también se guarda, para futuras comparaciones.' },
    ],
    duplicada: [
      { label: 'Leer fuentes', texto: 'El radar revisa sus fuentes y descarta lo que ya vio por enlace exacto.' },
      { label: 'Generar embedding', texto: 'La pieza que queda se convierte en un vector que representa de qué trata.' },
      { label: 'Comparar con el índice', texto: 'Se consulta Vectorize contra lo publicado hoy mismo.' },
      { label: 'Clasificar: duplicado', texto: 'Similitud de 0.93 o más con algo de hoy — es la misma noticia contada por otra fuente.' },
      { label: 'Fusionar (fin)', texto: 'Se añade esta fuente a la pieza ya publicada. Nunca llega a Haiku: no se gasta un resumen nuevo en la misma historia.' },
    ],
  };

  let escenario = 'nueva';
  let paso = 0;

  function construirPasos() {
    pasosEl.innerHTML = '';
    ESCENARIOS[escenario].forEach((p, i) => {
      const caja = document.createElement('div');
      caja.className = 'pipeline-demo-paso';
      caja.textContent = p.label;
      pasosEl.appendChild(caja);
      if (i < ESCENARIOS[escenario].length - 1) {
        const flecha = document.createElement('div');
        flecha.className = 'pipeline-demo-flecha';
        flecha.textContent = '→';
        pasosEl.appendChild(flecha);
      }
    });
  }

  function render() {
    const pasos = ESCENARIOS[escenario];
    const cajas = pasosEl.querySelectorAll('.pipeline-demo-paso');
    cajas.forEach((c, i) => c.classList.toggle('is-active', i === paso));
    caption.textContent = pasos[paso].texto;
    stepBtn.disabled = paso >= pasos.length - 1;
  }

  escenarioBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      escenario = btn.dataset.escenario;
      escenarioBtns.forEach((b) => b.classList.toggle('is-active', b === btn));
      paso = 0;
      construirPasos();
      render();
    });
  });

  stepBtn.addEventListener('click', () => {
    const pasos = ESCENARIOS[escenario];
    if (paso < pasos.length - 1) paso++;
    render();
  });

  resetBtn.addEventListener('click', () => {
    paso = 0;
    render();
  });

  construirPasos();
  render();
})();
</script>

## Comparar por significado, no por enlace

Hasta ahora, "ya publicado" quería decir "mismo enlace exacto". Funciona bien contra republicaciones, pero no contra el caso más habitual: un lanzamiento grande lo cuentan tres o cuatro medios el mismo día, cada uno con su titular y su URL. Para el radar, eso eran tres noticias distintas — para el lector, la misma historia tres veces.

La solución fue darle al radar memoria de verdad: guardar de qué trata cada noticia, no solo su enlace, y antes de resumir una nueva preguntar "¿algo de lo que ya tengo se parece mucho a esto?". Un detalle que vale la pena explicitar: cuando el radar sí menciona una relación con el pasado, nunca deja que el modelo escriba el enlace de memoria — se lo pasa el propio código a partir de un dato real. Pedirle a un modelo que recuerde una URL es invitarlo a inventársela.

En la práctica cambia esto: antes, una noticia cubierta por tres fuentes eran tres llamadas al modelo de resumen y tres piezas casi idénticas en el digest. Ahora es una sola llamada y una sola pieza, con las demás fuentes anotadas al lado. Menos coste, y menos ruido para quien lee.

Montar esa memoria fue la parte fácil. Lo interesante vino después, al ponerla a funcionar con datos reales.

## El límite que nadie había comprobado

La entrada anterior ya había chocado una vez con un límite real de Cloudflare: 50 peticiones a internet por cada ejecución del radar. Se resolvió repartiendo el trabajo en tareas más pequeñas, y de paso se dio por sentado algo que sonaba razonable — que las herramientas *propias* de la plataforma (el modelo que compara significados, la base de datos donde se guarda) no deberían contar contra ese mismo límite, solo las llamadas a internet.

Sonaba razonable. Nadie lo había comprobado.

Y cuando tocó cargar de una vez todo el histórico ya publicado en esa nueva memoria, apareció el mismo error de siempre — pero esta vez disparado por las herramientas que se suponía que no contaban. El proceso se cortó en seco a mitad de camino, siempre en el mismo punto exacto: el límite de 50 también les aplicaba a ellas.

La corrección fue simple una vez detectada: contar también esas llamadas, y dejar de intentar la memoria semántica bastante antes de acercarse al límite — pero nunca cortar lo que sí es innegociable, que es el resumen de la noticia. Mejor una pieza sin contexto histórico que una noticia perdida.

## Ajustar el oído, no solo la teoría

Quedaba decidir a partir de qué punto dos noticias se consideran "relacionadas". La primera cifra fue una estimación razonable a ojo, sin datos delante. Y falló en la dirección que más importa: cuando llegó el primer caso real —dos artículos claramente sobre el mismo tema, la ola de modelos chinos de código abierto—, su parecido no llegó a cruzar el umbral fijado. Con ese número, el radar nunca los habría conectado.

No se apoyó solo en ese caso: se contrastó también contra varios pares sin relación real que aparecieron en la misma tanda, mucho más bajos. Con las dos puntas claras, mover el umbral fue una decisión con datos, no un tanteo a ciegas. El otro umbral —el que decide si es la *misma* noticia, no solo una relacionada— sigue a la espera de su propio caso real, y eso no se puede forzar: hace falta que ocurra.

Muévelo tú mismo: esto es justo lo que decide el paso "Clasificar" del diagrama de arriba.

<div class="umbral-demo" id="umbral-demo">
  <div class="umbral-demo-escala">
    <div class="umbral-demo-barra"></div>
    <span class="umbral-demo-tick" style="left:65%">0.65<small>relacionado</small></span>
    <span class="umbral-demo-tick" style="left:93%">0.93<small>duplicado</small></span>
    <input type="range" min="0" max="100" value="50" step="1" class="umbral-demo-slider" id="umbral-demo-slider" aria-label="Similitud coseno entre dos noticias" />
  </div>
  <div class="umbral-demo-valor">Similitud: <code id="umbral-demo-valor">0.50</code></div>
  <div class="umbral-demo-caption" id="umbral-demo-caption" aria-live="polite">nuevo — se resume y publica como siempre</div>
  <div class="umbral-demo-presets">
    <button type="button" data-valor="73">Caso real: 0.731 — dos piezas sobre modelos chinos</button>
    <button type="button" data-valor="58">Ruido: 0.575 — un paper de XAI vs una app de cámara</button>
  </div>
</div>

<script>
(function () {
  const root = document.getElementById('umbral-demo');
  if (!root) return;
  const slider = root.querySelector('#umbral-demo-slider');
  const valorEl = root.querySelector('#umbral-demo-valor');
  const captionEl = root.querySelector('#umbral-demo-caption');

  const UMBRAL_RELACIONADO = 65;
  const UMBRAL_DUPLICADO = 93;

  function clasificar(v) {
    if (v >= UMBRAL_DUPLICADO) {
      return { tipo: 'duplicado', texto: 'duplicado — se fusiona con la pieza ya publicada, no se resume de nuevo' };
    }
    if (v >= UMBRAL_RELACIONADO) {
      return { tipo: 'relacionado', texto: 'relacionado — se pasa como contexto al resumen, sin fusionar' };
    }
    return { tipo: 'nuevo', texto: 'nuevo — se resume y publica como siempre' };
  }

  function render() {
    const v = parseInt(slider.value, 10);
    const { tipo, texto } = clasificar(v);
    valorEl.textContent = (v / 100).toFixed(2);
    captionEl.textContent = texto;
    captionEl.className = 'umbral-demo-caption is-' + tipo;
  }

  slider.addEventListener('input', render);
  root.querySelectorAll('.umbral-demo-presets button').forEach((boton) => {
    boton.addEventListener('click', () => {
      slider.value = boton.dataset.valor;
      render();
    });
  });

  render();
})();
</script>

## Qué cambia para quien lee el radar

Menos repetición, ya cubierta arriba. Lo nuevo es lo otro: de vez en cuando, el radar podrá decir "esto continúa lo de hace unas semanas" en vez de tratar cada pieza como si no tuviera pasado — la diferencia entre juntar titulares y construir sobre lo que ya se sabe. Ya está desplegado y corriendo. Lo único que queda abierto es afinar el segundo umbral con más casos reales.

## La lección

No basta con medir después de que algo falle: hay que desconfiar, antes, de lo que suena razonable — incluida la letra pequeña de la propia infraestructura. Un supuesto sin verificar no es un hecho: es solo una opinión con buena redacción.

Repo y diario técnico completo, como siempre, en [github.com/david-sanchezperez/espacio-latente](https://github.com/david-sanchezperez/espacio-latente) — `worker-radar/DEVLOG.md` tiene el detalle línea a línea de esta entrada, con todas las cifras que aquí me he dejado fuera a propósito.
