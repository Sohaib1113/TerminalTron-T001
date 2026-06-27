import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { DEFAULT_SETTINGS, type JarvisSettings } from '@shared/types'

const SETTINGS_FILE = 'jarvis-settings.json'

function envDefaults(): Partial<JarvisSettings> {
  const num = (key: string, fallback: number) => {
    const value = Number(process.env[key])
    return Number.isFinite(value) ? value : fallback
  }

  return {
    alertCpuThreshold: num('JARVIS_ALERT_CPU', DEFAULT_SETTINGS.alertCpuThreshold),
    alertMemoryThreshold: num('JARVIS_ALERT_MEMORY', DEFAULT_SETTINGS.alertMemoryThreshold),
    alertDiskThreshold: num('JARVIS_ALERT_DISK', DEFAULT_SETTINGS.alertDiskThreshold),
    alertTempThreshold: num('JARVIS_ALERT_TEMP', DEFAULT_SETTINGS.alertTempThreshold),
    ollamaUrl: process.env.OLLAMA_URL ?? DEFAULT_SETTINGS.ollamaUrl,
    ollamaModel: process.env.OLLAMA_MODEL ?? DEFAULT_SETTINGS.ollamaModel
  }
}

function settingsPath(): string {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, SETTINGS_FILE)
}

export function loadSettings(): JarvisSettings {
  try {
    const raw = readFileSync(settingsPath(), 'utf-8')
    return { ...DEFAULT_SETTINGS, ...envDefaults(), ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_SETTINGS, ...envDefaults() }
  }
}

export function saveSettings(settings: JarvisSettings): JarvisSettings {
  writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), 'utf-8')
  return settings
}

export function updateSettings(partial: Partial<JarvisSettings>): JarvisSettings {
  const next = { ...loadSettings(), ...partial }
  return saveSettings(next)
}
