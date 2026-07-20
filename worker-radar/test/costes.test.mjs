import { calcularCoste, estimarTokens, fetchContado, crearContadorSubrequests } from '../src/costes.js';
import { MODELOS } from '../src/config.js';

const casos = [];

// --- calcularCoste ---
casos.push([
  'Haiku: 1000 in / 500 out',
  () => calcularCoste(MODELOS.HAIKU, 1000, 500),
  1000 * (1 / 1_000_000) + 500 * (5 / 1_000_000),
]);
casos.push([
  'Workers AI: 1000 in / 500 out',
  () => calcularCoste(MODELOS.WORKERS_AI, 1000, 500),
  1000 * (0.051 / 1_000_000) + 500 * (0.34 / 1_000_000),
]);
casos.push(['Modelo desconocido -> coste 0', () => calcularCoste('modelo-inventado', 1000, 500), 0]);
casos.push(['Cero tokens -> coste 0', () => calcularCoste(MODELOS.HAIKU, 0, 0), 0]);

// --- estimarTokens ---
casos.push(['estimarTokens: 400 caracteres -> 100 tokens', () => estimarTokens('a'.repeat(400)), 100]);
casos.push(['estimarTokens: texto vacío -> 0', () => estimarTokens(''), 0]);
casos.push(['estimarTokens: undefined -> 0', () => estimarTokens(undefined), 0]);

let fallos = 0;
for (const [descripcion, fn, esperado] of casos) {
  const obtenido = fn();
  const ok = Math.abs(obtenido - esperado) < 1e-12;
  if (!ok) fallos++;
  console.log(`${ok ? '✓' : '✗ FALLO'}  ${descripcion}  →  obtenido=${obtenido} esperado=${esperado}`);
}

// --- fetchContado: incrementa el contador ANTES de que la petición se resuelva ---
{
  const contador = crearContadorSubrequests();
  const promesa = fetchContado(contador, 'https://no-existe.invalid.espacio-latente-test/').catch(() => {});
  const ok = contador.externos === 1;
  if (!ok) fallos++;
  console.log(`${ok ? '✓' : '✗ FALLO'}  fetchContado incrementa antes de resolver  →  obtenido=${contador.externos} esperado=1`);
  await promesa;
}

console.log(`\n${casos.length + 1 - fallos}/${casos.length + 1} casos correctos`);
process.exit(fallos > 0 ? 1 : 0);
