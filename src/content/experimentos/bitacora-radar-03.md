---
titulo: "El radar deja de pagar dos veces por lo mismo"
resumen: "Tercer episodio de la bitácora: cómo se bajó el coste de la memoria semántica agrupando en lotes, se cerró de verdad el límite de peticiones con un tope duro, y dos bugs reales que solo encontró la primera suite de tests del proyecto — ninguno lo había reportado un lector."
estado: pruebas
unidad: "U-11"
serie: bitacora
fecha: 2026-07-27
---

El [episodio anterior](/lab/bitacora-radar-02) dejaba la memoria semántica funcionando en producción, con un límite de peticiones ya conocido y una fórmula para no pasarse de él. Esta entrada no añade una función nueva — es la típica ronda de "ya funciona, ahora que no cueste tanto ni se rompa por el lado que todavía no habíamos mirado". Todo lo que sigue nace de datos que las dos fases anteriores ya habían dejado sobre la mesa, no de intuiciones nuevas.

## El gasto que nadie había mirado: 3 peticiones por noticia, solo para recordarla

Cada noticia nueva, antes de publicarse, gastaba tres peticiones solo en el paso de memoria: una a Workers AI para calcular su embedding, una a Vectorize para preguntar si algo parecido, y una más para guardar el vector una vez decidido que sí se publica. Con veintitantas noticias por pasada, eso es la mayoría del presupuesto de peticiones consumido en algo que el lector nunca ve — comparar, no publicar.

La solución no fue optimizar la lógica, fue dejar de pedir las cosas de una en una. `bge-m3` acepta varios textos en una sola llamada, y Vectorize acepta varios vectores en un único `insert`. El pipeline ahora decide primero qué noticias de una fuente son candidatas de verdad, pide todos sus embeddings de golpe, y acumula los vectores para insertarlos todos juntos al cerrar la pasada. Solo la consulta —¿hay algo parecido ya guardado?— sigue siendo, por naturaleza, una por noticia: eso no se puede agrupar sin perder la respuesta individual que necesitas.

El resultado: el coste de memoria pasa de aproximadamente 3 peticiones por noticia a solo 1 más un par fijo por lote. Con ese margen recuperado, se pudo subir el techo de noticias que el radar procesa por pasada sin arriesgar el límite de la plataforma — casi la mitad de las noticias que antes se quedaban sin procesar por falta de presupuesto no era por exceso de volumen, era el coste por noticia el que sobraba.

## El tope que la fase anterior dejó pendiente

En el episodio 1, la solución al límite de 50 peticiones externas fue repartir el trabajo en lotes pequeños. Funciona, pero es una defensa por aproximación: calculas cuánto va a gastar cada lote y te quedas por debajo con margen. Nunca fue una garantía dura — si algo salía más caro de lo previsto, el límite seguía ahí para saltar.

Ahora sí hay un tope duro: si una pasada llega a 45 peticiones, se deja de procesar en ese momento, sin excepción. No hace falta reencolar nada a mano — lo que no se llegó a procesar tampoco se llegó a guardar, así que la siguiente pasada programada lo recoge sola, como si nunca hubiera empezado. Es la diferencia entre "he calculado que no debería pasarme" y "no puedo pasarme aunque me equivoque al calcular".

## Publicar el resumen del día una vez, no tres

El resumen general del día —el "panorama"— se generaba dentro de cada lote que tuviera noticias nuevas. Con tres lotes, eran tres llamadas al modelo para producir un único resumen, cada una sobrescribiendo a la anterior. Solo la última importaba; las otras dos eran coste tirado.

Ahora ese resumen se encola como su propio paso, después de que todos los lotes hayan terminado, y solo se genera una vez por pasada — comprobando antes si el conjunto de noticias del día ha cambiado de verdad, para no repetir el trabajo si un reintento de la cola vuelve a pasar por ahí.

## Que lo descartado se quede descartado

Una noticia que el modelo de resumen puntuaba como poco relevante no dejaba ningún rastro. El radar revisa cada fuente cada 24 horas pero mira una ventana de las últimas 30, así que esa misma noticia mediocre volvía a evaluarse — y a pagar por evaluarse— en la pasada siguiente, sin que nadie se beneficiara de habérsela pensado ya una vez.

Ahora queda anotada como descartada durante 72 horas antes de gastar nada en volver a juzgarla. El plazo es corto a propósito: es memoria para no repetir trabajo reciente, no una lista negra permanente — una noticia floja hoy puede merecer otra mirada si vuelve a aparecer semanas después con más contexto alrededor.

## Dos bugs que ningún lector reportó, porque los encontraron los tests, no la producción

Esta fase también fue la primera vez que el proyecto tuvo una suite de tests que de verdad se ejecutaba — antes existían ficheros de test, pero no había ni el script para correrlos. Al arreglar eso y escribir los primeros tests de punta a punta, aparecieron dos fallos que llevaban tiempo ahí, en silencio:

- **Una fusión que nunca llegaba a guardarse.** Cuando dos fuentes cuentan la misma noticia, la segunda se "fusiona" con la ya publicada en vez de duplicarse — eso es justamente lo que contaba el episodio anterior. Pero si en un lote *todas* las noticias nuevas resultaban ser fusiones (ninguna genuinamente nueva), el código nunca llegaba a escribir ese cambio en el almacén. La fuente adicional se perdía sin ningún error visible; simplemente no aparecía nunca en la página.
- **HTML escapado publicado tal cual.** Algunas fuentes (WordPress y derivados, que es buena parte del feed) mandan su descripción con las etiquetas HTML escapadas en vez de crudas. El código que limpia el texto quitaba etiquetas *antes* de decodificar esos caracteres escapados, así que en esos casos el texto que llegaba al modelo — y al lector — conservaba trozos de `<p>` y `<a href=...>` literales.

Ninguno de los dos era un fallo hipotético: ambos estaban pasando ya, en producción, sin que nada lo señalara. Es la razón por la que esta fase dedica tanto espacio a los tests: no son burocracia, son la única razón por la que estos dos bugs se encontraron antes de que alguien los notara leyendo el radar en directo.

## Lo que esta entrada no puede confirmar todavía

Con la honestidad que ya tuvo el episodio anterior con su suposición fallida: esto se escribe desde el código, no desde una pasada real ya observada en producción. Quedan dos cosas por confirmar en cuanto corra con datos de verdad: que el nuevo resumen del día llega efectivamente después de todos los lotes con el volumen real de noticias, y que la proporción de noticias sin presupuesto para memoria semántica baja tanto como debería. Y sigue abierto lo mismo que en el episodio anterior — el umbral que decide si dos noticias son la *misma* (0.93) todavía no tiene un caso real que lo haya puesto a prueba.

Repo y diario técnico completo, como siempre, en [github.com/david-sanchezperez/espacio-latente](https://github.com/david-sanchezperez/espacio-latente) — `worker-radar/DEVLOG.md` tiene el detalle línea a línea de esta entrada.
