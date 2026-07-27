/**
 * Tests de `ejecutarDigest` de punta a punta con un `env` falso (KV, D1,
 * Workers AI, Vectorize) y `fetch` interceptado. No prueba modelos ni red:
 * prueba las decisiones del pipeline, que es donde han estado los fallos
 * reales — una fusión que no llegaba a KV, o una pieza descartada que se
 * volvía a pagar en la siguiente pasada.
 */
import { ejecutarDigest } from '../src/index.js';

const HOY = new Date().toISOString().slice(0, 10);
const FUENTE_A = { nombre: 'Fuente A', url: 'https://ejemplo.test/a.xml', tipo: 'feed' };
const FUENTE_B = { nombre: 'Fuente B', url: 'https://ejemplo.test/b.xml', tipo: 'feed' };

function rss(items) {
  const ahora = new Date().toUTCString();
  return `<?xml version="1.0"?><rss><channel>${items
    .map(
      (it) =>
        `<item><title>${it.titulo}</title><link>${it.link}</link><pubDate>${ahora}</pubDate>` +
        `<description>${it.descripcion || 'Cuerpo de la noticia.'}</description></item>`
    )
    .join('')}</channel></rss>`;
}

/**
 * `env` falso. `feeds` mapea url -> items; `vecinos` decide qué devuelve
 * Vectorize; `relevancia` decide qué contesta Haiku para cada link.
 */
function crearEntorno({ feeds = {}, vecinos = () => [], relevancia = () => 5, kv = {} } = {}) {
  const almacen = new Map(Object.entries(kv));
  const registro = { haiku: 0, embeddings: 0, consultas: 0, inserciones: 0, filasD1: [] };

  globalThis.fetch = async (url, opciones) => {
    if (String(url).includes('api.anthropic.com')) {
      registro.haiku++;
      // El prompt real lleva "Fuente: X\n\nTítulo\n\ncuerpo": basta para que
      // el test decida una relevancia distinta por pieza si le hace falta.
      const nota = relevancia(JSON.parse(opciones.body).messages[0].content);
      return {
        ok: true,
        async json() {
          return {
            content: [{ type: 'text', text: `RELEVANCIA: ${nota}\nRESUMEN: Resumen de prueba.` }],
            usage: { input_tokens: 10, output_tokens: 5 },
          };
        },
      };
    }
    const items = feeds[String(url)];
    if (!items) return { ok: false, status: 404, async text() { return ''; } };
    return { ok: true, status: 200, async text() { return rss(items); } };
  };

  const env = {
    ANTHROPIC_API_KEY: 'clave-de-prueba',
    RADAR_KV: {
      async get(clave) {
        return almacen.has(clave) ? almacen.get(clave) : null;
      },
      async put(clave, valor) {
        almacen.set(clave, valor);
      },
    },
    RADAR_DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              async run() {
                registro.filasD1.push({ sql, args });
              },
            };
          },
        };
      },
    },
    AI: {
      async run(_modelo, { text }) {
        registro.embeddings++;
        return { data: text.map(() => [0.1, 0.2]) };
      },
    },
    RADAR_VECTORIZE: {
      async query() {
        registro.consultas++;
        return { matches: vecinos() };
      },
      async insert(vectores) {
        registro.inserciones += vectores.length;
      },
    },
  };

  return { env, almacen, registro };
}

const casos = [];
const comprobar = (descripcion, obtenido, esperado) => casos.push([descripcion, obtenido, esperado]);

// --- 1. Camino normal: dos piezas nuevas se publican y se vectorizan ---
{
  const { env, almacen, registro } = crearEntorno({
    feeds: {
      'https://ejemplo.test/a.xml': [
        { titulo: 'Noticia uno', link: 'https://ejemplo.test/1' },
        { titulo: 'Noticia dos', link: 'https://ejemplo.test/2' },
      ],
    },
  });
  const res = await ejecutarDigest(env, [FUENTE_A], `${HOY}-test`);
  const guardados = JSON.parse(almacen.get(`radar:items:${HOY}`));

  comprobar('Camino normal: 2 piezas publicadas', res.totalNuevos, 2);
  comprobar('Camino normal: 2 piezas en KV', guardados.length, 2);
  comprobar('Camino normal: se guarda la relevancia devuelta', guardados[0].relevancia, 5);
  comprobar('Camino normal: UNA llamada de embeddings para las 2 piezas', registro.embeddings, 1);
  comprobar('Camino normal: UNA inserción con los 2 vectores', registro.inserciones, 2);
  comprobar('Camino normal: no se corta por presupuesto', res.cortadoPorPresupuesto, false);
}

