/**
 * Shared TypeScript types for Ultron application
 * Used across frontend, backend, and IPC communication
 */

// User Management
export interface User {
  id: string;
  username: string;
  email?: string;
  password?: string; // Only used internally for hashing
  createdAt: Date;
  updatedAt: Date;
}

// Task Management
export interface Task {
  id: string;
  userId: string;
  title: string;
  description: string;
  status: 'pending' | 'in-progress' | 'completed' | 'on-hold';
  priority: 'low' | 'medium' | 'high' | 'critical';
  dueDate?: Date;
  createdAt: Date;
  updatedAt: Date;
  parentTaskId?: string; // For sub-tasks
  tags?: string[];
}

// Conversation & Chat
export interface ConversationMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  tokens?: number; // For token counting
}

export interface Conversation {
  id: string;
  userId: string;
  title: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
  messages: ConversationMessage[];
  contextData?: Record<string, unknown>; // For conversation context
}

// System Monitoring
export interface SystemMetrics {
  id: string;
  timestamp: Date;
  cpuUsage: number; // Percentage
  memoryUsage: number; // Percentage
  diskUsage: number; // Percentage
  processCount: number;
}

export interface MonitoringAlert {
  id: string;
  userId: string;
  type: 'cpu' | 'memory' | 'disk' | 'error' | 'task-completion';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  timestamp: Date;
  read: boolean;
}

// Settings
export interface AppSettings {
  userId: string;
  theme: 'light' | 'dark' | 'auto';
  autoStart: boolean;
  notificationsEnabled: boolean;
  soundEnabled: boolean;
  
  // LLM Settings
  llmProvider: 'ollama' | 'openai' | 'anthropic' | 'huggingface';
  llmModel: string; // e.g., "mistral" for Ollama, "gpt-4" for OpenAI
  llmApiKey?: string;
  ollamaBaseUrl: string; // Default: http://localhost:11434
  
  // Monitoring
  monitoringEnabled: boolean;
  monitoringInterval: number; // Milliseconds
  
  // UI Preferences
  sidebarCollapsed: boolean;
  defaultView: 'dashboard' | 'chat' | 'tasks';
}

// API Response Types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// AI/LLM Types
export interface LLMRequest {
  prompt: string;
  context?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMResponse {
  text: string;
  tokens?: number;
  model: string;
}

// IPC Message Types (Electron main <-> renderer communication)
export interface IPCMessage {
  channel: string;
  data?: unknown;
}

// Job Queue Types
export interface JobData {
  id: string;
  type: 'llm-inference' | 'data-export' | 'system-check' | 'task-analysis';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: Date;
  updatedAt: Date;
  result?: unknown;
  error?: string;
}

// WebSocket Event Types
export interface WebSocketEvent {
  type: string;
  data: unknown;
  timestamp: Date;
}
