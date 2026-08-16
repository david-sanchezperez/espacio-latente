// Chrome de terminal (barra macOS con los tres puntos) compartido por
// AgenteBio.jsx y TerminalBio.jsx.
export const estilosTerminal = {
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
  cursor: { color: '#ffb454', marginLeft: 2 },
};
