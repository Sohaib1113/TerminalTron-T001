import {
  AIResult,
  AIStatus,
  AppSettings,
  AutomationAuditLog,
  AutomationCapabilities,
  AutomationStats,
  AutomationTask,
  Conversation,
  MonitoringAlert,
  ModelsResponse,
  SystemMetric,
} from './types';

const API_BASE = import.meta.env.DEV
  ? 'http://localhost:5000/api'
  : 'http://localhost:5000/api';

const fetchApi = async <T>(path: string, options?: RequestInit): Promise<T> => {
  const { headers, ...rest } = options ?? {};
  const response = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: {
      // Only advertise JSON when we actually send a body; Fastify rejects
      // bodyless requests that claim `Content-Type: application/json`.
      ...(rest.body ? { 'Content-Type': 'application/json' } : {}),
      ...(headers as Record<string, string> | undefined),
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    let message = errorText;
    try {
      message = (JSON.parse(errorText) as { message?: string }).message ?? errorText;
    } catch {
      // Response was not JSON; fall back to the raw text.
    }
    throw new Error(message || `API request failed: ${response.status}`);
  }

  return response.json();
};

export const getTasks = () => fetchApi<{ tasks: Task[] }>('/tasks');
export const createTask = (task: { title: string; description?: string; priority?: string; dueDate?: string }) =>
  fetchApi<{ task: Task }>('/tasks', {
    method: 'POST',
    body: JSON.stringify(task),
  });

export const askAI = (prompt: string, conversationId?: string) =>
  fetchApi<{ result: AIResult; conversationId: string }>('/ai/prompt', {
    method: 'POST',
    body: JSON.stringify({ prompt, conversationId }),
  });

export const getAIStatus = () => fetchApi<{ status: AIStatus }>('/ai/status');

export const getAIModels = () => fetchApi<ModelsResponse>('/ai/models');

export const getSettings = () => fetchApi<{ settings: AppSettings }>('/settings');

export const updateSettings = (payload: Partial<AppSettings>) =>
  fetchApi<{ settings: AppSettings }>('/settings', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });

export const getConversations = () =>
  fetchApi<{ conversations: Conversation[] }>('/conversations');

export const getConversation = (id: string) =>
  fetchApi<{ conversation: Conversation }>(`/conversations/${id}`);

export const getMetricsHistory = (limit = 30) =>
  fetchApi<{ metrics: SystemMetric[] }>(`/monitoring/metrics?limit=${limit}`);

export const getLatestMetrics = () =>
  fetchApi<{ metric: SystemMetric | null }>('/monitoring/metrics/latest');

export const getAlerts = () =>
  fetchApi<{ alerts: MonitoringAlert[] }>('/monitoring/alerts');

export const markAlertRead = (id: string) =>
  fetchApi<{ alert: MonitoringAlert }>(`/monitoring/alerts/${id}/read`, {
    method: 'PATCH',
  });

export const runMonitoringCheck = () =>
  fetchApi<{ snapshot: unknown }>('/monitoring/check', {
    method: 'POST',
  });

// ---------------------------------------------------------------------------
// Automation
// ---------------------------------------------------------------------------

export const getAutomationOverview = () =>
  fetchApi<{ tasks: AutomationTask[]; stats: AutomationStats; capabilities: AutomationCapabilities }>(
    '/automation',
  );

export const getAutomationTasks = () => fetchApi<{ tasks: AutomationTask[] }>('/automation/tasks');

export const getPendingAutomation = () =>
  fetchApi<{ tasks: AutomationTask[] }>('/automation/pending');

export const getAutomationAudit = () =>
  fetchApi<{ logs: AutomationAuditLog[] }>('/automation/audit');

export const getAutomationCapabilities = () =>
  fetchApi<{ capabilities: AutomationCapabilities }>('/automation/capabilities');

export const createAutomationRequest = (payload: { prompt?: string; action?: string; target?: string }) =>
  fetchApi<{ task: AutomationTask }>('/automation/request', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const approveAutomationTask = (id: string) =>
  fetchApi<{ task: AutomationTask }>(`/automation/tasks/${id}/approve`, { method: 'POST' });

export const denyAutomationTask = (id: string) =>
  fetchApi<{ task: AutomationTask }>(`/automation/tasks/${id}/deny`, { method: 'POST' });

export const executeAutomation = (payload: { prompt?: string; action?: string; target?: string }) =>
  fetchApi<{ task: AutomationTask }>('/automation/execute', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const clearAutomationHistory = () =>
  fetchApi<{ cleared: boolean }>('/automation/history', { method: 'DELETE' });

export interface StreamHandlers {
  onStart?: (conversationId: string) => void;
  onChunk?: (text: string) => void;
  onAutomation?: (payload: { task: AutomationTask; message: string }) => void;
  onDone?: (conversationId: string) => void;
  onError?: (error: string) => void;
}

export async function streamPrompt(
  prompt: string,
  conversationId: string | undefined,
  handlers: StreamHandlers,
): Promise<void> {
  const response = await fetch(`${API_BASE}/ai/prompt/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prompt, conversationId }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `API request failed: ${response.status}`);
  }

  if (!response.body) {
    throw new Error('Streaming is not supported by this runtime');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const dispatch = (rawEvent: string) => {
    const lines = rawEvent.split('\n');
    const eventLine = lines.find((line) => line.startsWith('event: '));
    const dataLine = lines.find((line) => line.startsWith('data: '));
    if (!eventLine || !dataLine) {
      return;
    }

    const event = eventLine.slice(7).trim();
    const data = dataLine.slice(6).trim();
    if (!data) {
      return;
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(data);
    } catch {
      return;
    }

    switch (event) {
      case 'start':
        handlers.onStart?.(payload.conversationId as string);
        break;
      case 'chunk':
        handlers.onChunk?.(payload.text as string);
        break;
      case 'automation':
        handlers.onAutomation?.(payload as unknown as { task: AutomationTask; message: string });
        break;
      case 'done':
        handlers.onDone?.(payload.conversationId as string);
        break;
      case 'error':
        handlers.onError?.(payload.error as string);
        break;
      default:
        break;
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';

    for (const event of events) {
      dispatch(event);
    }
  }

  if (buffer.trim()) {
    dispatch(buffer);
  }
}

export const transcribeAudio = (audioBase64: string) =>
  fetchApi<{ text: string }>('/ai/transcribe', {
    method: 'POST',
    body: JSON.stringify({ audio: audioBase64 }),
  });

export interface Task {
  id: string;
  userId: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
}
