import { contextBridge, ipcRenderer, webUtils } from 'electron';
import {
  AppConfig,
  ElectronAPI,
  FloatingWindowType,
  LyricsResult,
  MuseumSkinItem,
  ShortcutAction,
  SpotifyAuthState,
  SpotifyPlaylistItem,
  SpotifyTrackItem,
  Track,
  WszPleditColors,
  WszSkinData,
  WszSkinMeta,
} from './shared/types';

const api: ElectronAPI = {
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('window:togglePin') as Promise<boolean>,
  setMiniMode: (enabled: boolean) =>
    ipcRenderer.invoke('window:setMiniMode', enabled) as Promise<boolean>,
  setWindowPanels: (eqVisible: boolean, plVisible: boolean) =>
    ipcRenderer.invoke('window:setPanels', eqVisible, plVisible) as Promise<void>,
  openFloatingWindow: (type: FloatingWindowType) =>
    ipcRenderer.invoke('window:openFloating', type) as Promise<void>,
  openExternalUrl: (url: string) =>
    ipcRenderer.invoke('shell:openExternal', url) as Promise<void>,

  openAudioFiles: () => ipcRenderer.invoke('dialog:openAudio') as Promise<Track[]>,
  selectMusicFolder: () =>
    ipcRenderer.invoke('dialog:selectFolder') as Promise<{ folderPath: string; tracks: Track[] } | null>,
  scanFolder: (folderPath: string) =>
    ipcRenderer.invoke('library:scanFolder', folderPath) as Promise<Track[]>,
  readDroppedPaths: (paths: string[]) =>
    ipcRenderer.invoke('library:readPaths', paths) as Promise<Track[]>,
  getPathForFile: (file: File) => webUtils.getPathForFile(file),

  loadConfig: () => ipcRenderer.invoke('config:load') as Promise<AppConfig>,
  saveConfig: (partial: Partial<AppConfig>) =>
    ipcRenderer.invoke('config:save', partial) as Promise<AppConfig>,

  fetchLyrics: (track: Pick<Track, 'title' | 'artist' | 'album' | 'duration'>) =>
    ipcRenderer.invoke('lyrics:fetch', track) as Promise<LyricsResult>,
  broadcastTrack: (track: Track | null) => ipcRenderer.send('sync:track', track),
  broadcastTime: (currentTime: number) => ipcRenderer.send('sync:time', currentTime),
  broadcastPalette: (palette: WszPleditColors) => ipcRenderer.send('sync:palette', palette),
  requestSeekFromLyrics: (seconds: number) => ipcRenderer.send('lyrics:seek', seconds),
  sendExternalTrack: (track: Track, autoPlay: boolean) =>
    ipcRenderer.send('external:addTrack', track, autoPlay),
  getSyncState: () =>
    ipcRenderer.invoke('sync:getState') as Promise<{
      track: Track | null;
      palette: WszPleditColors;
      activeSkinId: string | null;
    }>,

  onShortcutAction: (callback: (action: ShortcutAction) => void) => {
    ipcRenderer.removeAllListeners('shortcut:action');
    ipcRenderer.on('shortcut:action', (_event, action: ShortcutAction) => callback(action));
  },
  onTrackChanged: (callback: (track: Track | null) => void) => {
    ipcRenderer.removeAllListeners('sync:track');
    ipcRenderer.on('sync:track', (_event, track: Track | null) => callback(track));
  },
  onTimeUpdated: (callback: (currentTime: number) => void) => {
    ipcRenderer.removeAllListeners('sync:time');
    ipcRenderer.on('sync:time', (_event, sec: number) => callback(sec));
  },
  onPaletteUpdated: (callback: (palette: WszPleditColors) => void) => {
    ipcRenderer.removeAllListeners('sync:palette');
    ipcRenderer.on('sync:palette', (_event, palette: WszPleditColors) => callback(palette));
  },
  onSeekRequested: (callback: (seconds: number) => void) => {
    ipcRenderer.removeAllListeners('lyrics:seek');
    ipcRenderer.on('lyrics:seek', (_event, sec: number) => callback(sec));
  },
  onSkinApplied: (callback: (skin: WszSkinData | null) => void) => {
    ipcRenderer.removeAllListeners('wsz:skinApplied');
    ipcRenderer.on('wsz:skinApplied', (_event, skin: WszSkinData | null) => callback(skin));
  },
  onExternalTrackReceived: (callback: (track: Track, autoPlay: boolean) => void) => {
    ipcRenderer.removeAllListeners('external:trackReceived');
    ipcRenderer.on('external:trackReceived', (_event, track: Track, autoPlay: boolean) =>
      callback(track, autoPlay)
    );
  },

  listWszSkins: () => ipcRenderer.invoke('wsz:list') as Promise<WszSkinMeta[]>,
  importWszDialog: () => ipcRenderer.invoke('wsz:importDialog') as Promise<WszSkinData | null>,
  importWszPath: (filePath: string) =>
    ipcRenderer.invoke('wsz:importPath', filePath) as Promise<WszSkinData | null>,
  loadWszSkin: (skinId: string) =>
    ipcRenderer.invoke('wsz:load', skinId) as Promise<WszSkinData | null>,
  deleteWszSkin: (skinId: string) => ipcRenderer.invoke('wsz:delete', skinId) as Promise<boolean>,
  selectWszSkin: (skinId: string | null) =>
    ipcRenderer.invoke('wsz:select', skinId) as Promise<WszSkinData | null>,
  searchMuseumSkins: (query: string) =>
    ipcRenderer.invoke('wsz:searchMuseum', query) as Promise<MuseumSkinItem[]>,
  downloadMuseumSkin: (downloadUrl: string, filename: string) =>
    ipcRenderer.invoke('wsz:downloadMuseum', downloadUrl, filename) as Promise<WszSkinData | null>,

  spotifyGetState: () => ipcRenderer.invoke('spotify:state') as Promise<SpotifyAuthState>,
  spotifyConnect: (clientId: string) =>
    ipcRenderer.invoke('spotify:connect', clientId) as Promise<SpotifyAuthState>,
  spotifyDisconnect: () => ipcRenderer.invoke('spotify:disconnect') as Promise<SpotifyAuthState>,
  spotifyListPlaylists: () =>
    ipcRenderer.invoke('spotify:playlists') as Promise<SpotifyPlaylistItem[]>,
  spotifyGetPlaylistTracks: (playlistId: string) =>
    ipcRenderer.invoke('spotify:playlistTracks', playlistId) as Promise<SpotifyTrackItem[]>,
};

contextBridge.exposeInMainWorld('electronAPI', api);
