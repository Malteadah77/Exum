import type {
  CustomSkinConfig,
  ElectronAPI,
  RepeatMode,
  ShortcutAction,
  Track,
} from '../shared/types.js';
import { AudioEngine, PlaybackState, formatTime } from './audioEngine.js';
import { EQ_BANDS, EQ_PRESETS } from './equalizerPresets.js';
import { LyricsController } from './lyricsController.js';
import { PlaylistManager } from './playlistManager.js';
import { ThemeManager } from './themeManager.js';
import { AudioVisualizer } from './visualizer.js';

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

// Referencias a elementos del DOM
const playerShell = document.getElementById('player-shell');
const dropOverlay = document.getElementById('drop-overlay');

const btnEqPanel = document.getElementById('btn-eq-panel');
const btnLyricsPanel = document.getElementById('btn-lyrics-panel');
const btnSkinEditor = document.getElementById('btn-skin-editor');
const btnTheme = document.getElementById('btn-theme');
const btnMiniMode = document.getElementById('btn-mini-mode');
const btnMinimize = document.getElementById('btn-minimize');
const btnClose = document.getElementById('btn-close');

// Mini-barra flotante
const miniTime = document.getElementById('mini-time');
const miniTitle = document.getElementById('mini-title');
const miniPrev = document.getElementById('mini-prev');
const miniPlay = document.getElementById('mini-play');
const miniNext = document.getElementById('mini-next');

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
const visualizerCanvas = document.getElementById('visualizer-canvas') as HTMLCanvasElement | null;

const seekBar = document.getElementById('seek-bar') as HTMLInputElement | null;
const timeCurrent = document.getElementById('time-current');
const timeTotal = document.getElementById('time-total');

const volumeBar = document.getElementById('volume-bar') as HTMLInputElement | null;
const volumeValue = document.getElementById('volume-value');

// Ecualizador
const eqPanel = document.getElementById('eq-panel');
const btnEqToggle = document.getElementById('btn-eq-toggle');
const eqPresetSelect = document.getElementById('eq-preset-select') as HTMLSelectElement | null;
const btnEqReset = document.getElementById('btn-eq-reset');
const eqBandsContainer = document.getElementById('eq-bands-container');

// Editor de Skin personalizada
const skinEditorPanel = document.getElementById('skin-editor-panel');
const skinFontSelect = document.getElementById('skin-font-select') as HTMLSelectElement | null;
const colorBgShell = document.getElementById('color-bg-shell') as HTMLInputElement | null;
const colorBgTitlebar = document.getElementById('color-bg-titlebar') as HTMLInputElement | null;
const colorBgLcd = document.getElementById('color-bg-lcd') as HTMLInputElement | null;
const colorTextMain = document.getElementById('color-text-main') as HTMLInputElement | null;
const colorAccent = document.getElementById('color-accent') as HTMLInputElement | null;

// Letras
const lyricsPanel = document.getElementById('lyrics-panel');
const lyricsContent = document.getElementById('lyrics-content');

// Playlist
const searchInput = document.getElementById('search-input') as HTMLInputElement | null;
const playlistCount = document.getElementById('playlist-count');
const playlistContainer = document.getElementById('playlist-container');

let isSeeking = false;
let isMiniMode = false;
let searchQuery = '';

const eqSliders: HTMLInputElement[] = [];
const eqDbLabels: HTMLSpanElement[] = [];

const statusLabels: Record<PlaybackState, string> = {
  idle: 'LISTO',
  playing: 'REPRODUCIENDO',
  paused: 'EN PAUSA',
  stopped: 'DETENIDO',
};

const themeManager = new ThemeManager();
const visualizer = visualizerCanvas ? new AudioVisualizer(visualizerCanvas) : null;

function formatAudioTechInfo(track: Track | null): string {
  if (!track) return '';
  const parts: string[] = [];
  if (track.codec) parts.push(track.codec.toUpperCase());
  if (track.bitrate) parts.push(`${track.bitrate} kbps`);
  if (track.sampleRate) parts.push(`${(track.sampleRate / 1000).toFixed(1)} kHz`);
  return parts.join(' • ');
}

