/**
 * pareceTruncado/generarImporta/generarPanorama: el bug real visto en
 * producción (ver DEVLOG.md) era un corte a mitad de frase por falta de
 * tokens — IMPORTA compartía presupuesto con RESUMEN en una sola respuesta,
 * y el panorama diario tenía su propio tope fijo sin red de seguridad.
 * Ambos ahora reintentan una vez con más presupuesto antes de rendirse, y
 * `pareceTruncado` es la señal compartida para detectarlo.
 */
import { generarImporta, generarPanorama, pareceTruncado } from '../src/resumen.js';

const casos = [];
const comprobar = (descripcion, obtenido, esperado) => casos.push([descripcion, obtenido, esperado]);

// --- pareceTruncado ---
comprobar(
  'pareceTruncado: texto cortado a media palabra, sin puntuación de cierre',
  pareceTruncado('cambia la forma de servir modelos en producc'),
  true
);
comprobar('pareceTruncado: frase completa termina en punto', pareceTruncado('Cambia la forma de servir modelos.'), false);
comprobar('pareceTruncado: frase completa termina en cierre de interrogación', pareceTruncado('¿Y si no hiciera falta?'), false);
comprobar('pareceTruncado: cadena vacía no se considera truncada', pareceTruncado(''), false);
comprobar('pareceTruncado: null no se considera truncado', pareceTruncado(null), false);

/** env falso para llamarHaiku: devuelve una respuesta distinta por llamada, en orden. */
function envHaikuConRespuestas(respuestas) {
  let llamada = 0;
  const registro = { llamadas: 0, maxTokensVistos: [] };
  globalThis.fetch = async (_url, opciones) => {
    registro.llamadas++;
    registro.maxTokensVistos.push(JSON.parse(opciones.body).max_tokens);
    const texto = respuestas[Math.min(llamada, respuestas.length - 1)];
    llamada++;
    return {
      ok: true,
      async json() {
        return { content: [{ type: 'text', text: texto }], usage: { input_tokens: 10, output_tokens: 5 } };
      },
    };
  };
  const env = {
    ANTHROPIC_API_KEY: 'clave-de-prueba',
    RADAR_DB: { prepare: () => ({ bind: () => ({ async run() {} }) }) },
  };
  return { env, registro };
}

const ITEM = { titulo: 'Prueba', resumen: 'Resumen de prueba.', link: 'https://ejemplo.test/1', fuente: 'Fuente' };

// --- generarImporta: primer intento ya completo, no hace falta reintentar ---
{
  const { env, registro } = envHaikuConRespuestas(['Permite auditar mejor los pipelines de agentes en producción.']);
  const resultado = await generarImporta(env, ITEM);
  comprobar('generarImporta: primer intento completo', resultado, 'Permite auditar mejor los pipelines de agentes en producción.');
  comprobar('generarImporta: no reintenta si no hace falta', registro.llamadas, 1);
}

// --- generarImporta: primer intento cortado -> reintenta con más presupuesto y se queda con el bueno ---
{
  const { env, registro } = envHaikuConRespuestas([
    'Permite auditar mejor los pipelines de agentes en producción sin tener que', // cortado
    'Permite auditar mejor los pipelines de agentes en producción sin tener que reentrenar el modelo.',
  ]);
  const resultado = await generarImporta(env, ITEM);
  comprobar('generarImporta: reintenta tras un corte', registro.llamadas, 2);
  comprobar('generarImporta: el reintento pide más tokens que el primero', registro.maxTokensVistos[1] > registro.maxTokensVistos[0], true);
  comprobar('generarImporta: se queda con la versión completa del reintento', resultado, 'Permite auditar mejor los pipelines de agentes en producción sin tener que reentrenar el modelo.');
}

// --- generarImporta: cortado en los dos intentos -> null, nunca publica basura ---
{
  const { env, registro } = envHaikuConRespuestas([
    'Permite auditar mejor los pipelines de agentes en producción sin tener que',
    'Permite auditar mejor los pipelines de agentes en producción sin tener que reentrenar desde cero cada vez que cambia algo en el',
  ]);
  const resultado = await generarImporta(env, ITEM);
  comprobar('generarImporta: cortado en los dos intentos -> null', resultado, null);
  comprobar('generarImporta: agota los dos intentos antes de rendirse', registro.llamadas, 2);
}

const ITEMS_PANORAMA = [{ titulo: 'Pieza uno', resumen: 'Resumen uno.', relevancia: 5 }];

// --- generarPanorama: mismo patrón de reintento ---
{
  const { env, registro } = envHaikuConRespuestas([
    'El día estuvo marcado por avances en inferencia local y un debate sobre', // cortado
    'El día estuvo marcado por avances en inferencia local y un debate sobre el coste de servir modelos grandes.',
  ]);
  const resultado = await generarPanorama(env, ITEMS_PANORAMA);
  comprobar('generarPanorama: se recupera en el reintento', resultado, 'El día estuvo marcado por avances en inferencia local y un debate sobre el coste de servir modelos grandes.');
  comprobar('generarPanorama: reintenta con más presupuesto', registro.maxTokensVistos[1] > registro.maxTokensVistos[0], true);
}

// --- generarPanorama: cortado en los dos intentos -> null (mejor sin panorama que uno roto) ---
{
  const { env, registro } = envHaikuConRespuestas([
    'El día estuvo marcado por avances en inferencia local y un debate sobre',
    'El día estuvo marcado por avances en inferencia local y un debate sobre el coste de servir modelos grandes sin que',
  ]);
  const resultado = await generarPanorama(env, ITEMS_PANORAMA);
  comprobar('generarPanorama: cortado en los dos intentos -> null', resultado, null);
  comprobar('generarPanorama: agota los dos intentos antes de rendirse', registro.llamadas, 2);
}

// --- generarPanorama: sin items, no llama a nada ---
{
  const { registro } = envHaikuConRespuestas([]);
  const resultado = await generarPanorama({ ANTHROPIC_API_KEY: 'x' }, []);
  comprobar('generarPanorama: sin items devuelve null sin llamar al modelo', resultado, null);
  comprobar('generarPanorama: sin items, cero llamadas', registro.llamadas, 0);
}

let fallos = 0;
for (const [descripcion, obtenido, esperado] of casos) {
  const ok = obtenido === esperado;
  if (!ok) fallos++;
  console.log(`${ok ? '✓' : '✗ FALLO'}  ${descripcion}  →  obtenido=${JSON.stringify(obtenido)} esperado=${JSON.stringify(esperado)}`);
}

console.log(`\n${casos.length - fallos}/${casos.length} casos correctos`);
process.exit(fallos > 0 ? 1 : 0);
