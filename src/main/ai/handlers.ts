import type { IpcMain } from 'electron'
import { chatWithJarvis, getReasoningCoreStatus } from './assistant'

export function registerAiHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(
    'ai:chat',
    async (_event, message: string, history: { role: 'user' | 'assistant'; content: string }[]) => {
      return chatWithJarvis(message, history)
    }
  )

  ipcMain.handle('ai:coreStatus', () => getReasoningCoreStatus())
}
