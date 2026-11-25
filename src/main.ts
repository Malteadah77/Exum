import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Rectangle } from 'electron';
import * as path from 'path';
import { loadConfig, saveConfig } from './main/configStore';
import { readTracksFromPaths, scanFolder } from './main/libraryScanner';
import { fetchLyrics } from './main/lyricsService';
import { AppConfig, ShortcutAction, Track } from './shared/types';

let mainWindow: BrowserWindow | null = null;
let normalBounds: Rectangle | null = null;
let isMiniMode = false;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 520,
    height: 560,
    minWidth: 440,
    minHeight: 380,
    frame: false,
    backgroundColor: '#121318',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../index.html'));
}

function sendShortcutAction(action: ShortcutAction): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('shortcut:action', action);
}

/**
 * Registra atajos globales del sistema (funcionan aunque Exum esté en segundo plano).
 */
function registerGlobalShortcuts(): void {
  const bindings: Array<{ accelerator: string; action: ShortcutAction }> = [
    { accelerator: 'MediaPlayPause', action: 'play-pause' },
    { accelerator: 'MediaNextTrack', action: 'next' },
    { accelerator: 'MediaPreviousTrack', action: 'previous' },
    { accelerator: 'MediaStop', action: 'stop' },
    { accelerator: 'CommandOrControl+Alt+Space', action: 'play-pause' },
    { accelerator: 'CommandOrControl+Alt+Right', action: 'next' },
    { accelerator: 'CommandOrControl+Alt+Left', action: 'previous' },
  ];

  for (const { accelerator, action } of bindings) {
    try {
      globalShortcut.register(accelerator, () => sendShortcutAction(action));
    } catch {
      // Si otro programa ya reservó esa combinación, continuamos sin romper la app
    }
  }
}

// Control de ventana
ipcMain.on('window:minimize', () => {
  mainWindow?.minimize();
});

ipcMain.on('window:close', () => {
  mainWindow?.close();
});

// Modo Mini-Barra Flotante (Winamp Shade Mode + Always on Top)
ipcMain.handle('window:setMiniMode', (_event, enabled: boolean) => {
  if (!mainWindow) return false;
  if (enabled === isMiniMode) return isMiniMode;

  isMiniMode = enabled;

  if (enabled) {
    normalBounds = mainWindow.getBounds();
    mainWindow.setMinimumSize(400, 74);
    mainWindow.setSize(460, 82);
    mainWindow.setAlwaysOnTop(true, 'floating');
  } else {
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setMinimumSize(440, 380);
    if (normalBounds) {
      mainWindow.setBounds(normalBounds);
    } else {
      mainWindow.setSize(520, 560);
    }
  }

  return isMiniMode;
});

// Abrir una o varias canciones desde Windows
ipcMain.handle('dialog:openAudio', async () => {
  if (!mainWindow) return [];

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Agregar canciones a la playlist',
    properties: ['openFile', 'multiSelections'],
    filters: [
      {
        name: 'Archivos de Audio',
        extensions: ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac'],
      },
    ],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return [];
  }

  return readTracksFromPaths(result.filePaths);
});

// Elegir carpeta dedicada de biblioteca local
ipcMain.handle('dialog:selectFolder', async () => {
  if (!mainWindow) return null;

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Seleccionar tu carpeta de música',
    properties: ['openDirectory'],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const folderPath = result.filePaths[0];
  await saveConfig({ musicFolder: folderPath });
  const tracks = await scanFolder(folderPath);
  return { folderPath, tracks };
});

ipcMain.handle('library:scanFolder', async (_event, folderPath: string) => scanFolder(folderPath));
ipcMain.handle('library:readPaths', async (_event, paths: string[]) => readTracksFromPaths(paths));

// Letras sincronizadas (LRCLIB)
ipcMain.handle(
  'lyrics:fetch',
  async (_event, track: Pick<Track, 'title' | 'artist' | 'album' | 'duration'>) =>
    fetchLyrics(track)
);

// Persistencia de configuración
ipcMain.handle('config:load', async () => loadConfig());
ipcMain.handle('config:save', async (_event, partial: Partial<AppConfig>) => saveConfig(partial));

app.whenReady().then(() => {
  createWindow();
  registerGlobalShortcuts();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('will-quit', () => {
  // Regla de oro en Electron: liberar todos los atajos globales al cerrar
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
