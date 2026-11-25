import { contextBridge, ipcRenderer } from 'electron';

export interface OpenedAudioFile {
  filePath: string;
  fileUrl: string;
  fileName: string;
}

// Puente seguro: solo exponemos las acciones específicas que la UI necesita
contextBridge.exposeInMainWorld('electronAPI', {
  minimizeWindow: (): void => ipcRenderer.send('window:minimize'),
  closeWindow: (): void => ipcRenderer.send('window:close'),
  openAudioFile: (): Promise<OpenedAudioFile | null> =>
    ipcRenderer.invoke('dialog:openAudio'),
});
