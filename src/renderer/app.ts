import type { ElectronAPI, RepeatMode, ThemeName, Track } from '../shared/types.js';
import { AudioEngine, PlaybackState, formatTime } from './audioEngine.js';
import { PlaylistManager } from './playlistManager.js';

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

// Referencias a elementos del DOM
const playerShell = document.getElementById('player-shell');
const dropOverlay = document.getElementById('drop-overlay');

const btnMinimize = document.getElementById('btn-minimize');
const btnClose = document.getElementById('btn-close');
const btnTheme = document.getElementById('btn-theme');

const btnFolder = document.getElementById('btn-folder');
const btnOpen = document.getElementById('btn-open');
const btnPrev = document.getElementById('btn-prev') as HTMLButtonElement | null;
const btnPlay = document.getElementById('btn-play') as HTMLButtonElement | null;
const btnPause = document.getElementById('btn-pause') as HTMLButtonElement | null;
const btnStop = document.getElementById('btn-stop') as HTMLButtonElement | null;
const btnNext = document.getElementById('btn-next') as HTMLButtonElement | null;
const btnShuffle = document.getElementById('btn-shuffle') as HTMLButtonElement | null;
const btnRepeat = document.getElementById('btn-repeat') as HTMLButtonElement | null;
const btnMute = document.getElementById('btn-mute');

const lcdTime = document.getElementById('lcd-time');
const trackTitle = document.getElementById('track-title');
const trackArtist = document.getElementById('track-artist');
const statusText = document.getElementById('status-text');

const seekBar = document.getElementById('seek-bar') as HTMLInputElement | null;
const timeCurrent = document.getElementById('time-current');
const timeTotal = document.getElementById('time-total');

const volumeBar = document.getElementById('volume-bar') as HTMLInputElement | null;
const volumeValue = document.getElementById('volume-value');

const searchInput = document.getElementById('search-input') as HTMLInputElement | null;
const playlistCount = document.getElementById('playlist-count');
const playlistContainer = document.getElementById('playlist-container');

const themes: ThemeName[] = ['winamp-classic', 'modern-dark', 'minimal-blue'];
let currentThemeIndex = 0;
let isSeeking = false;
let searchQuery = '';

const statusLabels: Record<PlaybackState, string> = {
  idle: 'LISTO',
  playing: 'REPRODUCIENDO',
  paused: 'EN PAUSA',
  stopped: 'DETENIDO',
};

function formatAudioTechInfo(track: Track | null): string {
  if (!track) return '';
  const parts: string[] = [];
  if (track.codec) parts.push(track.codec.toUpperCase());
  if (track.bitrate) parts.push(`${track.bitrate} kbps`);
  if (track.sampleRate) parts.push(`${(track.sampleRate / 1000).toFixed(1)} kHz`);
  return parts.join(' • ');
}

function applyTheme(theme: ThemeName): void {
  const idx = themes.indexOf(theme);
  currentThemeIndex = idx >= 0 ? idx : 0;
  document.documentElement.setAttribute('data-theme', themes[currentThemeIndex]);
}

function updateVolumeUI(percent: number): void {
  engine.setVolume(percent / 100);
  if (volumeBar) volumeBar.value = String(percent);
  if (volumeValue) volumeValue.textContent = `${percent}%`;
  if (btnMute) btnMute.textContent = percent === 0 ? '🔇' : '🔊';
}

function updateTransportAvailability(hasTracks: boolean): void {
  if (btnPrev) btnPrev.disabled = !hasTracks;
  if (btnNext) btnNext.disabled = !hasTracks;
  if (btnPlay) btnPlay.disabled = !hasTracks;
  if (btnPause) btnPause.disabled = !hasTracks;
  if (btnStop) btnStop.disabled = !hasTracks;
}

