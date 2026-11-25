import type { ElectronAPI, ShortcutAction, Track, WszSkinData } from '../shared/types.js';
import { AudioEngine, formatTime } from './audioEngine.js';
import { PlaylistManager } from './playlistManager.js';
import { AudioVisualizer } from './visualizer.js';
import { DEFAULT_PALETTE, WszClassicView } from './wszRenderer.js';

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

const playerShell = document.getElementById('player-shell');
const dropOverlay = document.getElementById('drop-overlay');
const winampDecks = document.getElementById('winamp-decks');
const visCanvas = document.getElementById('wsz-vis-canvas') as HTMLCanvasElement | null;

// Mini-barra flotante
const miniTime = document.getElementById('mini-time');
const miniTitle = document.getElementById('mini-title');
const miniPrev = document.getElementById('mini-prev');
const miniPlay = document.getElementById('mini-play');
const miniNext = document.getElementById('mini-next');
const miniRestore = document.getElementById('mini-restore');

// Playlist y barra inferior
const playlistContainer = document.getElementById('playlist-container');
const playlistCount = document.getElementById('playlist-count');
const searchInput = document.getElementById('search-input') as HTMLInputElement | null;
const btnFolder = document.getElementById('btn-folder');
const btnOpen = document.getElementById('btn-open');
const btnLyrics = document.getElementById('btn-lyrics');
const btnSkins = document.getElementById('btn-skins');

let isMiniMode = false;
let searchQuery = '';

const visualizer = visCanvas ? new AudioVisualizer(visCanvas, 18) : null;

async function toggleMiniMode(): Promise<void> {
  isMiniMode = await window.electronAPI.setMiniMode(!isMiniMode);
  document.body.classList.toggle('mini-mode', isMiniMode);
  if (!isMiniMode) {
    classicView?.fitToWindowWidth();
  }
}

async function openAudioFilesAction(): Promise<void> {
  const tracks = await window.electronAPI.openAudioFiles();
  if (tracks.length === 0) return;
  playlist.addTracks(tracks, !engine.hasTrack);
}

async function selectFolderAction(): Promise<void> {
  const result = await window.electronAPI.selectMusicFolder();
  if (!result) return;
  playlist.setTracks(result.tracks, false);
}

function triggerPlayOrStartFirst(): void {
  if (!engine.hasTrack && playlist.allTracks.length > 0) {
    playlist.selectIndex(0);
    return;
  }
  engine.togglePlay();
}

function renderPlaylist(tracks: Track[], activeIndex: number): void {
  if (!playlistContainer) return;

  const query = searchQuery.trim().toLowerCase();
  const filtered = tracks
    .map((track, index) => ({ track, index }))
    .filter(({ track }) => {
      if (!query) return true;
      return (
        track.title.toLowerCase().includes(query) ||
        track.artist.toLowerCase().includes(query) ||
        track.album.toLowerCase().includes(query)
      );
    });

  if (playlistCount) {
    playlistCount.textContent =
      query && filtered.length !== tracks.length
        ? `${filtered.length}/${tracks.length}`
        : `${tracks.length} pistas`;
  }

  playlistContainer.innerHTML = '';

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'playlist-empty';
    empty.textContent =
      tracks.length === 0
        ? 'Arrastra archivos de música o skins .wsz aquí, o presiona 📁.'
        : 'Sin resultados para esa búsqueda.';
    playlistContainer.appendChild(empty);
    return;
  }

  for (const { track, index } of filtered) {
    const row = document.createElement('div');
    row.className = `playlist-row${index === activeIndex ? ' active' : ''}`;

    const title = document.createElement('span');
    title.className = 'playlist-row-title';
    title.textContent =
      track.artist && track.artist !== 'Artista desconocido'
        ? `${index + 1}. ${track.artist} - ${track.title}`
        : `${index + 1}. ${track.title}`;

    const dur = document.createElement('span');
    dur.className = 'playlist-row-dur';
    dur.textContent = formatTime(track.duration);

    row.append(title, dur);
    row.addEventListener('dblclick', () => playlist.selectIndex(index));
    playlistContainer.appendChild(row);
  }
}

function applySkinOrDefault(skin: WszSkinData | null): void {
  if (skin) {
    classicView?.applySkin(skin);
    visualizer?.setCustomPalette(skin.visColors);
    window.electronAPI.broadcastPalette(skin.pledit);
  } else {
    classicView?.clearSkin();
    visualizer?.setCustomPalette(null);
    window.electronAPI.broadcastPalette(DEFAULT_PALETTE);
  }
}

