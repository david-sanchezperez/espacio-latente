/**
 * DeepSeek V4 Flash como proveedor candidato (Fase 4, ver DEVLOG.md) — solo
 * se ejerce vía /comparar, nunca en producción. Cubre el parseo de la
 * respuesta OpenAI-compatible y el fallo abierto sin DEEPSEEK_API_KEY, no
 * hace ninguna llamada de red real.
 */
import { resumir } from '../src/resumen.js';

const ITEM = { titulo: 'Noticia de prueba', link: 'https://ejemplo.test/uno', descripcion: 'Snippet corto.' };
const FUENTE = { nombre: 'Fuente de prueba' };

function envFalso({ conApiKey = true } = {}) {
  const registro = { llamadasDeepseek: 0, filasD1: [], cuerposEnviados: [] };
  globalThis.fetch = async (url, opciones) => {
    registro.llamadasDeepseek++;
    registro.cuerposEnviados.push(JSON.parse(opciones.body));
    return {
      ok: true,
      async json() {
        return {
          choices: [{ message: { content: 'RELEVANCIA: 5\nRESUMEN: Resumen de DeepSeek.\nIMPORTA: Consecuencia de prueba.' } }],
          usage: { prompt_tokens: 20, completion_tokens: 8 },
        };
      },
    };
  };
  const env = {
    DEEPSEEK_API_KEY: conApiKey ? 'clave-de-prueba' : undefined,
    RADAR_DB: {
      prepare() {
        return { bind: () => ({ async run() { registro.filasD1.push(true); } }) };
      },
    },
  };
  return { env, registro };
}

const casos = [];
const comprobar = (descripcion, obtenido, esperado) => casos.push([descripcion, obtenido, esperado]);

{
  const { env, registro } = envFalso();
  const resultado = await resumir(env, ITEM, FUENTE, { proveedor: 'deepseek' });
  comprobar('DeepSeek: se llama a la API', registro.llamadasDeepseek, 1);
  comprobar('DeepSeek: relevancia parseada', resultado.relevancia, 5);
  comprobar('DeepSeek: resumen parseado', resultado.resumen, 'Resumen de DeepSeek.');
  comprobar('DeepSeek: IMPORTA parseado', resultado.porQueImporta, 'Consecuencia de prueba.');
  // El razonamiento oculto de V4 Flash cuenta contra max_tokens y puede
  // agotar el presupuesto sin emitir respuesta visible (verificado con una
  // llamada real, ver DEVLOG.md) — desactivarlo es lo que lo arregla, así
  // que un cambio que lo reactive sin querer debe romper este test.
  comprobar('DeepSeek: pide thinking desactivado', JSON.stringify(registro.cuerposEnviados[0].thinking), JSON.stringify({ type: 'disabled' }));
}

{
  const { env } = envFalso({ conApiKey: false });
  const resultado = await resumir(env, ITEM, FUENTE, { proveedor: 'deepseek' });
  // Sin DEEPSEEK_API_KEY: falla la llamada, pero resumir() falla abierto —
  // se publica con el título en vez de perder la pieza (mismo criterio que
  // el resto de proveedores).
  comprobar('DeepSeek sin API key: falla abierto, se publica con el título', resultado.resumen, ITEM.titulo);
  comprobar('DeepSeek sin API key: relevante por defecto', resultado.relevante, true);
}

let fallos = 0;
for (const [descripcion, obtenido, esperado] of casos) {
  const ok = obtenido === esperado;
  if (!ok) fallos++;
  console.log(`${ok ? '✓' : '✗ FALLO'}  ${descripcion}  →  obtenido=${JSON.stringify(obtenido)} esperado=${JSON.stringify(esperado)}`);
}

console.log(`\n${casos.length - fallos}/${casos.length} casos correctos`);
process.exit(fallos > 0 ? 1 : 0);
