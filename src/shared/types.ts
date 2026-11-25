// Única fuente de verdad para los tipos compartidos entre Main, Preload y ventanas Renderer

export type RepeatMode = 'off' | 'all' | 'one';
export type VisualizerMode = 'bars' | 'wave' | 'off';
export type ShortcutAction = 'play-pause' | 'next' | 'previous' | 'stop';
export type FloatingWindowType = 'lyrics' | 'skins' | 'sources';
export type TrackSourceType = 'local' | 'stream' | 'spotify';
export type PanelState = 'open' | 'shaded' | 'closed';

export interface WszSkinMeta {
  id: string;
  name: string;
  filePath: string;
}

export interface WszPleditColors {
  normal: string;
  current: string;
  normalBg: string;
  selectedBg: string;
  font: string;
}

export interface WszSkinSprites {
  main?: string;
  titlebar?: string;
  cbuttons?: string;
  posbar?: string;
  volume?: string;
  balance?: string;
  shufrep?: string;
  numbers?: string;
  playpaus?: string;
  monoster?: string;
  eqmain?: string;
  eqEx?: string;
  pledit?: string;
}

export interface WszSkinData {
  meta: WszSkinMeta;
  sprites: WszSkinSprites;
  pledit: WszPleditColors;
  visColors: string[];
}

export interface MuseumSkinItem {
  md5: string;
  filename: string;
  downloadUrl: string;
  screenshotUrl: string;
}

export interface SavedStream {
  id: string;
  name: string;
  url: string;
  genre: string;
}

export interface SavedPlaylist {
  id: string;
  name: string;
  tracks: Track[];
  updatedAt: number;
}

export interface SpotifyAuthState {
  connected: boolean;
  displayName?: string;
  product?: string;
  error?: string;
}

export interface SpotifyPlaylistItem {
  id: string;
  name: string;
  trackCount: number;
  externalUrl: string;
}

export interface SpotifyTrackItem {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  previewUrl: string | null;
  externalUrl: string;
}

export interface LyricLine {
  time: number;
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
  duration: number;
  bitrate?: number;
  sampleRate?: number;
  channels?: number;
  codec?: string;
  sourceType?: TrackSourceType;
  isLive?: boolean;
  externalUrl?: string;
}

export interface AppConfig {
  musicFolder: string | null;
  activeWszSkinId: string | null;
  volume: number;
  shuffle: boolean;
  repeatMode: RepeatMode;
  eqEnabled: boolean;
  eqPreset: string;
  eqGains: number[];
  visualizerMode: VisualizerMode;
  savedStreams: SavedStream[];
  spotifyClientId: string | null;
}

export interface ElectronAPI {
  // Control de ventana actual (principal o flotante)
  minimizeWindow: () => void;
  closeWindow: () => void;
  toggleAlwaysOnTop: () => Promise<boolean>;
  toggleDoubleSize: () => Promise<boolean>;
  setMiniMode: (enabled: boolean) => Promise<boolean>;
  setWindowPanels: (eqState: PanelState, plState: PanelState) => Promise<void>;
  openFloatingWindow: (type: FloatingWindowType) => Promise<void>;
  openExternalUrl: (url: string) => Promise<void>;

  // Biblioteca local y archivos
  openAudioFiles: () => Promise<Track[]>;
  selectMusicFolder: () => Promise<{ folderPath: string; tracks: Track[] } | null>;
  scanFolder: (folderPath: string) => Promise<Track[]>;
  readDroppedPaths: (paths: string[]) => Promise<Track[]>;
  getPathForFile: (file: File) => string;

  // Persistencia
  loadConfig: () => Promise<AppConfig>;
  saveConfig: (partial: Partial<AppConfig>) => Promise<AppConfig>;

  // Letras y sincronización entre ventanas
  fetchLyrics: (track: Pick<Track, 'title' | 'artist' | 'album' | 'duration'>) => Promise<LyricsResult>;
  broadcastTrack: (track: Track | null) => void;
  broadcastTime: (currentTime: number) => void;
  broadcastPalette: (palette: WszPleditColors) => void;
  requestSeekFromLyrics: (seconds: number) => void;
  sendExternalTrack: (track: Track, autoPlay: boolean) => void;
  getSyncState: () => Promise<{ track: Track | null; palette: WszPleditColors; activeSkinId: string | null }>;

  // Eventos recibidos desde Main
  onShortcutAction: (callback: (action: ShortcutAction) => void) => void;
  onTrackChanged: (callback: (track: Track | null) => void) => void;
  onTimeUpdated: (callback: (currentTime: number) => void) => void;
  onPaletteUpdated: (callback: (palette: WszPleditColors) => void) => void;
  onSeekRequested: (callback: (seconds: number) => void) => void;
  onSkinApplied: (callback: (skin: WszSkinData | null) => void) => void;
  onExternalTrackReceived: (callback: (track: Track, autoPlay: boolean) => void) => void;

  // Motor de Skins .wsz + Webamp Skin Museum
  listWszSkins: () => Promise<WszSkinMeta[]>;
  importWszDialog: () => Promise<WszSkinData | null>;
  importWszPath: (filePath: string) => Promise<WszSkinData | null>;
  loadWszSkin: (skinId: string) => Promise<WszSkinData | null>;
  deleteWszSkin: (skinId: string) => Promise<boolean>;
  selectWszSkin: (skinId: string | null) => Promise<WszSkinData | null>;
  searchMuseumSkins: (query: string) => Promise<MuseumSkinItem[]>;
  downloadMuseumSkin: (downloadUrl: string, filename: string) => Promise<WszSkinData | null>;

  // Spotify Oficial (OAuth 2.0 PKCE)
  spotifyGetState: () => Promise<SpotifyAuthState>;
  spotifyConnect: (clientId: string) => Promise<SpotifyAuthState>;
  spotifyDisconnect: () => Promise<SpotifyAuthState>;
  spotifyListPlaylists: () => Promise<SpotifyPlaylistItem[]>;
  spotifyGetPlaylistTracks: (playlistId: string) => Promise<SpotifyTrackItem[]>;

  // Gestión de Playlists guardadas + .m3u
  listSavedPlaylists: () => Promise<SavedPlaylist[]>;
  saveNamedPlaylist: (name: string, tracks: Track[]) => Promise<SavedPlaylist[]>;
  deleteSavedPlaylist: (id: string) => Promise<SavedPlaylist[]>;
  exportPlaylistM3u: (tracks: Track[]) => Promise<boolean>;
  importPlaylistM3u: () => Promise<Track[]>;
}
