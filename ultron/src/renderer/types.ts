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

export interface AIResponse {
  result: unknown;
}

// AI / LLM result returned by the backend
export interface AIResult {
  text: string;
  model: string;
  provider: string;
  durationMs: number;
}

export interface AIStatus {
  provider: string;
  model: string;
  baseUrl: string;
  connected: boolean;
  error?: string;
}

export interface ModelsResponse {
  models: string[];
  connected: boolean;
  baseUrl: string;
  provider: string;
  error?: string;
}

export type MessageRole = 'user' | 'assistant' | 'system';

export interface ConversationMessage {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  tokens?: number | null;
}

export interface Conversation {
  id: string;
  userId: string;
  title: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  messages?: ConversationMessage[];
}

export interface AppSettings {
  id: string;
  userId: string;
  theme: 'light' | 'dark' | 'auto';
  autoStart: boolean;
  notificationsEnabled: boolean;
  soundEnabled: boolean;
  llmProvider: 'ollama' | 'openai' | 'anthropic' | 'huggingface';
  llmModel: string;
  llmApiKey?: string | null;
  ollamaBaseUrl: string;
  monitoringEnabled: boolean;
  monitoringInterval: number;
  sidebarCollapsed: boolean;
  defaultView: string;
}

export interface SystemMetric {
  id: string;
  timestamp: string;
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  processCount: number;
}

export type AlertType = 'cpu' | 'memory' | 'disk' | 'error' | 'task-completion';
export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface MonitoringAlert {
  id: string;
  userId: string;
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  timestamp: string;
  read: boolean;
}

export type AutomationAction =
  | 'open_url'
  | 'open_site'
  | 'youtube_search'
  | 'youtube_play'
  | 'web_search'
  | 'open_app'
  | 'run_command';

export type AutomationStatus =
  | 'pending-approval'
  | 'approved'
  | 'running'
  | 'completed'
  | 'denied'
  | 'failed';

export interface AutomationTask {
  id: string;
  action: AutomationAction | string;
  target: string;
  title: string;
  detail: string | null;
  status: AutomationStatus | string;
  result: string | null;
  error: string | null;
  source: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface AutomationAuditLog {
  id: string;
  userId: string;
  taskId: string | null;
  action: string;
  target: string | null;
  status: string;
  message: string | null;
  timestamp: string;
}

export interface AutomationCapabilities {
  enabled: boolean;
  commandsAllowed: boolean;
  playwrightAvailable: boolean;
  platform: string;
  applications: string[];
  actions: { action: string; example: string }[];
}

export interface AutomationStats {
  total: number;
  completed: number;
  failed: number;
  denied: number;
  pending: number;
}