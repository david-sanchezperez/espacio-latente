/**
 * Tests del embedding y la inserción POR LOTES (memoria.js). Lo que importa
 * aquí no es el modelo sino el contrato con el resto del pipeline:
 *   - los vectores vuelven ALINEADOS con los textos de entrada (index.js los
 *     empareja por índice con sus items: un desalineo publicaría el contexto
 *     histórico de otra noticia),
 *   - un fallo nunca lanza, solo produce huecos `null`,
 *   - el contador de subrequests refleja llamadas por LOTE, no por item —
 *     que es justo el ahorro por el que existe este código.
 */
import { generarEmbeddings, guardarVectores } from '../src/memoria.js';
import { MEMORIA } from '../src/config.js';
import { crearContadorSubrequests } from '../src/costes.js';

const casos = [];

/** env falso: devuelve un vector reconocible por texto, para comprobar el alineamiento. */
function envAI({ fallar = false, omitirUltimo = false } = {}) {
  const llamadas = [];
  return {
    llamadas,
    AI: {
      async run(_modelo, { text }) {
        llamadas.push(text);
        if (fallar) throw new Error('Workers AI caído (simulado)');
        const data = text.map((t) => [t.length, 0.5]);
        if (omitirUltimo) data.pop();
        return { data };
      },
    },
  };
}

// --- alineamiento y conteo ---
{
  const env = envAI();
  const contador = crearContadorSubrequests();
  const vectores = await generarEmbeddings(env, ['a', 'bb', 'ccc'], contador);
  casos.push(['3 textos -> 3 vectores', () => vectores.length, 3]);
  casos.push(['Vector alineado con su texto (índice 1)', () => vectores[1][0], 2]);
  casos.push(['Vector alineado con su texto (índice 2)', () => vectores[2][0], 3]);
  casos.push(['3 textos -> UNA sola llamada (el ahorro de subrequests)', () => env.llamadas.length, 1]);
  casos.push(['3 textos -> 1 subrequest contado', () => contador.externos, 1]);
}

// --- troceado por encima del tamaño de lote ---
{
  const env = envAI();
  const contador = crearContadorSubrequests();
  const textos = Array.from({ length: MEMORIA.EMBEDDINGS_POR_LLAMADA + 3 }, (_, i) => 'x'.repeat(i + 1));
  const vectores = await generarEmbeddings(env, textos, contador);
  casos.push(['Por encima del tamaño de lote se trocea en 2 llamadas', () => env.llamadas.length, 2]);
  casos.push(['Troceado: se devuelven todos los vectores', () => vectores.filter(Boolean).length, textos.length]);
  casos.push([
    'Troceado: el último vector sigue alineado con su texto',
    () => vectores[textos.length - 1][0],
    textos.length,
  ]);
}

// --- fallos: nunca lanzan, dejan huecos ---
{
  const env = envAI({ fallar: true });
  const contador = crearContadorSubrequests();
  const vectores = await generarEmbeddings(env, ['a', 'b'], contador);
  casos.push(['Workers AI caído -> array de nulls, sin excepción', () => vectores.join(','), ',']);
  casos.push(['Workers AI caído -> el subrequest se cuenta igual', () => contador.externos, 1]);
}
{
  const env = envAI({ omitirUltimo: true });
  const vectores = await generarEmbeddings(env, ['a', 'bb'], null);
  casos.push(['Respuesta corta -> hueco null en la posición que falta', () => vectores[1], null]);
  casos.push(['Respuesta corta -> el resto sigue alineado', () => vectores[0][0], 1]);
}
{
  const vectores = await generarEmbeddings(envAI(), [], null);
  casos.push(['Sin textos -> lista vacía, sin llamar al modelo', () => vectores.length, 0]);
}

// --- guardarVectores ---
{
  const inserciones = [];
  const env = { RADAR_VECTORIZE: { async insert(v) { inserciones.push(v); } } };
  const contador = crearContadorSubrequests();
  await guardarVectores(
    env,
    [
      { link: 'https://ejemplo.test/uno', titulo: 'Uno', fecha: '2026-07-27', vector: [1, 2] },
      { link: 'https://ejemplo.test/dos', titulo: 'Dos', fecha: '2026-07-27', vector: [3, 4] },
    ],
    contador
  );
  casos.push(['2 vectores -> UN solo insert', () => inserciones.length, 1]);
  casos.push(['2 vectores -> los dos van en el mismo insert', () => inserciones[0].length, 2]);
  casos.push(['2 vectores -> 1 subrequest contado', () => contador.externos, 1]);
  casos.push(['El id es un hash compacto del link', () => inserciones[0][0].id.length, 32]);
  casos.push(['Links distintos -> ids distintos', () => inserciones[0][0].id !== inserciones[0][1].id, true]);
  casos.push(['La metadata guarda el link real', () => inserciones[0][1].metadata.link, 'https://ejemplo.test/dos']);
}
{
  const env = { RADAR_VECTORIZE: { async insert() { throw new Error('Vectorize caído (simulado)'); } } };
  let lanzo = false;
  try {
    await guardarVectores(env, [{ link: 'https://ejemplo.test/x', titulo: 'X', fecha: '2026-07-27', vector: [1] }], null);
  } catch {
    lanzo = true;
  }
  casos.push(['Vectorize caído -> no lanza, el pipeline sigue', () => lanzo, false]);
}
{
  let llamado = false;
  const env = { RADAR_VECTORIZE: { async insert() { llamado = true; } } };
  const contador = crearContadorSubrequests();
  await guardarVectores(env, [], contador);
  casos.push(['Sin vectores -> ni insert ni subrequest', () => llamado || contador.externos > 0, false]);
}

let fallos = 0;
for (const [descripcion, fn, esperado] of casos) {
  const obtenido = fn();
  const ok = obtenido === esperado;
  if (!ok) fallos++;
  console.log(`${ok ? '✓' : '✗ FALLO'}  ${descripcion}  →  obtenido=${JSON.stringify(obtenido)} esperado=${JSON.stringify(esperado)}`);
}

console.log(`\n${casos.length - fallos}/${casos.length} casos correctos`);
process.exit(fallos > 0 ? 1 : 0);
