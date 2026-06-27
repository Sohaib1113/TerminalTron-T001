import { useJarvisStore } from '../store/jarvisStore'

export function TitleBar() {
  const setShowSettings = useJarvisStore((s) => s.setShowSettings)
  const overlayMode = useJarvisStore((s) => s.settings.overlayMode)

  return (
    <div className="title-bar">
      <h1>J.A.R.V.I.S — M1 {overlayMode ? '· OVERLAY' : ''}</h1>
      <div className="window-controls">
        <button type="button" title="Settings" onClick={() => setShowSettings(true)}>
          ⚙
        </button>
        <button type="button" onClick={() => window.jarvis.minimize()}>
          ─
        </button>
        {!overlayMode && (
          <button type="button" onClick={() => window.jarvis.maximize()}>
            ▢
          </button>
        )}
        <button type="button" className="close" onClick={() => window.jarvis.close()}>
          ✕
        </button>
      </div>
    </div>
  )
}
