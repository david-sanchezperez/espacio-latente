/**
 * Test de `renderSitemap` (paginas.js). El sitemap es lo único que enumera
 * cada día de archivo que existe en KV: si perdiera la etiqueta `<urlset>` o
 * una fecha, los buscadores dejarían de indexar ese día sin avisar.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSitemap } from '../src/paginas.js';

test('renderSitemap devuelve un <urlset> con la URL de cada fecha de archivo', () => {
  const salida = renderSitemap(['2026-08-01']);

  assert.equal(typeof salida, 'string');
  assert.ok(salida.includes('<urlset'), 'debe incluir la etiqueta <urlset');
  assert.ok(salida.includes('/archivo/2026-08-01'), 'debe incluir la URL /archivo/2026-08-01');
});
