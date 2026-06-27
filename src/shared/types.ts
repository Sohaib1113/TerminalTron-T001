export type SystemStats = {
  cpuLoad: number
  cpuTemp: number | null
  memoryUsedPercent: number
  memoryUsedGb: number
  memoryTotalGb: number
  diskUsedPercent: number
  uptimeHours: number
  hostname: string
  platform: string
}

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
}

export type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking'

export type ReasoningCoreStatus = {
  engine: 'local' | 'hybrid' | 'ollama'
  localCore: 'online'
  ollama: {
    serverOnline: boolean
    modelReady: boolean
    model: string | null
    models: string[]
  }
  activeProvider: 'local' | 'ollama'
}

export type SystemAlert = {
  id: string
  severity: 'info' | 'warn' | 'crit'
  metric: 'cpu' | 'memory' | 'disk' | 'temperature'
  message: string
  value: number
  timestamp: number
}

export type JarvisSettings = {
  overlayMode: boolean
  clickThrough: boolean
  alwaysOnTop: boolean
  launchAtLogin: boolean
  proactiveAlerts: boolean
  voiceAlerts: boolean
  useNeuralVoice: boolean
  alertCpuThreshold: number
  alertMemoryThreshold: number
  alertDiskThreshold: number
  alertTempThreshold: number
  reasoningMode: 'local' | 'hybrid' | 'ollama'
  ollamaUrl: string
  ollamaModel: string
}

export const DEFAULT_SETTINGS: JarvisSettings = {
  overlayMode: false,
  clickThrough: false,
  alwaysOnTop: false,
  launchAtLogin: false,
  proactiveAlerts: true,
  voiceAlerts: true,
  useNeuralVoice: true,
  alertCpuThreshold: 90,
  alertMemoryThreshold: 90,
  alertDiskThreshold: 95,
  alertTempThreshold: 85,
  reasoningMode: 'hybrid',
  ollamaUrl: 'http://127.0.0.1:11434',
  ollamaModel: 'llama3.2'
}

export type JarvisState = {
  voiceState: VoiceState
  isWakeWordActive: boolean
  messages: ChatMessage[]
  systemStats: SystemStats | null
}

export const JARVIS_PERSONA = `You are JARVIS (Just A Rather Very Intelligent System), Tony Stark's AI assistant.
Speak with calm British wit, precision, and subtle dry humor. Address the user as "sir" or "ma'am" when appropriate.
Keep responses concise unless detail is requested. You control the user's Windows PC through tools.
When executing actions, confirm briefly what you did. Never pretend to act — use tools for real actions.`

export const WAKE_WORDS = ['jarvis', 'hey jarvis', 'ok jarvis']

export const FULL_WINDOW = { width: 1400, height: 900, minWidth: 1100, minHeight: 700 }
export const OVERLAY_WINDOW = { width: 420, height: 520, minWidth: 380, minHeight: 480 }
