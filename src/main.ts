import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Rectangle, session } from 'electron';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { loadConfig, saveConfig } from './main/configStore';
import {
  downloadDirectAudioToLibrary,
  getArchiveAlbumTracks,
  resolveStreamUrl,
  searchArchiveAlbums,
  searchAudiusTracks,
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
  DEFAULT_PLEDIT,
  deleteSavedWszSkin,
  downloadMuseumSkin,
  importWszFromPath,
  listSavedWszSkins,
  loadSavedWszSkin,
  searchMuseumSkins,
} from './main/wszService';
import type {
  AppConfig,
  FloatingWindowType,
  PanelState,
  ShortcutAction,
  Track,
  WszPleditColors,
  WszSkinData,
} from './shared/types';

// Identidad de aplicación en Windows (anclado en barra de tareas y agrupación)
if (process.platform === 'win32') {
  app.setAppUserModelId('com.exum.player');
}

// Bloqueo de instancia única antes de registrar IPCs
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
const floatingWindows = new Map<FloatingWindowType, BrowserWindow>();

const BASE_W = 275;
const BASE_H_MAIN = 116;
const BASE_H_EQ = 116;
const BASE_H_PL = 152;
const BASE_H_SHADED = 14;
const MIN_SCALE = 1;
const MAX_SCALE = 2.5;

let normalBounds: Rectangle | null = null;
let isMiniMode = false;
let wasPinnedBeforeMini = false;
let eqPanelState: PanelState = 'open';
let plPanelState: PanelState = 'open';
let currentScale = 1.5;
let isProgrammaticResize = false;
let programmaticResizeTimer: ReturnType<typeof setTimeout> | null = null;

// Estado sincronizado en memoria para ventanas flotantes recién abiertas
let currentTrack: Track | null = null;
let currentPalette: WszPleditColors = { ...DEFAULT_PLEDIT };
let activeSkinId: string | null = null;

const ALLOWED_LOCAL_PAGES = new Set([
  pathToFileURL(path.join(__dirname, '../index.html')).href,
  pathToFileURL(path.join(__dirname, '../lyrics.html')).href,
  pathToFileURL(path.join(__dirname, '../skins.html')).href,
  pathToFileURL(path.join(__dirname, '../sources.html')).href,
]);

const FLOATING_SPECS: Record<
  FloatingWindowType,
  { file: string; width: number; height: number; minWidth: number; minHeight: number }
> = {
  lyrics: { file: '../lyrics.html', width: 360, height: 440, minWidth: 260, minHeight: 240 },
  skins: { file: '../skins.html', width: 520, height: 540, minWidth: 360, minHeight: 360 },
  sources: { file: '../sources.html', width: 500, height: 550, minWidth: 380, minHeight: 380 },
};

function getAppIconPath(): string {
  return path.join(__dirname, '../assets/icon.ico');
}

function getSafeWebPreferences(): Electron.WebPreferences {
  return {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  };
}

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

  if (programmaticResizeTimer) {
    clearTimeout(programmaticResizeTimer);
    programmaticResizeTimer = null;
  }

  isProgrammaticResize = true;
  mainWindow.setAspectRatio(0);
  mainWindow.setMinimumSize(minW, Math.min(minH, BASE_H_MAIN));
  mainWindow.setMaximumSize(
    maxW,
    Math.max(maxH, Math.round((BASE_H_MAIN + BASE_H_EQ + BASE_H_PL) * MAX_SCALE))
  );

  if (resizeWindow) {
    const targetW = Math.round(BASE_W * currentScale);
    const targetH = Math.round(baseH * currentScale);
    mainWindow.setContentSize(targetW, targetH);
  }

  mainWindow.setMinimumSize(minW, minH);
  mainWindow.setMaximumSize(maxW, maxH);
  mainWindow.setAspectRatio(BASE_W / baseH);

  programmaticResizeTimer = setTimeout(() => {
    isProgrammaticResize = false;
    programmaticResizeTimer = null;
  }, 120);
}

