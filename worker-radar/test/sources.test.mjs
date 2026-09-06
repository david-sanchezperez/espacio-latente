/**
 * Prioridad de clase por fuente (Fase 4, ver DEVLOG.md) — decide qué fuente
 * queda como principal cuando varias cubren la misma noticia, tanto en
 * caliente (index.js) como en el backfill retroactivo.
 */
import { prioridadClase, elegirFuentePrincipal } from '../src/sources.js';

const casos = [
  ['Primaria pesa más que comunidad', prioridadClase('OpenAI News') < prioridadClase('Hacker News'), true],
  ['Experta pesa más que media', prioridadClase('Simon Willison') < prioridadClase('The Verge · IA'), true],
  ['Media pesa más que comunidad', prioridadClase('TechCrunch · IA') < prioridadClase('Hacker News'), true],
  ['Fuente desconocida cae al final, peor que comunidad', prioridadClase('Fuente Inventada') > prioridadClase('Hacker News'), true],
  ['elegirFuentePrincipal: primaria gana entre varias', elegirFuentePrincipal(['Hacker News', 'The Verge · IA', 'OpenAI News']), 'OpenAI News'],
  ['elegirFuentePrincipal: única opción se devuelve tal cual', elegirFuentePrincipal(['Hacker News']), 'Hacker News'],
  ['elegirFuentePrincipal: entre dos expertas, se queda con la primera (empate estable)', elegirFuentePrincipal(['Simon Willison', 'Sebastian Raschka']), 'Simon Willison'],
];

let fallos = 0;
for (const [descripcion, obtenido, esperado] of casos) {
  const ok = obtenido === esperado;
  if (!ok) fallos++;
  console.log(`${ok ? '✓' : '✗ FALLO'}  ${descripcion}  →  obtenido=${JSON.stringify(obtenido)} esperado=${JSON.stringify(esperado)}`);
}

console.log(`\n${casos.length - fallos}/${casos.length} casos correctos`);
process.exit(fallos > 0 ? 1 : 0);
