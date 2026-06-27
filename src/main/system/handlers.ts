import type { IpcMain } from 'electron'
import {
  getSystemStats,
  openApplication,
  setVolume,
  lockWorkstation,
  getRunningProcesses,
  runPowerShell
} from './controller'

export function registerSystemHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('system:getStats', () => getSystemStats())

  ipcMain.handle('system:openApp', (_event, name: string) => openApplication(name))

  ipcMain.handle('system:setVolume', (_event, level: number) => setVolume(level))

  ipcMain.handle('system:lock', () => lockWorkstation())

  ipcMain.handle('system:processes', () => getRunningProcesses())

  ipcMain.handle('system:runCommand', (_event, command: string) => runPowerShell(command))
}