function createWindow(): void {
  const initialBaseH = computeBaseHeight('open', 'open');
  mainWindow = new BrowserWindow({
    width: Math.round(BASE_W * currentScale),
    height: Math.round(initialBaseH * currentScale),
    minWidth: Math.round(BASE_W * MIN_SCALE),
    maxWidth: Math.round(BASE_W * MAX_SCALE),
    minHeight: Math.round(initialBaseH * MIN_SCALE),
    maxHeight: Math.round(initialBaseH * MAX_SCALE),
    frame: false,
    useContentSize: true,
    icon: getAppIconPath(),
    backgroundColor: '#0e090b',
    webPreferences: getSafeWebPreferences(),
  });

  mainWindow.setAspectRatio(BASE_W / initialBaseH);
  void mainWindow.loadFile(path.join(__dirname, '../index.html')).catch(() => undefined);

  mainWindow.on('resize', () => {
    if (!mainWindow || mainWindow.isDestroyed() || isProgrammaticResize || isMiniMode) return;
    const [w] = mainWindow.getContentSize();
    if (w >= BASE_W * MIN_SCALE && w <= BASE_W * MAX_SCALE + 2) {
      currentScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, w / BASE_W));
    }
  });

  mainWindow.on('closed', () => {
    for (const win of floatingWindows.values()) {
      if (!win.isDestroyed()) win.close();
    }
    floatingWindows.clear();
    mainWindow = null;
  });
}

function openFloatingWindow(type: FloatingWindowType): void {
  const existing = floatingWindows.get(type);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return;
  }

  const spec = FLOATING_SPECS[type];
  if (!spec) return;

  const win = new BrowserWindow({
    width: spec.width,
    height: spec.height,
    minWidth: spec.minWidth,
    minHeight: spec.minHeight,
    frame: false,
    icon: getAppIconPath(),
    backgroundColor: currentPalette.normalBg,
    webPreferences: getSafeWebPreferences(),
  });

  floatingWindows.set(type, win);
  void win.loadFile(path.join(__dirname, spec.file)).catch(() => undefined);
  win.on('closed', () => {
    floatingWindows.delete(type);
  });
}

function broadcastToFloating(channel: string, payload: unknown): void {
  for (const win of floatingWindows.values()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}

function broadcastSkinToAll(skin: WszSkinData | null): void {
  activeSkinId = skin?.meta.id ?? null;
  currentPalette = skin ? { ...skin.pledit } : { ...DEFAULT_PLEDIT };

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('wsz:skinApplied', skin);
  }
  broadcastToFloating('sync:palette', currentPalette);

  const skinsWin = floatingWindows.get('skins');
  if (skinsWin && !skinsWin.isDestroyed()) {
    // Enviamos solo metadatos mínimos a la ventana de skins (no sprites base64)
    const liteSkin = skin
      ? { meta: skin.meta, sprites: {}, pledit: skin.pledit, visColors: [] }
      : null;
    skinsWin.webContents.send('wsz:skinApplied', liteSkin);
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

// Blindaje global de navegación y ventanas emergentes (bloquea secuestro de preload)
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (navEvent, navigationUrl) => {
    if (!ALLOWED_LOCAL_PAGES.has(navigationUrl)) {
      navEvent.preventDefault();
    }
  });
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-attach-webview', (attachEvent) => {
    attachEvent.preventDefault();
  });
});

// Control de ventana genérico (principal, Letras, Skins y Biblioteca)
ipcMain.on('window:minimize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) win.minimize();
});

ipcMain.on('window:close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) win.close();
});

