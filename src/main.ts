import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Rectangle, shell } from 'electron';
import * as path from 'path';
import { loadConfig, saveConfig } from './main/configStore';
import {
  downloadDirectAudioToLibrary,
  matchSpotifyPlaylistToLocal,
  resolveStreamUrl,
  searchWorldRadios,
} from './main/externalSourcesService';
import { readTracksFromPaths, scanFolder } from './main/libraryScanner';
import { fetchLyrics } from './main/lyricsService';
import {
  deleteSavedPlaylist,
  exportM3uDialog,
  importM3uDialog,
  listSavedPlaylists,
  saveNamedPlaylist,
} from './main/playlistStore';
import {
  connectSpotify,
  disconnectSpotify,
  getSpotifyPlaylistTracks,
  getSpotifyState,
  listSpotifyPlaylists,
} from './main/spotifyService';
import {
  DEFAULT_PLEDIT,
  deleteSavedWszSkin,
  downloadMuseumSkin,
  importWszFromPath,
  listSavedWszSkins,
  loadSavedWszSkin,
  searchMuseumSkins,
} from './main/wszService';
import {
  AppConfig,
  FloatingWindowType,
  PanelState,
  ShortcutAction,
  Track,
  WszPleditColors,
  WszSkinData,
} from './shared/types';

let mainWindow: BrowserWindow | null = null;
let lyricsWindow: BrowserWindow | null = null;
let skinsWindow: BrowserWindow | null = null;
let sourcesWindow: BrowserWindow | null = null;

const BASE_W = 275;
const BASE_H_MAIN = 116;
const BASE_H_EQ = 116;
const BASE_H_PL = 152;
const BASE_H_SHADED = 14;
const MIN_SCALE = 1;
const MAX_SCALE = 2.5;

let normalBounds: Rectangle | null = null;
let isMiniMode = false;
let eqPanelState: PanelState = 'open';
let plPanelState: PanelState = 'open';
// Única fuente de verdad de la escala actual: evita encogimiento progresivo al alternar EQ/PL
let currentScale = 1.5;
let isProgrammaticResize = false;

function computeBaseHeight(eqState: PanelState, plState: PanelState): number {
  const eqH = eqState === 'open' ? BASE_H_EQ : eqState === 'shaded' ? BASE_H_SHADED : 0;
  const plH = plState === 'open' ? BASE_H_PL : plState === 'shaded' ? BASE_H_SHADED : 0;
  return BASE_H_MAIN + eqH + plH;
}

function applyWindowProportions(eqState: PanelState, plState: PanelState, resizeWindow = true): void {
  if (!mainWindow || mainWindow.isDestroyed() || isMiniMode) return;

  eqPanelState = eqState;
  plPanelState = plState;
  const baseH = computeBaseHeight(eqState, plState);
  const minW = Math.round(BASE_W * MIN_SCALE);
  const minH = Math.round(baseH * MIN_SCALE);
  const maxW = Math.round(BASE_W * MAX_SCALE);
  const maxH = Math.round(baseH * MAX_SCALE);

  isProgrammaticResize = true;
  mainWindow.setAspectRatio(0);
  mainWindow.setMinimumSize(minW, Math.min(minH, BASE_H_MAIN));
  mainWindow.setMaximumSize(maxW, Math.max(maxH, Math.round((BASE_H_MAIN + BASE_H_EQ + BASE_H_PL) * MAX_SCALE)));

  if (resizeWindow) {
    const targetW = Math.round(BASE_W * currentScale);
    const targetH = Math.round(baseH * currentScale);
    mainWindow.setContentSize(targetW, targetH);
  }

  mainWindow.setMinimumSize(minW, minH);
  mainWindow.setMaximumSize(maxW, maxH);
  mainWindow.setAspectRatio(BASE_W / baseH);

  setTimeout(() => {
    isProgrammaticResize = false;
  }, 120);
}

// Estado sincronizado en memoria para ventanas flotantes recién abiertas
let currentTrack: Track | null = null;
let currentPalette: WszPleditColors = { ...DEFAULT_PLEDIT };
let activeSkinId: string | null = null;

