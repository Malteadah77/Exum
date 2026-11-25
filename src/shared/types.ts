// Única fuente de verdad para los tipos compartidos entre Main, Preload y Renderer

export type ThemeName = 'winamp-classic' | 'modern-dark' | 'minimal-blue' | 'custom';
export type RepeatMode = 'off' | 'all' | 'one';
export type VisualizerMode = 'bars' | 'wave' | 'off';
export type ShortcutAction = 'play-pause' | 'next' | 'previous' | 'stop';

export interface CustomSkinConfig {
  bgShell: string;
  bgTitlebar: string;
  bgLcd: string;
  textMain: string;
  accent: string;
  fontLcd: string;
}

export interface LyricLine {
  time: number; // en segundos
  text: string;
}

export interface LyricsResult {
  found: boolean;
  synced: boolean;
  lines: LyricLine[];
  plainText: string;
}

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
  customSkin: CustomSkinConfig;
  volume: number; // 0 a 100
  shuffle: boolean;
  repeatMode: RepeatMode;
  eqEnabled: boolean;
  eqPreset: string;
  eqGains: number[]; // 10 bandas en dB (-12 a +12)
  visualizerMode: VisualizerMode;
}

export interface ElectronAPI {
  minimizeWindow: () => void;
  closeWindow: () => void;
  setMiniMode: (enabled: boolean) => Promise<boolean>;
  openAudioFiles: () => Promise<Track[]>;
  selectMusicFolder: () => Promise<{ folderPath: string; tracks: Track[] } | null>;
  scanFolder: (folderPath: string) => Promise<Track[]>;
  readDroppedPaths: (paths: string[]) => Promise<Track[]>;
  getPathForFile: (file: File) => string;
  loadConfig: () => Promise<AppConfig>;
  saveConfig: (partial: Partial<AppConfig>) => Promise<AppConfig>;
  fetchLyrics: (track: Pick<Track, 'title' | 'artist' | 'album' | 'duration'>) => Promise<LyricsResult>;
  onShortcutAction: (callback: (action: ShortcutAction) => void) => void;
}
