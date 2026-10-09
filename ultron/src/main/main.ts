import path from 'path';
import fs from 'fs';
import { app, BrowserWindow, ipcMain, shell, session, Menu } from 'electron';
import dotenv from 'dotenv';
import isDev from 'electron-is-dev';

dotenv.config();

let mainWindow: BrowserWindow | null = null;
let fallbackShowTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Let the renderer chrome (custom title bar) stay in sync with the OS window.
 */
const broadcastWindowState = () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send('window:state', { maximized: mainWindow.isMaximized() });
};

/**
 * The window/taskbar icon lives outside `dist`, so resolve it relative to the
 * project root in dev and to the packaged resources in production.
 */
const resolveWindowIcon = (): string | undefined => {
  const candidates = isDev
    ? [
        // compiled main lives at <root>/dist/main/main/, so climb back to the project root
        path.join(__dirname, '../../../assets/icon.ico'),
        path.join(__dirname, '../../assets/icon.ico'),
      ]
    : [
        path.join(process.resourcesPath, 'assets/icon.ico'),
        path.join(__dirname, '../assets/icon.ico'),
      ];
  return candidates.find((candidate) => fs.existsSync(candidate));
};

export const createWindow = async () => {
  const windowIcon = resolveWindowIcon();

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    // TerminalTron-T001 draws its own HUD chrome, so the OS frame is disabled.
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#050506',
    title: 'TerminalTron-T001',
    ...(windowIcon ? { icon: windowIcon } : {}),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Listeners must be attached before the first load: `ready-to-show` can fire
  // while `loadURL` is still awaiting, which would leave the window hidden.
  mainWindow.once('ready-to-show', () => {
    if (fallbackShowTimer) {
      clearTimeout(fallbackShowTimer);
      fallbackShowTimer = null;
    }
    mainWindow?.show();
  });

  // Never leave the user staring at an invisible process if the dev server is down.
  fallbackShowTimer = setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  }, 8000);

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`Failed to load ${validatedURL}: ${errorCode} ${errorDescription}`);
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  });

  if (isDev) {
    await mainWindow.loadURL('http://localhost:5173');
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('maximize', broadcastWindowState);
  mainWindow.on('unmaximize', broadcastWindowState);
  mainWindow.on('enter-full-screen', broadcastWindowState);
  mainWindow.on('leave-full-screen', broadcastWindowState);

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    if (fallbackShowTimer) {
      clearTimeout(fallbackShowTimer);
      fallbackShowTimer = null;
    }
    mainWindow = null;
  });
};

ipcMain.handle('ping', async () => 'pong');

/* ---- Custom window chrome ---- */
ipcMain.handle('window:minimize', () => {
  mainWindow?.minimize();
  return true;
});

ipcMain.handle('window:toggle-maximize', () => {
  if (!mainWindow) {
    return false;
  }
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
  broadcastWindowState();
  return mainWindow.isMaximized();
});

ipcMain.handle('window:close', () => {
  mainWindow?.close();
  return true;
});

ipcMain.handle('window:state', () => ({ maximized: mainWindow?.isMaximized() ?? false }));

/**
 * The renderer renders its own menu strip, so pop up the matching native
 * submenu (File / Edit / View / Window / Help) at the mouse position.
 */
ipcMain.handle('menu:popup', (_event, payload?: { label?: string }) => {
  if (!mainWindow || !payload?.label) {
    return false;
  }
  const applicationMenu = Menu.getApplicationMenu();
  if (!applicationMenu) {
    return false;
  }
  const wanted = payload.label.replace('&', '').toLowerCase();
  const entry = applicationMenu.items.find(
    (item) => item.label.replace('&', '').toLowerCase() === wanted,
  );
  if (!entry?.submenu) {
    return false;
  }
  entry.submenu.popup({ window: mainWindow });
  return true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.whenReady().then(async () => {
  // Allow microphone access so the renderer's voice-reactive orb can listen.
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(true);
  });
  await createWindow();
}).catch((error) => {
  console.error('Failed to create main window', error);
});

