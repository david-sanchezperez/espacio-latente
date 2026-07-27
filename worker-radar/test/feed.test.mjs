/**
 * Tests del parser de feeds (feed.js). Es un parser por regex sobre XML real
 * de terceros: el sitio donde más barato sale un test y más caro sale un
 * fallo silencioso (una entidad mal decodificada acaba publicada tal cual en
 * el digest, como ya pasó con el apóstrofe curvo de WordPress).
 */
import { parsearFeed } from '../src/feed.js';

const casos = [];

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Canal de prueba</title>
  <item>
    <title><![CDATA[Un titular con <b>HTML</b> dentro]]></title>
    <link>https://ejemplo.test/uno</link>
    <guid>https://ejemplo.test/uno</guid>
    <pubDate>Mon, 21 Jul 2026 10:00:00 GMT</pubDate>
    <description>Resumen con &#8217;apóstrofe curvo&#8217; y &amp;amp; entidad anidada.</description>
  </item>
  <item>
    <title>Segundo item</title>
    <link>https://ejemplo.test/dos</link>
    <description>&lt;p&gt;HTML escapado&lt;/p&gt; y &nbsp;espacios&nbsp;raros.</description>
  </item>
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Releases</title>
  <entry>
    <title>v5.14.0</title>
    <link rel="alternate" type="text/html" href="https://github.com/org/repo/releases/tag/v5.14.0"/>
    <id>tag:github.com,2008:Repository/1/v5.14.0</id>
    <updated>2026-07-20T08:00:00Z</updated>
    <content type="html">Notas de la release</content>
  </entry>
</feed>`;

const rss = parsearFeed(RSS);
const atom = parsearFeed(ATOM);

casos.push(['RSS: se detectan los dos items', () => rss.length, 2]);
casos.push(['RSS: CDATA desenvuelto y HTML interno fuera', () => rss[0].titulo, 'Un titular con HTML dentro']);
casos.push(['RSS: link simple', () => rss[0].link, 'https://ejemplo.test/uno']);
casos.push(['RSS: fecha tal cual, para que Date.parse la juzgue', () => rss[0].fecha, 'Mon, 21 Jul 2026 10:00:00 GMT']);
casos.push([
  'RSS: entidad numérica decodificada y &amp;amp; anidada resuelta a un solo &',
  () => rss[0].descripcion,
  'Resumen con ’apóstrofe curvo’ y &amp; entidad anidada.',
]);
casos.push([
  'RSS: HTML escapado se decodifica y luego se limpia como texto',
  () => rss[1].descripcion,
  'HTML escapado y espacios raros.',
]);
casos.push(['RSS: sin guid propio, cae al link', () => rss[1].guid, 'https://ejemplo.test/dos']);

casos.push(['Atom: se detecta la entry', () => atom.length, 1]);
casos.push([
  'Atom: link href rel=alternate, no el <id>',
  () => atom[0].link,
  'https://github.com/org/repo/releases/tag/v5.14.0',
]);
casos.push(['Atom: <updated> como fecha cuando no hay pubDate', () => atom[0].fecha, '2026-07-20T08:00:00Z']);
casos.push(['Atom: <content> como descripción cuando no hay summary', () => atom[0].descripcion, 'Notas de la release']);

casos.push(['XML sin items ni entries -> lista vacía, sin excepción', () => parsearFeed('<rss></rss>').length, 0]);
casos.push(['Basura que no es XML -> lista vacía, sin excepción', () => parsearFeed('no soy xml').length, 0]);

let fallos = 0;
for (const [descripcion, fn, esperado] of casos) {
  const obtenido = fn();
  const ok = obtenido === esperado;
  if (!ok) fallos++;
  console.log(`${ok ? '✓' : '✗ FALLO'}  ${descripcion}  →  obtenido=${JSON.stringify(obtenido)} esperado=${JSON.stringify(esperado)}`);
}

console.log(`\n${casos.length - fallos}/${casos.length} casos correctos`);
process.exit(fallos > 0 ? 1 : 0);
