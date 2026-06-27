import { loadSettings } from '../settings/store'
import { parseIntent } from './intent'
import { respondConversationally, respondToIntent } from './local-core'
import { chatWithOllama, phraseActionWithOllama } from './ollama-provider'
import { executeTool } from './tools'

export { getReasoningCoreStatus } from './ollama-provider'

export async function chatWithJarvis(
  userMessage: string,
  history: { role: 'user' | 'assistant'; content: string }[] = []
): Promise<string> {
  const settings = loadSettings()
  const intent = parseIntent(userMessage)
  const preferOllama = settings.reasoningMode !== 'local'

  if (intent.tool && intent.confidence >= 0.85) {
    const result = await executeTool(intent.tool.name, intent.tool.args)
    const localReply = respondToIntent(intent, result)

    if (preferOllama) {
      const polished = await phraseActionWithOllama(
        userMessage,
        intent.tool.name,
        result.output,
        history
      )
      if (polished) return polished
    }

    return localReply
  }

  if (intent.kind !== 'conversation' && intent.confidence >= 0.85) {
    const localReply = respondToIntent(intent)
    if (localReply) {
      if (preferOllama && ['greeting', 'identity', 'help'].includes(intent.kind)) {
        const polished = await chatWithOllama(userMessage, history)
        if (polished) return polished
      }
      return localReply
    }
  }

  if (preferOllama) {
    const ollamaReply = await chatWithOllama(userMessage, history)
    if (ollamaReply) return ollamaReply
  }

  if (intent.tool && intent.confidence >= 0.7) {
    const result = await executeTool(intent.tool.name, intent.tool.args)
    return respondToIntent(intent, result)
  }

  return respondConversationally(userMessage, history)
}
