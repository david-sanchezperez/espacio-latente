import { useState, useRef, useEffect } from 'react';

// Respuestas fijas: sin llamadas a ninguna API, sin coste ni tokens.
// Si quieres ampliar lo que "sabe" el agente, añade entradas aquí.
const COMANDOS = [
  {
    etiqueta: '¿Quién eres?',
    comando: 'whoami',
    respuesta: 'David Sánchez Pérez lleva más de 20 años haciendo que la infraestructura sea invisible para que otros puedan construir encima. Hoy es Head of Core Platform - Engineering en BBVA, donde su equipo sostiene la plataforma sobre la que corre un banco. Empezó reconfigurando routers de Telefónica en 2005.',
  },
  {
    etiqueta: '¿Qué te gusta?',
    comando: 'cat intereses.md',
    respuesta: 'Aprender sin pausa: hizo un Máster en IA Aplicada y Avanzada bastante después de terminar la carrera, porque para él estudiar no es una fase. Y, más que el código, le mueven las personas — conseguir que un equipo reme junto pesa más que cualquier arquitectura elegante.',
  },
  {
    etiqueta: '¿En qué proyectos trabajas?',
    comando: 'ls proyectos/',
    respuesta: 'En BBVA lidera "One Single PaaS", una única experiencia de desarrollo y operación entre on-premise, AWS y otros clouds, y la automatización a gran escala del aprovisionamiento de clusters OpenShift. Aquí, en espacio-latente.com, documenta experimentos con agentes, MCP y loop prompting.',
  },
  {
    etiqueta: '¿Qué es esto del rack?',
    comando: 'man rack',
    respuesta: 'Cada módulo del rack es una idea que ha pasado de estado latente a algo concreto: un experimento con agentes, MCP o prompting, documentado y con demo cuando es posible. Este mismo agente es el módulo U-01.',
  },
];

const COMANDO_BUZON = {
  etiqueta: '+ Aportar una idea',
  comando: 'mkdir buzon/idea-nueva',
  respuesta: 'Directorio creado. Bajando al buzón de peticiones ↓',
};