function renderPlaylist(tracks: Track[], activeIndex: number): void {
  if (!playlistContainer) return;

  const query = searchQuery.trim().toLowerCase();
  const indexedTracks = tracks
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
      query && indexedTracks.length !== tracks.length
        ? `${indexedTracks.length} / ${tracks.length} pistas`
        : `${tracks.length} pistas`;
  }

  updateTransportAvailability(tracks.length > 0);
  playlistContainer.innerHTML = '';

  if (indexedTracks.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'playlist-empty';
    empty.textContent =
      tracks.length === 0
        ? 'Arrastra archivos o carpetas de música aquí, o presiona 📁 CARPETA.'
        : 'No se encontraron canciones con esa búsqueda.';
    playlistContainer.appendChild(empty);
    return;
  }

  for (const { track, index } of indexedTracks) {
    const row = document.createElement('div');
    row.className = `playlist-item${index === activeIndex ? ' active' : ''}`;

    const main = document.createElement('div');
    main.className = 'playlist-item-main';

    const idxSpan = document.createElement('span');
    idxSpan.className = 'playlist-index';
    idxSpan.textContent = String(index + 1).padStart(2, '0');

    const meta = document.createElement('div');
    meta.className = 'playlist-meta';

    const titleEl = document.createElement('span');
    titleEl.className = 'playlist-title';
    titleEl.textContent = track.title;

    const artistEl = document.createElement('span');
    artistEl.className = 'playlist-artist';
    artistEl.textContent = track.artist;

    meta.append(titleEl, artistEl);
    main.append(idxSpan, meta);

    const durSpan = document.createElement('span');
    durSpan.className = 'playlist-duration';
    durSpan.textContent = formatTime(track.duration);

    row.append(main, durSpan);
    row.addEventListener('dblclick', () => {
      playlist.selectIndex(index);
    });

    playlistContainer.appendChild(row);
  }
}

function updateModeButtons(shuffle: boolean, repeatMode: RepeatMode): void {
  btnShuffle?.classList.toggle('ctrl-btn-active', shuffle);
  btnRepeat?.classList.toggle('ctrl-btn-active', repeatMode !== 'off');

  if (btnRepeat) {
    btnRepeat.textContent = repeatMode === 'one' ? '🔂' : '🔁';
    const labels: Record<RepeatMode, string> = {
      off: 'Repetir: desactivado',
      all: 'Repetir: toda la lista',
      one: 'Repetir: canción actual',
    };
    btnRepeat.title = labels[repeatMode];
  }
}

// 1. Motor de audio
const engine = new AudioEngine({
  onTrackLoaded: (_title, duration) => {
    if (timeTotal) timeTotal.textContent = formatTime(duration);
    if (seekBar) {
      seekBar.max = String(duration || 0);
      seekBar.value = '0';
      seekBar.disabled = false;
    }
  },

  onTimeUpdate: (current, duration) => {
    if (isSeeking) return;
    const formatted = formatTime(current);
    if (lcdTime) lcdTime.textContent = formatted;
    if (timeCurrent) timeCurrent.textContent = formatted;
    if (seekBar && Number.isFinite(duration)) {
      seekBar.value = String(current);
    }
  },

  onStateChange: (state) => {
    const tech = formatAudioTechInfo(playlist.currentTrack);
    if (statusText) {
      statusText.textContent = tech ? `${statusLabels[state]} • ${tech}` : statusLabels[state];
    }
    btnPlay?.classList.toggle('ctrl-btn-active', state === 'playing');
    btnPause?.classList.toggle('ctrl-btn-active', state === 'paused');
  },

  onEnded: () => {
    playlist.handleTrackEnded();
  },

  onError: (message) => {
    if (statusText) statusText.textContent = message.toUpperCase();
  },
});

// 2. Gestor de playlist
const playlist = new PlaylistManager({
  onChange: (tracks, activeIndex) => {
    renderPlaylist(tracks, activeIndex);
  },

  onTrackSelect: (track) => {
    if (trackTitle) trackTitle.textContent = track.title;
    if (trackArtist) {
      trackArtist.textContent = track.album ? `${track.artist} — ${track.album}` : track.artist;
    }
    engine.load(track.fileUrl, track.title);
    void engine.play();
  },

  onModeChange: (shuffle, repeatMode) => {
    updateModeButtons(shuffle, repeatMode);
  },
});

// Controles de ventana y skin (guardando preferencia en config.json)
btnMinimize?.addEventListener('click', () => window.electronAPI.minimizeWindow());
btnClose?.addEventListener('click', () => window.electronAPI.closeWindow());

btnTheme?.addEventListener('click', () => {
  const nextTheme = themes[(currentThemeIndex + 1) % themes.length];
  applyTheme(nextTheme);
  void window.electronAPI.saveConfig({ theme: nextTheme });
  if (statusText) {
    statusText.textContent = `SKIN ACTIVA: ${nextTheme.toUpperCase()}`;
  }
});

