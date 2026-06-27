import { useJarvisStore } from '../store/jarvisStore'
import type { JarvisSettings } from '@shared/types'

type ToggleProps = {
  label: string
  hint?: string
  checked: boolean
  onChange: (value: boolean) => void
}

function Toggle({ label, hint, checked, onChange }: ToggleProps) {
  return (
    <label className="setting-row">
      <div>
        <span className="setting-label">{label}</span>
        {hint && <span className="setting-hint">{hint}</span>}
      </div>
      <button
        type="button"
        className={`toggle ${checked ? 'on' : ''}`}
        onClick={() => onChange(!checked)}
        aria-pressed={checked}
      >
        <span />
      </button>
    </label>
  )
}

type ThresholdProps = {
  label: string
  value: number
  onChange: (value: number) => void
}

function Threshold({ label, value, onChange }: ThresholdProps) {
  return (
    <label className="setting-row">
      <span className="setting-label">{label}</span>
      <input
        className="threshold-input"
        type="number"
        min={50}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

export function SettingsPanel() {
  const settings = useJarvisStore((s) => s.settings)
  const setSettings = useJarvisStore((s) => s.setSettings)
  const setShowSettings = useJarvisStore((s) => s.setShowSettings)

  const patch = async (partial: Partial<JarvisSettings>) => {
    const next = await window.jarvis.updateSettings(partial)
    setSettings(next)
  }

  return (
    <div className="settings-overlay" onClick={() => setShowSettings(false)}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">SYSTEM CONFIG — M1</div>
        <div className="panel-body settings-body">
          <Toggle
            label="Overlay mode"
            hint="Compact HUD in corner · Ctrl+Shift+J"
            checked={settings.overlayMode}
            onChange={(overlayMode) => patch({ overlayMode })}
          />
          <Toggle
            label="Click-through overlay"
            hint="Mouse passes through HUD when in overlay mode"
            checked={settings.clickThrough}
            onChange={(clickThrough) => patch({ clickThrough })}
          />
          <Toggle
            label="Always on top"
            checked={settings.alwaysOnTop}
            onChange={(alwaysOnTop) => patch({ alwaysOnTop })}
          />
          <Toggle
            label="Launch at Windows login"
            checked={settings.launchAtLogin}
            onChange={(launchAtLogin) => patch({ launchAtLogin })}
          />
          <Toggle
            label="Proactive alerts"
            hint="Notify when CPU, RAM, disk, or temp spike"
            checked={settings.proactiveAlerts}
            onChange={(proactiveAlerts) => patch({ proactiveAlerts })}
          />
          <Toggle
            label="Voice alerts"
            checked={settings.voiceAlerts}
            onChange={(voiceAlerts) => patch({ voiceAlerts })}
          />
          <Toggle
            label="Neural British voice"
            hint="Microsoft RyanNeural (movie-style)"
            checked={settings.useNeuralVoice}
            onChange={(useNeuralVoice) => patch({ useNeuralVoice })}
          />

          <div className="settings-divider">Reasoning core (free · no API keys)</div>
          <label className="setting-row">
            <div>
              <span className="setting-label">Engine mode</span>
              <span className="setting-hint">Local = built-in · Hybrid = local + Ollama · Ollama = LLM first</span>
            </div>
            <select
              className="setting-select"
              value={settings.reasoningMode}
              onChange={(e) => patch({ reasoningMode: e.target.value as JarvisSettings['reasoningMode'] })}
            >
              <option value="local">Local only</option>
              <option value="hybrid">Hybrid (recommended)</option>
              <option value="ollama">Ollama first</option>
            </select>
          </label>
          <label className="setting-row">
            <div>
              <span className="setting-label">Ollama model</span>
              <span className="setting-hint">Run: ollama pull {settings.ollamaModel || 'llama3.2'}</span>
            </div>
            <input
              className="setting-text-input"
              value={settings.ollamaModel}
              onChange={(e) => patch({ ollamaModel: e.target.value })}
            />
          </label>
          <label className="setting-row">
            <span className="setting-label">Ollama URL</span>
            <input
              className="setting-text-input wide"
              value={settings.ollamaUrl}
              onChange={(e) => patch({ ollamaUrl: e.target.value })}
            />
          </label>

          <div className="settings-divider">Alert thresholds (%)</div>
          <Threshold
            label="CPU"
            value={settings.alertCpuThreshold}
            onChange={(alertCpuThreshold) => patch({ alertCpuThreshold })}
          />
          <Threshold
            label="Memory"
            value={settings.alertMemoryThreshold}
            onChange={(alertMemoryThreshold) => patch({ alertMemoryThreshold })}
          />
          <Threshold
            label="Disk"
            value={settings.alertDiskThreshold}
            onChange={(alertDiskThreshold) => patch({ alertDiskThreshold })}
          />
          <Threshold
            label="CPU temp (°C)"
            value={settings.alertTempThreshold}
            onChange={(alertTempThreshold) => patch({ alertTempThreshold })}
          />
        </div>
        <div className="settings-footer">
          <button type="button" className="quick-btn" onClick={() => setShowSettings(false)}>
            CLOSE
          </button>
        </div>
      </div>
    </div>
  )
}
