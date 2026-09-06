---
titulo: "El radar aprende a decir por qué importa"
resumen: "Cuarto episodio de la bitácora: qué pasa cuando se contrasta el radar con un plan de evolución de 42 puntos escrito para un equipo con presupuesto elástico, y por qué distinguir 'límite de Cloudflare' de 'límite de dinero' abrió la puerta a leer el artículo completo en producción, no solo compararlo aparte."
estado: pruebas
unidad: "U-19"
serie: bitacora
fecha: 2026-09-06
---

El [episodio anterior](/lab/bitacora-radar-03) cerraba con los tests encontrando dos bugs reales que la producción llevaba semanas sin denunciar. Esta entrada nace de algo distinto: alguien (yo, con la ayuda de Claude) le pasó al radar un documento de evolución de 42 puntos —clustering de eventos, detección de tendencias, seguimiento de predicciones, páginas de entidades, cruce con este mismo blog— y la primera pregunta útil no fue "¿cuál implementamos primero?" sino "¿cuáles de estos 42 puntos tienen sentido con el volumen y el presupuesto que hay hoy, y cuáles son ruido de un plan escrito para otro proyecto?".

## Contrastar un plan grande contra un sistema pequeño y real

La respuesta, mirando el propio diario de las tres fases anteriores, fue incómoda pero útil: bastante de ese plan (detección de tendencias con embeddings temporales, páginas de entidades, seguimiento de contradicciones y predicciones, síntesis semanal completa con RAG) necesita un volumen de datos que el radar todavía no tiene —con 30-80 noticias al día no hay suficiente señal para que "tendencia acelerando" signifique algo distinto de ruido estadístico— y en algunos casos presupuesto que las tres fases anteriores ya habían rechazado explícitamente dos veces (Workers de pago, hardware propio) por no compensar.

De los 42 puntos, cinco sí cabían en lo que ya existe sin tocar infraestructura nueva, y son el cuerpo de esta entrada.

## Un perfil de interés, no solo "¿es esto IA?"

El radar llevaba tres fases juzgando relevancia con una sola pregunta: ¿el tema central es IA? Eso deja pasar de todo —una ronda de financiación, un producto que "añade IA" sin cambiar nada técnico— siempre que mencione IA de forma central. La pregunta correcta es otra: ¿le compensaría a alguien que trabaja con sistemas de IA, agentes o infraestructura dedicarle 3-10 minutos a esto?

Dos cambios en el mismo prompt, sin ninguna llamada nueva al modelo: un perfil de interés explícito (agentes, inferencia local, cuantización, MCP, RAG, infraestructura de IA... frente a producto de consumo genérico, rondas sin ángulo técnico) que sube o baja la nota por sustancia real, no por la palabra "IA"; y una pregunta de rechazo explícita antes de puntuar —¿hay una razón de peso para NO mostrar esto?— en vez de solo la pregunta de aceptación. Es la diferencia entre un filtro que solo sabe decir que sí y uno que también sabe decir que no.

## Por qué importa, no solo qué pasó

El resumen de cada pieza cuenta *qué* pasó. Nunca decía *por qué* le iba a importar a quien lo lee. Ahora cada noticia lleva un tercer campo, `IMPORTA`, generado en la misma llamada a Haiku que ya calculaba relevancia y resumen —coste marginal prácticamente cero—: una frase que no repite el resumen, sino que dice la consecuencia. No "Qwen lanzó un modelo MoE de X parámetros" otra vez, sino "esto podría cambiar el equilibrio calidad/latencia para cargas de trabajo de agentes en GPUs de consumo".

Es la diferencia entre un digest que resume y uno que empieza a parecerse a inteligencia: la primera pregunta de un lector técnico casi nunca es "¿qué pasó?", es "¿y a mí esto en qué me afecta?".

## Hacker News es descubrimiento, no autoridad

