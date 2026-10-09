import { useCallback, useEffect, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  getAIStatus,
  getAlerts,
  getLatestMetrics,
  getMetricsHistory,
  getTasks,
  markAlertRead,
  runMonitoringCheck,
} from '../api';
import { AIStatus, MonitoringAlert, SystemMetric, Task } from '../types';

const POLL_INTERVAL_MS = 8000;

export default function Dashboard() {
  const [metrics, setMetrics] = useState<SystemMetric[]>([]);
  const [latest, setLatest] = useState<SystemMetric | null>(null);
  const [alerts, setAlerts] = useState<MonitoringAlert[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [aiStatus, setAiStatus] = useState<AIStatus | null>(null);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [history, lat, alertsData, tasksData, ai] = await Promise.all([
        getMetricsHistory(30),
        getLatestMetrics(),
        getAlerts(),
        getTasks(),
        getAIStatus(),
      ]);

      if (history.metrics.length) {
        setMetrics(history.metrics);
      }
      setLatest(lat.metric);
      setAlerts(alertsData.alerts);
      setTasks(tasksData.tasks);
      setAiStatus(ai.status);
      setError('');
    } catch (err) {
      console.error(err);
      setError('Failed to load system data.');
    }
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [load]);

  const handleCheck = async () => {
    setChecking(true);
    try {
      await runMonitoringCheck();
      await load();
    } catch (err) {
      console.error(err);
      setError('Monitoring check failed.');
    } finally {
      setChecking(false);
    }
  };

  const handleMarkRead = async (id: string) => {
    try {
      await markAlertRead(id);
      setAlerts((prev) => prev.map((alert) => (alert.id === id ? { ...alert, read: true } : alert)));
    } catch (err) {
      console.error(err);
    }
  };

  const activeTaskCount = tasks.filter((task) => task.status !== 'completed').length;

  const chartData = metrics.map((metric) => ({
    name: new Date(metric.timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
    cpu: metric.cpuUsage,
    memory: metric.memoryUsage,
    disk: metric.diskUsage,
  }));

  return (
    <div className="page-content">
      <header className="page-title">
        <div>
          <h1>Dashboard</h1>
          <p>Live system health, tasks, and AI readiness.</p>
        </div>
      </header>

      {error && <p className="dashboard-error">{error}</p>}

      <section className="grid-grid">
        <article className="metric-card">
          <span className="metric-label">CPU Load</span>
          <strong>{latest ? `${latest.cpuUsage}%` : '—'}</strong>
        </article>
        <article className="metric-card">
          <span className="metric-label">Memory Usage</span>
          <strong>{latest ? `${latest.memoryUsage}%` : '—'}</strong>
        </article>
        <article className="metric-card">
          <span className="metric-label">Disk Usage</span>
          <strong>{latest ? `${latest.diskUsage}%` : '—'}</strong>
        </article>
        <article className="metric-card">
          <span className="metric-label">Processes</span>
          <strong>{latest ? latest.processCount : '—'}</strong>
        </article>
        <article className="metric-card">
          <span className="metric-label">Active Tasks</span>
          <strong>{activeTaskCount}</strong>
        </article>
        <article className="metric-card">
          <span className="metric-label">AI Status</span>
          <strong className={aiStatus?.connected ? 'metric-ok' : 'metric-bad'}>
            {aiStatus?.connected ? 'Ready' : 'Offline'}
          </strong>
        </article>
      </section>
<section className="chart-card">
        <header>
          <h2>Live resource usage</h2>
        </header>
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={chartData} margin={{ top: 16, right: 24, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="4 4" stroke="rgba(245,197,24,0.14)" />
            <XAxis dataKey="name" stroke="rgba(246,238,214,0.45)" />
            <YAxis stroke="rgba(246,238,214,0.45)" />
            <Tooltip
              contentStyle={{
                background: '#0b0b0d',
                border: '1px solid rgba(245,197,24,0.35)',
                color: '#f6eed6',
                fontFamily: 'Bahnschrift, Segoe UI, sans-serif',
              }}
            />
            <Legend wrapperStyle={{ color: 'rgba(246,238,214,0.7)' }} />
            <Line type="monotone" dataKey="cpu" stroke="#f5c518" strokeWidth={3} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="memory" stroke="#ffd75e" strokeWidth={3} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="disk" stroke="#b8860b" strokeWidth={3} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </section>

      <section className="table-card">
        <header className="card-header">
          <h2>Monitoring alerts</h2>
          <button
            type="button"
            className="primary-button secondary-button"
            onClick={handleCheck}
            disabled={checking}
          >
            {checking ? 'Checking…' : 'Check now'}
          </button>
        </header>

        {loading ? (
          <p className="muted">Loading alerts...</p>
        ) : alerts.length === 0 ? (
          <p className="muted">
            No alerts yet. Hit “Check now” or let the sampling loop collect metrics.
          </p>
        ) : (
          <div className="alert-list">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className={`alert-item ${alert.severity}${alert.read ? '' : ' unread'}`}
              >
                <span className={`alert-badge ${alert.severity}`}>{alert.severity}</span>
                <span className="alert-type">{alert.type}</span>
                <p className="alert-message">{alert.message}</p>
                <span className="alert-time">{new Date(alert.timestamp).toLocaleString()}</span>
                {!alert.read && (
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => handleMarkRead(alert.id)}
                  >
                    Mark read
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}