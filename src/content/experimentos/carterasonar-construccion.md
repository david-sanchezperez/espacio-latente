---
titulo: "Construyendo CarteraSonar"
resumen: "Un motor de análisis de fondos sobre el catálogo público de MyInvestor tiene una feature central —detectar solapamiento oculto— que un límite real del catálogo deja incompleta. La historia de por qué ese límite se queda documentado en vez de maquillado."
estado: pruebas
unidad: "U-15"
serie: bitacora
fecha: 2026-08-22
---

> Esto no es asesoramiento financiero, y CarteraSonar no es un proyecto
> oficial de MyInvestor ni actúa en su nombre — es un proyecto personal que
> consume su catálogo público. Las cifras de este post son de ejemplo, no
> mi cartera real.

## Una feature central que no se puede terminar de resolver con código

CarteraSonar detecta solapamiento oculto entre fondos: dos productos con
nombres y gestoras completamente distintos que en realidad comparten buena
parte de sus posiciones. Es la razón de ser del proyecto — de ahí el
nombre, el sonar que detecta lo que no se ve a simple vista bajo la
superficie. Y tiene un límite real que ninguna cantidad de código adicional
resuelve: el catálogo de MyInvestor solo expone el **top-6 de sectores**
por fondo, no el listado completo de posiciones. Lo confirmé con un caso
real durante las pruebas: dos fondos compartían una posición individual
concreta, pero como esa posición no entraba en el top-6 sectorial de uno
de los dos, el solapamiento calculado salía en 0% — aunque el solapamiento
real existiera. Revisé una a una las doce herramientas del conector
buscando cualquier forma de sacar el listado completo de holdings.
Ninguna lo expone.

La opción obvia habría sido buscar algún endpoint interno no documentado
de la web de MyInvestor — el que usa su propia interfaz para pintar el
X-Ray — y llamarlo directamente para saltarme el límite. La descarté
explícitamente. Hay una línea real entre "cliente legítimo de una API
pública, diseñada para ser consumida así" y "acceso no autorizado a
infraestructura interna", y cruzarla habría socavado justo la razón por
la que tiene sentido que este proyecto sea público y tenga una relación
sana con la entidad de la que depende. Así que el límite se quedó
documentado como lo que es — en el README y como aviso en cada ejecución
del programa — en vez de maquillado con una heurística que aparente
resolverlo.

Esa tensión — entre lo que se puede calcular con precisión y lo que solo
se puede aproximar y hay que declarar como tal — terminó siendo el hilo
de todo el proyecto. Vale la pena contar cómo se construyó.

## El problema que resuelve

Comparar fondos por nombre y gestora no detecta el solapamiento real: dos
fondos con nombres completamente distintos pueden compartir la mitad de
sus posiciones en las mismas megacaps tecnológicas sin que se note a
simple vista. CarteraSonar automatiza ese cruce — TER, Sharpe, alfa/beta
aproximado y solapamiento sectorial — sobre el catálogo público de
MyInvestor, con una recomendación de asignación según horizonte y perfil
de riesgo.

## El endpoint público, no el conector de Claude

El punto de partida natural habría sido replicar lo que hace Claude cuando
consulta el catálogo de MyInvestor a través de su conector en claude.ai —
pero ese conector solo existe dentro de esa interfaz, no es algo a lo que
un script pueda llamar por su cuenta. La sorpresa fue descubrir, buscando
por mi cuenta, que MyInvestor expone el mismo catálogo en un servidor MCP
**público y sin autenticación** (`mcp.myinvestor.es/mcp`, protocolo
Streamable HTTP): el conector de Claude no es un acceso privilegiado, es
simplemente otro cliente más de esa misma API pública. Un script en
Python con el SDK oficial de MCP puede hablar directamente con ella, sin
ningún LLM en medio. MCP no es solo el protocolo con el que los agentes de
IA hablan con herramientas — aquí se usa como lo que es en el fondo: una
API normal, consumida por código convencional.

## Tres capas, separadas desde el primer commit

- **Scoring** (dato duro): TER, Sharpe, volatilidad, alfa/beta — derivado
  directamente del catálogo.
- **Contexto de mercado** (fiabilidad media, deliberadamente sin
  implementar todavía): valoraciones relativas, momentum — nunca como
  señal de compra/venta, solo como freno de riesgo. Existe como módulo
  vacío desde el primer día para no tener que rediseñar nada cuando se
  implemente.
- **Perfil** (reglas): horizonte × riesgo → banda de asignación objetivo,
  sin red, sin predicción.

El resultado nunca mezcla estos tres tipos de confianza en una sola cifra.
Se ve con claridad qué es cálculo, qué es contexto declarado como tal, y
qué es regla de perfil — una decisión deliberada contra la caja negra de
scoring único, en un dominio donde la falsa precisión sale cara.

## Rentabilidad anual, no series diarias

Un alfa/beta "de verdad" se calcula por regresión sobre series diarias o
mensuales. El catálogo de MyInvestor solo expone rentabilidad por año
natural — 5 o 6 puntos por fondo. La regresión sigue siendo útil como
aproximación: capta si un fondo bate o no a su categoría en años
completos. Pero hay una diferencia real entre no poder calcular algo y
poder calcularlo pero tener que decir en voz alta lo aproximado que es —
y el resultado lo etiqueta explícitamente con el número de puntos usados.

## Por qué el benchmark no se puede elegir a mano cada vez

La primera versión dejaba elegir el benchmark de alfa/beta a mano, fondo
por fondo. El problema de diseño era real: dos personas analizando el
mismo fondo con benchmarks distintos obtienen alfas distintos sin que el
resultado lo explique — rompe la reproducibilidad, que es la gracia de
automatizar esto en primer lugar. La solución fue una tabla de categoría
Morningstar a benchmark, con cada instrumento verificado contra el
catálogo real, uno a uno — un ISIN mal recordado habría sido peor que no
tener la tabla. Si la categoría de un fondo no está cubierta, el sistema
no adivina: exige un benchmark explícito. Mejor fallar de forma visible
que fallar en silencio con un número que parece preciso y no lo es.

## Otras decisiones pequeñas

- **Caché con TTL de un día**, no por rendimiento sino por
  responsabilidad: un endpoint público y gratuito es fácil de dar por
  hecho como "sin límite de uso", y ese es precisamente el tipo de
  comportamiento que acaba obligando a un servicio así a meter
  autenticación donde antes no hacía falta.
- **Sin pandas.** Con series de 5-6 puntos anuales, numpy más una
  regresión lineal de scipy cubren el caso sin añadir una dependencia
  pesada para algo que cabe en dos líneas.
- **Parseo por expresiones regulares sobre texto en español**, porque el
  conector no devuelve JSON estructurado — es el módulo más frágil de
  todo el proyecto, y está documentado como tal desde el principio.

## El hilo de fondo

En un dominio financiero, la tentación es rellenar los huecos de datos con
una heurística que "queda bien". La disciplina real está en decir
explícitamente dónde termina el dato duro y empieza la aproximación —
incluso cuando eso significa que la feature estrella del proyecto tiene un
límite que no se puede resolver con más código.

---

*[Código y README completo en GitHub](https://github.com/david-sanchezperez/carterasonar).*
