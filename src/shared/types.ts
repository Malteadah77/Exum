// Única fuente de verdad para los tipos compartidos entre Main, Preload y Renderer

export type ThemeName = 'winamp-classic' | 'modern-dark' | 'minimal-blue';
export type RepeatMode = 'off' | 'all' | 'one';

export interface Track {
  id: string;
  filePath: string;
  fileUrl: string;
  fileName: string;
  title: string;
  artist: string;
  album: string;
  duration: number; // en segundos
  bitrate?: number; // en kbps (ej. 320)
  sampleRate?: number; // en Hz (ej. 44100)
  codec?: string; // ej. MP3, FLAC, WAV
}

export interface AppConfig {
  musicFolder: string | null;
  theme: ThemeName;
  volume: number; // 0 a 100
  shuffle: boolean;
  repeatMode: RepeatMode;
}

export interface ElectronAPI {
  minimizeWindow: () => void;
  closeWindow: () => void;
  openAudioFiles: () => Promise<Track[]>;
  selectMusicFolder: () => Promise<{ folderPath: string; tracks: Track[] } | null>;
  scanFolder: (folderPath: string) => Promise<Track[]>;
  readDroppedPaths: (paths: string[]) => Promise<Track[]>;
  getPathForFile: (file: File) => string;
  loadConfig: () => Promise<AppConfig>;
  saveConfig: (partial: Partial<AppConfig>) => Promise<AppConfig>;
}
