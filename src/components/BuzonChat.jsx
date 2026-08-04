import { useState, useRef, useEffect } from 'react';

const WORKER_URL = 'https://espacio-latente-buzon.dvd-sanchez.workers.dev';
const TURNSTILE_SITE_KEY = '0x4AAAAAAEFkFaHzEzM8UCfU';
const MAX_TURNOS = 5; // debe coincidir con MAX_TURNOS_USUARIO del worker

export default function BuzonChat({ strings }) {
  const t = (clave) => strings?.[clave] ?? clave;

  const [mensajes, setMensajes] = useState([]);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);
  const [cerrada, setCerrada] = useState(false);
  const [resumen, setResumen] = useState(null);
  const [tokenListo, setTokenListo] = useState(false);

  const widgetIdRef = useRef(null);
  const tokenRef = useRef(null);
  const contenedorRef = useRef(null);
  const finRef = useRef(null);

  const turnosUsuario = mensajes.filter((m) => m.role === 'user').length;
  // "cerrada" (la IA propuso un resumen) NO bloquea el chat — el visitante
  // puede seguir matizando. Solo el tope real de turnos lo bloquea.
  const limiteAlcanzado = turnosUsuario >= MAX_TURNOS;

  // Carga el script de Turnstile una sola vez y renderiza el widget.
  useEffect(() => {
    function render() {
      if (!contenedorRef.current || widgetIdRef.current !== null) return;
      widgetIdRef.current = window.turnstile.render(contenedorRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (token) => {
          tokenRef.current = token;
          setTokenListo(true);
        },
        'expired-callback': () => {
          tokenRef.current = null;
          setTokenListo(false);
        },
      });
    }

    if (window.turnstile) {
      render();
    } else {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
      script.async = true;
      script.defer = true;
      script.onload = render;
      document.head.appendChild(script);
    }
  }, []);

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [mensajes]);

  async function mandar() {
    const contenido = texto.trim();
    if (!contenido || enviando || limiteAlcanzado || !tokenRef.current) return;

    const nuevos = [...mensajes, { role: 'user', content: contenido }];
    setMensajes(nuevos);
    setTexto('');
    setEnviando(true);
    setError(null);

    try {
      const res = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nuevos, turnstileToken: tokenRef.current }),
      });
      const datos = await res.json();

      // El token de Turnstile se consume en cada verificación — hay que
      // renovarlo para el siguiente mensaje.
      tokenRef.current = null;
      setTokenListo(false);
      if (widgetIdRef.current !== null) window.turnstile?.reset(widgetIdRef.current);

      if (!res.ok) {
        setError(datos.error || t('buzon.chat.error'));
        return;
      }

      // El marcador RESUMEN_SUGERENCIA es para nosotros, no para mostrarlo tal cual.
      const visible = (datos.respuesta || '').replace(/RESUMEN_SUGERENCIA:.*/s, '').trim();
      setMensajes((prev) => [...prev, { role: 'assistant', content: visible || datos.respuesta }]);
      if (datos.cerrada) {
        setCerrada(true);
        setResumen(datos.resumen);
      }
    } catch {
      setError(t('buzon.chat.error'));
    } finally {
      setEnviando(false);
    }
  }

  function usarResumen() {
    const textarea = document.querySelector('.form-buzon textarea[name="mensaje"]');
    if (textarea && resumen) {
      textarea.value = resumen;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
      textarea.focus();
    }
  }

  return (
    <div style={estilos.caja}>
      <p style={estilos.titulo}>{t('buzon.chat.titulo')}</p>
      <p style={estilos.intro}>{t('buzon.chat.intro')}</p>

      {mensajes.length > 0 && (
        <div style={estilos.log}>
          {mensajes.map((m, i) => (
            <div key={i} style={m.role === 'user' ? estilos.lineaUsuario : estilos.lineaAsistente}>
              <span style={estilos.autor}>{m.role === 'user' ? 'tú' : 'ia'}</span> {m.content}
            </div>
          ))}
          <div ref={finRef} />
        </div>
      )}

      {error && <p style={estilos.errorTexto}>{error}</p>}

      {cerrada && resumen && (
        <button type="button" style={estilos.botonResumen} onClick={usarResumen}>
          {t('buzon.chat.usarResumen')}
        </button>
      )}

      {limiteAlcanzado ? (
        <p style={estilos.aviso}>{t('buzon.chat.limite')}</p>
      ) : (
        <div style={estilos.fila}>
          <input
            type="text"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && mandar()}
            placeholder={t('buzon.chat.placeholder')}
            disabled={enviando}
            style={estilos.input}
          />
          <button
            type="button"
            onClick={mandar}
            disabled={enviando || !texto.trim() || !tokenListo}
            style={estilos.boton}
          >
            {enviando ? t('buzon.chat.pensando') : !tokenListo ? t('buzon.chat.verificando') : t('buzon.chat.enviar')}
          </button>
        </div>
      )}

      <div ref={contenedorRef} style={{ marginTop: '0.6rem' }} />
    </div>
  );
}

const estilos = {
  caja: {
    background: '#0d0f13', border: '1px solid #2c333d', borderRadius: 6,
    padding: '1rem 1.1rem', marginBottom: '1.25rem',
  },
  titulo: { margin: 0, fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.85rem', color: '#ffb454' },
  intro: { margin: '0.35rem 0 0.8rem', fontSize: '0.85rem', color: '#8a97a5' },
  log: {
    fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.85rem', lineHeight: 1.6,
    maxHeight: 260, overflowY: 'auto', marginBottom: '0.7rem',
  },
  lineaUsuario: { color: '#e9e5da', marginBottom: '0.35rem' },
  lineaAsistente: { color: '#7adb8f', marginBottom: '0.35rem' },
  autor: { color: '#5c6b7a' },
  fila: { display: 'flex', gap: '0.5rem' },
  input: {
    flex: 1, background: '#161a20', border: '1px solid #2c333d', borderRadius: 4,
    padding: '0.5rem 0.7rem', color: '#e9e5da', fontFamily: 'inherit', fontSize: '0.9rem',
  },
  boton: {
    background: 'transparent', border: '1px solid #ffb454', color: '#ffb454',
    padding: '0.5rem 0.9rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem',
    whiteSpace: 'nowrap',
  },
  botonResumen: {
    background: 'transparent', border: '1px solid #7adb8f', color: '#7adb8f',
    padding: '0.55rem 0.9rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem', width: '100%',
    marginBottom: '0.6rem',
  },
  aviso: { fontSize: '0.82rem', color: '#8a97a5' },
  errorTexto: { fontSize: '0.82rem', color: '#ff8a8a', marginBottom: '0.5rem' },
};
