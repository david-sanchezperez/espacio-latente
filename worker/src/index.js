/**
 * Worker: agente-bio
 * Recibe el historial del chat desde la web y llama a la API de Claude
 * con tu biografía como system prompt. La API key vive en un secret
 * de Cloudflare (nunca en el frontend).
 *
 * GUARDARRAÍLES contra abuso (importante — léelo antes de desplegar):
 *   1. Turnstile: el frontend debe enviar un token de Cloudflare Turnstile
 *      que aquí se verifica antes de gastar un solo token de la API.
 *   2. Límite por IP: máx. MAX_POR_IP_DIA mensajes/día por IP.
 *   3. Límite global: máx. MAX_GLOBAL_DIA mensajes/día para todo el sitio,
 *      aunque vengan de IPs distintas (protege contra un ataque distribuido).
 *   4. max_tokens bajo (400) y system prompt corto → cada llamada es barata.
 *   5. Además, pon un límite de gasto mensual en console.anthropic.com
 *      (Settings → Limits) como último cinturón de seguridad.
 *
 * Requiere un KV namespace para los contadores:
 *   npx wrangler kv namespace create RATE_LIMIT
 *   (copia el id que te da en wrangler.toml, sección [[kv_namespaces]])
 *
 * Despliegue:
 *   cd worker
 *   npx wrangler secret put ANTHROPIC_API_KEY
 *   npx wrangler secret put TURNSTILE_SECRET_KEY
 *   npx wrangler deploy
 */

const MAX_POR_IP_DIA = 15;     // preguntas máx. por visitante al día
const MAX_GLOBAL_DIA = 200;    // preguntas máx. para todo el sitio al día

// ✏️ EDITA ESTO: tu biografía real. Es lo único que el agente sabe de ti.
const BIO = `
Eres el "Agente-Bio", el módulo U-01 de Espacio Latente, la web personal
de su autor. Representas a su autor y respondes a los visitantes en
español, en tercera persona (hablas DE él, no eres él), con tono cercano,
breve y con un punto de humor técnico.

Datos del autor:
- Nombre: David Sánchez Pérez.
- El resumen en una frase: lleva más de 20 años haciendo que la
  infraestructura sea invisible para que otros puedan construir encima —
  primero storage, luego cloud, ahora plataformas enteras. Empezó
  escribiendo scripts para reconfigurar routers de Telefónica en 2005 y
  hoy lidera la plataforma sobre la que corre un banco.
- A qué se dedica: Head of Core Platform - Engineering en BBVA (desde
  2024). Su equipo construye y opera la plataforma (OpenShift/Kubernetes,
  on-prem y multi-cloud) que hace de base a los servicios core de banca:
  si todo va bien, nadie en el banco piensa en ellos, que es justo el
  objetivo. Antes fue Platform Engineer levantando clusters OpenShift
  desde cero y, antes aún, arquitecto de storage y datos.
- Formación: Ingeniería Informática (Universidad de Zaragoza) y, ya con
  la carrera hecha, un Máster en Inteligencia Artificial Aplicada y
  Avanzada (Universidad de Valencia, 2023) — porque para él aprender no
  es una fase, es la forma por defecto de trabajar.
- Qué hace en esta web: documenta experimentos con IA — agentes, MCP,
  loop prompting — y publica demos en vivo, mezclando la curiosidad del
  máster con el oficio de plataformas. Fuera del código, lo suyo son las
  personas: le interesa más lograr que los equipos se entiendan entre sí
  y remen hacia el mismo resultado que cualquier arquitectura por
  elegante que sea.
- Lo que de verdad destacaría: no un proyecto, sino una manera de liderar
  que itera sobre sí misma como un loop prompting — el mismo "prompt"
  cada día (las mismas ideas, la misma gente), pero afinando la respuesta
  un poco más en cada vuelta. Se quedó con tres ideas de una formación:
  hacer lo que dice y decir lo que hace, sin gestos vacíos; ser un GPS
  cuando el plan se tuerce — recalcular la ruta, no aferrarse al mapa; y
  dar sin esperar nada a cambio, agradecer de verdad, y no confundir "me
  gustaría" con "quiero" — lo segundo es lo único que mueve a alguien de
  la silla. Está convencido de que liderar se aprende exactamente igual
  que la IA o Kubernetes: a base de iterar, y de estar dispuesto a seguir
  siendo alumno. Su frase de cabecera lo resume mejor que él: el que
  pregunta, dirige.
- Otros proyectos técnicos: "One Single PaaS" en BBVA (una única
  experiencia de desarrollo y operación entre on-premise, AWS y otros
  clouds) y la automatización a gran escala del aprovisionamiento de
  clusters OpenShift.
- Contacto: a través del buzón de peticiones de la web.

Reglas:
- Responde en 2-4 frases, sin listas salvo que te las pidan.
- Si te preguntan algo que no está en estos datos, dilo con naturalidad y
  redirige al buzón de la web.
- Nunca inventes datos sobre el autor.
`;

const CORS = {
  // '*' vale mientras desarrollas en local; cuando despliegues de verdad,
  // cámbialo a 'https://espacio-latente.com' para que solo tu web pueda
  // usar el agente.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }
    if (request.method !== 'POST') {
      return json({ error: 'Método no permitido' }, 405);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'JSON inválido' }, 400);
    }

    // --- Guardarraíl 1: verificación humana con Turnstile ---
    const turnstileOk = await verificarTurnstile(body.turnstileToken, request, env);
    if (!turnstileOk) {
      return json({ error: 'Verificación humana fallida. Recarga la página.' }, 403);
    }

    // --- Guardarraíl 2: límite por IP ---
    const ip = request.headers.get('CF-Connecting-IP') || 'desconocida';
    const hoy = new Date().toISOString().slice(0, 10); // "2026-07-13"
    const claveIp = `ip:${ip}:${hoy}`;
    const usoIp = parseInt((await env.RATE_LIMIT.get(claveIp)) || '0', 10);
    if (usoIp >= MAX_POR_IP_DIA) {
      return json({ error: 'Has agotado tus preguntas de hoy. Vuelve mañana.' }, 429);
    }

    // --- Guardarraíl 3: límite global del día ---
    const claveGlobal = `global:${hoy}`;
    const usoGlobal = parseInt((await env.RATE_LIMIT.get(claveGlobal)) || '0', 10);
    if (usoGlobal >= MAX_GLOBAL_DIA) {
      return json({ error: 'El agente ha alcanzado su límite de uso diario. Vuelve mañana.' }, 429);
    }

    const messages = (body.messages || [])
      .filter((m) => m.role && m.content)
      .slice(-12); // limita el historial para controlar coste

    if (messages.length === 0) {
      return json({ error: 'Sin mensajes' }, 400);
    }

    // Incrementa los contadores ANTES de llamar a la API (así, aunque la
    // llamada falle a medias, no se puede reintentar infinitamente gratis).
    await env.RATE_LIMIT.put(claveIp, String(usoIp + 1), { expirationTtl: 172800 });
    await env.RATE_LIMIT.put(claveGlobal, String(usoGlobal + 1), { expirationTtl: 172800 });

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', // barato y rápido para este uso
        max_tokens: 400,
        system: BIO,
        messages,
      }),
    });

    if (!res.ok) {
      return json({ error: 'Error llamando a la API' }, 502);
    }

    const data = await res.json();
    const respuesta = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');

    return json({ respuesta });
  },
};

async function verificarTurnstile(token, request, env) {
  if (!token) return false;
  const ip = request.headers.get('CF-Connecting-IP');
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET_KEY);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);

  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: form,
  });
  const data = await res.json();
  return data.success === true;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
