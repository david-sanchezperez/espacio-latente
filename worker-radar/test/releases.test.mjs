import { esReleaseSignificativo } from '../src/resumen.js';

const casos = [
  // [nombre, fuente, item, esperado]
  ['transformers minor (v4.42.0) -> pasa', { nombre: 'transformers' }, { titulo: 'Release v4.42.0' }, true],
  ['transformers patch (v4.42.1) -> descartado', { nombre: 'transformers' }, { titulo: 'Release v4.42.1' }, false],
  ['vLLM prerelease (rc2) -> descartado', { nombre: 'vLLM' }, { titulo: 'v0.9.3rc2' }, false],
  ['vLLM patch (v0.9.3) -> descartado', { nombre: 'vLLM' }, { titulo: 'v0.9.3' }, false],
  ['vLLM minor (v0.10.0) -> pasa', { nombre: 'vLLM' }, { titulo: 'v0.10.0' }, true],
  ['LangChain paquete raíz minor -> pasa', { nombre: 'LangChain', soloRaiz: true }, { titulo: 'langchain==1.4.0' }, true],
  ['LangChain subpaquete (openai) -> descartado', { nombre: 'LangChain', soloRaiz: true }, { titulo: 'langchain-openai==1.3.5' }, false],
  ['LangChain raíz pero patch -> descartado', { nombre: 'LangChain', soloRaiz: true }, { titulo: 'langchain==1.4.1' }, false],
  ['LangChain otro subpaquete (core) -> descartado', { nombre: 'LangChain', soloRaiz: true }, { titulo: 'langchain-core==1.2.0' }, false],
  ['Ollama beta -> descartado', { nombre: 'Ollama' }, { titulo: 'v0.5.0-beta' }, false],
  ['Ollama alpha -> descartado', { nombre: 'Ollama' }, { titulo: 'v0.5.0-alpha.1' }, false],
  ['Sin versión identificable -> pasa (fail-open)', { nombre: 'Anthropic SDK' }, { titulo: 'Security advisory' }, true],
  ['Anthropic SDK minor -> pasa', { nombre: 'Anthropic SDK' }, { titulo: 'v0.40.0' }, true],
  ['OpenAI SDK patch -> descartado', { nombre: 'OpenAI SDK' }, { titulo: 'v1.2.3' }, false],
  ['Major bump (v2.0.0) -> pasa', { nombre: 'transformers' }, { titulo: 'Release v2.0.0' }, true],

  // --- Casos reales sacados de los feeds en vivo (verificados con curl) ---
  ['vLLM real: v0.25.1 (patch) -> descartado', { nombre: 'vLLM' }, { titulo: 'v0.25.1' }, false],
  ['vLLM real: v0.25.0 (minor) -> pasa', { nombre: 'vLLM' }, { titulo: 'v0.25.0' }, true],
  ['vLLM real: v0.25.0rc3 (rc SIN guion) -> descartado', { nombre: 'vLLM' }, { titulo: 'v0.25.0rc3' }, false],
  ['vLLM real: v0.24.0rc2 con sufijo de texto -> descartado', { nombre: 'vLLM' }, { titulo: 'v0.24.0rc2: Fix P/D with DP Supervisor (#46628)' }, false],
  ['transformers real: "Patch release: v5.14.1" -> descartado', { nombre: 'transformers' }, { titulo: 'Patch release: v5.14.1' }, false],
  ['transformers real: "Release v5.14.0" -> pasa', { nombre: 'transformers' }, { titulo: 'Release v5.14.0' }, true],
  ['LangChain real: langchain==1.3.14 (raíz, patch) -> descartado', { nombre: 'LangChain', soloRaiz: true }, { titulo: 'langchain==1.3.14' }, false],
  ['LangChain real: langchain-fireworks==1.4.4 (subpaquete) -> descartado', { nombre: 'LangChain', soloRaiz: true }, { titulo: 'langchain-fireworks==1.4.4' }, false],
];

let fallos = 0;
for (const [descripcion, fuente, item, esperado] of casos) {
  const resultado = esReleaseSignificativo(fuente, item);
  const ok = resultado === esperado;
  if (!ok) fallos++;
  console.log(`${ok ? '✓' : '✗ FALLO'}  ${descripcion}  →  obtenido=${resultado} esperado=${esperado}`);
}

console.log(`\n${casos.length - fallos}/${casos.length} casos correctos`);
process.exit(fallos > 0 ? 1 : 0);