// 1. Motor de Audio (Web Audio API: 10-band EQ + Analyser)
const engine = new AudioEngine({
  onAudioGraphReady: (analyser) => visualizer?.attachAnalyser(analyser),

  onTrackLoaded: (_title, duration) => {
    classicView?.updateTime(0, duration);
  },

  onTimeUpdate: (current, duration) => {
    classicView?.updateTime(current, duration);
    if (miniTime) miniTime.textContent = formatTime(current);
    window.electronAPI.broadcastTime(current);
  },

  onStateChange: (state) => {
    if (miniPlay) miniPlay.textContent = state === 'playing' ? '⏸' : '▶';
  },

  onEnded: () => playlist.handleTrackEnded(),
});

// 2. Gestor de Playlist
const playlist = new PlaylistManager({
  onChange: (tracks, activeIndex) => renderPlaylist(tracks, activeIndex),

  onTrackSelect: (track) => {
    classicView?.updateTrackInfo(track.title, track.artist);
    if (miniTitle) miniTitle.textContent = `${track.title} — ${track.artist}`;
    engine.load(track.fileUrl, track.title);
    void engine.play();
    window.electronAPI.broadcastTrack(track);
  },

  onModeChange: (shuffle, repeatMode) => classicView?.updateModes(shuffle, repeatMode),
});

// 3. Vista Winamp Unificada (escalable sin bordes negros)
const classicView = winampDecks
  ? new WszClassicView(winampDecks, {
      onPrev: () => playlist.previous(),
      onPlay: () => {
        if (!engine.hasTrack && playlist.allTracks.length > 0) playlist.selectIndex(0);
        else void engine.play();
      },
      onPause: () => engine.pause(),
      onStop: () => engine.stop(),
      onNext: () => playlist.next(),
      onEject: () => void openAudioFilesAction(),
      onToggleShuffle: () => {
        const shuffle = playlist.toggleShuffle();
        void window.electronAPI.saveConfig({ shuffle });
      },
      onCycleRepeat: () => {
        const repeatMode = playlist.cycleRepeat();
        void window.electronAPI.saveConfig({ repeatMode });
      },
      onSeek: (sec) => engine.seek(sec),
      onVolume: (pct) => {
        engine.setVolume(pct / 100);
        void window.electronAPI.saveConfig({ volume: pct });
      },
      onBalance: (pan) => {
        engine.setBalance(pan);
      },
      onPreampChange: (db) => {
        engine.setPreampGain(db);
      },
      onEqBandChange: (idx, db, commit) => {
        engine.setBandGain(idx, db);
        if (commit) {
          void window.electronAPI.saveConfig({ eqPreset: 'custom', eqGains: engine.getEqGains() });
        }
      },
      onEqToggle: () => {
        const nextEnabled = !engine.isEqEnabled;
        engine.setEqEnabled(nextEnabled);
        classicView?.updateEq(nextEnabled, engine.getEqGains());
        void window.electronAPI.saveConfig({ eqEnabled: nextEnabled });
      },
      onEqReset: () => {
        const flat = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        engine.setAllBandGains(flat);
        classicView?.updateEq(engine.isEqEnabled, flat);
        void window.electronAPI.saveConfig({ eqPreset: 'flat', eqGains: flat });
      },
      onEqPresetSelect: (presetId, gains) => {
        engine.setAllBandGains(gains);
        classicView?.updateEq(engine.isEqEnabled, gains);
        void window.electronAPI.saveConfig({ eqPreset: presetId, eqGains: gains });
      },
      onPanelsVisibilityChange: (eqVisible, plVisible) => {
        void window.electronAPI.setWindowPanels(eqVisible, plVisible);
      },
      onMinimize: () => window.electronAPI.minimizeWindow(),
      onClose: () => window.electronAPI.closeWindow(),
      onMiniMode: () => void toggleMiniMode(),
    })
  : null;

// Escalado proporcional fluido al redimensionar la ventana
window.addEventListener('resize', () => {
  if (!isMiniMode) {
    classicView?.fitToWindowWidth();
  }
});

// Visualizador (clic para alternar Barras / Onda / Off)
visCanvas?.addEventListener('click', () => {
  if (!visualizer) return;
  const nextMode = visualizer.cycleMode();
  void window.electronAPI.saveConfig({ visualizerMode: nextMode });
});