function formatDb(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function syncSkinEditorInputs(skin: CustomSkinConfig): void {
  if (colorBgShell) colorBgShell.value = skin.bgShell;
  if (colorBgTitlebar) colorBgTitlebar.value = skin.bgTitlebar;
  if (colorBgLcd) colorBgLcd.value = skin.bgLcd;
  if (colorTextMain) colorTextMain.value = skin.textMain;
  if (colorAccent) colorAccent.value = skin.accent;
  if (skinFontSelect) skinFontSelect.value = skin.fontLcd;
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

function syncEqUI(enabled: boolean, preset: string, gains: number[]): void {
  if (btnEqToggle) {
    btnEqToggle.textContent = enabled ? 'EQ: ON' : 'EQ: OFF';
    btnEqToggle.classList.toggle('eq-toggle-active', enabled);
  }
  eqPanel?.classList.toggle('eq-disabled', !enabled);
  if (eqPresetSelect) eqPresetSelect.value = preset;

  gains.forEach((db, idx) => {
    if (eqSliders[idx]) eqSliders[idx].value = String(db);
    if (eqDbLabels[idx]) eqDbLabels[idx].textContent = formatDb(db);
  });
}

function buildEqBandsUI(): void {
  if (!eqBandsContainer) return;
  eqBandsContainer.innerHTML = '';

  EQ_BANDS.forEach((band, index) => {
    const col = document.createElement('div');
    col.className = 'eq-band';

    const dbLabel = document.createElement('span');
    dbLabel.className = 'eq-db';
    dbLabel.textContent = '0';

    const sliderWrap = document.createElement('div');
    sliderWrap.className = 'eq-slider-wrap';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'eq-slider';
    slider.min = '-12';
    slider.max = '12';
    slider.step = '1';
    slider.value = '0';
    slider.title = `${band.label} Hz`;

    slider.addEventListener('input', () => {
      const db = Number(slider.value);
      dbLabel.textContent = formatDb(db);
      engine.setBandGain(index, db);
      if (eqPresetSelect) eqPresetSelect.value = 'custom';
    });

    slider.addEventListener('change', () => {
      void window.electronAPI.saveConfig({
        eqPreset: 'custom',
        eqGains: engine.getEqGains(),
      });
    });

    const freqLabel = document.createElement('span');
    freqLabel.className = 'eq-freq';
    freqLabel.textContent = band.label;

    sliderWrap.appendChild(slider);
    col.append(dbLabel, sliderWrap, freqLabel);
    eqBandsContainer.appendChild(col);

    eqSliders.push(slider);
    eqDbLabels.push(dbLabel);
  });
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
  onAudioGraphReady: (analyser) => {
    visualizer?.attachAnalyser(analyser);
  },

  onTrackLoaded: (_title, duration) => {
    if (timeTotal) timeTotal.textContent = formatTime(duration);
    if (seekBar) {
      seekBar.max = String(duration || 0);
      seekBar.value = '0';
      seekBar.disabled = false;
    }
  },

  onTimeUpdate: (current, duration) => {
    if (!isSeeking) {
      const formatted = formatTime(current);
      if (lcdTime) lcdTime.textContent = formatted;
      if (miniTime) miniTime.textContent = formatted;
      if (timeCurrent) timeCurrent.textContent = formatted;
      if (seekBar && Number.isFinite(duration)) {
        seekBar.value = String(current);
      }
    }
    if (lyricsPanel && !lyricsPanel.classList.contains('hidden')) {
      lyricsController?.syncToTime(current);
    }
  },

  onStateChange: (state) => {
    const tech = formatAudioTechInfo(playlist.currentTrack);
    if (statusText) {
      statusText.textContent = tech ? `${statusLabels[state]} • ${tech}` : statusLabels[state];
    }
    btnPlay?.classList.toggle('ctrl-btn-active', state === 'playing');
    btnPause?.classList.toggle('ctrl-btn-active', state === 'paused');
    if (miniPlay) miniPlay.textContent = state === 'playing' ? '⏸' : '▶';
  },

  onEnded: () => {
    playlist.handleTrackEnded();
  },

  onError: (message) => {
    if (statusText) statusText.textContent = message.toUpperCase();
  },
});

const lyricsController = lyricsContent
  ? new LyricsController(lyricsContent, (sec) => engine.seek(sec))
  : null;

// 2. Gestor de playlist
const playlist = new PlaylistManager({
  onChange: (tracks, activeIndex) => {
    renderPlaylist(tracks, activeIndex);
  },

  onTrackSelect: (track) => {
    if (trackTitle) trackTitle.textContent = track.title;
    if (miniTitle) miniTitle.textContent = `${track.title} — ${track.artist}`;
    if (trackArtist) {
      trackArtist.textContent = track.album ? `${track.artist} — ${track.album}` : track.artist;
    }
    engine.load(track.fileUrl, track.title);
    void engine.play();

    if (lyricsPanel && !lyricsPanel.classList.contains('hidden')) {
      void lyricsController?.loadForTrack(track);
    }
  },

  onModeChange: (shuffle, repeatMode) => {
    updateModeButtons(shuffle, repeatMode);
  },
});

buildEqBandsUI();

// Controles de paneles superiores (EQ, LRC, Editor de Skin, MINI)
btnEqPanel?.addEventListener('click', () => {
  const isHidden = eqPanel?.classList.toggle('hidden');
  btnEqPanel.classList.toggle('active', !isHidden);
});

btnLyricsPanel?.addEventListener('click', () => {
  const isHidden = lyricsPanel?.classList.toggle('hidden');
  btnLyricsPanel.classList.toggle('active', !isHidden);
  if (!isHidden) {
    void lyricsController?.loadForTrack(playlist.currentTrack);
  }
});

btnSkinEditor?.addEventListener('click', () => {
  const isHidden = skinEditorPanel?.classList.toggle('hidden');
  btnSkinEditor.classList.toggle('active', !isHidden);
});

btnMiniMode?.addEventListener('click', async () => {
  isMiniMode = await window.electronAPI.setMiniMode(!isMiniMode);
  document.body.classList.toggle('mini-mode', isMiniMode);
  btnMiniMode.textContent = isMiniMode ? 'FULL' : 'MINI';
  btnMiniMode.classList.toggle('active', isMiniMode);
});

btnMinimize?.addEventListener('click', () => window.electronAPI.minimizeWindow());
btnClose?.addEventListener('click', () => window.electronAPI.closeWindow());

// Cambio de skin
btnTheme?.addEventListener('click', () => {
  const nextTheme = themeManager.cycleTheme();
  void window.electronAPI.saveConfig({ theme: nextTheme });
  if (statusText) {
    statusText.textContent = `SKIN ACTIVA: ${nextTheme.toUpperCase()}`;
  }
});

// Editor de Skin personalizada en tiempo real
function bindCustomSkinInput(
  input: HTMLInputElement | HTMLSelectElement | null,
  key: keyof CustomSkinConfig
): void {
  if (!input) return;
  input.addEventListener('input', () => {
    const updated = themeManager.updateCustomSkin({ [key]: input.value });
    if (statusText) statusText.textContent = 'SKIN ACTIVA: CUSTOM';
    void window.electronAPI.saveConfig({ theme: 'custom', customSkin: updated });
  });
}

bindCustomSkinInput(colorBgShell, 'bgShell');
bindCustomSkinInput(colorBgTitlebar, 'bgTitlebar');
bindCustomSkinInput(colorBgLcd, 'bgLcd');
bindCustomSkinInput(colorTextMain, 'textMain');
bindCustomSkinInput(colorAccent, 'accent');
bindCustomSkinInput(skinFontSelect, 'fontLcd');

// Visualizador
visualizerCanvas?.addEventListener('click', () => {
  if (!visualizer) return;
  const nextMode = visualizer.cycleMode();
  void window.electronAPI.saveConfig({ visualizerMode: nextMode });
  if (statusText) {
    statusText.textContent = `VISUALIZADOR: ${nextMode.toUpperCase()}`;
  }
});

// Ecualizador
btnEqToggle?.addEventListener('click', () => {
  const nextEnabled = !engine.isEqEnabled;
  engine.setEqEnabled(nextEnabled);
  syncEqUI(nextEnabled, eqPresetSelect?.value ?? 'flat', engine.getEqGains());
  void window.electronAPI.saveConfig({ eqEnabled: nextEnabled });
});

eqPresetSelect?.addEventListener('change', () => {
  const presetId = eqPresetSelect.value;
  const preset = EQ_PRESETS.find((p) => p.id === presetId);
  if (!preset) return;

  engine.setAllBandGains(preset.gains);
  syncEqUI(engine.isEqEnabled, preset.id, preset.gains);
  void window.electronAPI.saveConfig({ eqPreset: preset.id, eqGains: preset.gains });
});

btnEqReset?.addEventListener('click', () => {
  const flat = EQ_PRESETS[0];
  engine.setAllBandGains(flat.gains);
  syncEqUI(engine.isEqEnabled, flat.id, flat.gains);
  void window.electronAPI.saveConfig({ eqPreset: flat.id, eqGains: flat.gains });
});

// Biblioteca local y archivos
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

btnOpen?.addEventListener('click', async () => {
  const tracks = await window.electronAPI.openAudioFiles();
  if (tracks.length === 0) return;
  playlist.addTracks(tracks, !engine.hasTrack);
});

// Controles de reproducción (normal + mini-barra)
function triggerPlayOrStartFirst(): void {
  if (!engine.hasTrack && playlist.allTracks.length > 0) {
    playlist.selectIndex(0);
    return;
  }
  engine.togglePlay();
}

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

miniPrev?.addEventListener('click', () => playlist.previous());
miniPlay?.addEventListener('click', () => triggerPlayOrStartFirst());
miniNext?.addEventListener('click', () => playlist.next());

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

// Volumen y silencio
volumeBar?.addEventListener('input', () => updateVolumeUI(Number(volumeBar.value)));
volumeBar?.addEventListener('change', () => {
  void window.electronAPI.saveConfig({ volume: Number(volumeBar.value) });
});

btnMute?.addEventListener('click', () => {
  const muted = engine.toggleMute();
  if (btnMute) btnMute.textContent = muted ? '🔇' : '🔊';
});

// Buscador
searchInput?.addEventListener('input', () => {
  searchQuery = searchInput.value;
  renderPlaylist(playlist.allTracks, playlist.activeIndex);
});

// Drag & Drop
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

  if (paths.length === 0) return;

  if (statusText) statusText.textContent = 'LEYENDO ARCHIVOS ARRASTRADOS...';
  const tracks = await window.electronAPI.readDroppedPaths(paths);
  playlist.addTracks(tracks, !engine.hasTrack);
  if (statusText) statusText.textContent = `AGREGADAS ${tracks.length} PISTAS`;
});

