# Espacio Latente — espacio-latente.com

Web personal construida con **Astro** (contenido estático + islas React) y
un pipeline de IA propio, **El Radar**, que corre como Cloudflare Worker en
`radar.espacio-latente.com`.

## Qué hay aquí

| Carpeta | Qué es | Dónde vive |
|---|---|---|
| `src/` | El sitio: portada, rack de experimentos y proyectos, versión ES/EN | Cloudflare Pages, `espacio-latente.com` |
| `worker-radar/` | El radar: digest de noticias de IA dos veces al día (colas, embeddings, memoria semántica, contabilidad de coste) | Worker, `radar.espacio-latente.com` |
| `worker/` | Agente-bio conversacional. **Hoy desconectado** — ver más abajo | Worker |

```
src/
├── pages/index.astro           # portada ES  (en/index.astro → EN)
├── pages/lab/[...slug].astro   # página de cada experimento
├── content/experimentos/       # los artículos en Markdown ← escribe aquí
├── content/proyectos/          # fichas de proyectos
├── components/                 # Home.astro + islas React
├── layouts/Base.astro          # <head>, nav, footer, hreflang
└── styles/global.css           # sistema de diseño "rack"
```

## Puesta en marcha

```bash
npm install
npm run dev      # http://localhost:4321
npm test         # tests del radar (sin red, sin claves)
npm run build    # build de producción
```

`npm test` ejecuta los tests de `worker-radar/test/`. Todos corren en Node
pelado con dobles de KV/D1/Workers AI/Vectorize: ni tocan red ni necesitan
credenciales. Aparte, `npm run probar:articulo` sí sale a internet — es un
script manual para ver qué extrae el lector de artículos de webs reales, no
un test.

## Añadir un experimento

Crea un `.md` en `src/content/experimentos/` con este frontmatter (todos los
campos son obligatorios salvo `lang`, que por defecto es `es`; el esquema
está en `src/content.config.ts` y el build falla si algo no encaja):

```yaml
---
titulo: "Título del experimento"
resumen: "Una línea que aparece en el rack."
estado: pruebas          # online | pruebas | archivado
unidad: "U-09"           # etiqueta de rack, correlativa
serie: bitacora          # fundamentos | agentes | bitacora
fecha: 2026-07-27
---
```

Y aparece automáticamente como un módulo nuevo en el rack. Para la versión
en inglés, el mismo fichero en `src/content/experimentos/en/` con
`lang: en` y el **mismo nombre de fichero**: así se enlazan solos y se
emiten los `hreflang` (sin traducción no se emiten, a propósito).

## El radar (`worker-radar/`)

El pipeline completo y las decisiones de diseño están en
[`worker-radar/DEVLOG.md`](worker-radar/DEVLOG.md), que es el documento a
leer antes de tocar nada aquí. En corto:

- `sources.js` → fuentes RSS/Atom verificadas a mano.
- `index.js` → el cron reparte las fuentes en lotes y los encola
  (`RADAR_QUEUE`); cada lote se procesa en su propia invocación para no
  agotar el límite de 50 subrequests del plan free. Un mensaje final,
  retrasado, genera el panorama del día una sola vez.
- `memoria.js` → embeddings (`bge-m3`) y Vectorize: fusiona la misma noticia
  contada por dos medios y enlaza con cobertura pasada relacionada. Los
  embeddings y las inserciones van **por lotes**, no por item — es lo que
  hace que quepan en el presupuesto de subrequests.
- `resumen.js` → Claude Haiku evalúa relevancia (1-5) y resume en una sola
  llamada.
- `costes.js` + `schema.sql` → cada llamada a un modelo queda en D1 con
  tokens y coste real. Medir antes de optimizar.

### Despliegue del radar

```bash
cd worker-radar
npx wrangler kv namespace create RADAR_KV        # una vez
npx wrangler queues create radar-fuentes         # una vez
npx wrangler d1 create radar-costes              # una vez; copia el id a wrangler.toml
npx wrangler d1 execute radar-costes --file=schema.sql --remote
npx wrangler vectorize create radar-memoria --dimensions=1024 --metric=cosine
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put RADAR_SECRET             # protege /ejecutar y /comparar
npx wrangler secret put ALERTA_WEBHOOK           # opcional: aviso si falla una pasada entera
```

Y para desplegar, desde la raíz del repo:

```bash
npm run desplegar:radar
```

> **No uses `npx wrangler deploy` a secas para el radar**, ni siquiera desde
> `worker-radar/`. Wrangler encuentra antes el `wrangler.jsonc` de la raíz
> —que es el del sitio estático— que el `wrangler.toml` de la carpeta, y lo
> que sube son los assets de `dist/` **sin ningún binding**, encima del
> Worker del radar. El script de arriba pasa `--config` explícito. Si
> despliegas a mano, comprueba antes con `--dry-run` que salen los cinco
> bindings (KV, Queue, D1, Vectorize, AI).

Disparo manual de una pasada (el resultado se ve en el digest y en D1, no en
la respuesta — el trabajo real ocurre en la cola):

```bash
curl -X POST https://radar.espacio-latente.com/ejecutar -H "X-Radar-Secret: ..."
```

## El agente-bio (`worker/`) — desconectado

`src/components/AgenteBio.jsx` funciona hoy con respuestas fijas: no llama a
ninguna API y no cuesta nada. El Worker de `worker/` sigue en el repo, pero
**la web ya no lo usa**. Si sigue desplegado, es un endpoint público que
puede gastar la API key sin que nadie lo utilice:

```bash
cd worker
npx wrangler deployments list   # ¿sigue vivo?
npx wrangler delete             # retirarlo (borrar la carpeta NO lo apaga)
```

Si algún día se reconecta, sus tres capas de protección (Turnstile, límite
por IP y límite global diario en KV) están descritas en la cabecera de
`worker/src/index.js`, y el CORS ya está restringido al propio dominio.

## Despliegue del sitio

Cloudflare Pages construye y publica con cada push a `main` (framework
Astro, `npm run build`, salida `dist/`). El dominio y `www` están
configurados como custom domains en `wrangler.jsonc`.

## Cinturones de seguridad de coste

Independientemente del código, conviene tener puesto un tope de gasto
mensual en [console.anthropic.com](https://console.anthropic.com) →
Settings → Limits. Es la única protección que no depende de que el resto
funcione.
