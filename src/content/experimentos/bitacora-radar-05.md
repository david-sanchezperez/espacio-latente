---
titulo: "El radar aprende a desconfiar de sí mismo: dos jueces en vez de uno"
resumen: "Quinto episodio de la bitácora: un benchmark real entre Workers AI, Haiku y DeepSeek destapa que un solo número de relevancia mezclaba dos preguntas distintas, y que el modelo más barato puede alucinar un detalle tan concreto como el color de un pelícano. La respuesta no es elegir un ganador: es que un segundo modelo revise al primero antes de publicar."
estado: pruebas
unidad: "U-20"
serie: bitacora
fecha: 2026-09-06
---

El [episodio anterior](/lab/bitacora-radar-04) cerraba con una pregunta abierta: si el prompt ampliado cambia de forma medible cuánto se publica, todavía no había forma barata de comprobarlo sin un corpus etiquetado a mano. Esta entrada no resuelve eso —sigue siendo caro construirlo—, pero nace de una prueba mucho más modesta que terminó revelando más de lo esperado: comparar, artículo por artículo, qué escribe cada proveedor cuando se les da exactamente el mismo texto.

## Un benchmark con doce piezas reales

El radar ya tenía un endpoint interno, `/comparar`, para esto exactamente: pedirle a Workers AI, Haiku y DeepSeek que evalúen y resuman las mismas noticias recientes, sin publicar nada, solo para juzgar a ojo. La primera tanda de seis artículos salió rara: Haiku devolvía, en las seis, el título tal cual como si fuera el resumen —`"resumen": "Using Blender with coding agents on macOS"`, sin relevancia, sin nada más.

Eso no es un modelo escribiendo mal. Es la forma exacta del *fallback* de error del código (`resumir()` falla "abierto": si la llamada revienta, publica el titular en vez de perder la pieza) — así que Haiku estaba fallando el 100% de las veces, no rindiendo poco. La causa, encontrada mirando el código y no el prompt: `wrangler secret put ANTHROPIC_API_KEY` lanzado sin `--name` desde la raíz del repo sube el secreto al Worker equivocado —el del sitio, no el del radar—, porque ambos comparten cuenta de Cloudflare y el comando resuelve el nombre por el `wrangler.jsonc` que encuentre primero. Pasó dos veces seguidas antes de darnos cuenta: la key se subió bien, pero al Worker que no tocaba. La solución real no es acordarse de un flag, es no depender de acordarse: `npm run desplegar:radar` ya usaba `--config worker-radar/wrangler.toml` desde antes, y ahora es también cómo se suben los secrets de ese Worker.

Con la key en el sitio correcto, la segunda tanda de doce piezas sí dio datos utilizables.

## Un número que hacía dos preguntas a la vez

El caso más claro fue un artículo de MIT Technology Review sobre infraestructura de memoria para inferencia de IA —contenido patrocinado, sin datos técnicos, básicamente una entrevista de opinión. Haiku le dio 4 sobre 5 de relevancia. DeepSeek le dio 2. Ninguno de los dos "se equivocaba": Haiku estaba respondiendo "¿esto encaja con el tema que le interesa a esta audiencia?" (sí, de lleno) y DeepSeek estaba respondiendo "¿este artículo concreto aporta algo que no supieran ya?" (no, nada).

El prompt llevaba tres fases pidiendo un solo campo, `RELEVANCIA`, y ese número tenía que cargar con las dos preguntas a la vez. Funcionaba razonablemente mientras las respuestas coincidían casi siempre; en cuanto un modelo empezó a pesar más una pregunta que la otra, el desacuerdo dejó de ser sobre hechos y pasó a ser sobre qué estaba midiendo cada uno. La solución es separar los dos ejes en el propio formato de salida —`RELEVANCIA_TEMA` y `VALOR_INFORMATIVO`— y exigir que una pieza supere los dos umbrales, no uno solo. Un tema perfecto con un artículo vacío ya no cuela.

## El pelícano que se volvió pelirroja

El segundo hallazgo es más serio. En un artículo sobre un lanzamiento de OpenAI, la fuente original describía un vídeo promocional con "un pelícano con un pañuelo rojo montando en bicicleta". El resumen de DeepSeek —bien escrito, con buen criterio editorial en el resto de la pieza— decía "una pelirroja con pañuelo rojo montando una bicicleta". No es una paráfrasis torpe: es un detalle concreto, verificable y completamente inventado, servido con la misma confianza que el resto del texto correcto.

Eso es justo el tipo de error que un digest automático no puede permitirse: cuanto mejor escribe un modelo, menos motivos da un lector para ir a comprobar la fuente. Se añadió una instrucción explícita al prompt —no completar con suposiciones ningún detalle concreto (colores, cifras, nombres, citas) que no esté literalmente en el texto, omitirlo en vez de inventarlo— pero una frase en un prompt no es una garantía, es una reducción de probabilidad. La alucinación seguía siendo posible.

## Dos jueces, no un modelo ganador

La pregunta que parecía tener que responder este benchmark era "¿Haiku o DeepSeek?". La respuesta útil resultó ser otra: en la muestra, cada uno fallaba de forma distinta —Haiku se dejaba llevar por el tema (el caso MIT), DeepSeek podía alucinar un detalle concreto (el caso pelícano)— y ninguno de los dos fallos lo detecta el propio modelo que lo comete.

El radar pasa a tener dos jueces en producción, no uno. DeepSeek —más barato, con criterio editorial al menos igual de bueno en la muestra— decide relevancia primero, con los dos ejes nuevos. Solo lo que él aprueba pasa a un segundo modelo, Haiku, con un prompt distinto: no "resume esto", sino "aquí tienes el artículo completo y el resumen que otro modelo ya escribió — busca una razón para rechazarlo". Es un editor adversarial, no un segundo redactor: su trabajo es desconfiar, no confirmar. Si aprueba, se publica el resumen (corregido si hacía falta). Si no, se descarta con el mismo criterio de "mejor perder una pieza de más que publicar un hecho inventado" que ya regía el resto del pipeline.

El coste extra es pequeño porque Haiku solo entra en juego sobre lo que ya sobrevivió al primer filtro —una fracción del volumen total evaluado cada día, no todas las piezas—, que es justo el patrón que ya se usaba para el artículo completo frente al snippet en el episodio anterior: gastar más solo donde ya se sabe que merece la pena.

## Lo que esta entrada no puede confirmar todavía

Con la misma honestidad que los episodios 2, 3 y 4: el sistema de dos jueces está desplegado y probado —31 casos de test cubren el descarte por cada eje por separado y el veto del editor sobre algo que el primer juez ya había aprobado—, pero todavía no hay ni un solo día de producción real corriendo con él. No sé todavía cuántas piezas veta Haiku de las que DeepSeek aprueba, ni si el prompt de dos ejes reduce de verdad el desacuerdo que motivó este cambio, ni si el editor adversarial pilla alguna vez una alucinación real o simplemente aprueba siempre porque DeepSeek ya venía haciendo bien los deberes. Esta entrada se actualizará con esos números en cuanto haya unos días de datos —si el editor nunca veta nada, esa ausencia es tan parte de la historia como un veto real.

Repo y diario técnico completo, como siempre, en [github.com/david-sanchezperez/espacio-latente](https://github.com/david-sanchezperez/espacio-latente) — `worker-radar/DEVLOG.md` tiene el detalle línea a línea de esta entrada.
