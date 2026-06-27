export function QuickActions() {
  const actions = [
    { label: 'NOTEPAD', action: () => window.jarvis.openApp('notepad') },
    { label: 'CHROME', action: () => window.jarvis.openApp('chrome') },
    { label: 'CALC', action: () => window.jarvis.openApp('calc') },
    { label: 'VOL 50%', action: () => window.jarvis.setVolume(50) },
    { label: 'VOL 100%', action: () => window.jarvis.setVolume(100) },
    { label: 'LOCK PC', action: () => window.jarvis.lockWorkstation() }
  ]

  return (
    <div className="panel">
      <div className="panel-header">QUICK ACTIONS</div>
      <div className="panel-body">
        <div className="quick-actions">
          {actions.map((a) => (
            <button key={a.label} type="button" className="quick-btn" onClick={a.action}>
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
