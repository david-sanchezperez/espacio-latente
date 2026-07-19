import { obtenerTextoArticulo } from '../src/articulo.js';

const urls = [
  'https://simonwillison.net/2026/Jul/18/sqlite-query-explainer/',
  'https://arstechnica.com/ai/2026/07/will-ai-fix-prior-authorization-or-make-it-worse/',
  'https://magazine.sebastianraschka.com/p/controlling-reasoning-effort-in-llms',
];

for (const url of urls) {
  const texto = await obtenerTextoArticulo(url);
  console.log(`\n=== ${url} ===`);
  if (!texto) {
    console.log('(null — falló la extracción, caería al snippet)');
  } else {
    console.log(`${texto.length} caracteres extraídos`);
    console.log(texto.slice(0, 400) + '...');
  }
}
