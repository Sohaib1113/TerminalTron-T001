import { JARVIS_PERSONA } from '@shared/types'
import { loadSettings } from '../settings/store'

export type OllamaStatus = {
  serverOnline: boolean
  modelReady: boolean
  model: string | null
  models: string[]
}

export type ReasoningCoreStatus = {
  engine: 'local' | 'hybrid' | 'ollama'
  localCore: 'online'
  ollama: OllamaStatus
  activeProvider: 'local' | 'ollama'
}

function baseUrl(): string {
  const settings = loadSettings()
  return (process.env.OLLAMA_URL ?? settings.ollamaUrl).replace(/\/$/, '')
}

function modelName(): string {
  const settings = loadSettings()
  return process.env.OLLAMA_MODEL ?? settings.ollamaModel
}

async function ollamaFetch<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(`${baseUrl()}${path}`, {
      ...init,
      signal: AbortSignal.timeout(8000)
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

export async function getOllamaStatus(): Promise<OllamaStatus> {
  const data = await ollamaFetch<{ models: { name: string }[] }>('/api/tags')
  if (!data?.models) {
    return { serverOnline: false, modelReady: false, model: null, models: [] }
  }

  const fullNames = data.models.map((m) => m.name)
  const models = [...new Set(fullNames.map((m) => m.split(':')[0]))]
  const preferred = modelName()
  const hasPreferred = fullNames.some((m) => m === preferred || m.startsWith(`${preferred}:`))

  return {
    serverOnline: true,
    modelReady: hasPreferred,
    model: hasPreferred ? preferred : null,
    models
  }
}

export async function getReasoningCoreStatus(): Promise<ReasoningCoreStatus> {
  const settings = loadSettings()
  const ollama = await getOllamaStatus()
  const useOllama = settings.reasoningMode !== 'local' && ollama.modelReady

  return {
    engine: settings.reasoningMode,
    localCore: 'online',
    ollama,
    activeProvider: useOllama ? 'ollama' : 'local'
  }
}

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

type OllamaChatResponse = {
  message?: { content?: string }
}

async function runOllamaChat(messages: ChatMessage[]): Promise<string | null> {
  const status = await getOllamaStatus()
  if (!status.modelReady || !status.model) return null

  const response = await ollamaFetch<OllamaChatResponse>('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: status.model,
      messages,
      stream: false
    })
  })

  return response?.message?.content?.trim() || null
}

export async function chatWithOllama(
  userMessage: string,
  history: { role: 'user' | 'assistant'; content: string }[]
): Promise<string | null> {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        `${JARVIS_PERSONA}\n\nYou run locally via Ollama — fully open source, no API keys. ` +
        'Keep replies concise. Address the user as sir or ma\'am.'
    },
    ...history.slice(-8).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage }
  ]

  return runOllamaChat(messages)
}

export async function phraseActionWithOllama(
  userMessage: string,
  toolName: string,
  result: string,
  history: { role: 'user' | 'assistant'; content: string }[]
): Promise<string | null> {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        `${JARVIS_PERSONA}\n\nSummarise the action result briefly in character. Do not invent data.`
    },
    ...history.slice(-4).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
    {
      role: 'assistant',
      content: `I executed ${toolName}. Raw result: ${result}`
    },
    {
      role: 'user',
      content: 'Give the user a brief JARVIS-style confirmation using only that result.'
    }
  ]

  return runOllamaChat(messages)
}

export async function pullOllamaModel(model: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl()}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model, stream: false }),
      signal: AbortSignal.timeout(300000)
    })
    return res.ok
  } catch {
    return false
  }
}