function createWindow(): void {
  const initialBaseH = computeBaseHeight('open', 'open');
  const appIcon = path.join(__dirname, '../assets/icon.png');
  mainWindow = new BrowserWindow({
    width: Math.round(BASE_W * currentScale),
    height: Math.round(initialBaseH * currentScale),
    minWidth: Math.round(BASE_W * MIN_SCALE),
    maxWidth: Math.round(BASE_W * MAX_SCALE),
    minHeight: Math.round(initialBaseH * MIN_SCALE),
    maxHeight: Math.round(initialBaseH * MAX_SCALE),
    frame: false,
    useContentSize: true,
    icon: appIcon,
    backgroundColor: '#0e090b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setAspectRatio(BASE_W / initialBaseH);
  mainWindow.loadFile(path.join(__dirname, '../index.html'));

  // Solo actualizamos currentScale cuando el usuario redimensiona manualmente la ventana
  mainWindow.on('resize', () => {
    if (!mainWindow || isProgrammaticResize || isMiniMode) return;
    const [w] = mainWindow.getContentSize();
    if (w >= BASE_W * MIN_SCALE && w <= BASE_W * MAX_SCALE + 2) {
      currentScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, w / BASE_W));
    }
  });

  // Al cerrar la ventana principal, cerramos también las flotantes
  mainWindow.on('closed', () => {
    lyricsWindow?.close();
    skinsWindow?.close();
    sourcesWindow?.close();
    mainWindow = null;
  });
}

function openFloatingWindow(type: FloatingWindowType): void {
  const appIcon = path.join(__dirname, '../assets/icon.png');
  if (type === 'lyrics') {
    if (lyricsWindow && !lyricsWindow.isDestroyed()) {
      lyricsWindow.focus();
      return;
    }
    lyricsWindow = new BrowserWindow({
      width: 360,
      height: 440,
      minWidth: 260,
      minHeight: 240,
      frame: false,
      icon: appIcon,
      backgroundColor: currentPalette.normalBg,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    lyricsWindow.loadFile(path.join(__dirname, '../lyrics.html'));
    lyricsWindow.on('closed', () => {
      lyricsWindow = null;
    });
    return;
  }

  if (type === 'skins') {
    if (skinsWindow && !skinsWindow.isDestroyed()) {
      skinsWindow.focus();
      return;
    }
    skinsWindow = new BrowserWindow({
      width: 520,
      height: 540,
      minWidth: 360,
      minHeight: 360,
      frame: false,
      icon: appIcon,
      backgroundColor: currentPalette.normalBg,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    skinsWindow.loadFile(path.join(__dirname, '../skins.html'));
    skinsWindow.on('closed', () => {
      skinsWindow = null;
    });
    return;
  }

  if (type === 'sources') {
    if (sourcesWindow && !sourcesWindow.isDestroyed()) {
      sourcesWindow.focus();
      return;
    }
    sourcesWindow = new BrowserWindow({
      width: 480,
      height: 500,
      minWidth: 340,
      minHeight: 340,
      frame: false,
      icon: appIcon,
      backgroundColor: currentPalette.normalBg,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    sourcesWindow.loadFile(path.join(__dirname, '../sources.html'));
    sourcesWindow.on('closed', () => {
      sourcesWindow = null;
    });
  }
}

function broadcastToFloating(channel: string, payload: unknown): void {
  if (lyricsWindow && !lyricsWindow.isDestroyed()) {
    lyricsWindow.webContents.send(channel, payload);
  }
  if (skinsWindow && !skinsWindow.isDestroyed()) {
    skinsWindow.webContents.send(channel, payload);
  }
  if (sourcesWindow && !sourcesWindow.isDestroyed()) {
    sourcesWindow.webContents.send(channel, payload);
  }
}

function broadcastSkinToAll(skin: WszSkinData | null): void {
  activeSkinId = skin?.meta.id ?? null;
  currentPalette = skin ? { ...skin.pledit } : { ...DEFAULT_PLEDIT };

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('wsz:skinApplied', skin);
  }
  broadcastToFloating('sync:palette', currentPalette);
  if (skinsWindow && !skinsWindow.isDestroyed()) {
    skinsWindow.webContents.send('wsz:skinApplied', skin);
  }
}

function sendShortcutAction(action: ShortcutAction): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('shortcut:action', action);
}

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
      // Si otro programa ya reservó esa combinación, continuamos
    }
  }
}

// Control de ventana genérico (funciona para principal, Letras y Skins)
ipcMain.on('window:minimize', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.on('window:close', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

ipcMain.handle('window:togglePin', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return false;
  const next = !win.isAlwaysOnTop();
  win.setAlwaysOnTop(next, 'floating');
  return next;
});

ipcMain.handle('window:toggleDoubleSize', () => {
  if (!mainWindow || mainWindow.isDestroyed() || isMiniMode) return false;
  const isDouble = currentScale >= 1.9;
  currentScale = isDouble ? 1.5 : 2;
  applyWindowProportions(eqPanelState, plPanelState, true);
  return !isDouble;
});

ipcMain.handle('window:openFloating', (_event, type: FloatingWindowType) => {
  openFloatingWindow(type);
});

// Modo Mini-Barra Flotante para la ventana principal
ipcMain.handle('window:setMiniMode', (_event, enabled: boolean) => {
  if (!mainWindow) return false;
  if (enabled === isMiniMode) return isMiniMode;

  isMiniMode = enabled;
  if (enabled) {
    normalBounds = mainWindow.getBounds();
    mainWindow.setAspectRatio(0);
    mainWindow.setMinimumSize(275, 56);
    mainWindow.setMaximumSize(688, 90);
    mainWindow.setSize(412, 62);
    mainWindow.setAlwaysOnTop(true, 'floating');
  } else {
    mainWindow.setAlwaysOnTop(false);
    if (normalBounds) {
      mainWindow.setMinimumSize(275, 200);
      mainWindow.setMaximumSize(688, 1000);
      mainWindow.setBounds(normalBounds);
    }
    applyWindowProportions(eqPanelState, plPanelState, false);
  }
  return isMiniMode;
});

// Ajusta altura y proporción bloqueada según estado de EQ y PL (open / shaded / closed)
ipcMain.handle('window:setPanels', (_event, eqState: PanelState, plState: PanelState) => {
  applyWindowProportions(eqState, plState, true);
});

// Sincronización entre ventana principal y ventanas flotantes
ipcMain.on('sync:track', (_event, track: Track | null) => {
  currentTrack = track;
  if (lyricsWindow && !lyricsWindow.isDestroyed()) {
    lyricsWindow.webContents.send('sync:track', track);
  }
});

ipcMain.on('sync:time', (_event, currentTime: number) => {
  if (lyricsWindow && !lyricsWindow.isDestroyed()) {
    lyricsWindow.webContents.send('sync:time', currentTime);
  }
});

ipcMain.on('sync:palette', (_event, palette: WszPleditColors) => {
  currentPalette = { ...palette };
  broadcastToFloating('sync:palette', currentPalette);
});

ipcMain.on('lyrics:seek', (_event, seconds: number) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('lyrics:seek', seconds);
  }
});