Cuando la misma noticia llega por dos fuentes distintas, el radar ya sabía fusionarlas (episodio 2) —pero la fuente que se mostraba como principal era la que llegó primero, sin más criterio. Si Hacker News la traía dos horas antes que el propio laboratorio que la anunció, HN se quedaba como fuente principal.

Ahora cada fuente tiene una clase —primaria (el propio laboratorio o repositorio), experta (voces técnicas independientes como Simon Willison), investigación (papers), medios generales, comunidad— y al fusionar gana la de mayor autoridad, nunca la más rápida. Hacker News baja a la categoría de menor prioridad: sigue sirviendo para descubrir noticias (su feed ya enlaza al artículo original, no a la discusión), pero nunca vuelve a aparecer como fuente principal si hay algo más autorizado cubriendo lo mismo.

## El límite que no era de Cloudflare

Esta es la parte que más vale la pena contar aparte, porque es un error de categoría fácil de cometer y que este proyecto llevaba arrastrando desde la fase 1: confundir "no puedo gastar una petición más" (límite real de la plataforma, 50 subrequests por invocación) con "no puedo gastar un dólar más" (presupuesto, que aquí es de céntimos).

El radar tiene, desde el primer día, una función que lee el artículo completo en vez del snippet corto del RSS —`obtenerTextoArticulo()`—, pero solo se usaba en un endpoint interno de comparación (`/comparar`), nunca en la producción real. La razón, en su momento, tenía sentido: una petición más por noticia es una petición menos de margen frente al límite de 50. Pero Haiku cuesta, medido en D1 desde la fase 1, entre $0,0015 y $0,002 por llamada —y leer el artículo completo no añade llamadas a Haiku, solo hace que esa llamada reciba más texto de entrada, que es prácticamente gratis.

Dicho de otra forma: el radar llevaba fases enteras aplicando una restricción de dinero a un problema que era de peticiones, y viceversa. Separarlos es simple una vez que se ve: el límite de peticiones sigue tan vigilado como siempre (comparte el mismo presupuesto que ya protegía la memoria semántica, para no arriesgar nunca la llamada a Haiku, que es la que de verdad no puede fallar), pero dentro de ese presupuesto, ahora cada pieza puede permitirse leer el artículo entero. Resúmenes y "por qué importa" con más sustancia —fechas, cifras, matices— al mismo coste de infraestructura, pagando unos céntimos más al mes en tokens de entrada.

## Aplicarlo hacia atrás, no solo hacia adelante

Todo lo anterior mejora lo que se publica desde hoy. Pero el archivo entero —más de 50 días ya publicados— se quedaba con la fuente "equivocada" como principal en las piezas fusionadas antes de este cambio, y sin ningún `IMPORTA`. En vez de dejarlo así hasta que quedara obsoleto por completo, el radar incorpora un endpoint temporal de backfill que recorre cada día del archivo: reordena la fuente principal donde haga falta (gratis, sin llamar a ningún modelo) y genera el `IMPORTA` que falta para lo ya publicado, a partir del título y el resumen que ya existían —nunca releyendo el artículo original, que puede haber cambiado o desaparecido semanas después. Paginado en tandas para no chocar con el mismo límite de peticiones de siempre, y con el mismo criterio de todos los endpoints temporales de este proyecto: se retira en cuanto termina.

## Lo que esta entrada no puede confirmar todavía

Con la misma honestidad que ya tuvieron los episodios 2 y 3: el backfill retroactivo se escribe y se prueba en esta entrada, pero ejecutarlo contra el archivo real de producción requiere el secreto de despliegue, así que corre después de publicar este texto, no antes. Y sigue abierto lo mismo de siempre —si el prompt ampliado cambia de forma medible cuánto se publica, todavía no hay un corpus etiquetado a mano contra el que compararlo; eso es, con diferencia, lo más caro de construir de todo el plan de 42 puntos, y no es esta fase.

Repo y diario técnico completo, como siempre, en [github.com/david-sanchezperez/espacio-latente](https://github.com/david-sanchezperez/espacio-latente) — `worker-radar/DEVLOG.md` tiene el detalle línea a línea de esta entrada.
