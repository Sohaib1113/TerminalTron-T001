import type { ToolCall, ToolName } from './tools'

export type ParsedIntent = {
  tool: ToolCall | null
  kind:
    | 'action'
    | 'greeting'
    | 'thanks'
    | 'help'
    | 'time'
    | 'identity'
    | 'conversation'
  confidence: number
}

const APP_ALIASES: Record<string, string> = {
  'note pad': 'notepad',
  notes: 'notepad',
  calc: 'calculator',
  calculator: 'calculator',
  browser: 'chrome',
  'google chrome': 'chrome',
  edge: 'edge',
  'microsoft edge': 'edge',
  'code editor': 'vscode',
  'vs code': 'vscode',
  'visual studio code': 'vscode',
  terminal: 'terminal',
  cmd: 'terminal',
  powershell: 'terminal',
  settings: 'settings',
  'windows settings': 'settings',
  'file explorer': 'explorer',
  explorer: 'explorer',
  files: 'explorer',
  music: 'spotify',
  spotify: 'spotify'
}

function normalize(text: string): string {
  return text.toLowerCase().trim().replace(/[^\w\s']/g, ' ')
}

function resolveApp(raw: string): string {
  const cleaned = raw.trim().replace(/\s+/g, ' ')
  return APP_ALIASES[cleaned] ?? cleaned
}

function extractApp(message: string): string | null {
  const patterns = [
    /(?:open|launch|start|run)\s+(?:the\s+)?(.+?)(?:\s+please|\s+for me|\s+sir|\s+ma'am|$)/i,
    /(?:can you|could you|please)\s+(?:open|launch|start|run)\s+(?:the\s+)?(.+?)(?:\?|$)/i
  ]

  for (const pattern of patterns) {
    const match = message.match(pattern)
    if (match?.[1]) return resolveApp(match[1])
  }

  return null
}

function extractVolume(message: string): number | null {
  if (/\bmute\b/.test(message)) return 0

  const match = message.match(/(?:volume|sound|audio)\s*(?:to|at|of)?\s*(\d{1,3})/i)
  if (match) return Math.min(100, Number(match[1]))

  const percent = message.match(/(\d{1,3})\s*(?:%|percent)\s*(?:volume|sound)?/i)
  if (percent && /volume|sound|audio/i.test(message)) return Math.min(100, Number(percent[1]))

  return null
}

export function parseIntent(message: string): ParsedIntent {
  const text = normalize(message)

  if (/^(hi|hello|hey|good morning|good evening|good afternoon|greetings)\b/.test(text)) {
    return { tool: null, kind: 'greeting', confidence: 0.95 }
  }

  if (/^(thanks|thank you|cheers|much obliged)/.test(text)) {
    return { tool: null, kind: 'thanks', confidence: 0.95 }
  }

  if (/help|what can you do|your capabilities|commands/.test(text)) {
    return { tool: null, kind: 'help', confidence: 0.9 }
  }

  if (/what time|current time|what's the time|what date|today's date/.test(text)) {
    return { tool: null, kind: 'time', confidence: 0.9 }
  }

  if (/who are you|what are you|your name|jarvis/.test(text) && /who|what|name/.test(text)) {
    return { tool: null, kind: 'identity', confidence: 0.85 }
  }

  if (/lock(?:\s+(?:my|the))?\s*(?:pc|computer|workstation|screen|machine)|lock it/.test(text)) {
    return {
      tool: { name: 'lock_workstation', args: {} },
      kind: 'action',
      confidence: 0.95
    }
  }

  const volume = extractVolume(text)
  if (volume !== null) {
    return {
      tool: { name: 'set_volume', args: { level: volume } },
      kind: 'action',
      confidence: 0.92
    }
  }

  const app = extractApp(message)
  if (app && /open|launch|start|run/.test(text)) {
    return {
      tool: { name: 'open_application', args: { name: app } },
      kind: 'action',
      confidence: 0.9
    }
  }

  if (/process|processes|memory hogs|what(?:'s| is) using (?:ram|memory)|top apps/.test(text)) {
    return {
      tool: { name: 'list_top_processes', args: {} },
      kind: 'action',
      confidence: 0.88
    }
  }

  if (/cpu|memory|ram|disk|storage|system stats|system status|telemetry|performance|how(?:'s| is) (?:my|the) (?:pc|system|computer)/.test(text)) {
    return {
      tool: { name: 'get_system_stats', args: {} },
      kind: 'action',
      confidence: 0.88
    }
  }

  return { tool: null, kind: 'conversation', confidence: 0.4 }
}

export function toolLabel(name: ToolName): string {
  const labels: Record<ToolName, string> = {
    get_system_stats: 'system telemetry',
    open_application: 'application launch',
    set_volume: 'volume control',
    lock_workstation: 'workstation lock',
    list_top_processes: 'process analysis'
  }
  return labels[name]
}
