import { clasificarVecinos } from '../src/memoria.js';
import { MEMORIA } from '../src/config.js';

const HOY = '2026-07-21';

function vecino(score, fecha, link = 'https://ejemplo.test/vecino') {
  return { score, link, titulo: 'Vecino de prueba', fecha };
}

/** n días antes de `hoy` (ISO), para construir vecinos dentro/fuera de la ventana de contexto. */
function diasAntes(hoy, n) {
  const d = new Date(hoy);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

const casos = [];

casos.push([
  'Sin vecinos -> nuevo, sin vecino',
  () => clasificarVecinos([], HOY),
  { tipo: 'nuevo', vecinoScore: null },
]);

casos.push([
  'Vecino con score justo en UMBRAL_DUPLICADO (frontera inclusive) -> duplicado',
  () => clasificarVecinos([vecino(MEMORIA.UMBRAL_DUPLICADO, HOY)], HOY),
  { tipo: 'duplicado', vecinoScore: MEMORIA.UMBRAL_DUPLICADO },
]);

casos.push([
  'Vecino justo por debajo de UMBRAL_DUPLICADO pero >= UMBRAL_RELACIONADO, de hace 10 días -> relacionado',
  () => clasificarVecinos([vecino(MEMORIA.UMBRAL_DUPLICADO - 0.001, diasAntes(HOY, 10))], HOY),
  { tipo: 'relacionado', vecinoScore: MEMORIA.UMBRAL_DUPLICADO - 0.001 },
]);

casos.push([
  'Vecino con score de relacionado pero de HOY mismo -> no cuenta como relacionado (eso es candidato a duplicado, no contexto), cae a nuevo',
  () => clasificarVecinos([vecino(MEMORIA.UMBRAL_RELACIONADO, HOY)], HOY),
  { tipo: 'nuevo', vecinoScore: MEMORIA.UMBRAL_RELACIONADO },
]);

casos.push([
  'Vecino con score de relacionado pero fuera de la ventana de contexto -> cae a nuevo',
  () => clasificarVecinos([vecino(MEMORIA.UMBRAL_RELACIONADO, diasAntes(HOY, MEMORIA.VENTANA_DIAS_CONTEXTO + 1))], HOY),
  { tipo: 'nuevo', vecinoScore: MEMORIA.UMBRAL_RELACIONADO },
]);

casos.push([
  'Vecino justo en el límite de la ventana de contexto (frontera inclusive) -> relacionado',
  () => clasificarVecinos([vecino(MEMORIA.UMBRAL_RELACIONADO, diasAntes(HOY, MEMORIA.VENTANA_DIAS_CONTEXTO))], HOY),
  { tipo: 'relacionado', vecinoScore: MEMORIA.UMBRAL_RELACIONADO },
]);

casos.push([
  'Vecino con score bajo (ruido, ej. 0.4) -> nuevo, pero se conserva como "mejor" vecino',
  () => clasificarVecinos([vecino(0.4, diasAntes(HOY, 5))], HOY),
  { tipo: 'nuevo', vecinoScore: 0.4 },
]);

casos.push([
  'El mejor vecino (topK[0]) no es relacionado, pero otro de la lista sí -> se detecta igual (busca en toda la lista)',
  () =>
    clasificarVecinos(
      [vecino(0.3, diasAntes(HOY, 5)), vecino(MEMORIA.UMBRAL_RELACIONADO + 0.05, diasAntes(HOY, 5))],
      HOY
    ),
  { tipo: 'relacionado', vecinoScore: MEMORIA.UMBRAL_RELACIONADO + 0.05 },
]);

casos.push([
  'Vecino sin fecha guardada (dato incompleto) con score alto -> nunca se cuenta como relacionado, cae a nuevo',
  () => clasificarVecinos([vecino(MEMORIA.UMBRAL_RELACIONADO + 0.1, undefined)], HOY),
  { tipo: 'nuevo', vecinoScore: MEMORIA.UMBRAL_RELACIONADO + 0.1 },
]);

casos.push([
  'Duplicado tiene prioridad y corta antes de mirar el resto: el mejor vecino ya es duplicado aunque haya otro más "relacionado" después',
  () =>
    clasificarVecinos(
      [vecino(MEMORIA.UMBRAL_DUPLICADO, HOY), vecino(0.99, diasAntes(HOY, 3))],
      HOY
    ),
  { tipo: 'duplicado', vecinoScore: MEMORIA.UMBRAL_DUPLICADO },
]);

let fallos = 0;
for (const [descripcion, fn, esperado] of casos) {
  const obtenido = fn();
  const vecinoScoreObtenido = obtenido.vecino?.score ?? null;
  const ok = obtenido.tipo === esperado.tipo && vecinoScoreObtenido === esperado.vecinoScore;
  if (!ok) fallos++;
  console.log(
    `${ok ? '✓' : '✗ FALLO'}  ${descripcion}  →  obtenido={tipo:${obtenido.tipo}, vecinoScore:${vecinoScoreObtenido}} esperado={tipo:${esperado.tipo}, vecinoScore:${esperado.vecinoScore}}`
  );
}

console.log(`\n${casos.length - fallos}/${casos.length} casos correctos`);
process.exit(fallos > 0 ? 1 : 0);
