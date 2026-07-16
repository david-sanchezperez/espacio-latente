---
titulo: "Cómo interactúa un agente con un servidor MCP"
resumen: "Anatomía de una llamada: del prompt a la herramienta y de vuelta."
estado: archivado
unidad: "U-02"
fecha: 2026-07-11
---

## El problema

Un modelo de lenguaje por sí solo no puede tocar tu calendario, tu base de
datos ni tu sistema de ficheros. El Model Context Protocol (MCP) define un
contrato estándar para que un agente descubra y use herramientas externas.

## El flujo, paso a paso

1. El cliente (Claude, por ejemplo) se conecta al servidor MCP y pide la
   lista de herramientas disponibles.
2. El modelo recibe esas herramientas como parte de su contexto.
3. Cuando el usuario pide algo que requiere una herramienta, el modelo emite
   un `tool_use` con los parámetros.
4. El servidor ejecuta la acción real y devuelve un `tool_result`.
5. El modelo integra el resultado y responde en lenguaje natural.

```json
{
  "type": "tool_use",
  "name": "buscar_eventos",
  "input": { "rango": "esta semana" }
}
```

## Lo que aprendí

*(Escribe aquí tus notas reales: latencias, errores de esquema, cómo afecta
el orden de las herramientas al comportamiento del agente...)*
