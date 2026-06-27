import type { IpcMain, BrowserWindow } from 'electron'
import { loadSettings } from '../settings/store'
import { speakWithNeuralVoice } from './speaker'

export function registerVoiceHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('voice:speak', async (event, text: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const settings = loadSettings()
    win?.webContents.send('voice:state', 'speaking')

    try {
      if (settings.useNeuralVoice) {
        await speakWithNeuralVoice(text)
      } else {
        win?.webContents.send('voice:speak-fallback', text)
      }
    } finally {
      win?.webContents.send('voice:state', 'idle')
    }
  })

  ipcMain.handle('voice:speak-start', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.webContents.send('voice:state', 'speaking')
  })

  ipcMain.handle('voice:speak-end', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.webContents.send('voice:state', 'idle')
  })
}
