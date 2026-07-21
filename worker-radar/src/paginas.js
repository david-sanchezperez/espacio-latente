const ESTILO = `
  :root {
    --grafito: #12151a; --panel: #1a1f26; --panel-alt: #171c24;
    --borde: #2c333d; --hueso: #e9e5da; --acero: #8a97a5; --ambar: #ffb454;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--grafito); color: var(--hueso);
    font-family: 'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif;
    font-size: 1.0625rem; line-height: 1.65;
  }
  .contenedor { max-width: 760px; margin: 0 auto; padding: 0 1.25rem; }
  a { color: var(--ambar); text-decoration: none; }
  a:hover { text-decoration: underline; }
  header { padding: 2.5rem 0 1.5rem; border-bottom: 1px solid var(--borde); margin-bottom: 2rem; }
  .marca { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 0.8rem; color: var(--acero); }
  h1 { font-family: 'Archivo', sans-serif; font-weight: 800; font-size: clamp(1.8rem, 5vw, 2.6rem); margin: 0.5rem 0; }
  .nota { color: var(--acero); font-size: 0.92rem; max-width: 60ch; }
  .seccion { padding-bottom: 3rem; }
  .seccion h2 {
    font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 0.85rem;
    text-transform: uppercase; letter-spacing: 0.08em; color: var(--acero);
    border-bottom: 1px solid var(--borde); padding-bottom: 0.6rem; margin-bottom: 1rem;
  }
  .pieza {
    background: var(--panel); border: 1px solid var(--borde);
    border-top: none; padding: 1.1rem 1.25rem;
  }
  .pieza:first-of-type { border-top: 1px solid var(--borde); }
  .pieza .fuente {
    font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 0.72rem;
    text-transform: uppercase; letter-spacing: 0.06em; color: var(--ambar);
  }
  .pieza h3 { font-size: 1.05rem; font-weight: 600; margin: 0.3rem 0 0.4rem; }
  .pieza h3 a { color: var(--hueso); }
  .pieza h3 a:hover { color: var(--ambar); }
  .pieza p { color: var(--acero); font-size: 0.92rem; }
  .pieza .contexto { font-size: 0.82rem; font-style: italic; margin-top: 0.5rem; }
  .vacio { color: var(--acero); font-style: italic; padding: 1rem 0; }
  footer { border-top: 1px solid var(--borde); padding: 2rem 0; font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 0.8rem; color: var(--acero); }
  .archivo-lista { list-style: none; }
  .archivo-lista li { border-bottom: 1px solid var(--borde); padding: 0.7rem 0; font-family: 'IBM Plex Mono', ui-monospace, monospace; }
`;

function envoltorio(titulo, cuerpo) {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${titulo} — Radar · Espacio Latente</title>
  <link rel="alternate" type="application/atom+xml" title="El radar — Espacio Latente" href="/feed.xml" />
  <style>${ESTILO}</style>
</head>
<body>
  <div class="contenedor">
    <header>
      <p class="marca">// espacio-latente.com / radar</p>
      <h1>El radar</h1>
      <p class="nota">
        Píldora diaria de lo que se mueve en IA: laboratorios, papers, blogs de referencia
        y releases relevantes, resumido y con link al original. Se actualiza dos veces al día.
        · <a href="https://espacio-latente.com/">← volver a espacio-latente.com</a>
        · <a href="/archivo">archivo</a>
        · <a href="/feed.xml">RSS</a>
      </p>
    </header>
    ${cuerpo}
    <footer>ESPACIO LATENTE / RADAR — generado automáticamente, revisa siempre el original antes de citarlo.</footer>
  </div>
</body>
</html>`;
}

function renderPieza(item) {
  const fuentes = [item.fuente, ...(item.fuentesAdicionales || [])].join(' · ');
  const contexto = item.contexto
    ? `<p class="contexto">↳ Contexto: <a href="${escapar(item.contexto.link)}" target="_blank" rel="noopener noreferrer">${escapar(item.contexto.titulo)}</a></p>`
    : '';
  return `<article class="pieza">
    <span class="fuente">${escapar(fuentes)}</span>
    <h3><a href="${escapar(item.link)}" target="_blank" rel="noopener noreferrer">${escapar(item.titulo)}</a></h3>
    <p>${escapar(item.resumen)}</p>
    ${contexto}
  </article>`;
}

function renderSeccion(titulo, items) {
  const cuerpo = items.length
    ? items.map(renderPieza).join('')
    : '<p class="vacio">Nada nuevo en este tramo.</p>';
  return `<section class="seccion"><h2>${escapar(titulo)}</h2>${cuerpo}</section>`;
}

export function renderDigest({ hoy, ayer, itemsHoy, itemsAyer, soloUnDia }) {
  const cuerpo = soloUnDia
    ? renderSeccion(hoy, itemsHoy)
    : renderSeccion(`Hoy · ${hoy}`, itemsHoy) + renderSeccion(`Ayer · ${ayer}`, itemsAyer);
  return envoltorio(soloUnDia ? hoy : 'Hoy', cuerpo);
}

export function renderArchivoIndice(fechas) {
  const cuerpo = fechas.length
    ? `<section class="seccion"><h2>Archivo</h2><ul class="archivo-lista">${fechas
        .map((f) => `<li><a href="/archivo/${f}">${f}</a></li>`)
        .join('')}</ul></section>`
    : '<section class="seccion"><p class="vacio">Todavía no hay archivo.</p></section>';
  return envoltorio('Archivo', cuerpo);
}

export function renderError(mensaje) {
  return envoltorio('Error', `<section class="seccion"><p class="vacio">Algo falló: ${escapar(mensaje)}</p></section>`);
}

/**
 * Atom feed (RFC 4287) con lo mismo que se ve en la home (hoy + ayer).
 * Entradas ordenadas por fecha descendente; si una pieza antigua no tiene
 * `fecha` guardada (formato previo a este cambio), cae al final.
 */
export function renderFeedAtom({ origen, items }) {
  const ordenados = [...items].sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0));
  const actualizado = ordenados[0]?.fecha || new Date().toISOString();

  const entradas = ordenados
    .map(
      (item) => `  <entry>
    <title>${escaparXml(item.titulo)}</title>
    <link href="${escaparXml(item.link)}" />
    <id>${escaparXml(item.link)}</id>
    <updated>${new Date(item.fecha || Date.now()).toISOString()}</updated>
    <author><name>${escaparXml([item.fuente, ...(item.fuentesAdicionales || [])].join(' · '))}</name></author>
    <summary>${escaparXml(item.resumen)}${item.contexto ? ` (Contexto: ${escaparXml(item.contexto.titulo)} — ${escaparXml(item.contexto.link)})` : ''}</summary>
  </entry>`
    )
    .join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>El radar — Espacio Latente</title>
  <subtitle>Píldora diaria de IA: laboratorios, papers, blogs de referencia y releases relevantes.</subtitle>
  <link href="${origen}/feed.xml" rel="self" />
  <link href="${origen}/" />
  <id>${origen}/</id>
  <updated>${new Date(actualizado).toISOString()}</updated>
${entradas}
</feed>`;
}

function escaparXml(texto) {
  return String(texto || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapar(texto) {
  return String(texto || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
