import type { IpcMain, BrowserWindow, App } from 'electron'
import { loadSettings, saveSettings, updateSettings } from './store'
import type { JarvisSettings } from '@shared/types'

let applyWindowSettings: ((settings: JarvisSettings) => void) | null = null
let applyLoginSettings: ((enabled: boolean) => void) | null = null

export function bindSettingsAppliers(
  windowApplier: (settings: JarvisSettings) => void,
  loginApplier: (enabled: boolean) => void
): void {
  applyWindowSettings = windowApplier
  applyLoginSettings = loginApplier
}

export function registerSettingsHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('settings:get', () => loadSettings())

  ipcMain.handle('settings:update', (_event, partial: Partial<JarvisSettings>) => {
    const settings = updateSettings(partial)
    applyWindowSettings?.(settings)
    if (partial.launchAtLogin !== undefined) {
      applyLoginSettings?.(settings.launchAtLogin)
    }
    return settings
  })

  ipcMain.handle('settings:save', (_event, settings: JarvisSettings) => {
    const saved = saveSettings(settings)
    applyWindowSettings?.(saved)
    applyLoginSettings?.(saved.launchAtLogin)
    return saved
  })
}

export function initLoginItem(app: App, enabled: boolean): void {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: false,
    path: process.execPath,
    args: ['--jarvis-autostart']
  })
}

export function broadcastSettings(win: BrowserWindow | null, settings: JarvisSettings): void {
  win?.webContents.send('settings:changed', settings)
}
