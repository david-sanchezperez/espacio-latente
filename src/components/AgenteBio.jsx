import { useState, useRef, useEffect } from 'react';

// URL de tu Worker desplegado (cámbiala tras `wrangler deploy`)
const WORKER_URL = 'https://espacio-latente-agente-bio.TU-SUBDOMINIO.workers.dev';

// Site key pública de Turnstile (dashboard.cloudflare.com → Turnstile → Add site)
// Esta SÍ va en el frontend, es pública por diseño; el secreto va solo en el Worker.
const TURNSTILE_SITE_KEY = 'TU_SITE_KEY_DE_TURNSTILE';

const SUGERENCIAS = [
  '¿Quién eres?',
  '¿En qué proyectos trabajas?',
  '¿Qué es esto del rack?',
];

export default function AgenteBio() {
  const [mensajes, setMensajes] = useState([
    { rol: 'agente', texto: 'Módulo U-01 en línea. Soy el agente de esta web: pregúntame quién es su autor, qué hace o qué encontrarás aquí.' },
  ]);
  const [entrada, setEntrada] = useState('');
  const [cargando, setCargando] = useState(false);
  const [tsToken, setTsToken] = useState(null);
  const [tsListo, setTsListo] = useState(false);
  const finRef = useRef(null);
  const tsContenedorRef = useRef(null);
  const tsWidgetId = useRef(null);

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [mensajes, cargando]);

  // Carga el script de Turnstile y renderiza el widget invisible.
  // Sin un token válido, no se puede enviar ninguna pregunta.
  useEffect(() => {
    function renderizar() {
      if (!window.turnstile || tsWidgetId.current !== null) return;
      tsWidgetId.current = window.turnstile.render(tsContenedorRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        size: 'invisible',
        callback: (token) => setTsToken(token),
        'expired-callback': () => setTsToken(null),
        'error-callback': () => setTsToken(null),
      });
      setTsListo(true);
    }

    if (window.turnstile) {
      renderizar();
    } else {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
      script.async = true;
      script.onload = renderizar;
      document.head.appendChild(script);
    }
  }, []);

  async function enviar(texto) {
    const pregunta = (texto ?? entrada).trim();
    if (!pregunta || cargando) return;

    if (!tsToken) {
      setMensajes((prev) => [
        ...prev,
        { rol: 'agente', texto: 'Verificando que no eres un robot… vuelve a intentarlo en un segundo.' },
      ]);
      window.turnstile?.execute(tsWidgetId.current);
      return;
    }

    setEntrada('');
    const historial = [...mensajes, { rol: 'usuario', texto: pregunta }];
    setMensajes(historial);
    setCargando(true);
    try {
      const res = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          turnstileToken: tsToken,
          // El Worker espera el historial en formato { role, content }
          messages: historial.map((m) => ({
            role: m.rol === 'usuario' ? 'user' : 'assistant',
            content: m.texto,
          })),
        }),
      });
      // Cada token de Turnstile es de un solo uso: pide uno nuevo para el
      // siguiente mensaje.
      setTsToken(null);
      window.turnstile?.reset(tsWidgetId.current);

      if (res.status === 429) {
        const data = await res.json();
        setMensajes((prev) => [...prev, { rol: 'agente', texto: data.error }]);
        return;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      setMensajes((prev) => [...prev, { rol: 'agente', texto: data.respuesta }]);
    } catch (err) {
      setMensajes((prev) => [
        ...prev,
        { rol: 'agente', texto: 'Fallo en el enlace con el módulo. Comprueba que el Worker está desplegado y la URL es correcta.' },
      ]);
    } finally {
      setCargando(false);
    }
  }

  return (
    <div style={estilos.caja}>
      <div style={estilos.cabecera}>
        <span style={estilos.led} />
        <span style={estilos.cabeceraTexto}>U-01 · AGENTE-BIO · EN VIVO</span>
      </div>

      <div style={estilos.mensajes}>
        {mensajes.map((m, i) => (
          <div key={i} style={m.rol === 'usuario' ? estilos.msgUsuario : estilos.msgAgente}>
            {m.texto}
          </div>
        ))}
        {cargando && <div style={estilos.msgAgente}>▋ procesando…</div>}
        <div ref={finRef} />
      </div>

      <div style={estilos.sugerencias}>
        {SUGERENCIAS.map((s) => (
          <button key={s} style={estilos.chip} onClick={() => enviar(s)} disabled={cargando}>
            {s}
          </button>
        ))}
      </div>

      <div ref={tsContenedorRef} />
      <div style={estilos.entradaFila}>
        <input
          style={estilos.input}
          value={entrada}
          onChange={(e) => setEntrada(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && enviar()}
          placeholder="Escribe tu pregunta…"
          aria-label="Pregunta para el agente"
        />
        <button style={estilos.boton} onClick={() => enviar()} disabled={cargando}>
          Enviar
        </button>
      </div>
    </div>
  );
}

const estilos = {
  caja: {
    background: '#1a1f26',
    border: '1px solid #2c333d',
    fontFamily: "'IBM Plex Sans', sans-serif",
  },
  cabecera: {
    display: 'flex', alignItems: 'center', gap: '0.5rem',
    padding: '0.6rem 1rem',
    borderBottom: '1px solid #2c333d',
  },
  led: {
    width: 8, height: 8, borderRadius: '50%',
    background: '#7adb8f', boxShadow: '0 0 8px #7adb8f',
  },
  cabeceraTexto: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: '0.72rem', letterSpacing: '0.1em', color: '#8a97a5',
  },
  mensajes: {
    padding: '1rem', display: 'flex', flexDirection: 'column',
    gap: '0.6rem', maxHeight: 320, overflowY: 'auto',
  },
  msgAgente: {
    alignSelf: 'flex-start', maxWidth: '85%',
    background: '#12151a', border: '1px solid #2c333d',
    padding: '0.6rem 0.85rem', fontSize: '0.92rem', color: '#e9e5da',
    whiteSpace: 'pre-wrap',
  },
  msgUsuario: {
    alignSelf: 'flex-end', maxWidth: '85%',
    background: '#2a2116', border: '1px solid #4a3a20',
    padding: '0.6rem 0.85rem', fontSize: '0.92rem', color: '#ffb454',
    whiteSpace: 'pre-wrap',
  },
  sugerencias: {
    display: 'flex', flexWrap: 'wrap', gap: '0.5rem',
    padding: '0 1rem 0.75rem',
  },
  chip: {
    background: 'transparent', border: '1px solid #2c333d',
    color: '#8a97a5', fontSize: '0.78rem', padding: '0.35rem 0.7rem',
    cursor: 'pointer', fontFamily: "'IBM Plex Mono', monospace",
  },
  entradaFila: {
    display: 'flex', gap: '0.5rem', padding: '0.75rem 1rem',
    borderTop: '1px solid #2c333d',
  },
  input: {
    flex: 1, background: '#12151a', border: '1px solid #2c333d',
    color: '#e9e5da', padding: '0.6rem 0.8rem', fontSize: '0.92rem',
    fontFamily: 'inherit',
  },
  boton: {
    background: '#ffb454', color: '#12151a', border: 'none',
    padding: '0.6rem 1.1rem', cursor: 'pointer',
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.06em',
  },
};
