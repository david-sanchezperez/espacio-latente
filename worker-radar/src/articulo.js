import { fetchContado } from './costes.js';

/**
 * Extracción de texto de artículo completo, para cuando el snippet del RSS
 * se queda corto para un resumen de calidad. Sin DOM parser (el runtime de
 * Workers no trae uno para HTML arbitrario) — heurística: nos quedamos con
 * el contenido de las etiquetas <p>, que en la inmensa mayoría de sitios de
 * noticias es donde vive el cuerpo del artículo, y descartamos párrafos muy
 * cortos (suelen ser migas de nav/menú, no contenido real).
 *
 * Puede fallar por muchos motivos legítimos (paywall, bloqueo de bots, sitio
 * que renderiza con JS, tipo de contenido no-HTML como los PDF de arXiv) —
 * en cualquiera de esos casos devuelve null y quien llama cae al snippet
 * del RSS. Nunca debe tirar abajo el pipeline por un artículo que no se
 * pudo leer.
 */

const LONGITUD_MAXIMA = 8000; // ~2000 tokens, suficiente para un resumen de calidad
const LONGITUD_MINIMA_PARRAFO = 40; // por debajo de esto, suele ser nav/menú, no contenido

export async function obtenerTextoArticulo(url, contador = null) {
  try {
    const res = await fetchContado(contador, url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; espacio-latente-radar/1.0; +https://espacio-latente.com)',
        Accept: 'text/html',
      },
      redirect: 'follow',
    });
    if (!res.ok) return null;

    const tipoContenido = res.headers.get('content-type') || '';
    if (!tipoContenido.includes('html')) return null; // PDFs de arXiv, etc. — no lo intentamos

    const html = await res.text();
    const vistos = new Set();
    const parrafos = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
      .filter((m) => densidadDeEnlaces(m[1]) < 0.5) // fuera párrafos de nav/menú (casi todo <a>)
      .map((m) => limpiarParrafo(m[1]))
      .filter((p) => p.length >= LONGITUD_MINIMA_PARRAFO)
      .filter((p) => !parecePlantilla(p))
      .filter((p) => {
        // fuera duplicados exactos — un menú/dropdown repetido (desktop+mobile) es la señal
        // más fiable de que no es contenido real, ni el heurístico de enlaces lo detectó.
        if (vistos.has(p)) return false;
        vistos.add(p);
        return true;
      });

    if (parrafos.length === 0) return null;

    const texto = parrafos.join('\n\n').slice(0, LONGITUD_MAXIMA);
    return texto || null;
  } catch (err) {
    console.error(`[radar] fallo leyendo artículo completo de ${url}: ${err.message}`);
    return null;
  }
}

/** Ratio de texto que vive dentro de <a> respecto al total del párrafo — alto en nav/menús. */
function densidadDeEnlaces(html) {
  const textoTotal = quitarTags(html).length;
  if (textoTotal === 0) return 1; // vacío de texto real: fuera
  const textoEnlaces = [...html.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi)].reduce(
    (acc, m) => acc + quitarTags(m[1]).length,
    0
  );
  return textoEnlaces / textoTotal;
}

function quitarTags(html) {
  return html.replace(/<[^>]+>/g, '').trim();
}

// Frases de plantilla habituales en cabeceras/menús/pies que a veces no van
// envueltas en <a> (ej. <select> de secciones, avisos de cookies) y por eso
// se escapan del filtro de densidad de enlaces.
const PATRON_PLANTILLA = /^(sign in|subscribe|search|skip to|cookie|menu|sections?\b|log in|newsletter)\b/i;

function parecePlantilla(texto) {
  return PATRON_PLANTILLA.test(texto.trim());
}

function limpiarParrafo(html) {
  return html
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