ipcMain.handle('window:togglePin', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return false;
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
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (enabled === isMiniMode) return isMiniMode;

  isMiniMode = enabled;
  if (enabled) {
    wasPinnedBeforeMini = mainWindow.isAlwaysOnTop();
    if (!mainWindow.isMinimized()) {
      normalBounds = mainWindow.getBounds();
    }
    mainWindow.setAspectRatio(0);
    mainWindow.setMinimumSize(275, 56);
    mainWindow.setMaximumSize(688, 90);
    mainWindow.setSize(412, 62);
    mainWindow.setAlwaysOnTop(true, 'floating');
  } else {
    mainWindow.setAlwaysOnTop(wasPinnedBeforeMini, 'floating');
    const baseH = computeBaseHeight(eqPanelState, plPanelState);
    mainWindow.setMinimumSize(Math.round(BASE_W * MIN_SCALE), Math.round(baseH * MIN_SCALE));
    mainWindow.setMaximumSize(Math.round(BASE_W * MAX_SCALE), Math.round(baseH * MAX_SCALE));
    if (normalBounds && normalBounds.x > -10_000 && normalBounds.y > -10_000) {
      mainWindow.setBounds(normalBounds);
    }
    applyWindowProportions(eqPanelState, plPanelState, false);
  }
  return isMiniMode;
});

ipcMain.handle('window:setPanels', (_event, eqState: PanelState, plState: PanelState) => {
  applyWindowProportions(eqState, plState, true);
});

// Sincronización entre ventana principal y ventanas flotantes
ipcMain.on('sync:track', (_event, track: Track | null) => {
  currentTrack = track;
  const lyricsWin = floatingWindows.get('lyrics');
  if (lyricsWin && !lyricsWin.isDestroyed()) {
    lyricsWin.webContents.send('sync:track', track);
  }
});

ipcMain.on('sync:time', (_event, currentTime: number) => {
  const lyricsWin = floatingWindows.get('lyrics');
  if (lyricsWin && !lyricsWin.isDestroyed()) {
    lyricsWin.webContents.send('sync:time', currentTime);
  }
});

ipcMain.on('lyrics:seek', (_event, seconds: number) => {
  if (mainWindow && !mainWindow.isDestroyed() && Number.isFinite(seconds) && seconds >= 0) {
    mainWindow.webContents.send('lyrics:seek', seconds);
  }
});

ipcMain.on('external:addTrack', (_event, track: Track, autoPlay: boolean) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('external:trackReceived', track, Boolean(autoPlay));
  }
});

ipcMain.on('external:replacePlaylist', (_event, tracks: Track[], label?: string) => {
  if (mainWindow && !mainWindow.isDestroyed() && Array.isArray(tracks)) {
    mainWindow.webContents.send('external:replacePlaylist', tracks, label);
  }
});

// Explorador Libre (Audius + Internet Archive) + Radios + .m3u/.pls + Descarga abierta
ipcMain.handle('external:searchAudius', async (_event, query: string) => searchAudiusTracks(query));
ipcMain.handle('external:searchArchive', async (_event, query: string) => searchArchiveAlbums(query));
ipcMain.handle(
  'external:archiveTracks',
  async (_event, identifier: string, albumTitle: string, creator: string) =>
    getArchiveAlbumTracks(identifier, albumTitle, creator)
);
ipcMain.handle('external:searchRadios', async (_event, query: string) => searchWorldRadios(query));
ipcMain.handle('external:resolveStream', async (_event, url: string) => resolveStreamUrl(url));
ipcMain.handle('external:downloadAudio', async (event, url: string, customName?: string) => {
  const owner = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
  return downloadDirectAudioToLibrary(url, customName, owner);
});

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
  if (!mainWindow || mainWindow.isDestroyed()) return [];
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Agregar canciones a la playlist',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Archivos de Audio', extensions: ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return [];
  return readTracksFromPaths(result.filePaths);
});

