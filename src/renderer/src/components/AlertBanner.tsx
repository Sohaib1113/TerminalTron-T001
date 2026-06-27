import { useJarvisStore } from '../store/jarvisStore'

export function AlertBanner() {
  const alerts = useJarvisStore((s) => s.alerts)
  const dismissAlert = useJarvisStore((s) => s.dismissAlert)

  if (alerts.length === 0) return null

  return (
    <div className="alert-stack">
      {alerts.map((alert) => (
        <div key={alert.id} className={`alert-banner ${alert.severity}`}>
          <div className="alert-content">
            <span className="alert-tag">{alert.metric.toUpperCase()}</span>
            <span>{alert.message}</span>
          </div>
          <button type="button" className="alert-dismiss" onClick={() => dismissAlert(alert.id)}>
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
