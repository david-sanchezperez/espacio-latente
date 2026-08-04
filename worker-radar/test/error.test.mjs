/**
 * Test de `renderError`: la página de error es lo último que ve el usuario
 * cuando el pipeline revienta, así que el mensaje que se le pasa tiene que
 * llegar entero — escapado y dentro del envoltorio habitual de la página.
 * Sin este test, un `escapar` que se comiera el mensaje o un envoltorio que
 * lo perdiera pasarían inadvertidos hasta producción.
 */
import { renderError } from '../src/paginas.js';

const casos = [];
const comprobar = (descripcion, obtenido, esperado) => casos.push([descripcion, obtenido, esperado]);

const html = renderError('algo falló');

comprobar('renderError devuelve un string', typeof html, 'string');
comprobar('renderError("algo falló") incluye el mensaje recibido', html.includes('algo falló'), true);
comprobar('renderError envuelve el mensaje con el prefijo "Algo falló:"', html.includes('Algo falló:'), true);

let fallos = 0;
for (const [descripcion, obtenido, esperado] of casos) {
  const ok = obtenido === esperado;
  if (!ok) fallos++;
  console.log(`${ok ? '✓' : '✗ FALLO'}  ${descripcion}  →  obtenido=${JSON.stringify(obtenido)} esperado=${JSON.stringify(esperado)}`);
}

console.log(`\n${casos.length - fallos}/${casos.length} casos correctos`);
process.exit(fallos > 0 ? 1 : 0);
