/**
 * Fuentes del radar. Cada una es RSS/Atom real y verificado a mano (ver
 * conversación de diseño) — nada de feeds inventados o "seguramente existen".
 *
 * tipo:
 *   'feed'            → RSS/Atom normal, se procesa tal cual.
 *   'github_release'  → feed de releases de GitHub, pasa por reglas extra
 *                        de filtrado (solo minor/major, sin -rc/-beta).
 *
 * soloRaiz: para monorepos (ej. LangChain) que taggean cada subpaquete por
 * separado — solo nos interesa el paquete raíz.
 *
 * clase: prioridad de la fuente como origen de una noticia (Fase 4 de v0.2,
 * ver DEVLOG.md) — no cambia si una pieza se publica, solo decide cuál de
 * las fuentes fusionadas (memoria.js/index.js) aparece como principal
 * cuando la misma noticia llega por varias. Orden en `ORDEN_CLASES` más
 * abajo. Fuente sin `clase` (ninguna hoy) cae al final del orden.
 */
export const FUENTES = [
  // --- Laboratorios oficiales ---
  { nombre: 'OpenAI News', url: 'https://openai.com/news/rss.xml', tipo: 'feed', clase: 'primaria' },
  { nombre: 'Google DeepMind', url: 'https://deepmind.google/blog/rss.xml', tipo: 'feed', clase: 'primaria' },
  { nombre: 'Google Research', url: 'https://research.google/blog/rss/', tipo: 'feed', clase: 'primaria' },
  { nombre: 'Microsoft Research', url: 'https://www.microsoft.com/en-us/research/feed/', tipo: 'feed', clase: 'primaria' },

  // --- Espejos no oficiales (labs sin RSS propio) ---
  { nombre: 'Meta AI', url: 'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_meta_ai.xml', tipo: 'feed', clase: 'primaria' },
  { nombre: 'Anthropic', url: 'https://raw.githubusercontent.com/taobojlen/anthropic-rss-feed/main/anthropic_news_rss.xml', tipo: 'feed', clase: 'primaria' },
  { nombre: 'Anthropic (respaldo)', url: 'https://tim-hilde.github.io/anthropic-rss/rss.xml', tipo: 'feed', clase: 'primaria' },

  // --- Blogs personales de alta señal ---
  { nombre: 'Simon Willison', url: 'https://simonwillison.net/atom/everything/', tipo: 'feed', clase: 'experta' },
  { nombre: 'Sebastian Raschka', url: 'https://sebastianraschka.com/rss_feed.xml', tipo: 'feed', clase: 'experta' },
  { nombre: "Lilian Weng (Lil'Log)", url: 'https://lilianweng.github.io/index.xml', tipo: 'feed', clase: 'experta' },
  { nombre: 'Andrej Karpathy', url: 'https://karpathy.bearblog.dev/feed/', tipo: 'feed', clase: 'experta' },
  { nombre: 'Jay Alammar', url: 'https://newsletter.languagemodels.co/feed', tipo: 'feed', clase: 'experta' },

  // --- Newsletters curadas ---
  { nombre: 'Latent Space', url: 'https://www.latent.space/feed', tipo: 'feed', clase: 'experta' },
  { nombre: 'Import AI (Jack Clark)', url: 'https://importai.substack.com/feed', tipo: 'feed', clase: 'experta' },
  { nombre: 'fast.ai', url: 'https://www.fast.ai/index.xml', tipo: 'feed', clase: 'experta' },

  // --- AI Engineering / Inferencia ---
  { nombre: 'NVIDIA Technical Blog', url: 'https://developer.nvidia.com/blog/feed/', tipo: 'feed', clase: 'primaria' },
  { nombre: 'Red Hat AI', url: 'https://www.redhat.com/en/rss/blog/channel/artificial-intelligence', tipo: 'feed', clase: 'primaria' },

  // --- Medios tecnológicos ---
  { nombre: 'Ars Technica · IA', url: 'https://arstechnica.com/ai/feed/', tipo: 'feed', clase: 'media' },
  { nombre: 'The Verge · IA', url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', tipo: 'feed', clase: 'media' },
  { nombre: 'MIT Technology Review · IA', url: 'https://www.technologyreview.com/topic/artificial-intelligence/feed', tipo: 'feed', clase: 'media' },
  { nombre: 'TechCrunch · IA', url: 'https://techcrunch.com/category/artificial-intelligence/feed/', tipo: 'feed', clase: 'media' },

  // --- Papers ---
  { nombre: 'arXiv cs.CL', url: 'https://rss.arxiv.org/rss/cs.CL', tipo: 'feed', clase: 'investigacion' },
  { nombre: 'arXiv cs.LG', url: 'https://rss.arxiv.org/rss/cs.LG', tipo: 'feed', clase: 'investigacion' },
  { nombre: 'arXiv cs.AI', url: 'https://rss.arxiv.org/rss/cs.AI', tipo: 'feed', clase: 'investigacion' },
  { nombre: 'Hugging Face Blog', url: 'https://huggingface.co/blog/feed.xml', tipo: 'feed', clase: 'primaria' },

  // --- Comunidad (mezcla mucho no-IA; la relevancia la juzga el propio
  // paso de resumen, no un filtro de palabras clave — más consistente y
  // sin listas que mantener. `limite` bajo para no disparar el número de
  // resúmenes de una fuente que en 30h trae de todo). `clase: 'comunidad'`
  // (la de menor prioridad) porque HN es descubrimiento, no autoridad: si la
  // misma noticia llega también por su fuente original o por un medio, esa
  // debe quedar como principal al fusionar (ver ORDEN_CLASES).
  { nombre: 'Hacker News', url: 'https://news.ycombinator.com/rss', tipo: 'feed', limite: 12, clase: 'comunidad' },

  // --- GitHub Releases (código, no noticias) ---
  { nombre: 'transformers (release)', url: 'https://github.com/huggingface/transformers/releases.atom', tipo: 'github_release', clase: 'primaria' },
  { nombre: 'vLLM (release)', url: 'https://github.com/vllm-project/vllm/releases.atom', tipo: 'github_release', clase: 'primaria' },
  { nombre: 'SGLang (release)', url: 'https://github.com/sgl-project/sglang/releases.atom', tipo: 'github_release', clase: 'primaria' },
  { nombre: 'llama.cpp (release)', url: 'https://github.com/ggml-org/llama.cpp/releases.atom', tipo: 'github_release', limite: 12, clase: 'primaria' },
  { nombre: 'LangGraph (release)', url: 'https://github.com/langchain-ai/langgraph/releases.atom', tipo: 'github_release', soloRaiz: true, clase: 'primaria' },
  { nombre: 'LangChain (release)', url: 'https://github.com/langchain-ai/langchain/releases.atom', tipo: 'github_release', soloRaiz: true, clase: 'primaria' },
  { nombre: 'Ollama (release)', url: 'https://github.com/ollama/ollama/releases.atom', tipo: 'github_release', clase: 'primaria' },
  { nombre: 'Anthropic SDK Python (release)', url: 'https://github.com/anthropics/anthropic-sdk-python/releases.atom', tipo: 'github_release', clase: 'primaria' },
  { nombre: 'OpenAI SDK Python (release)', url: 'https://github.com/openai/openai-python/releases.atom', tipo: 'github_release', clase: 'primaria' },
];

// Orden de preferencia al fusionar cobertura duplicada de la misma noticia
// (punto 6 del plan de evolución: preferir fuente primaria > análisis
// experto > investigación > medio general > comunidad). Una fuente sin
// `clase` reconocida cae al final (`indexOf` devuelve -1 → tratada como
// `ORDEN_CLASES.length`, peor que 'comunidad').
export const ORDEN_CLASES = ['primaria', 'experta', 'investigacion', 'media', 'comunidad'];

const CLASE_POR_FUENTE = new Map(FUENTES.map((f) => [f.nombre, f.clase]));

/** Prioridad numérica (menor = más prioritaria) de una fuente por su nombre. */
export function prioridadClase(nombreFuente) {
  const indice = ORDEN_CLASES.indexOf(CLASE_POR_FUENTE.get(nombreFuente));
  return indice === -1 ? ORDEN_CLASES.length : indice;
}

/**
 * De una lista de nombres de fuente que cubren la misma noticia, cuál debe
 * ser la principal — la de mayor prioridad de clase (menor índice). Usada al
 * fusionar en caliente (index.js, un par a la vez) y en el backfill
 * retroactivo (más de dos fuentes ya fusionadas de antes de esta fase).
 */
export function elegirFuentePrincipal(nombres) {
  return nombres.reduce((mejor, actual) => (prioridadClase(actual) < prioridadClase(mejor) ? actual : mejor));
}
