import { useState, useRef, useEffect } from 'react';

// Respuestas fijas: sin llamadas a ninguna API, sin coste ni tokens.
// Si quieres ampliar lo que "sabe" el agente, añade entradas aquí.
const SUGERENCIAS = [
  {
    pregunta: '¿Quién eres?',
    respuesta: 'David Sánchez Pérez lleva más de 20 años haciendo que la infraestructura sea invisible para que otros puedan construir encima. Hoy es Head of Core Platform - Engineering en BBVA, donde su equipo sostiene la plataforma sobre la que corre un banco. Empezó reconfigurando routers de Telefónica en 2005.',
  },
  {
    pregunta: '¿Qué te gusta?',
    respuesta: 'Aprender sin pausa: hizo un Máster en IA Aplicada y Avanzada bastante después de terminar la carrera, porque para él estudiar no es una fase. Y, más que el código, le mueven las personas — conseguir que un equipo reme junto pesa más que cualquier arquitectura elegante.',
  },
  {
    pregunta: '¿En qué proyectos trabajas?',
    respuesta: 'En BBVA lidera "One Single PaaS", una única experiencia de desarrollo y operación entre on-premise, AWS y otros clouds, y la automatización a gran escala del aprovisionamiento de clusters OpenShift. Aquí, en espacio-latente.com, documenta experimentos con agentes, MCP y loop prompting.',
  },
  {
    pregunta: '¿Qué es esto del rack?',
    respuesta: 'Cada módulo del rack es una idea que ha pasado de estado latente a algo concreto: un experimento con agentes, MCP o prompting, documentado y con demo cuando es posible. Este mismo agente es el módulo U-01.',
  },
];

export default function AgenteBio() {
  const [mensajes, setMensajes] = useState([
    { rol: 'agente', texto: 'Módulo U-01 en línea. Elige una pregunta y te cuento quién es el autor de esta web, qué hace o qué encontrarás aquí.' },
  ]);
  const [usadas, setUsadas] = useState([]);
  const finRef = useRef(null);

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [mensajes]);

  function preguntar(item) {
    setMensajes((prev) => [
      ...prev,
      { rol: 'usuario', texto: item.pregunta },
      { rol: 'agente', texto: item.respuesta },
    ]);
    setUsadas((prev) => [...prev, item.pregunta]);
  }

  function irAlBuzon() {
    setMensajes((prev) => [
      ...prev,
      { rol: 'usuario', texto: 'Quiero aportar una idea' },
      { rol: 'agente', texto: 'Buen módulo para instalar. Bajando al buzón de peticiones ↓' },
    ]);
    document.getElementById('buzon')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div style={estilos.caja}>
      <div style={estilos.cabecera}>
        <span style={estilos.led} />
        <span style={estilos.cabeceraTexto}>U-01 · AGENTE-BIO</span>
      </div>

      <div style={estilos.mensajes}>
        {mensajes.map((m, i) => (
          <div key={i} style={m.rol === 'usuario' ? estilos.msgUsuario : estilos.msgAgente}>
            {m.texto}
          </div>
        ))}
        <div ref={finRef} />
      </div>

      <div style={estilos.sugerencias}>
        {SUGERENCIAS.map((s) => (
          <button
            key={s.pregunta}
            style={estilos.chip}
            onClick={() => preguntar(s)}
            disabled={usadas.includes(s.pregunta)}
          >
            {s.pregunta}
          </button>
        ))}
        <button style={estilos.chipDestacado} onClick={irAlBuzon}>
          + Aportar una idea
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
  chipDestacado: {
    background: 'transparent', border: '1px solid #ffb454',
    color: '#ffb454', fontSize: '0.78rem', padding: '0.35rem 0.7rem',
    cursor: 'pointer', fontFamily: "'IBM Plex Mono', monospace",
  },
};
