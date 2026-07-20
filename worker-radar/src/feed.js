import { fetchContado } from './costes.js';

/**
 * Parser de RSS/Atom sin dependencias — el runtime de Workers no trae
 * DOMParser para XML arbitrario. Es un parser por regex, tolerante a CDATA
 * y namespaces; no es un parser XML completo, pero cubre los formatos
 * reales de las fuentes de este proyecto. Si una fuente nueva viene con un
 * formato raro, mejor arreglarlo aquí que tragar basura silenciosamente.
 */
export function parsearFeed(xml) {
  const bloques = xml.match(/<item\b[\s\S]*?<\/item>/gi) || xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  return bloques.map((bloque) => ({
    titulo: extraerEtiqueta(bloque, 'title'),
    link: extraerLink(bloque),
    guid: extraerEtiqueta(bloque, 'guid') || extraerEtiqueta(bloque, 'id') || extraerLink(bloque),
    fecha: extraerEtiqueta(bloque, 'pubDate') || extraerEtiqueta(bloque, 'published') || extraerEtiqueta(bloque, 'updated'),
    descripcion: extraerEtiqueta(bloque, 'description') || extraerEtiqueta(bloque, 'summary') || extraerEtiqueta(bloque, 'content'),
  }));
}

function extraerEtiqueta(bloque, etiqueta) {
  const m = bloque.match(new RegExp(`<${etiqueta}[^>]*>([\\s\\S]*?)<\\/${etiqueta}>`, 'i'));
  if (!m) return '';
  return limpiar(m[1]);
}

function extraerLink(bloque) {
  // Atom: <link href="..." /> — RSS: <link>https://...</link>
  let m = bloque.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i);
  if (m) return m[1];
  m = bloque.match(/<link[^>]*href=["']([^"']+)["']/i);
  if (m) return m[1];
  m = bloque.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
  if (m) return m[1].trim();
  return '';
}

function limpiar(texto) {
  return texto
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ') // fuera cualquier HTML embebido en la descripción
    // Entidades numéricas (ej. &#8217; el apóstrofe curvo que usa WordPress) antes
    // que las nombradas — si no, "&amp;#8217;" se queda a medio decodificar.
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&') // siempre el último: cualquier "&algo;" sin decodificar antes quedaría roto si esto va primero
    .replace(/\s+/g, ' ')
    .trim();
}

export async function obtenerItems(fuente, contador = null) {
  const res = await fetchContado(contador, fuente.url, {
    headers: { 'User-Agent': 'espacio-latente-radar/1.0 (+https://espacio-latente.com)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${fuente.url}`);
  const xml = await res.text();
  const items = parsearFeed(xml).slice(0, fuente.limite || 20);

  // Primera vuelta de una fuente nueva: sin fecha fiable, no descartamos
  // por antigüedad, el dedupe por KV ya evita repetir en las siguientes.
  const corteMs = Date.now() - 1000 * 60 * 60 * 30; // últimas ~30h
  return items.filter((item) => {
    const t = Date.parse(item.fecha);
    return Number.isNaN(t) || t >= corteMs;
  });
}