export default function AgenteBio() {
  // Cada entrada del historial es { comando, respuesta } — una vez
  // insertada se teclea sola, línea a línea, como bio.sh.
  const [historial, setHistorial] = useState([]);
  const [enCurso, setEnCurso] = useState(null); // { comando, respuesta, escrito }
  const [usados, setUsados] = useState([]);
  const finRef = useRef(null);
  const reducidoRef = useRef(false);
  const colaRef = useRef([]);
  const escribiendoRef = useRef(false);

  useEffect(() => {
    reducidoRef.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [historial, enCurso]);

  function ejecutar(item) {
    colaRef.current.push(item);
    setUsados((prev) => [...prev, item.etiqueta]);
    if (!escribiendoRef.current) procesarCola();
  }

  async function procesarCola() {
    escribiendoRef.current = true;
    while (colaRef.current.length > 0) {
      const item = colaRef.current.shift();

      if (reducidoRef.current) {
        setHistorial((prev) => [...prev, { comando: item.comando, respuesta: item.respuesta }]);
      } else {
        setEnCurso({ comando: item.comando, texto: '', fase: 'comando' });
        for (let c = 1; c <= item.comando.length; c++) {
          setEnCurso({ comando: item.comando, texto: item.comando.slice(0, c), fase: 'comando' });
          await esperar(28 + Math.random() * 20);
        }
        await esperar(200);
        for (let c = 1; c <= item.respuesta.length; c++) {
          setEnCurso({ comando: item.comando, texto: item.respuesta.slice(0, c), fase: 'respuesta' });
          await esperar(8 + Math.random() * 10);
        }
        await esperar(150);
        setHistorial((prev) => [...prev, { comando: item.comando, respuesta: item.respuesta }]);
        setEnCurso(null);
      }

      if (item.esBuzon) {
        document.getElementById('buzon')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
    escribiendoRef.current = false;
  }

  return (
    <div style={estilos.terminal}>
      <div style={estilos.barra}>
        <span style={{ ...estilos.punto, background: '#ff5f57' }} />
        <span style={{ ...estilos.punto, background: '#febc2e' }} />
        <span style={{ ...estilos.punto, background: '#28c840' }} />
        <span style={estilos.tituloBarra}>agente-bio.sh — U-01</span>
      </div>

      <pre style={estilos.cuerpo}>
        <div style={estilos.linea}>
          <span style={estilos.prompt}>$</span> ./agente-bio --interactivo
        </div>
        <div style={{ ...estilos.linea, color: '#8a97a5' }}>
          Módulo en línea. Elige un comando para conocer al autor de esta web.
        </div>
        {historial.map((h, i) => (
          <div key={i}>
            <div style={estilos.linea}>
              <span style={estilos.prompt}>$</span> {h.comando}
            </div>
            <div style={{ ...estilos.linea, color: '#e9e5da' }}>{h.respuesta}</div>
          </div>
        ))}
        {enCurso && (
          <div>
            <div style={estilos.linea}>
              <span style={estilos.prompt}>$</span> {enCurso.fase === 'comando' ? enCurso.texto : enCurso.comando}
              {enCurso.fase === 'comando' && <span style={{ ...estilos.cursor, animation: 'parpadeo 1s step-end infinite' }}>▋</span>}
            </div>
            {enCurso.fase === 'respuesta' && (
              <div style={{ ...estilos.linea, color: '#e9e5da' }}>
                {enCurso.texto}
                <span style={{ ...estilos.cursor, animation: 'parpadeo 1s step-end infinite' }}>▋</span>
              </div>
            )}
          </div>
        )}
        <div ref={finRef} />
      </pre>

      <div style={estilos.comandos}>
        {COMANDOS.map((c) => (
          <button
            key={c.etiqueta}
            style={estilos.chip}
            onClick={() => ejecutar(c)}
            disabled={usados.includes(c.etiqueta)}
          >
            {c.etiqueta}
          </button>
        ))}
        <button
          style={estilos.chipDestacado}
          onClick={() => ejecutar({ ...COMANDO_BUZON, esBuzon: true })}
        >
          {COMANDO_BUZON.etiqueta}
        </button>
      </div>
    </div>
  );
}

function esperar(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const estilos = {
  terminal: {
    background: '#0d0f13',
    border: '1px solid #2c333d',
    borderRadius: 6,
    overflow: 'hidden',
    boxShadow: '0 0 40px rgba(255, 180, 84, 0.06)',
  },
  barra: {
    display: 'flex', alignItems: 'center', gap: '0.4rem',
    padding: '0.55rem 0.8rem',
    background: '#161a20',
    borderBottom: '1px solid #2c333d',
  },
  punto: { width: 10, height: 10, borderRadius: '50%', display: 'inline-block' },
  tituloBarra: {
    marginLeft: '0.6rem',
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: '0.72rem', color: '#8a97a5', letterSpacing: '0.04em',
  },
  cuerpo: {
    margin: 0,
    padding: '1.1rem 1.2rem',
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: '0.92rem',
    lineHeight: 1.7,
    whiteSpace: 'pre-wrap',
    maxHeight: 340,
    overflowY: 'auto',
  },
  linea: { color: '#7adb8f' },
  prompt: { color: '#ffb454' },
  cursor: { color: '#ffb454', marginLeft: 2 },
  comandos: {
    display: 'flex', flexWrap: 'wrap', gap: '0.5rem',
    padding: '0.75rem 1.2rem 1.1rem',
    borderTop: '1px solid #2c333d',
  },
  chip: {
    background: 'transparent', border: '1px solid #2c333d',
    color: '#8a97a5', fontSize: '0.78rem', padding: '0.35rem 0.7rem',
    cursor: 'pointer', fontFamily: "'IBM Plex Mono', monospace",
  },
  chipDestacado: {
    background: 'transparent', border: '1px solid #ffb454',
    color: '#ffb454', fontSize: '0.78rem', padding: '0.35rem 0.7rem',
    cursor: 'pointer', fontFamily: "'IBM Plex Mono', monospace",
  },
};