// --- 2. Fusión sobre una pieza YA en KV sin nada nuevo que publicar ---
// Es el caso que se perdía: `nuevos` vacío, así que el KV no se reescribía y
// la fuente adicional nunca llegaba a verse en la página.
{
  const yaPublicado = [
    { titulo: 'Lanzamiento gordo', resumen: 'Resumen previo.', link: 'https://ejemplo.test/original', fuente: 'Fuente A', fecha: `${HOY}T08:00:00.000Z`, relevancia: 5 },
  ];
  const { env, almacen, registro } = crearEntorno({
    kv: { [`radar:items:${HOY}`]: JSON.stringify(yaPublicado) },
    feeds: {
      'https://ejemplo.test/b.xml': [{ titulo: 'Lanzamiento gordo, contado por otro medio', link: 'https://ejemplo.test/copia' }],
    },
    vecinos: () => [{ score: 0.97, metadata: { link: 'https://ejemplo.test/original', titulo: 'Lanzamiento gordo', fecha: `${HOY}T08:00:00.000Z` } }],
  });
  const res = await ejecutarDigest(env, [FUENTE_B], `${HOY}-test`);
  const guardados = JSON.parse(almacen.get(`radar:items:${HOY}`));

  comprobar('Fusión: no se publica una pieza nueva', res.totalNuevos, 0);
  comprobar('Fusión: el día sigue teniendo una sola pieza', guardados.length, 1);
  comprobar('Fusión: la fuente adicional SÍ queda persistida en KV', (guardados[0].fuentesAdicionales || []).join(','), 'Fuente B');
  comprobar('Fusión: no se gasta Haiku en la copia', registro.haiku, 0);
}

// --- 3. Fusión repetida: no duplica la fuente ni reescribe de más ---
{
  const yaPublicado = [
    { titulo: 'Lanzamiento gordo', resumen: 'Resumen previo.', link: 'https://ejemplo.test/original', fuente: 'Fuente A', fuentesAdicionales: ['Fuente B'], fecha: `${HOY}T08:00:00.000Z`, relevancia: 5 },
  ];
  const { env, almacen } = crearEntorno({
    kv: { [`radar:items:${HOY}`]: JSON.stringify(yaPublicado) },
    feeds: { 'https://ejemplo.test/b.xml': [{ titulo: 'Otra copia más', link: 'https://ejemplo.test/copia-2' }] },
    vecinos: () => [{ score: 0.97, metadata: { link: 'https://ejemplo.test/original', titulo: 'Lanzamiento gordo', fecha: `${HOY}T08:00:00.000Z` } }],
  });
  await ejecutarDigest(env, [FUENTE_B], `${HOY}-test`);
  const guardados = JSON.parse(almacen.get(`radar:items:${HOY}`));
  comprobar('Fusión repetida: la fuente no se duplica', (guardados[0].fuentesAdicionales || []).join(','), 'Fuente B');
}

// --- 4. Descartado por baja relevancia: se anota y no se vuelve a pagar ---
{
  const { env, almacen, registro } = crearEntorno({
    feeds: { 'https://ejemplo.test/a.xml': [{ titulo: 'Nada relevante', link: 'https://ejemplo.test/ruido' }] },
    relevancia: () => 1,
  });
  const res = await ejecutarDigest(env, [FUENTE_A], `${HOY}-test`);
  const descartados = JSON.parse(almacen.get(`radar:descartados:${HOY}`) || '[]');

  comprobar('Descarte: no se publica', res.totalNuevos, 0);
  comprobar('Descarte: no se escribe el día en KV', almacen.has(`radar:items:${HOY}`), false);
  comprobar('Descarte: el link queda anotado', descartados.join(','), 'https://ejemplo.test/ruido');
  comprobar('Descarte: se gastó una llamada a Haiku', registro.haiku, 1);

  // Segunda pasada sobre el mismo feed: ya no debe volver a evaluarlo.
  const antes = registro.haiku;
  await ejecutarDigest(env, [FUENTE_A], `${HOY}-test-2`);
  comprobar('Descarte: la segunda pasada NO vuelve a llamar a Haiku', registro.haiku - antes, 0);
  comprobar('Descarte: la segunda pasada tampoco embebe nada', registro.embeddings, 1);
}

// --- 5. Contexto histórico: un vecino relacionado de días atrás ---
{
  const haceDiezDias = new Date(Date.now() - 10 * 86400000).toISOString();
  const { env, almacen } = crearEntorno({
    feeds: { 'https://ejemplo.test/a.xml': [{ titulo: 'Segunda parte de la historia', link: 'https://ejemplo.test/nueva' }] },
    vecinos: () => [{ score: 0.72, metadata: { link: 'https://ejemplo.test/vieja', titulo: 'Primera parte', fecha: haceDiezDias } }],
  });
  await ejecutarDigest(env, [FUENTE_A], `${HOY}-test`);
  const guardados = JSON.parse(almacen.get(`radar:items:${HOY}`));
  comprobar('Contexto: se publica con enlace al artículo relacionado', guardados[0].contexto?.link, 'https://ejemplo.test/vieja');
  comprobar('Contexto: el título del contexto viene del dato real, no del modelo', guardados[0].contexto?.titulo, 'Primera parte');
}

// --- 6. Fuente caída: no tumba la pasada, queda registrada ---
{
  const { env, registro } = crearEntorno({ feeds: {} });
  const res = await ejecutarDigest(env, [FUENTE_A], `${HOY}-test`);
  comprobar('Fuente caída: se registra el error', Object.keys(res.errores).join(','), 'Fuente A');
  comprobar('Fuente caída: no se llama a Haiku', registro.haiku, 0);
}

let fallos = 0;
for (const [descripcion, obtenido, esperado] of casos) {
  const ok = obtenido === esperado;
  if (!ok) fallos++;
  console.log(`${ok ? '✓' : '✗ FALLO'}  ${descripcion}  →  obtenido=${JSON.stringify(obtenido)} esperado=${JSON.stringify(esperado)}`);
}

console.log(`\n${casos.length - fallos}/${casos.length} casos correctos`);
process.exit(fallos > 0 ? 1 : 0);