ipcMain.on('external:addTrack', (_event, track: Track, autoPlay: boolean) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('external:trackReceived', track, autoPlay);
  }
});

ipcMain.on('external:replacePlaylist', (_event, tracks: Track[], label?: string) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('external:replacePlaylist', tracks, label);
  }
});

ipcMain.on('external:pauseLocal', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('external:pauseLocal');
  }
});

ipcMain.handle('shell:openExternal', async (_event, url: string) => {
  if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
    await shell.openExternal(url);
  }
});

// Fuentes Externas (Radio Browser, .m3u/.pls, descarga audio directo, Spotify Match)
ipcMain.handle('external:searchRadios', async (_event, query: string) => searchWorldRadios(query));
ipcMain.handle('external:resolveStream', async (_event, url: string) => resolveStreamUrl(url));
ipcMain.handle('external:downloadAudio', async (event, url: string, customName?: string) => {
  const owner = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
  return downloadDirectAudioToLibrary(url, customName, owner);
});
ipcMain.handle('spotify:matchPlaylist', async (_event, urlOrId: string) =>
  matchSpotifyPlaylistToLocal(urlOrId)
);

// Spotify Oficial (OAuth 2.0 PKCE)
ipcMain.handle('spotify:state', () => getSpotifyState());
ipcMain.handle('spotify:connect', async (_event, clientId: string) => {
  await saveConfig({ spotifyClientId: clientId.trim() || null });
  return connectSpotify(clientId);
});
ipcMain.handle('spotify:disconnect', () => disconnectSpotify());
ipcMain.handle('spotify:playlists', async () => listSpotifyPlaylists());
ipcMain.handle('spotify:playlistTracks', async (_event, playlistId: string) =>
  getSpotifyPlaylistTracks(playlistId)
);

