import { renderSitemap } from '../src/paginas.js';

const casos = [];

const salida = renderSitemap(['2026-08-01']);

casos.push(['renderSitemap devuelve un string', () => typeof salida === 'string', true]);
casos.push(['el sitemap incluye <urlset', () => salida.includes('<urlset'), true]);
casos.push(['el sitemap incluye la URL del archivo del día', () => salida.includes('/archivo/2026-08-01'), true]);

let fallos = 0;
for (const [descripcion, fn, esperado] of casos) {
  const obtenido = fn();
  const ok = obtenido === esperado;
  if (!ok) fallos++;
  console.log(`${ok ? '✓' : '✗ FALLO'}  ${descripcion}  →  obtenido=${JSON.stringify(obtenido)} esperado=${JSON.stringify(esperado)}`);
}

console.log(`\n${casos.length - fallos}/${casos.length} casos correctos`);
process.exit(fallos > 0 ? 1 : 0);
