import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  screen
} from 'electron'
import { join } from 'path'
import { config } from 'dotenv'
import { registerSystemHandlers } from './system/handlers'
import { registerAiHandlers } from './ai/handlers'
import { registerVoiceHandlers } from './voice/handlers'
import {
  registerSettingsHandlers,
  bindSettingsAppliers,
  initLoginItem,
  broadcastSettings
} from './settings/handlers'
import { loadSettings, updateSettings } from './settings/store'
import { AlertMonitor } from './alerts/monitor'
import { FULL_WINDOW, OVERLAY_WINDOW, type JarvisSettings } from '@shared/types'

config()

let mainWindow: BrowserWindow | null = null
let savedBounds: Electron.Rectangle | null = null
const alertMonitor = new AlertMonitor(() => loadSettings())

function positionOverlayWindow(win: BrowserWindow): void {
  const display = screen.getDisplayNearestPoint(win.getBounds())
  const { width, height } = OVERLAY_WINDOW
  const margin = 24
  const x = display.workArea.x + display.workArea.width - width - margin
  const y = display.workArea.y + display.workArea.height - height - margin
  win.setBounds({ x, y, width, height })
}

function applyWindowSettings(settings: JarvisSettings): void {
  if (!mainWindow) return

  mainWindow.setAlwaysOnTop(settings.alwaysOnTop || settings.overlayMode)

  if (settings.overlayMode) {
    if (!savedBounds) savedBounds = mainWindow.getBounds()
    mainWindow.setMinimumSize(OVERLAY_WINDOW.minWidth, OVERLAY_WINDOW.minHeight)
    positionOverlayWindow(mainWindow)
    mainWindow.setIgnoreMouseEvents(settings.clickThrough, { forward: true })
  } else {
    mainWindow.setMinimumSize(FULL_WINDOW.minWidth, FULL_WINDOW.minHeight)
    if (savedBounds) {
      mainWindow.setBounds(savedBounds)
      savedBounds = null
    } else {
      mainWindow.setSize(FULL_WINDOW.width, FULL_WINDOW.height)
      mainWindow.center()
    }
    mainWindow.setIgnoreMouseEvents(false)
  }

  broadcastSettings(mainWindow, settings)
}

function createWindow(): void {
  const settings = loadSettings()

  mainWindow = new BrowserWindow({
    width: settings.overlayMode ? OVERLAY_WINDOW.width : FULL_WINDOW.width,
    height: settings.overlayMode ? OVERLAY_WINDOW.height : FULL_WINDOW.height,
    minWidth: settings.overlayMode ? OVERLAY_WINDOW.minWidth : FULL_WINDOW.minWidth,
    minHeight: settings.overlayMode ? OVERLAY_WINDOW.minHeight : FULL_WINDOW.minHeight,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    titleBarStyle: 'hidden',
    alwaysOnTop: settings.alwaysOnTop || settings.overlayMode,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (settings.overlayMode) positionOverlayWindow(mainWindow)

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    applyWindowSettings(loadSettings())
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function toggleOverlayMode(): void {
  const current = loadSettings()
  updateSettings({ overlayMode: !current.overlayMode })
  applyWindowSettings(loadSettings())
}

app.whenReady().then(() => {
  registerSystemHandlers(ipcMain)
  registerAiHandlers(ipcMain)
  registerVoiceHandlers(ipcMain)
  registerSettingsHandlers(ipcMain)

  bindSettingsAppliers(applyWindowSettings, (enabled) => initLoginItem(app, enabled))

  createWindow()
  initLoginItem(app, loadSettings().launchAtLogin)
  alertMonitor.start(() => mainWindow)

  globalShortcut.register('Control+Shift+J', toggleOverlayMode)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  alertMonitor.stop()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('window:minimize', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize()
})

ipcMain.handle('window:maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win?.isMaximized()) win.unmaximize()
  else win?.maximize()
})

ipcMain.handle('window:close', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close()
})

ipcMain.handle('window:toggleOverlay', () => {
  toggleOverlayMode()
  return loadSettings()
})

ipcMain.handle('window:setClickThrough', (_event, enabled: boolean) => {
  const settings = updateSettings({ clickThrough: enabled })
  applyWindowSettings(settings)
  return settings
})