// Gestión de Playlists guardadas + Importar/Exportar .m3u
ipcMain.handle('playlists:list', async () => listSavedPlaylists());
ipcMain.handle('playlists:save', async (_event, name: string, tracks: Track[]) =>
  saveNamedPlaylist(name, tracks)
);
ipcMain.handle('playlists:delete', async (_event, id: string) => deleteSavedPlaylist(id));
ipcMain.handle('playlists:exportM3u', async (_event, tracks: Track[]) =>
  exportM3uDialog(mainWindow, tracks)
);
ipcMain.handle('playlists:importM3u', async () => importM3uDialog(mainWindow));

ipcMain.handle('sync:getState', () => ({
  track: currentTrack,
  palette: currentPalette,
  activeSkinId,
}));

// Archivos y biblioteca local
ipcMain.handle('dialog:openAudio', async () => {
  if (!mainWindow) return [];
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Agregar canciones a la playlist',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Archivos de Audio', extensions: ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return [];
  return readTracksFromPaths(result.filePaths);
});

ipcMain.handle('dialog:selectFolder', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Seleccionar tu carpeta de música',
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const folderPath = result.filePaths[0];
  await saveConfig({ musicFolder: folderPath });
  const tracks = await scanFolder(folderPath);
  return { folderPath, tracks };
});

ipcMain.handle('library:scanFolder', async (_event, folderPath: string) => scanFolder(folderPath));
ipcMain.handle('library:readPaths', async (_event, paths: string[]) => readTracksFromPaths(paths));

// Letras (LRCLIB)
ipcMain.handle(
  'lyrics:fetch',
  async (_event, track: Pick<Track, 'title' | 'artist' | 'album' | 'duration'>) => fetchLyrics(track)
);

// Skins .wsz + Webamp Skin Museum
ipcMain.handle('wsz:list', async () => listSavedWszSkins());

ipcMain.handle('wsz:importDialog', async (event) => {
  const owner = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
  if (!owner) return null;
  const result = await dialog.showOpenDialog(owner, {
    title: 'Importar skin de Winamp (.wsz)',
    properties: ['openFile'],
    filters: [{ name: 'Winamp Classic Skin', extensions: ['wsz', 'zip'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const skin = await importWszFromPath(result.filePaths[0]);
  if (skin) {
    await saveConfig({ activeWszSkinId: skin.meta.id });
    broadcastSkinToAll(skin);
  }
  return skin;
});

ipcMain.handle('wsz:importPath', async (_event, filePath: string) => {
  const skin = await importWszFromPath(filePath);
  if (skin) {
    await saveConfig({ activeWszSkinId: skin.meta.id });
    broadcastSkinToAll(skin);
  }
  return skin;
});

ipcMain.handle('wsz:load', async (_event, skinId: string) => loadSavedWszSkin(skinId));

ipcMain.handle('wsz:select', async (_event, skinId: string | null) => {
  if (!skinId) {
    await saveConfig({ activeWszSkinId: null });
    broadcastSkinToAll(null);
    return null;
  }
  const skin = await loadSavedWszSkin(skinId);
  if (skin) {
    await saveConfig({ activeWszSkinId: skin.meta.id });
    broadcastSkinToAll(skin);
  }
  return skin;
});

ipcMain.handle('wsz:delete', async (_event, skinId: string) => {
  const ok = await deleteSavedWszSkin(skinId);
  if (ok && activeSkinId === skinId) {
    await saveConfig({ activeWszSkinId: null });
    broadcastSkinToAll(null);
  }
  return ok;
});

ipcMain.handle('wsz:searchMuseum', async (_event, query: string) => searchMuseumSkins(query));

ipcMain.handle('wsz:downloadMuseum', async (_event, downloadUrl: string, filename: string) => {
  const skin = await downloadMuseumSkin(downloadUrl, filename);
  if (skin) {
    await saveConfig({ activeWszSkinId: skin.meta.id });
    broadcastSkinToAll(skin);
  }
  return skin;
});

// Persistencia
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
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