// Mini-barra
miniPrev?.addEventListener('click', () => playlist.previous());
miniPlay?.addEventListener('click', () => triggerPlayOrStartFirst());
miniNext?.addEventListener('click', () => playlist.next());
miniRestore?.addEventListener('click', () => void toggleMiniMode());

// Barra inferior de Playlist (Carpeta, Archivos, Buscador, Letras flotante, Skins flotante)
btnFolder?.addEventListener('click', () => void selectFolderAction());
btnOpen?.addEventListener('click', () => void openAudioFilesAction());
btnLyrics?.addEventListener('click', () => void window.electronAPI.openFloatingWindow('lyrics'));
btnSkins?.addEventListener('click', () => void window.electronAPI.openFloatingWindow('skins'));

searchInput?.addEventListener('input', () => {
  searchQuery = searchInput.value;
  renderPlaylist(playlist.allTracks, playlist.activeIndex);
});

// Drag & Drop de música y archivos .wsz
let dragDepth = 0;

playerShell?.addEventListener('dragenter', (event) => {
  event.preventDefault();
  dragDepth++;
  dropOverlay?.classList.add('visible');
});

playerShell?.addEventListener('dragover', (event) => event.preventDefault());

playerShell?.addEventListener('dragleave', () => {
  dragDepth--;
  if (dragDepth <= 0) {
    dragDepth = 0;
    dropOverlay?.classList.remove('visible');
  }
});

playerShell?.addEventListener('drop', async (event) => {
  event.preventDefault();
  dragDepth = 0;
  dropOverlay?.classList.remove('visible');

  const files = Array.from(event.dataTransfer?.files ?? []);
  if (files.length === 0) return;

  const paths = files
    .map((file) => window.electronAPI.getPathForFile(file))
    .filter((p) => Boolean(p));

  const wszPath = paths.find((p) => p.toLowerCase().endsWith('.wsz'));
  if (wszPath) {
    await window.electronAPI.importWszPath(wszPath);
  }

  const audioPaths = paths.filter((p) => !p.toLowerCase().endsWith('.wsz'));
  if (audioPaths.length > 0) {
    const tracks = await window.electronAPI.readDroppedPaths(audioPaths);
    playlist.addTracks(tracks, !engine.hasTrack);
  }
});

// Atajos locales
window.addEventListener('keydown', (event) => {
  const tag = (document.activeElement as HTMLElement | null)?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (!engine.hasTrack) return;

  if (event.code === 'Space') {
    event.preventDefault();
    engine.togglePlay();
  } else if (event.code === 'ArrowRight') {
    event.preventDefault();
    engine.seek(engine.currentTime + 5);
  } else if (event.code === 'ArrowLeft') {
    event.preventDefault();
    engine.seek(engine.currentTime - 5);
  }
});

// Eventos desde ventanas flotantes y atajos globales
window.electronAPI.onShortcutAction((action: ShortcutAction) => {
  if (action === 'play-pause') triggerPlayOrStartFirst();
  else if (action === 'next') playlist.next();
  else if (action === 'previous') playlist.previous();
  else if (action === 'stop') engine.stop();
});

window.electronAPI.onSeekRequested((seconds: number) => {
  engine.seek(seconds);
});

window.electronAPI.onSkinApplied((skin: WszSkinData | null) => {
  applySkinOrDefault(skin);
});

// Arranque inicial
async function bootstrap(): Promise<void> {
  const config = await window.electronAPI.loadConfig();
  engine.setVolume(config.volume / 100);
  classicView?.updateVolumeSprite(config.volume);
  playlist.setModes(config.shuffle, config.repeatMode);

  engine.setEqEnabled(config.eqEnabled);
  engine.setAllBandGains(config.eqGains);
  classicView?.updateEq(config.eqEnabled, config.eqGains);
  visualizer?.setMode(config.visualizerMode);

  if (config.activeWszSkinId) {
    const skin = await window.electronAPI.loadWszSkin(config.activeWszSkinId);
    applySkinOrDefault(skin);
  } else {
    applySkinOrDefault(null);
  }

  if (config.musicFolder) {
    const tracks = await window.electronAPI.scanFolder(config.musicFolder);
    playlist.setTracks(tracks, false);
  }
}

void bootstrap();
