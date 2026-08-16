import { useState, useEffect, useRef } from 'react';
import { estilosTerminal } from './estilosTerminal';

/**
 * Terminal de arranque para la bio. Teclea línea a línea con cursor
 * parpadeante, como una consola antigua encendiéndose.
 *
 * Uso:
 *   <TerminalBio lineas={["> primera línea", "> segunda línea"]} />
 */
export default function TerminalBio({ lineas = [] }) {
  const [visibles, setVisibles] = useState([]); // líneas ya completadas
  const [actual, setActual] = useState('');     // línea en curso de tecleo
  const [terminado, setTerminado] = useState(false);
  const reducidoRef = useRef(false);

  useEffect(() => {
    reducidoRef.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Si el usuario prefiere menos movimiento, mostramos todo de golpe.
    if (reducidoRef.current) {
      setVisibles(lineas);
      setTerminado(true);
      return;
    }

    let cancelado = false;
    async function escribir() {
      for (let i = 0; i < lineas.length; i++) {
        const linea = lineas[i];
        for (let c = 1; c <= linea.length; c++) {
          if (cancelado) return;
          setActual(linea.slice(0, c));
          // velocidad variable: más rápido en general, con alguna pausa
          // para que no parezca metrónomo
          await esperar(18 + Math.random() * 22);
        }
        if (cancelado) return;
        setVisibles((prev) => [...prev, linea]);
        setActual('');
        await esperar(280); // pausa entre líneas, como un salto de prompt
      }
      if (!cancelado) setTerminado(true);
    }
    escribir();
    return () => { cancelado = true; };
  }, [lineas]);

  return (
    <div style={estilos.terminal}>
      <div style={estilos.barra}>
        <span style={{ ...estilos.punto, background: '#ff5f57' }} />
        <span style={{ ...estilos.punto, background: '#febc2e' }} />
        <span style={{ ...estilos.punto, background: '#28c840' }} />
        <span style={estilos.tituloBarra}>bio.sh — espacio-latente</span>
      </div>
      <pre style={estilos.cuerpo}>
        {visibles.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
        <div>
          {actual}
          <span style={{ ...estilos.cursor, ...(terminado ? estilos.cursorParpadea : {}) }}>▋</span>
        </div>
      </pre>
    </div>
  );
}

function esperar(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const estilos = {
  ...estilosTerminal,
  cuerpo: {
    margin: 0,
    padding: '1.1rem 1.2rem 1.3rem',
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: '0.92rem',
    lineHeight: 1.7,
    color: '#7adb8f',
    whiteSpace: 'pre-wrap',
    minHeight: '7.5em',
  },
  cursorParpadea: {
    animation: 'parpadeo 1s step-end infinite',
  },
};
