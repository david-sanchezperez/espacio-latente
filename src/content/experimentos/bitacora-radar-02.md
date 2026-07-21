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

## Qué cambia para quien lee el radar

Menos repetición, ya cubierta arriba. Lo nuevo es lo otro: de vez en cuando, el radar podrá decir "esto continúa lo de hace unas semanas" en vez de tratar cada pieza como si no tuviera pasado — la diferencia entre juntar titulares y construir sobre lo que ya se sabe. Ya está desplegado y corriendo. Lo único que queda abierto es afinar el segundo umbral con más casos reales.

## La lección

No basta con medir después de que algo falle: hay que desconfiar, antes, de lo que suena razonable — incluida la letra pequeña de la propia infraestructura. Un supuesto sin verificar no es un hecho: es solo una opinión con buena redacción.

Repo y diario técnico completo, como siempre, en [github.com/david-sanchezperez/espacio-latente](https://github.com/david-sanchezperez/espacio-latente) — `worker-radar/DEVLOG.md` tiene el detalle línea a línea de esta entrada, con todas las cifras que aquí me he dejado fuera a propósito.
