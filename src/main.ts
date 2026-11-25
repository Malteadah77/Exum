import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import * as path from 'path';
import { loadConfig, saveConfig } from './main/configStore';
import { readTracksFromPaths, scanFolder } from './main/libraryScanner';
import { AppConfig } from './shared/types';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 520,
    height: 540,
    minWidth: 440,
    minHeight: 380,
    frame: false, // Sin bordes de Windows para dar estilo propio (tipo Winamp)
    backgroundColor: '#121318',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, // Seguridad: aísla la UI del acceso directo al sistema
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../index.html'));
}

// Eventos sin respuesta (send/on): controlar la ventana
ipcMain.on('window:minimize', () => {
  mainWindow?.minimize();
});

ipcMain.on('window:close', () => {
  mainWindow?.close();
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

// Elegir la carpeta dedicada de biblioteca local y guardarla en config.json
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

// Escanear una carpeta guardada previamente
ipcMain.handle('library:scanFolder', async (_event, folderPath: string) => {
  return scanFolder(folderPath);
});

// Leer archivos o carpetas arrastrados (Drag & Drop)
ipcMain.handle('library:readPaths', async (_event, paths: string[]) => {
  return readTracksFromPaths(paths);
});

// Persistencia de configuración
ipcMain.handle('config:load', async () => loadConfig());
ipcMain.handle('config:save', async (_event, partial: Partial<AppConfig>) => saveConfig(partial));

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
