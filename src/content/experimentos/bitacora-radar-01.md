---
titulo: "Cómo se construye este sitio: el porqué detrás de cada pieza"
resumen: "Primer episodio de la bitácora de construcción: qué es el radar, qué tecnologías lo mueven (colas, embeddings, retrieval) y las decisiones — y los descartes — detrás de cada una."
estado: pruebas
unidad: "U-07"
serie: bitacora
fecha: 2026-07-20
---

Este blog habla sobre LLMs, agentes y todo lo que hay alrededor. Pero hay una parte que hasta ahora no había contado: **el propio sitio es un experimento en construcción**, no solo el escaparate donde cuelgo lo que aprendo. Esta bitácora es el sitio abriendo su propio motor.

En corto: `radar.espacio-latente.com` es un digest de noticias de IA. Corre dos veces al día sin que yo lo toque, guarda histórico, y se sirve tanto como página web como feed. Lo que cuenta este post no es el digest en sí — es el criterio con el que se ha ido montando: qué tecnologías entran en juego, por qué esas y no otras, y qué se ha descartado por el camino con la cuenta hecha. Casi ninguna de las lecciones es específica de este proyecto — se aplican a cualquiera montando un pipeline de IA con presupuesto contenido.

## El radar, en seis pasos

1. **Recoger** — leer una veintena de fuentes (blogs de laboratorios, newsletters, releases de GitHub, arXiv).
2. **Filtrar** — descartar duplicados y lo que ya se publicó ayer u hoy.
3. **Juzgar relevancia** — un modelo decide si una pieza vale la pena o es ruido.
4. **Resumir** — el mismo modelo redacta el resumen de lo que sí pasa el filtro.
5. **Publicar** — el resultado queda disponible en la web y en el feed.
6. **Registrar** — cada llamada a un modelo queda anotada: tokens, coste, qué salió mal si algo falló.

Con esto en la cabeza, vamos a las piezas.

## Las piezas, y el criterio detrás de cada una

Hoy el pipeline corre sobre Cloudflare porque encajaba con las restricciones de este proyecto: gratis hasta un volumen generoso, sin servidor que mantener. Con otro proveedor las piezas concretas serían distintas, pero las preguntas detrás de cada una serían las mismas — y esas son las que importan aquí.

- **Cola de mensajes** (Cloudflare Queues): reparte el trabajo en tareas pequeñas e independientes en vez de una tarea gigante. El problema concreto que resolvió lo cuento más abajo.
- **Almacén clave-valor** (KV): guarda el digest publicado de cada día. Deliberadamente simple — es lo único que necesita servir la web pública.
- **Base de datos SQL** (D1): desde hace unos días, guarda una fila por cada llamada a un modelo — tokens, coste, propósito. No cambia lo que se publica; es la base para decidir con datos en vez de intuición.
- **Dos modelos de lenguaje, para dos preguntas distintas.**

## Dos modelos, una pregunta práctica

El resumen de cada noticia lo escribe **Claude Haiku**, vía la API de Anthropic. Antes de decidir eso, se probó también un modelo pequeño y gratuito de Cloudflare (Workers AI), sobre los mismos textos.

No son modelos del mismo nivel ni pensados para el mismo trabajo, y comparados en abstracto la respuesta es obvia. Pero la pregunta que se estaba haciendo era otra, más concreta: la opción gratuita ya integrada, ¿basta para este trabajo, o compensa pagar por algo especializado? Esa pregunta sí merece hacerse siempre antes de sumar una dependencia de pago.

Con los mismos textos delante, los resúmenes de Haiku incluían fechas y cifras concretas que el modelo gratuito se dejaba fuera. Para el trabajo que más se nota al lector — la calidad del texto publicado — ganó Haiku.

¿Y Workers AI, entonces? Hoy, en el pipeline real, no hace nada — sigue disponible como banco de pruebas para comparaciones como esa. Su papel llegará con la siguiente fase: generar los *embeddings* para la deduplicación semántica (más abajo). Ahí sí es la herramienta adecuada — un trabajo mucho más ligero, donde un modelo pequeño y gratuito rinde igual que uno grande.

