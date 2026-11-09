/**
 * `vecinosLocales` (memoria.js) — bug real visto en producción el 09/11: dos
 * piezas de la misma noticia en el mismo lote (misma fuente con dos entradas,
 * o dos fuentes del mismo lote cubriendo lo mismo) nunca se veían entre sí,
 * porque Vectorize solo conoce pasadas YA cerradas (`guardarVectores` inserta
 * en bloque al final de `ejecutarDigest`, no item a item). Esto compara
 * contra lo ya encolado en ESTA pasada (`vectoresPendientes` en index.js).
 */
import { vecinosLocales, clasificarVecinos } from '../src/memoria.js';
import { MEMORIA } from '../src/config.js';

const casos = [];
const comprobar = (descripcion, obtenido, esperado) => casos.push([descripcion, obtenido, esperado]);

const HOY = '2026-11-09';

// Vectores sencillos en 2D: paralelos = idénticos (coseno 1), ortogonales = sin relación (coseno 0).
const V_A = [1, 0];
const V_A_CASI_IGUAL = [0.999, 0.001]; // misma dirección, prácticamente idéntico -> coseno ~1
const V_ORTOGONAL = [0, 1];

const pendientes = [
  { link: 'https://ejemplo.test/stanford-normal', titulo: 'Stanford AI course', fecha: HOY, historiaId: null, vector: V_A },
];

// --- vector casi idéntico a uno ya encolado en este lote -> se detecta como vecino con score alto ---
{
  const vecinos = vecinosLocales(V_A_CASI_IGUAL, pendientes);
  comprobar('vecinosLocales: encuentra el pendiente', vecinos.length, 1);
  comprobar('vecinosLocales: score alto para vectores casi paralelos', vecinos[0].score > MEMORIA.UMBRAL_DUPLICADO, true);
  comprobar('vecinosLocales: conserva el link del pendiente', vecinos[0].link, 'https://ejemplo.test/stanford-normal');
}

// --- vector sin relación -> score bajo, no pasa el umbral ---
{
  const vecinos = vecinosLocales(V_ORTOGONAL, pendientes);
  comprobar('vecinosLocales: score bajo para vectores ortogonales', Math.abs(vecinos[0].score) < 0.01, true);
}

// --- sin pendientes -> sin vecinos ---
{
  const vecinos = vecinosLocales(V_A, []);
  comprobar('vecinosLocales: sin pendientes, sin vecinos', vecinos.length, 0);
}

// --- pendiente sin vector (dato incompleto) -> se ignora, no revienta ---
{
  const vecinos = vecinosLocales(V_A, [{ link: 'x', titulo: 'x', fecha: HOY, vector: null }]);
  comprobar('vecinosLocales: ignora pendientes sin vector', vecinos.length, 0);
}

// --- integración con clasificarVecinos: el duplicado intra-lote se clasifica igual que uno de Vectorize ---
{
  const vecinosVectorize = []; // Vectorize no sabe nada todavía de esta pasada
  const locales = vecinosLocales(V_A_CASI_IGUAL, pendientes);
  const combinados = [...vecinosVectorize, ...locales].sort((a, b) => b.score - a.score);
  const resultado = clasificarVecinos(combinados, HOY);
  comprobar('vecinosLocales + clasificarVecinos: duplicado intra-lote detectado', resultado.tipo, 'duplicado');
  comprobar('vecinosLocales + clasificarVecinos: apunta al item correcto para fusionar', resultado.vecino.link, 'https://ejemplo.test/stanford-normal');
}

let fallos = 0;
for (const [descripcion, obtenido, esperado] of casos) {
  const ok = obtenido === esperado;
  if (!ok) fallos++;
  console.log(`${ok ? '✓' : '✗ FALLO'}  ${descripcion}  →  obtenido=${JSON.stringify(obtenido)} esperado=${JSON.stringify(esperado)}`);
}

console.log(`\n${casos.length - fallos}/${casos.length} casos correctos`);
process.exit(fallos > 0 ? 1 : 0);