ipcMain.handle('dialog:selectFolder', async (event, includeCover = false) => {
  const owner = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
  if (!owner || owner.isDestroyed()) return null;
  const result = await dialog.showOpenDialog(owner, {
    title: 'Seleccionar tu carpeta de música',
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const folderPath = result.filePaths[0];
  await saveConfig({ musicFolder: folderPath }, true);
  const tracks = await scanFolder(folderPath, Boolean(includeCover));
  return { folderPath, tracks };
});

ipcMain.handle('library:scanFolder', async (_event, folderPath: string) => {
  const cfg = await loadConfig();
  if (!cfg.musicFolder || path.resolve(folderPath) !== path.resolve(cfg.musicFolder)) return [];
  return scanFolder(cfg.musicFolder, false);
});

ipcMain.handle('library:scanWithCovers', async (_event, folderPath: string) => {
  const cfg = await loadConfig();
  if (!cfg.musicFolder || path.resolve(folderPath) !== path.resolve(cfg.musicFolder)) return [];
  return scanFolder(cfg.musicFolder, true);
});

ipcMain.handle('library:readPaths', async (_event, paths: string[]) =>
  Array.isArray(paths) ? readTracksFromPaths(paths) : []
);

// Letras (LRCLIB)
ipcMain.handle(
  'lyrics:fetch',
  async (_event, track: Pick<Track, 'title' | 'artist' | 'album' | 'duration'>) => fetchLyrics(track)
);

// Skins .wsz + Webamp Skin Museum
ipcMain.handle('wsz:list', async () => listSavedWszSkins());

ipcMain.handle('wsz:importDialog', async (event) => {
  const owner = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
  if (!owner || owner.isDestroyed()) return null;
  const result = await dialog.showOpenDialog(owner, {
    title: 'Importar skin de Winamp (.wsz)',
    properties: ['openFile'],
    filters: [{ name: 'Winamp Classic Skin', extensions: ['wsz', 'zip'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const skin = await importWszFromPath(result.filePaths[0]);
  if (skin) {
    await saveConfig({ activeWszSkinId: skin.meta.id }, true);
    broadcastSkinToAll(skin);
  }
  return skin;
});

ipcMain.handle('wsz:importPath', async (_event, filePath: string) => {
  const skin = await importWszFromPath(filePath);
  if (skin) {
    await saveConfig({ activeWszSkinId: skin.meta.id }, true);
    broadcastSkinToAll(skin);
  }
  return skin;
});

ipcMain.handle('wsz:load', async (_event, skinId: string) => {
  const skin = await loadSavedWszSkin(skinId);
  if (skin) {
    activeSkinId = skin.meta.id;
    currentPalette = { ...skin.pledit };
  }
  return skin;
});

ipcMain.handle('wsz:select', async (_event, skinId: string | null) => {
  if (!skinId) {
    await saveConfig({ activeWszSkinId: null }, true);
    broadcastSkinToAll(null);
    return null;
  }
  const skin = await loadSavedWszSkin(skinId);
  if (skin) {
    await saveConfig({ activeWszSkinId: skin.meta.id }, true);
    broadcastSkinToAll(skin);
  }
  return skin;
});

ipcMain.handle('wsz:delete', async (_event, skinId: string) => {
  const ok = await deleteSavedWszSkin(skinId);
  if (ok && activeSkinId === skinId) {
    await saveConfig({ activeWszSkinId: null }, true);
    broadcastSkinToAll(null);
  }
  return ok;
});

ipcMain.handle('wsz:searchMuseum', async (_event, query: string) => searchMuseumSkins(query));

ipcMain.handle('wsz:downloadMuseum', async (_event, downloadUrl: string, filename: string) => {
  const skin = await downloadMuseumSkin(downloadUrl, filename);
  if (skin) {
    await saveConfig({ activeWszSkinId: skin.meta.id }, true);
    broadcastSkinToAll(skin);
  }
  return skin;
});

// Persistencia (campos privilegiados como musicFolder solo se modifican desde diálogos de Main)
ipcMain.handle('config:load', async () => loadConfig());
ipcMain.handle('config:save', async (_event, partial: Partial<AppConfig>) => saveConfig(partial, false));

if (gotSingleInstanceLock) {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    // Bloquea permisos del navegador por defecto (cámara, micrófono, geolocalización, etc.)
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);

    createWindow();
    registerGlobalShortcuts();
  });
}

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  app.quit();
});
