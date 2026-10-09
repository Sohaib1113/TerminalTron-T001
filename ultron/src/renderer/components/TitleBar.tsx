import { MouseEvent, useEffect, useState } from 'react';
import logo from '../assets/terminatron-logo.png';
import './TitleBar.css';

const MENUS = ['File', 'Edit', 'View', 'Window', 'Help'];

export default function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const bridge = window.electron;
    if (!bridge) {
      return undefined;
    }

    void bridge
      .invoke('window:state')
      .then((state) => {
        const payload = state as { maximized?: boolean } | undefined;
        setMaximized(Boolean(payload?.maximized));
      })
      .catch(() => undefined);

    return bridge.on('window:state', (...args: unknown[]) => {
      const payload = args[0] as { maximized?: boolean } | undefined;
      setMaximized(Boolean(payload?.maximized));
    });
  }, []);

  const windowAction = (channel: string) => {
    void window.electron?.invoke(channel).catch(() => undefined);
  };

  const openMenu = (event: MouseEvent<HTMLButtonElement>, label: string) => {
    event.preventDefault();
    void window.electron?.invoke('menu:popup', { label }).catch(() => undefined);
  };

  return (
    <header className="title-bar">
      <div className="title-bar-brand">
        <img className="brand-logo" src={logo} alt="" aria-hidden="true" />
        <span className="title-bar-wordmark">TerminalTron-T001</span>
      </div>

      <nav className="title-bar-menu">
        {MENUS.map((label) => (
          <button
            key={label}
            type="button"
            className="title-menu-item"
            onClick={(event) => openMenu(event, label)}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="title-bar-controls">
        <button
          type="button"
          className="window-control minimize"
          title="Minimize"
          aria-label="Minimize"
          onClick={() => windowAction('window:minimize')}
        >
          <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
            <path d="M1 6h10" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        </button>
        <button
          type="button"
          className="window-control maximize"
          title={maximized ? 'Restore' : 'Maximize'}
          aria-label={maximized ? 'Restore' : 'Maximize'}
          onClick={() => windowAction('window:toggle-maximize')}
        >
          {maximized ? (
            <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
              <rect x="1" y="3" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1.2" />
              <path d="M3 3V1h8v8H9" fill="none" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          ) : (
            <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
              <rect x="1.5" y="1.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.4" />
            </svg>
          )}
        </button>
        <button
          type="button"
          className="window-control close"
          title="Close"
          aria-label="Close"
          onClick={() => windowAction('window:close')}
        >
          <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
            <path d="M1.5 1.5l9 9m0-9l-9 9" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        </button>
      </div>
    </header>
  );
}
