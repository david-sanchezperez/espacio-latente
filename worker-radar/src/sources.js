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
 */
export const FUENTES = [
  // --- Laboratorios oficiales ---
  { nombre: 'OpenAI News', url: 'https://openai.com/news/rss.xml', tipo: 'feed' },
  { nombre: 'Google DeepMind', url: 'https://deepmind.google/blog/rss.xml', tipo: 'feed' },
  { nombre: 'Google Research', url: 'https://research.google/blog/rss/', tipo: 'feed' },

  // --- Espejos no oficiales (labs sin RSS propio) ---
  { nombre: 'Meta AI', url: 'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_meta_ai.xml', tipo: 'feed' },
  { nombre: 'Anthropic', url: 'https://raw.githubusercontent.com/taobojlen/anthropic-rss-feed/main/anthropic_news_rss.xml', tipo: 'feed' },
  { nombre: 'Anthropic (respaldo)', url: 'https://tim-hilde.github.io/anthropic-rss/rss.xml', tipo: 'feed' },

  // --- Blogs personales de alta señal ---
  { nombre: 'Simon Willison', url: 'https://simonwillison.net/atom/everything/', tipo: 'feed' },
  { nombre: 'Sebastian Raschka', url: 'https://sebastianraschka.com/rss_feed.xml', tipo: 'feed' },
  { nombre: "Lilian Weng (Lil'Log)", url: 'https://lilianweng.github.io/index.xml', tipo: 'feed' },
  { nombre: 'Andrej Karpathy', url: 'https://karpathy.bearblog.dev/feed/', tipo: 'feed' },
  { nombre: 'Jay Alammar', url: 'https://newsletter.languagemodels.co/feed', tipo: 'feed' },

  // --- Newsletters curadas ---
  { nombre: 'Latent Space', url: 'https://www.latent.space/feed', tipo: 'feed' },
  { nombre: 'Import AI (Jack Clark)', url: 'https://importai.substack.com/feed', tipo: 'feed' },
  { nombre: 'fast.ai', url: 'https://www.fast.ai/index.xml', tipo: 'feed' },

  // --- Medios tecnológicos ---
  { nombre: 'Ars Technica · IA', url: 'https://arstechnica.com/ai/feed/', tipo: 'feed' },
  { nombre: 'The Verge · IA', url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', tipo: 'feed' },
  { nombre: 'MIT Technology Review · IA', url: 'https://www.technologyreview.com/topic/artificial-intelligence/feed', tipo: 'feed' },
  { nombre: 'TechCrunch · IA', url: 'https://techcrunch.com/category/artificial-intelligence/feed/', tipo: 'feed' },

  // --- Papers ---
  { nombre: 'arXiv cs.CL', url: 'https://rss.arxiv.org/rss/cs.CL', tipo: 'feed' },
  { nombre: 'arXiv cs.LG', url: 'https://rss.arxiv.org/rss/cs.LG', tipo: 'feed' },
  { nombre: 'Hugging Face Blog', url: 'https://huggingface.co/blog/feed.xml', tipo: 'feed' },

  // --- Comunidad (mezcla mucho no-IA; la relevancia la juzga el propio
  // paso de resumen, no un filtro de palabras clave — más consistente y
  // sin listas que mantener. `limite` bajo para no disparar el número de
  // resúmenes de una fuente que en 30h trae de todo).
  { nombre: 'Hacker News', url: 'https://news.ycombinator.com/rss', tipo: 'feed', limite: 12 },

  // --- GitHub Releases (código, no noticias) ---
  { nombre: 'transformers (release)', url: 'https://github.com/huggingface/transformers/releases.atom', tipo: 'github_release' },
  { nombre: 'vLLM (release)', url: 'https://github.com/vllm-project/vllm/releases.atom', tipo: 'github_release' },
  { nombre: 'LangChain (release)', url: 'https://github.com/langchain-ai/langchain/releases.atom', tipo: 'github_release', soloRaiz: true },
  { nombre: 'Ollama (release)', url: 'https://github.com/ollama/ollama/releases.atom', tipo: 'github_release' },
  { nombre: 'Anthropic SDK Python (release)', url: 'https://github.com/anthropics/anthropic-sdk-python/releases.atom', tipo: 'github_release' },
  { nombre: 'OpenAI SDK Python (release)', url: 'https://github.com/openai/openai-python/releases.atom', tipo: 'github_release' },
];
