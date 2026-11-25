import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { AppConfig, ElectronAPI, Track } from './shared/types';

// Puente seguro: solo exponemos las acciones específicas que la UI necesita
const api: ElectronAPI = {
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  openAudioFiles: () => ipcRenderer.invoke('dialog:openAudio') as Promise<Track[]>,
  selectMusicFolder: () =>
    ipcRenderer.invoke('dialog:selectFolder') as Promise<{ folderPath: string; tracks: Track[] } | null>,
  scanFolder: (folderPath: string) =>
    ipcRenderer.invoke('library:scanFolder', folderPath) as Promise<Track[]>,
  readDroppedPaths: (paths: string[]) =>
    ipcRenderer.invoke('library:readPaths', paths) as Promise<Track[]>,
  // En Electron moderno, File.path ya no existe en el Renderer; se usa webUtils.getPathForFile
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  loadConfig: () => ipcRenderer.invoke('config:load') as Promise<AppConfig>,
  saveConfig: (partial: Partial<AppConfig>) =>
    ipcRenderer.invoke('config:save', partial) as Promise<AppConfig>,
};

contextBridge.exposeInMainWorld('electronAPI', api);
