import { contextBridge, ipcRenderer } from 'electron'
import type { JarvisSettings, ReasoningCoreStatus, SystemAlert, SystemStats } from '@shared/types'

export type JarvisApi = {
  getSystemStats: () => Promise<SystemStats>
  chat: (message: string, history: { role: 'user' | 'assistant'; content: string }[]) => Promise<string>
  speak: (text: string) => Promise<void>
  notifySpeakStart: () => Promise<void>
  notifySpeakEnd: () => Promise<void>
  openApp: (name: string) => Promise<string>
  setVolume: (level: number) => Promise<string>
  lockWorkstation: () => Promise<string>
  minimize: () => Promise<void>
  maximize: () => Promise<void>
  close: () => Promise<void>
  getSettings: () => Promise<JarvisSettings>
  updateSettings: (partial: Partial<JarvisSettings>) => Promise<JarvisSettings>
  toggleOverlay: () => Promise<JarvisSettings>
  setClickThrough: (enabled: boolean) => Promise<JarvisSettings>
  getCoreStatus: () => Promise<ReasoningCoreStatus>
  onVoiceState: (callback: (state: string) => void) => () => void
  onVoiceFallback: (callback: (text: string) => void) => () => void
  onSettingsChanged: (callback: (settings: JarvisSettings) => void) => () => void
  onSystemAlert: (callback: (alert: SystemAlert) => void) => () => void
}

const api: JarvisApi = {
  getSystemStats: () => ipcRenderer.invoke('system:getStats'),
  chat: (message, history) => ipcRenderer.invoke('ai:chat', message, history),
  speak: (text) => ipcRenderer.invoke('voice:speak', text),
  notifySpeakStart: () => ipcRenderer.invoke('voice:speak-start'),
  notifySpeakEnd: () => ipcRenderer.invoke('voice:speak-end'),
  openApp: (name) => ipcRenderer.invoke('system:openApp', name),
  setVolume: (level) => ipcRenderer.invoke('system:setVolume', level),
  lockWorkstation: () => ipcRenderer.invoke('system:lock'),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (partial) => ipcRenderer.invoke('settings:update', partial),
  toggleOverlay: () => ipcRenderer.invoke('window:toggleOverlay'),
  setClickThrough: (enabled) => ipcRenderer.invoke('window:setClickThrough', enabled),
  getCoreStatus: () => ipcRenderer.invoke('ai:coreStatus'),
  onVoiceState: (callback) => {
    const handler = (_: unknown, state: string) => callback(state)
    ipcRenderer.on('voice:state', handler)
    return () => ipcRenderer.removeListener('voice:state', handler)
  },
  onVoiceFallback: (callback) => {
    const handler = (_: unknown, text: string) => callback(text)
    ipcRenderer.on('voice:speak-fallback', handler)
    return () => ipcRenderer.removeListener('voice:speak-fallback', handler)
  },
  onSettingsChanged: (callback) => {
    const handler = (_: unknown, settings: JarvisSettings) => callback(settings)
    ipcRenderer.on('settings:changed', handler)
    return () => ipcRenderer.removeListener('settings:changed', handler)
  },
  onSystemAlert: (callback) => {
    const handler = (_: unknown, alert: SystemAlert) => callback(alert)
    ipcRenderer.on('alert:system', handler)
    return () => ipcRenderer.removeListener('alert:system', handler)
  }
}

contextBridge.exposeInMainWorld('jarvis', api)

declare global {
  interface Window {
    jarvis: JarvisApi
  }
}
