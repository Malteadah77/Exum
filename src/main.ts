import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import * as path from 'path';
import { pathToFileURL } from 'url';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 280,
    minWidth: 420,
    minHeight: 250,
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

// Evento con respuesta (invoke/handle): abrir explorador de archivos de Windows
ipcMain.handle('dialog:openAudio', async () => {
  if (!mainWindow) return null;

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Seleccionar canción',
    properties: ['openFile'],
    filters: [
      {
        name: 'Archivos de Audio',
        extensions: ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac'],
      },
    ],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const filePath = result.filePaths[0];
  return {
    filePath,
    fileUrl: pathToFileURL(filePath).href, // Convierte "C:\..." a "file:///C:/..." seguro para <audio>
    fileName: path.basename(filePath),
  };
});

// Arranca la ventana cuando Electron termina de inicializarse
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Cierra la app al cerrar todas las ventanas (comportamiento estándar en Windows)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
