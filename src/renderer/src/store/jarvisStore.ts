import { create } from 'zustand'
import type { ChatMessage, JarvisSettings, SystemAlert, SystemStats, VoiceState } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'

type JarvisStore = {
  voiceState: VoiceState
  isWakeWordActive: boolean
  messages: ChatMessage[]
  systemStats: SystemStats | null
  inputText: string
  settings: JarvisSettings
  alerts: SystemAlert[]
  showSettings: boolean
  setVoiceState: (state: VoiceState) => void
  setWakeWordActive: (active: boolean) => void
  setSystemStats: (stats: SystemStats) => void
  addMessage: (role: ChatMessage['role'], content: string) => void
  setInputText: (text: string) => void
  setSettings: (settings: JarvisSettings) => void
  pushAlert: (alert: SystemAlert) => void
  dismissAlert: (id: string) => void
  setShowSettings: (show: boolean) => void
}

export const useJarvisStore = create<JarvisStore>((set) => ({
  voiceState: 'idle',
  isWakeWordActive: false,
  messages: [
    {
      id: 'boot',
      role: 'assistant',
      content: 'JARVIS Mark One online. In-house local reasoning core active — no API keys required, sir.',
      timestamp: Date.now()
    }
  ],
  systemStats: null,
  inputText: '',
  settings: DEFAULT_SETTINGS,
  alerts: [],
  showSettings: false,
  setVoiceState: (voiceState) => set({ voiceState }),
  setWakeWordActive: (isWakeWordActive) => set({ isWakeWordActive }),
  setSystemStats: (systemStats) => set({ systemStats }),
  addMessage: (role, content) =>
    set((state) => ({
      messages: [
        ...state.messages,
        { id: `${Date.now()}-${Math.random()}`, role, content, timestamp: Date.now() }
      ]
    })),
  setInputText: (inputText) => set({ inputText }),
  setSettings: (settings) => set({ settings }),
  pushAlert: (alert) =>
    set((state) => ({
      alerts: [alert, ...state.alerts.filter((a) => a.metric !== alert.metric)].slice(0, 5)
    })),
  dismissAlert: (id) => set((state) => ({ alerts: state.alerts.filter((a) => a.id !== id) })),
  setShowSettings: (showSettings) => set({ showSettings })
}))
