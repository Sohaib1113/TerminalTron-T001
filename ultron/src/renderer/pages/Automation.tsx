import { FormEvent, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  clearAutomationHistory,
  executeAutomation,
  getAutomationAudit,
  getAutomationOverview,
} from '../api';
import {
  AutomationAuditLog,
  AutomationCapabilities,
  AutomationStats,
  AutomationTask,
} from '../types';

const statusClass = (status: string) => {
  switch (status) {
    case 'completed':
      return 'ok';
    case 'failed':
      return 'bad';
    case 'denied':
      return 'muted';
    case 'pending-approval':
    case 'running':
      return 'warn';
    default:
      return 'muted';
  }
};

export default function Automation() {
  const [tasks, setTasks] = useState<AutomationTask[]>([]);
  const [stats, setStats] = useState<AutomationStats | null>(null);
  const [capabilities, setCapabilities] = useState<AutomationCapabilities | null>(null);
  const [logs, setLogs] = useState<AutomationAuditLog[]>([]);
  const [command, setCommand] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const [overview, audit] = await Promise.all([getAutomationOverview(), getAutomationAudit()]);
      setTasks(overview.tasks);
      setStats(overview.stats);
      setCapabilities(overview.capabilities);
      setLogs(audit.logs);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleRun = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = command.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      const { task } = await executeAutomation({ prompt: value });
      if (task.status === 'completed') {
        toast.success(task.result ?? 'Done.');
      } else {
        toast.error(task.error ?? 'Automation failed.');
      }
      setCommand('');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Automation failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleClear = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await clearAutomationHistory();
      toast.success('Automation history cleared.');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to clear history.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-content">
      <header className="page-title">
        <div>
          <h1>Automation</h1>
          <p>TerminalTron-T001 acts on your machine — every action is approved and logged.</p>
        </div>
        <button
          type="button"
          className="primary-button secondary-button"
          onClick={handleClear}
          disabled={busy}
        >
          Clear history
        </button>
      </header>

      {stats && (
        <section className="grid-grid">
          <div className="metric-card">
            <span className="metric-label">Total</span>
            <strong>{stats.total}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Completed</span>
            <strong>{stats.completed}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Pending</span>
            <strong>{stats.pending}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Failed</span>
            <strong>{stats.failed}</strong>
          </div>
        </section>
      )}

      {capabilities && (
        <section className="form-card">
          <h2>Capabilities</h2>
          <div className="capability-row">
            <span className={`status-badge ${capabilities.enabled ? 'ok' : 'bad'}`}>
              Automation {capabilities.enabled ? 'enabled' : 'disabled'}
            </span>
            <span className={`status-badge ${capabilities.playwrightAvailable ? 'ok' : 'muted'}`}>
              Playwright {capabilities.playwrightAvailable ? 'ready' : 'not installed'}
            </span>
            <span className="status-badge muted">Platform: {capabilities.platform}</span>
            <span className={`status-badge ${capabilities.commandsAllowed ? 'warn' : 'muted'}`}>
              Commands {capabilities.commandsAllowed ? 'allowed' : 'blocked'}
            </span>
          </div>
          <p className="muted">
            Try: “play lofi beats on YouTube”, “open calculator”, or “search for electron
            automation”.
          </p>
        </section>
      )}

      <section className="form-card">
        <h2>Run an action</h2>
        <form onSubmit={handleRun} className="task-form">
          <label>
            Command
            <input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="play lofi beats on YouTube"
            />
          </label>
          <button type="submit" className="primary-button" disabled={busy}>
            {busy ? 'Running…' : 'Execute'}
          </button>
        </form>
      </section>

      <section className="table-card">
        <h2>Recent actions</h2>
        {loading && tasks.length === 0 ? (
          <p>Loading…</p>
        ) : (
          <div className="task-list">
            {tasks.map((task) => (
              <article key={task.id} className="task-item">
                <div>
                  <h3>{task.title}</h3>
                  <p>{task.error || task.result || task.detail || task.target}</p>
                </div>
                <span className={`status-badge ${statusClass(task.status)}`}>{task.status}</span>
              </article>
            ))}
            {tasks.length === 0 && <p>No automation actions yet.</p>}
          </div>
        )}
      </section>

      <section className="table-card">
        <h2>Audit log</h2>
        {logs.length === 0 ? (
          <p>No audit entries yet.</p>
        ) : (
          <div className="task-list">
            {logs.map((log) => (
              <article key={log.id} className="task-item">
                <div>
                  <h3>
                    {log.action}
                    {log.target ? ` · ${log.target}` : ''}
                  </h3>
                  <p>{log.message || log.status}</p>
                </div>
                <span className={`status-badge ${statusClass(log.status)}`}>{log.status}</span>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}