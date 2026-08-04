# Task: Añadir test unitario para renderSitemap() en worker-radar

## Description

En worker-radar/src/paginas.js existe la función renderSitemap(fechas). No tiene test. Añade worker-radar/test/sitemap.test.mjs con un test unitario que compruebe que renderSitemap(["2026-08-01"]) devuelve un string que incluye "<urlset" y "/archivo/2026-08-01". Sigue el estilo de los tests ya existentes en worker-radar/test/ (node:test + node:assert/strict). No toques ningún otro fichero.

## Acceptance Criteria

- Complete all work described in the task description
- Ensure all existing tests pass
- Follow project conventions and patterns
- Do not introduce new warnings or errors
