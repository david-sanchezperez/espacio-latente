/**
 * Worker: buzón interactivo
 * El buzón de sugerencias deja de ser un textarea suelto: el visitante
 * charla un poco con DeepSeek para acotar la idea antes de mandarla.
 * La API key vive en un secret de Cloudflare (nunca en el frontend).
 *
 * GUARDARRAÍLES contra abuso (mismo patrón que worker/ — agente-bio):
 *   1. Turnstile: el frontend debe enviar un token de Cloudflare Turnstile
 *      que aquí se verifica antes de gastar un solo token de la API.
 *   2. Límite por IP: máx. MAX_POR_IP_DIA peticiones/día por IP.
 *   3. Límite global: máx. MAX_GLOBAL_DIA peticiones/día para todo el sitio.
 *   4. Tope duro de turnos: MAX_TURNOS_USUARIO mensajes de usuario por
 *      conversación — se cuenta en el propio historial recibido, no hace
 *      falta estado en servidor. Se corta aquí, no se confía en que el
 *      modelo respete "sé breve" del prompt.
 *   5. `thinking` desactivado y `max_tokens` bajo: probado a mano — sin esto
 *      el modelo (razonador) puede gastar el tope entero "pensando" y
 *      devolver una respuesta vacía. Desactivado, cada turno cuesta
 *      fracciones de céntimo y es predecible.
 *   6. Además, pon un límite de gasto mensual en platform.deepseek.com
 *      como último cinturón de seguridad.
 *
 * Requiere el mismo KV namespace que worker/ (ver wrangler.toml).
 *
 * Despliegue:
 *   cd worker-buzon
 *   npx wrangler secret put DEEPSEEK_API_KEY
 *   npx wrangler secret put TURNSTILE_SECRET_KEY
 *   npx wrangler deploy
 */

const MAX_POR_IP_DIA = 30;      // peticiones máx. por visitante al día (~6 conversaciones)
const MAX_GLOBAL_DIA = 300;     // peticiones máx. para todo el sitio al día
const MAX_TURNOS_USUARIO = 5;   // mensajes de usuario máx. por conversación

const SYSTEM_PROMPT = `Eres el asistente del buzón de sugerencias de "Espacio Latente", un blog sobre el funcionamiento interno de los LLM y construcción de agentes/sistemas de IA (espacio-latente.com). Tu único trabajo es ayudar a un visitante a perfilar UNA sugerencia de contenido o experimento para el blog: qué le gustaría ver explicado, qué duda tiene sobre LLMs/agentes, o qué le gustaría ver documentado.

Reglas estrictas:
- Si el mensaje del usuario no tiene nada que ver con sugerir contenido para este blog (temas: LLMs, embeddings, agentes, arquitecturas de IA, o el propio funcionamiento de este blog/proyectos), NO respondas su pregunta. Redirige explicando que solo puedes ayudar a perfilar sugerencias para el blog.
- No des consejo médico, legal, financiero, ni generes código, ensayos largos, ni nada que no sea acotar una idea de sugerencia.
- Sé breve: 2-4 frases por respuesta, nunca más.
- Cuando tengas claro qué está pidiendo, responde con exactamente este formato al final de tu respuesta:
RESUMEN_SUGERENCIA: <una frase resumiendo la sugerencia lista para enviar>
- No emitas RESUMEN_SUGERENCIA hasta tener claro el tema.`;

// Solo la propia web puede usar el buzón. Con '*' cualquier página de
// cualquier dominio podía gastar la API key desde el navegador de sus
// visitantes. Para desarrollo local se admite además localhost:4321.
const ORIGENES_PERMITIDOS = new Set([
  'https://espacio-latente.com',
  'https://www.espacio-latente.com',
  'http://localhost:4321',
]);

function cabecerasCors(request) {
  const origen = request.headers.get('Origin');
  return {
    'Access-Control-Allow-Origin': ORIGENES_PERMITIDOS.has(origen) ? origen : 'https://espacio-latente.com',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

export default {
  async fetch(request, env) {
    const cors = cabecerasCors(request);
    const responder = (obj, status = 200) => json(obj, status, cors);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }
    if (request.method !== 'POST') {
      return responder({ error: 'Método no permitido' }, 405);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return responder({ error: 'JSON inválido' }, 400);
    }

    // --- Guardarraíl 1: verificación humana con Turnstile ---
    const turnstileOk = await verificarTurnstile(body.turnstileToken, request, env);
    if (!turnstileOk) {
      return responder({ error: 'Verificación humana fallida. Recarga la página.' }, 403);
    }

    // --- Guardarraíl 2: límite por IP ---
    const ip = request.headers.get('CF-Connecting-IP') || 'desconocida';
    const hoy = new Date().toISOString().slice(0, 10);
    const claveIp = `buzon:ip:${ip}:${hoy}`;
    const usoIp = parseInt((await env.RATE_LIMIT.get(claveIp)) || '0', 10);
    if (usoIp >= MAX_POR_IP_DIA) {
      return responder({ error: 'Has agotado tus mensajes de hoy. Vuelve mañana.' }, 429);
    }

    // --- Guardarraíl 3: límite global del día ---
    const claveGlobal = `buzon:global:${hoy}`;
    const usoGlobal = parseInt((await env.RATE_LIMIT.get(claveGlobal)) || '0', 10);
    if (usoGlobal >= MAX_GLOBAL_DIA) {
      return responder({ error: 'El buzón ha alcanzado su límite de uso diario. Vuelve mañana.' }, 429);
    }

    const messages = (body.messages || [])
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim());

    if (messages.length === 0) {
      return responder({ error: 'Sin mensajes' }, 400);
    }

    // --- Guardarraíl 4: tope duro de turnos, no se confía en el prompt ---
    const turnosUsuario = messages.filter((m) => m.role === 'user').length;
    if (turnosUsuario > MAX_TURNOS_USUARIO) {
      return responder({
        respuesta: 'Hemos hablado ya un rato — cuéntamelo en una frase y lo mando tal cual.',
        cerrada: true,
      });
    }

    // Incrementa los contadores ANTES de llamar a la API.
    await env.RATE_LIMIT.put(claveIp, String(usoIp + 1), { expirationTtl: 172800 });
    await env.RATE_LIMIT.put(claveGlobal, String(usoGlobal + 1), { expirationTtl: 172800 });

    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        thinking: { type: 'disabled' }, // probado a mano: sin esto puede gastar todo max_tokens "pensando"
        max_tokens: 400,
        temperature: 0.4,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
      }),
    });

    if (!res.ok) {
      return responder({ error: 'Error llamando a la API' }, 502);
    }

    const data = await res.json();
    const respuesta = data.choices?.[0]?.message?.content || '';

    const match = respuesta.match(/RESUMEN_SUGERENCIA:\s*(.+)/s);
    return responder({
      respuesta,
      cerrada: Boolean(match),
      resumen: match ? match[1].trim() : null,
    });
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

function json(obj, status = 200, cors = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}
