import { useJarvisStore } from '../store/jarvisStore'
import { CoreStatusBadge } from './CoreStatusBadge'

type Props = {
  label: string
  value: string | number
  percent?: number
  warnAt?: number
  critAt?: number
}

export function StatGauge({ label, value, percent, warnAt = 70, critAt = 90 }: Props) {
  let fillClass = ''
  if (percent !== undefined) {
    if (percent >= critAt) fillClass = 'crit'
    else if (percent >= warnAt) fillClass = 'warn'
  }

  return (
    <div>
      <div className="stat-row">
        <span>{label}</span>
        <span>{value}</span>
      </div>
      {percent !== undefined && (
        <div className="progress-bar">
          <div className={`progress-fill ${fillClass}`} style={{ width: `${Math.min(100, percent)}%` }} />
        </div>
      )}
    </div>
  )
}

export function SystemPanel() {
  const stats = useJarvisStore((s) => s.systemStats)

  if (!stats) {
    return (
      <div className="panel">
        <div className="panel-header">TELEMETRY</div>
        <div className="panel-body">Scanning systems...</div>
      </div>
    )
  }

  return (
    <div className="panel">
      <div className="panel-header">TELEMETRY</div>
      <div className="panel-body">
        <StatGauge label="CPU LOAD" value={`${stats.cpuLoad}%`} percent={stats.cpuLoad} />
        <StatGauge
          label="MEMORY"
          value={`${stats.memoryUsedGb} / ${stats.memoryTotalGb} GB`}
          percent={stats.memoryUsedPercent}
        />
        <StatGauge label="STORAGE" value={`${stats.diskUsedPercent}%`} percent={stats.diskUsedPercent} />
        <div className="stat-row">
          <span>UPTIME</span>
          <span>{stats.uptimeHours}h</span>
        </div>
        {stats.cpuTemp !== null && (
          <div className="stat-row">
            <span>CPU TEMP</span>
            <span>{stats.cpuTemp}°C</span>
          </div>
        )}
        <div className="stat-row">
          <span>HOST</span>
          <span style={{ fontSize: 12 }}>{stats.hostname}</span>
        </div>
        <CoreStatusBadge />
      </div>
    </div>
  )
}
