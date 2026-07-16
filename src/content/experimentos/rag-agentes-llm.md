---
titulo: "RAG, agentes y LLM: cómo interactúa todo con todo"
resumen: "Las tres piezas del puzle explicadas con código: el modelo, la memoria externa y el bucle que decide."
estado: archivado
unidad: "U-06"
fecha: 2026-07-13
---

## Las tres piezas, por separado

Antes de mezclarlas conviene tener claro qué hace cada una, porque se
confunden a menudo:

- **LLM (modelo de lenguaje)**: predice texto. No sabe nada que no
  aprendiera en su entrenamiento, y no tiene memoria entre llamadas. Es el
  motor de razonamiento, no la base de datos.
- **RAG (Retrieval-Augmented Generation)**: la técnica de buscar información
  relevante *fuera* del modelo (en documentos, una base vectorial, etc.) y
  metérsela en el prompt antes de preguntar. Le da al modelo memoria
  externa, actualizable, sin reentrenarlo.
- **Agente**: un LLM al que se le da la capacidad de decidir y ejecutar
  acciones —llamar herramientas, consultar RAG, repetir el proceso— en
  lugar de responder de un solo tirón.

## Pieza 1: un LLM a pelo

```python
respuesta = llm.generar(
    prompt="¿Cuál es la política de vacaciones de mi empresa?"
)
# El modelo inventa una respuesta plausible, porque no tiene ese dato.
```

Sin más contexto, el modelo alucina. No es un fallo moral, es lo esperable:
se le pide un dato que no está en su entrenamiento.

## Pieza 2: añadiendo RAG

La idea de RAG es simple: antes de preguntar al modelo, buscamos los
fragmentos de texto más relevantes en nuestros propios documentos y se los
damos como contexto.

```python
# 1. Convertimos la pregunta en un vector (embedding)
vector_pregunta = embeddings.generar("política de vacaciones")

# 2. Buscamos los fragmentos más parecidos en la base vectorial
fragmentos = base_vectorial.buscar(vector_pregunta, top_k=3)

# 3. Construimos un prompt con esos fragmentos como contexto
contexto = "\n---\n".join(f.texto for f in fragmentos)
prompt = f"""Usa solo este contexto para responder:
{contexto}

Pregunta: ¿Cuál es la política de vacaciones de mi empresa?"""

respuesta = llm.generar(prompt)
# Ahora responde con datos reales de tu documentación, no con una invención.
```

El modelo sigue sin "saber" nada de forma permanente: cada llamada es
independiente. RAG no le da memoria al modelo, le da memoria al *sistema*
que lo rodea.

## Pieza 3: convirtiéndolo en agente

Un agente añade un bucle de decisión: el modelo elige qué hacer, no solo
qué responder. Aquí es donde entran las herramientas (RAG puede ser una
más).

```python
herramientas = {
    "buscar_documentos": lambda q: base_vectorial.buscar(embeddings.generar(q)),
    "consultar_calendario": lambda fecha: calendario.eventos(fecha),
}

mensajes = [{"rol": "usuario", "texto": "¿Puedo coger vacaciones la semana que viene?"}]

while True:
    respuesta = llm.generar(mensajes, herramientas_disponibles=herramientas.keys())

    if respuesta.tipo == "usar_herramienta":
        resultado = herramientas[respuesta.herramienta](respuesta.parametros)
        mensajes.append({"rol": "herramienta", "texto": resultado})
        continue  # el modelo vuelve a pensar con el nuevo dato

    if respuesta.tipo == "respuesta_final":
        print(respuesta.texto)
        break
```

En este ejemplo el agente puede encadenar dos herramientas por sí solo:
primero mira la política de vacaciones (RAG), luego comprueba el
calendario, y solo entonces responde. El humano no programó ese orden a
mano — lo decide el modelo en cada paso.

## Cómo interactúa todo con todo

```
usuario
  │
  ▼
┌─────────────────────────────────────────┐
│                  AGENTE                 │
│   (bucle: pensar → actuar → observar)    │
└───────┬───────────────────────┬─────────┘
        │                       │
        ▼                       ▼
   ┌─────────┐            ┌───────────┐
   │   RAG   │            │  OTRAS    │
   │ (busca  │            │HERRAMIENTAS│
   │ contexto)│            │(calendario,│
   └────┬────┘            │ MCP, etc.) │
        │                 └─────┬─────┘
        ▼                       ▼
   base vectorial         sistemas externos
        │                       │
        └───────────┬───────────┘
                     ▼
                    LLM
           (razona con todo el
            contexto reunido)
```

El LLM nunca deja de ser el mismo componente —predice texto—, pero lo que
cambia es *cuánto contexto de calidad* le llega antes de responder. RAG es
una forma de conseguir ese contexto; el bucle de agente es lo que decide,
paso a paso, qué contexto hace falta y de dónde sacarlo.

## Un error común al mezclarlas

Meter RAG *dentro* de cada paso del agente sin criterio dispara el coste:
si el agente hace 5 llamadas al modelo para resolver una tarea, y cada una
relanza una búsqueda vectorial completa, estás pagando cinco búsquedas
cuando probablemente con una al principio bastaba. Merece la pena decidir
explícitamente si el RAG es *una herramienta más* que el agente invoca
cuando lo necesita, o si es un paso fijo *antes* de que el agente empiece
a razonar.

## Notas de campo

*(Aquí es donde documento mis pruebas reales: qué tamaño de fragmento
(chunk) me ha funcionado mejor, cuántas herramientas es razonable dejar
sueltas antes de que el agente empiece a "dudar" entre ellas, coste medio
por consulta...)*