// Elegir carpeta dedicada de biblioteca local
btnFolder?.addEventListener('click', async () => {
  if (statusText) statusText.textContent = 'ESCANEANDO CARPETA...';
  const result = await window.electronAPI.selectMusicFolder();
  if (!result) {
    if (statusText) statusText.textContent = 'LISTO';
    return;
  }

  playlist.setTracks(result.tracks, false);
  if (statusText) {
    statusText.textContent = `BIBLIOTECA CARGADA (${result.tracks.length} PISTAS)`;
  }
});

// Agregar archivos sueltos
btnOpen?.addEventListener('click', async () => {
  const tracks = await window.electronAPI.openAudioFiles();
  if (tracks.length === 0) return;
  playlist.addTracks(tracks, !engine.hasTrack);
});

// Botones de reproducción y navegación
btnPlay?.addEventListener('click', () => {
  if (!engine.hasTrack && playlist.allTracks.length > 0) {
    playlist.selectIndex(0);
    return;
  }
  void engine.play();
});
btnPause?.addEventListener('click', () => engine.pause());
btnStop?.addEventListener('click', () => engine.stop());
btnPrev?.addEventListener('click', () => playlist.previous());
btnNext?.addEventListener('click', () => playlist.next());

btnShuffle?.addEventListener('click', () => {
  const shuffle = playlist.toggleShuffle();
  void window.electronAPI.saveConfig({ shuffle });
});

btnRepeat?.addEventListener('click', () => {
  const repeatMode = playlist.cycleRepeat();
  void window.electronAPI.saveConfig({ repeatMode });
});

// Barra de progreso
seekBar?.addEventListener('input', () => {
  isSeeking = true;
  const preview = formatTime(Number(seekBar.value));
  if (lcdTime) lcdTime.textContent = preview;
  if (timeCurrent) timeCurrent.textContent = preview;
});

seekBar?.addEventListener('change', () => {
  engine.seek(Number(seekBar.value));
  isSeeking = false;
});

// Volumen y silencio (guardando volumen al soltar)
volumeBar?.addEventListener('input', () => {
  updateVolumeUI(Number(volumeBar.value));
});

volumeBar?.addEventListener('change', () => {
  void window.electronAPI.saveConfig({ volume: Number(volumeBar.value) });
});

btnMute?.addEventListener('click', () => {
  const muted = engine.toggleMute();
  if (btnMute) btnMute.textContent = muted ? '🔇' : '🔊';
});

// Buscador de playlist
searchInput?.addEventListener('input', () => {
  searchQuery = searchInput.value;
  renderPlaylist(playlist.allTracks, playlist.activeIndex);
});

// Drag & Drop de archivos o carpetas sobre la ventana
let dragDepth = 0;

playerShell?.addEventListener('dragenter', (event) => {
  event.preventDefault();
  dragDepth++;
  dropOverlay?.classList.add('visible');
});

playerShell?.addEventListener('dragover', (event) => {
  event.preventDefault();
});

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

  if (paths.length === 0) return;

  if (statusText) statusText.textContent = 'LEYENDO ARCHIVOS ARRASTRADOS...';
  const tracks = await window.electronAPI.readDroppedPaths(paths);
  playlist.addTracks(tracks, !engine.hasTrack);
  if (statusText) {
    statusText.textContent = `AGREGADAS ${tracks.length} PISTAS`;
  }
});

// Atajos de teclado (ignorados cuando escribes en el buscador)
window.addEventListener('keydown', (event) => {
  if (document.activeElement === searchInput) return;
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

// Inicialización al arrancar Exum: restaura tu config.json y tu carpeta de música
async function bootstrap(): Promise<void> {
  const config = await window.electronAPI.loadConfig();
  applyTheme(config.theme);
  updateVolumeUI(config.volume);
  playlist.setModes(config.shuffle, config.repeatMode);

  if (config.musicFolder) {
    if (statusText) statusText.textContent = 'CARGANDO TU BIBLIOTECA...';
    const tracks = await window.electronAPI.scanFolder(config.musicFolder);
    playlist.setTracks(tracks, false);
    if (statusText) {
      statusText.textContent = `BIBLIOTECA LISTA (${tracks.length} PISTAS)`;
    }
  }
}

void bootstrap();
