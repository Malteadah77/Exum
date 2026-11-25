import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { AppConfig, ElectronAPI, LyricsResult, ShortcutAction, Track } from './shared/types';

// Puente seguro: solo exponemos las acciones específicas que la UI necesita
const api: ElectronAPI = {
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  setMiniMode: (enabled: boolean) =>
    ipcRenderer.invoke('window:setMiniMode', enabled) as Promise<boolean>,
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
  onShortcutAction: (callback: (action: ShortcutAction) => void) => {
    ipcRenderer.removeAllListeners('shortcut:action');
    ipcRenderer.on('shortcut:action', (_event, action: ShortcutAction) => callback(action));
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