## Medir antes de optimizar

Antes de tocar nada del pipeline, lo primero que se montó fue la contabilidad de coste: tokens reales y un contador de peticiones externas por pasada, sin cambiar todavía qué se publica.

Los números, una vez medidos: unas 28 fuentes, ~30 noticias nuevas procesadas al día entre las dos pasadas, a 0,0015-0,002 dólares por resumen. Total: **1,5-2 dólares al mes**.

Y la contabilidad dio un resultado casi de inmediato: la primera pasada de verificación en producción hizo **59 peticiones externas** en una sola invocación, por encima del límite de 50 del plan gratuito. Ocho fuentes fallaron esa pasada — con el volumen de hoy, no de un futuro hipotético.

## Dos tentaciones, y por qué ninguna ganó

La solución más rápida al límite de 50 existía: pagar unos dólares al mes para subirlo. Y la conversación que llevó hasta aquí también incluyó la tentación contraria — montar infraestructura propia (base de datos vectorial casera, hardware adicional para tareas pesadas) para depender menos de un proveedor.

Ninguna de las dos sobrevivió a hacer la cuenta. Pagar habría resuelto el límite de peticiones, pero no los otros dos que aparecieron al mirar alrededor: cuánto puede almacenar el futuro motor de búsqueda semántica (de sobra, con el volumen previsto) y cuánto cuesta cada llamada al modelo (céntimos, ya visto arriba). Montar infraestructura propia habría añadido mantenimiento real a cambio de resolver problemas que, con los números en la mano, no existían todavía — un ordenador que solo enciende en un horario fijo, por ejemplo, no puede formar parte de una tarea diaria sin festivos.

La tesis común a las dos decisiones: la mejor arquitectura no es la más barata ni la más sofisticada, es la que resuelve el problema que de verdad tienes, con la evidencia delante en vez de con la intuición.

## La solución real: repartir el trabajo en colas

Lo que sí hacía falta era dejar de procesar todas las fuentes en una sola invocación. En vez de recorrer las 28 de golpe, ahora se reparten en lotes pequeños y cada lote se encola como una tarea independiente, con su propio presupuesto de peticiones.

Verificado en producción: una pasada de 14 fuentes se dividió en 3 lotes, cada uno con 4 a 8 peticiones externas. Cero errores, y el mecanismo se mantiene gratis con margen amplio para el volumen actual.

## Qué viene: deduplicación semántica

El siguiente paso no es publicar más rápido ni más barato — es publicar mejor: que el radar deje de fiarse solo de comparar enlaces exactos para saber si ya cubrió algo, y compare el *significado* de cada noticia nueva contra lo ya publicado.

Para eso hacen falta **embeddings** (representar cada noticia como un vector que captura de qué trata) y una **búsqueda por similitud** sobre lo ya publicado. Es el mismo concepto de espacio latente de la serie "Por dentro de los LLM", aplicado aquí en pequeño. Esta técnica — dar a un sistema la capacidad de recuperar información propia antes de decidir o generar algo — es la familia que en la industria se conoce como **RAG** (*retrieval-augmented generation*). Lo que se va a montar aquí es una pieza de esa familia, no el paquete completo de un asistente de preguntas y respuestas sobre documentos — conviene no sobrevender el término.

Con eso resuelto, el radar deja de repetir lo que ya sabe sin que nadie tenga que revisarlo a mano — que es, al final, la diferencia entre esto y un scraper con un resumen automático pegado encima: no solo junta y resume, también recuerda.

Esta bitácora va a seguir contando estas decisiones a medida que se tomen. Si quieres curiosear en el código real — no una versión idealizada para el post — está en [github.com/david-sanchezperez/espacio-latente](https://github.com/david-sanchezperez/espacio-latente), con un diario de decisiones más técnico y más largo en `worker-radar/DEVLOG.md`.
