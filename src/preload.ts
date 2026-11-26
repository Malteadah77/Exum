import { contextBridge, ipcRenderer, webUtils } from 'electron';
import {
  AppConfig,
  ArchiveAlbumItem,
  DirectDownloadResult,
  DiscoverTrackItem,
  ElectronAPI,
  FloatingWindowType,
  LyricsResult,
  MuseumSkinItem,
  PanelState,
  RadioStationItem,
  SavedPlaylist,
  ShortcutAction,
  Track,
  WszPleditColors,
  WszSkinData,
  WszSkinMeta,
} from './shared/types';

const api: ElectronAPI = {
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('window:togglePin') as Promise<boolean>,
  toggleDoubleSize: () => ipcRenderer.invoke('window:toggleDoubleSize') as Promise<boolean>,
  setMiniMode: (enabled: boolean) =>
    ipcRenderer.invoke('window:setMiniMode', enabled) as Promise<boolean>,
  setWindowPanels: (eqState: PanelState, plState: PanelState) =>
    ipcRenderer.invoke('window:setPanels', eqState, plState) as Promise<void>,
  openFloatingWindow: (type: FloatingWindowType) =>
    ipcRenderer.invoke('window:openFloating', type) as Promise<void>,
  openExternalUrl: (url: string) =>
    ipcRenderer.invoke('shell:openExternal', url) as Promise<void>,

  openAudioFiles: () => ipcRenderer.invoke('dialog:openAudio') as Promise<Track[]>,
  selectMusicFolder: () =>
    ipcRenderer.invoke('dialog:selectFolder') as Promise<{ folderPath: string; tracks: Track[] } | null>,
  scanFolder: (folderPath: string) =>
    ipcRenderer.invoke('library:scanFolder', folderPath) as Promise<Track[]>,
  scanFolderWithCovers: (folderPath: string) =>
    ipcRenderer.invoke('library:scanWithCovers', folderPath) as Promise<Track[]>,
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
  replaceMainPlaylist: (tracks: Track[], label?: string) =>
    ipcRenderer.send('external:replacePlaylist', tracks, label),
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
  onReplacePlaylistReceived: (callback: (tracks: Track[], label?: string) => void) => {
    ipcRenderer.removeAllListeners('external:replacePlaylist');
    ipcRenderer.on('external:replacePlaylist', (_event, tracks: Track[], label?: string) =>
      callback(tracks, label)
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

  searchAudius: (query: string) =>
    ipcRenderer.invoke('external:searchAudius', query) as Promise<DiscoverTrackItem[]>,
  searchArchiveAlbums: (query: string) =>
    ipcRenderer.invoke('external:searchArchive', query) as Promise<ArchiveAlbumItem[]>,
  getArchiveAlbumTracks: (identifier: string, albumTitle: string, creator: string) =>
    ipcRenderer.invoke('external:archiveTracks', identifier, albumTitle, creator) as Promise<
      DiscoverTrackItem[]
    >,
  searchWorldRadios: (query: string) =>
    ipcRenderer.invoke('external:searchRadios', query) as Promise<RadioStationItem[]>,
  resolveStreamUrl: (url: string) =>
    ipcRenderer.invoke('external:resolveStream', url) as Promise<{ url: string; title?: string }>,
  downloadDirectAudio: (url: string, customName?: string) =>
    ipcRenderer.invoke('external:downloadAudio', url, customName) as Promise<DirectDownloadResult>,

  listSavedPlaylists: () => ipcRenderer.invoke('playlists:list') as Promise<SavedPlaylist[]>,
  saveNamedPlaylist: (name: string, tracks: Track[]) =>
    ipcRenderer.invoke('playlists:save', name, tracks) as Promise<SavedPlaylist[]>,
  deleteSavedPlaylist: (id: string) =>
    ipcRenderer.invoke('playlists:delete', id) as Promise<SavedPlaylist[]>,
  exportPlaylistM3u: (tracks: Track[]) =>
    ipcRenderer.invoke('playlists:exportM3u', tracks) as Promise<boolean>,
  importPlaylistM3u: () => ipcRenderer.invoke('playlists:importM3u') as Promise<Track[]>,
};

contextBridge.exposeInMainWorld('electronAPI', api);
