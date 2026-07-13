# Espacio Latente — espacio-latente.com

Web personal construida con **Astro** (contenido estático + islas React) y un
**Cloudflare Worker** que da vida al agente-bio con la API de Claude.

## Estructura

```
el-rack/
├── src/
│   ├── pages/index.astro          # portada: hero + agente + rack + buzón
│   ├── pages/lab/[...slug].astro  # página de cada experimento
│   ├── content/experimentos/      # tus artículos en Markdown ← escribe aquí
│   ├── components/AgenteBio.jsx   # chat del agente (isla React)
│   ├── layouts/Base.astro
│   └── styles/global.css          # sistema de diseño "rack"
└── worker/                        # backend del agente (Cloudflare Worker)
    ├── src/index.js               # ← edita tu BIO aquí
    └── wrangler.toml
```

## Puesta en marcha local

```bash
npm install
npm run dev        # http://localhost:4321
```

## Pasos para publicarla

1. **Dominio**: ✅ espacio-latente.com, comprado en Cloudflare Registrar.
2. **Repo**: crea un repositorio en GitHub (p.ej. `espacio-latente`) y sube
   esta carpeta.
3. **Worker del agente**:
   ```bash
   cd worker
   npx wrangler login
   npx wrangler secret put ANTHROPIC_API_KEY   # pega tu key de console.anthropic.com
   npx wrangler deploy
   ```
   Copia la URL que te devuelve (`https://espacio-latente-agente-bio.XXX.workers.dev`)
   y pégala en `src/components/AgenteBio.jsx` (constante `WORKER_URL`).
4. **Tu bio**: edita la constante `BIO` en `worker/src/index.js` con tus datos
   reales y vuelve a hacer `wrangler deploy`.
5. **Buzón**: crea una cuenta gratis en [web3forms.com](https://web3forms.com),
   copia tu `access_key` y pégala en `src/pages/index.astro`.
6. **Web**: en Cloudflare → Workers & Pages → Create → Pages → conectar el
   repo de GitHub. Framework: Astro. Cada `git push` desplegará
   automáticamente. Luego en "Custom domains" añade `espacio-latente.com`
   (como ya está en tu cuenta de Cloudflare, se configura solo).
7. **Seguridad**: en `worker/src/index.js` cambia
   `Access-Control-Allow-Origin: '*'` por `'https://espacio-latente.com'`
   para que solo tu web pueda usar el agente. Considera añadir un rate
   limit (Cloudflare lo ofrece en el panel del Worker) para controlar el
   gasto.

## Blindar el agente contra abuso (hazlo antes de anunciar la web)

Un endpoint público que llama a una API de pago es un imán para bots que
pueden vaciarte la cuenta en minutos. El proyecto ya trae tres capas de
protección, pero hay que activarlas:

1. **Turnstile (verificación humana)**:
   - Ve a Cloudflare Dashboard → Turnstile → Add site, con tu dominio
     `espacio-latente.com`. Elige modo "Invisible".
   - Copia la **Site Key** y pégala en `TURNSTILE_SITE_KEY` dentro de
     `src/components/AgenteBio.jsx`.
   - Copia la **Secret Key** y guárdala en el Worker:
     ```bash
     cd worker
     npx wrangler secret put TURNSTILE_SECRET_KEY
     ```

2. **Límites de uso (KV)**:
   ```bash
   npx wrangler kv namespace create RATE_LIMIT
   ```
   Copia el `id` que te devuelve dentro de `worker/wrangler.toml`, en
   `[[kv_namespaces]]`. Los topes por defecto son 15 preguntas/IP/día y 200
   preguntas/día en total — edítalos en `MAX_POR_IP_DIA` y `MAX_GLOBAL_DIA`
   al inicio de `worker/src/index.js` si quieres otros números.

3. **Límite de gasto en Anthropic** (el cinturón final):
   En [console.anthropic.com](https://console.anthropic.com) → Settings →
   Limits, pon un tope de gasto mensual. Así, pase lo que pase con las
   otras capas, nunca te sorprende una factura.

4. **CORS**: cuando despliegues de verdad, cambia
   `Access-Control-Allow-Origin: '*'` por `'https://espacio-latente.com'`
   en `worker/src/index.js`, para que solo tu web pueda llamar al Worker.

Con las tres capas activas: un bot necesita superar un captcha invisible,
y aunque lo supere, no puede hacer más de 15 preguntas al día por IP ni
200 en total — y si por lo que sea todo falla, el límite de Anthropic
corta el grifo.

## Añadir un experimento nuevo

Crea un `.md` en `src/content/experimentos/` con este frontmatter:

```yaml
---
titulo: "Título del experimento"
resumen: "Una línea que aparece en el rack."
estado: pruebas   # online | pruebas | archivado
unidad: "U-04"
fecha: 2026-07-11
---
```

Y aparecerá automáticamente como un módulo nuevo en el rack.