// Atajos locales de teclado
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

// Atajos globales del sistema (funcionan aunque estés en otro programa o juego)
window.electronAPI.onShortcutAction((action: ShortcutAction) => {
  if (action === 'play-pause') {
    triggerPlayOrStartFirst();
  } else if (action === 'next') {
    playlist.next();
  } else if (action === 'previous') {
    playlist.previous();
  } else if (action === 'stop') {
    engine.stop();
  }
});

// Inicialización
async function bootstrap(): Promise<void> {
  const config = await window.electronAPI.loadConfig();
  themeManager.apply(config.theme, config.customSkin);
  syncSkinEditorInputs(config.customSkin);
  updateVolumeUI(config.volume);
  playlist.setModes(config.shuffle, config.repeatMode);

  engine.setEqEnabled(config.eqEnabled);
  engine.setAllBandGains(config.eqGains);
  syncEqUI(config.eqEnabled, config.eqPreset, config.eqGains);
  visualizer?.setMode(config.visualizerMode);

  if (config.musicFolder) {
    if (statusText) statusText.textContent = 'CARGANDO TU BIBLIOTECA...';
    const tracks = await window.electronAPI.scanFolder(config.musicFolder);
    playlist.setTracks(tracks, false);
    if (statusText) statusText.textContent = `BIBLIOTECA LISTA (${tracks.length} PISTAS)`;
  }
}

void bootstrap();
