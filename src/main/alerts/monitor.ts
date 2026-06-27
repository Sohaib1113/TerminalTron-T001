import type { BrowserWindow } from 'electron'
import { getSystemStats } from '../system/controller'
import type { JarvisSettings, SystemAlert } from '@shared/types'

const COOLDOWN_MS = 5 * 60 * 1000

type AlertKey = `${SystemAlert['metric']}:${SystemAlert['severity']}`

export class AlertMonitor {
  private interval: NodeJS.Timeout | null = null
  private lastFired = new Map<AlertKey, number>()
  private getSettings: () => JarvisSettings

  constructor(getSettings: () => JarvisSettings) {
    this.getSettings = getSettings
  }

  start(getWindow: () => BrowserWindow | null): void {
    if (this.interval) return

    this.interval = setInterval(async () => {
      const settings = this.getSettings()
      if (!settings.proactiveAlerts) return

      try {
        const stats = await getSystemStats()
        const alerts = this.evaluate(stats, settings)
        const win = getWindow()
        for (const alert of alerts) {
          win?.webContents.send('alert:system', alert)
        }
      } catch {
        /* ignore transient failures */
      }
    }, 10000)
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
  }

  private evaluate(
    stats: Awaited<ReturnType<typeof getSystemStats>>,
    settings: JarvisSettings
  ): SystemAlert[] {
    const alerts: SystemAlert[] = []
    const now = Date.now()

    const push = (alert: Omit<SystemAlert, 'id' | 'timestamp'>) => {
      const key: AlertKey = `${alert.metric}:${alert.severity}`
      const last = this.lastFired.get(key) ?? 0
      if (now - last < COOLDOWN_MS) return

      this.lastFired.set(key, now)
      alerts.push({ ...alert, id: `${key}-${now}`, timestamp: now })
    }

    if (stats.cpuLoad >= settings.alertCpuThreshold) {
      push({
        severity: stats.cpuLoad >= 95 ? 'crit' : 'warn',
        metric: 'cpu',
        message: `CPU load elevated at ${stats.cpuLoad}%, sir. You may wish to close heavy processes.`,
        value: stats.cpuLoad
      })
    }

    if (stats.memoryUsedPercent >= settings.alertMemoryThreshold) {
      push({
        severity: stats.memoryUsedPercent >= 95 ? 'crit' : 'warn',
        metric: 'memory',
        message: `Memory usage at ${stats.memoryUsedPercent}% (${stats.memoryUsedGb}/${stats.memoryTotalGb} GB).`,
        value: stats.memoryUsedPercent
      })
    }

    if (stats.diskUsedPercent >= settings.alertDiskThreshold) {
      push({
        severity: 'warn',
        metric: 'disk',
        message: `Storage at ${stats.diskUsedPercent}% capacity. Consider freeing disk space.`,
        value: stats.diskUsedPercent
      })
    }

    if (stats.cpuTemp !== null && stats.cpuTemp >= settings.alertTempThreshold) {
      push({
        severity: stats.cpuTemp >= 95 ? 'crit' : 'warn',
        metric: 'temperature',
        message: `CPU temperature at ${stats.cpuTemp}°C. Thermal throttling may occur.`,
        value: stats.cpuTemp
      })
    }

    return alerts
  }
}
