import { FormEvent, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { getAIModels, getAIStatus, getSettings, updateSettings } from '../api';
import { AIStatus, AppSettings } from '../types';

const PROVIDERS: Array<{ value: AppSettings['llmProvider']; label: string }> = [
  { value: 'ollama', label: 'Ollama (Local)' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'huggingface', label: 'Hugging Face' },
];

export default function Settings() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [status, setStatus] = useState<AIStatus | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [settingsData, statusData] = await Promise.all([getSettings(), getAIStatus()]);
      setSettings(settingsData.settings);
      setStatus(statusData.status);
    } catch (error) {
      console.error(error);
      toast.error('Failed to load settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const handleFetchModels = async () => {
    setFetchingModels(true);
    try {
      const data = await getAIModels();
      setModels(data.models);
      setStatus((prev) => (prev ? { ...prev, connected: data.connected, error: data.error } : prev));
      if (!data.connected) {
        toast.error(data.error ?? 'Ollama is not reachable.');
      } else {
        toast.success(`${data.models.length} model(s) found.`);
      }
    } catch (error) {
      console.error(error);
      toast.error('Failed to fetch models.');
    } finally {
      setFetchingModels(false);
    }
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!settings) return;
    setSaving(true);
    try {
      const data = await updateSettings(settings);
      setSettings(data.settings);
      toast.success('Settings saved.');
      const { status: freshStatus } = await getAIStatus();
      setStatus(freshStatus);
    } catch (error) {
      console.error(error);
      toast.error('Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="page-content">
        <header className="page-title">
          <h1>Settings</h1>
        </header>
        <section className="settings-card">
          <p>Loading settings...</p>
        </section>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="page-content">
        <header className="page-title">
          <h1>Settings</h1>
        </header>
        <section className="settings-card">
          <p>Unable to load settings.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="page-content">
      <header className="page-title">
        <div>
          <h1>Settings</h1>
          <p>Configure TerminalTron-T001’s preferences and AI settings.</p>
        </div>
      </header>

      <form className="settings-form" onSubmit={handleSave}>
        <section className="settings-card">
          <h2>Application</h2>
          <div className="settings-grid">
            <label className="settings-field">
              Theme
              <select
                value={settings.theme}
                onChange={(e) => update('theme', e.target.value as AppSettings['theme'])}
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
                <option value="auto">Auto</option>
              </select>
            </label>

            <label className="settings-field">
              Default view
              <select value={settings.defaultView} onChange={(e) => update('defaultView', e.target.value)}>
                <option value="dashboard">Dashboard</option>
                <option value="chat">AI Chat</option>
                <option value="tasks">Tasks</option>
              </select>
            </label>

            <label className="settings-field checkbox-field">
              <input
                type="checkbox"
                checked={settings.autoStart}
                onChange={(e) => update('autoStart', e.target.checked)}
              />
              Launch on startup
            </label>

            <label className="settings-field checkbox-field">
              <input
                type="checkbox"
                checked={settings.notificationsEnabled}
                onChange={(e) => update('notificationsEnabled', e.target.checked)}
              />
              Enable notifications
            </label>

            <label className="settings-field checkbox-field">
              <input
                type="checkbox"
                checked={settings.soundEnabled}
                onChange={(e) => update('soundEnabled', e.target.checked)}
              />
              Enable sounds
            </label>

            <label className="settings-field checkbox-field">
              <input
                type="checkbox"
                checked={settings.monitoringEnabled}
                onChange={(e) => update('monitoringEnabled', e.target.checked)}
              />
              Enable system monitoring
            </label>
          </div>
        </section>

        <section className="settings-card">
          <h2>AI / LLM</h2>
          <div className="ai-status-row">
            <span className={`status-badge ${status?.connected ? 'ok' : 'bad'}`}>
              {status?.connected ? 'Ollama connected' : status?.error ?? 'Ollama offline'}
            </span>
            <span className="status-detail">
              {status ? `${status.provider} · ${status.model} · ${status.baseUrl}` : 'Unknown'}
            </span>
          </div>

          <div className="settings-grid">
            <label className="settings-field">
              Provider
              <select
                value={settings.llmProvider}
                onChange={(e) => update('llmProvider', e.target.value as AppSettings['llmProvider'])}
              >
                {PROVIDERS.map((provider) => (
                  <option key={provider.value} value={provider.value}>
                    {provider.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="settings-field">
              Model
              <input
                list="ollama-models"
                value={settings.llmModel}
                onChange={(e) => update('llmModel', e.target.value)}
                placeholder="e.g. mistral"
              />
              {models.length > 0 && (
                <datalist id="ollama-models">
                  {models.map((model) => (
                    <option key={model} value={model} />
                  ))}
                </datalist>
              )}
            </label>

            <label className="settings-field">
              Ollama base URL
              <input
                value={settings.ollamaBaseUrl}
                onChange={(e) => update('ollamaBaseUrl', e.target.value)}
                placeholder="http://localhost:11434"
              />
            </label>

            <label className="settings-field">
              API key (optional)
              <input
                type="password"
                value={settings.llmApiKey ?? ''}
                onChange={(e) => update('llmApiKey', e.target.value)}
                placeholder="Needed for cloud providers"
              />
            </label>
          </div>

          {settings.llmProvider === 'ollama' && (
            <button
              type="button"
              className="primary-button secondary-button"
              onClick={handleFetchModels}
              disabled={fetchingModels}
            >
              {fetchingModels ? 'Fetching models…' : 'Fetch Ollama models'}
            </button>
          )}
        </section>

        <div className="settings-actions">
          <button type="submit" className="primary-button" disabled={saving}>
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </form>
    </div>
  );
}

