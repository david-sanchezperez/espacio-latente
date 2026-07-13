---
titulo: "Loop prompting: iterar hasta converger"
resumen: "Cuándo compensa que el modelo critique y reescriba su propia salida."
estado: pruebas
unidad: "U-03"
fecha: 2026-07-11
---

## La idea

En lugar de pedir la respuesta perfecta en un solo turno, se monta un bucle:
generar → criticar → corregir → repetir hasta cumplir un criterio de parada.

## Esqueleto del bucle

```python
respuesta = generar(prompt)
for _ in range(max_iteraciones):
    critica = criticar(respuesta, criterios)
    if critica.aprobada:
        break
    respuesta = corregir(respuesta, critica)
```

## Notas de campo

*(Documenta aquí tus pruebas: cuántas iteraciones suelen bastar, cuándo el
bucle degrada la respuesta en vez de mejorarla, coste en tokens...)*
