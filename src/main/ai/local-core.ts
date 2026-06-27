import type { SystemStats } from '@shared/types'
import type { ParsedIntent } from './intent'
import { toolLabel } from './intent'
import type { ToolName, ToolResult } from './tools'

function hourGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function formatStats(stats: SystemStats): string {
  const temp =
    stats.cpuTemp !== null ? ` CPU temperature is ${stats.cpuTemp}°C,` : ''
  return (
    `${hourGreeting()}, sir. CPU is at ${stats.cpuLoad}%, memory at ${stats.memoryUsedPercent}% ` +
    `(${stats.memoryUsedGb} of ${stats.memoryTotalGb} GB), disk at ${stats.diskUsedPercent}%.` +
    `${temp} Uptime is ${stats.uptimeHours} hours. All within expected parameters unless noted otherwise.`
  )
}

export function respondToIntent(intent: ParsedIntent, toolResult?: ToolResult): string {
  switch (intent.kind) {
    case 'greeting':
      return `${hourGreeting()}, sir. JARVIS Mark One at your service. Local reasoning core online — no external API required.`

    case 'thanks':
      return 'My pleasure, sir. Always happy to be of assistance.'

    case 'help':
      return (
        'Certainly, sir. I can report system telemetry, open applications, adjust volume, lock your workstation, ' +
        'and list heavy processes — entirely on-device. Say things like "open Chrome", "system status", ' +
        '"volume to 40", or "lock my PC". Install Ollama with a local model for deeper conversation.'
      )

    case 'time': {
      const now = new Date()
      return `It is ${now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}, ` +
        `${now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}, sir.`
    }

    case 'identity':
      return (
        'I am JARVIS — Just A Rather Very Intelligent System — Mark One edition, sir. ' +
        'An in-house reasoning core running locally on your machine. No cloud API keys required.'
      )

    case 'action': {
      if (!intent.tool || !toolResult) return 'Action incomplete, sir. Please try again.'

      const stats = toolResult.data as SystemStats | undefined

      switch (intent.tool.name) {
        case 'get_system_stats':
          return stats ? formatStats(stats) : `Telemetry retrieved, sir. ${toolResult.output}`

        case 'open_application':
          return `Done, sir. ${toolResult.output}`

        case 'set_volume':
          return `Volume adjusted. ${toolResult.output}`

        case 'lock_workstation':
          return 'Locking the workstation now, sir.'

        case 'list_top_processes':
          return `Top memory consumers, sir:\n${toolResult.output}`

        default:
          return `Completed ${toolLabel(intent.tool.name as ToolName)}, sir. ${toolResult.output}`
      }
    }

    default:
      return ''
  }
}

export function respondConversationally(
  message: string,
  history: { role: 'user' | 'assistant'; content: string }[]
): string {
  const lower = message.toLowerCase()

  if (/how are you|you okay|status check/.test(lower)) {
    return 'Fully operational, sir. Local reasoning core nominal. HUD telemetry is live.'
  }

  if (/weather/.test(lower)) {
    return 'I do not have a weather module fitted yet, sir. System control and telemetry are my current specialities.'
  }

  if (/joke|funny/.test(lower)) {
    return 'I would tell you a joke about UDP, sir, but you might not get it. Shall I open an application instead?'
  }

  const lastAssistant = [...history].reverse().find((m) => m.role === 'assistant')
  if (lastAssistant && /repeat|say that again/.test(lower)) {
    return lastAssistant.content
  }

  return (
    'I understand, sir. My local core handles system commands directly — try "system status", "open notepad", or "volume to 30". ' +
    'For richer conversation, install Ollama (ollama.com) and run `ollama pull llama3.2` — free and fully offline.'
  )
}
