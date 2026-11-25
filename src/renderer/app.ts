import type {
  ElectronAPI,
  SavedPlaylist,
  ShortcutAction,
  Track,
  WszSkinData,
} from '../shared/types.js';
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
const plTotalTimeEl = document.getElementById('pl-total-time');
const searchInput = document.getElementById('search-input') as HTMLInputElement | null;
const btnSources = document.getElementById('btn-sources');
const btnLyrics = document.getElementById('btn-lyrics');
const btnSkins = document.getElementById('btn-skins');

// Menús clásicos de Playlist (ADD / REM / SEL / MISC / LIST OPTS)
const plMenus: Record<string, HTMLElement | null> = {
  add: document.getElementById('pl-menu-add'),
  rem: document.getElementById('pl-menu-rem'),
  sel: document.getElementById('pl-menu-sel'),
  misc: document.getElementById('pl-menu-misc'),
  list: document.getElementById('pl-menu-list'),
};
const plSaveNameInput = document.getElementById('pl-save-name') as HTMLInputElement | null;
const plSaveConfirmBtn = document.getElementById('pl-save-confirm');
const plSavedItemsEl = document.getElementById('pl-saved-items');

let isMiniMode = false;
let searchQuery = '';
let draggingRowIndex: number | null = null;

const visualizer = visCanvas ? new AudioVisualizer(visCanvas, 18) : null;

function closeAllPlMenus(): void {
  Object.values(plMenus).forEach((m) => m?.classList.add('hidden'));
}

function togglePlMenu(key: string): void {
  const target = plMenus[key];
  if (!target) return;
  const willOpen = target.classList.contains('hidden');
  closeAllPlMenus();
  if (willOpen) {
    target.classList.remove('hidden');
    if (key === 'list') void refreshSavedPlaylistsMenu();
  }
}

async function refreshSavedPlaylistsMenu(): Promise<void> {
  if (!plSavedItemsEl) return;
  const saved: SavedPlaylist[] = await window.electronAPI.listSavedPlaylists();
  plSavedItemsEl.innerHTML = '';

  if (saved.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'wsz-menu-item';
    empty.style.opacity = '0.6';
    empty.textContent = '(Sin playlists guardadas)';
    plSavedItemsEl.appendChild(empty);
    return;
  }

  for (const item of saved) {
    const row = document.createElement('div');
    row.className = 'pl-saved-row';

    const loadBtn = document.createElement('button');
    loadBtn.className = 'pl-saved-load';
    loadBtn.textContent = `${item.name} (${item.tracks.length})`;
    loadBtn.title = `Cargar playlist "${item.name}"`;
    loadBtn.addEventListener('click', () => {
      playlist.setTracks(item.tracks, false);
      classicView?.showTempMarquee(`PLAYLIST: ${item.name.toUpperCase()}`);
      closeAllPlMenus();
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'pl-saved-del';
    delBtn.textContent = '×';
    delBtn.title = `Eliminar "${item.name}"`;
    delBtn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      await window.electronAPI.deleteSavedPlaylist(item.id);
      await refreshSavedPlaylistsMenu();
    });

    row.append(loadBtn, delBtn);
    plSavedItemsEl.appendChild(row);
  }
}

function updatePlaylistTimeDisplay(): void {
  if (!plTotalTimeEl) return;
  const trackDur = playlist.currentTrack?.duration ?? 0;
  const totalDur = playlist.getTotalDuration();
  plTotalTimeEl.textContent = `${formatTime(trackDur)}/${formatTime(totalDur)}`;
}

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

function renderPlaylist(tracks: Track[], activeIndex: number, selectedIndices: Set<number>): void {
  updatePlaylistTimeDisplay();
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
        ? 'Arrastra música o skins .wsz aquí, o usa ADD.'
        : 'Sin resultados para esa búsqueda.';
    playlistContainer.appendChild(empty);
    return;
  }

  for (const { track, index } of filtered) {
    const row = document.createElement('div');
    const classes = ['playlist-row'];
    if (index === activeIndex) classes.push('active');
    if (selectedIndices.has(index)) classes.push('selected');
    row.className = classes.join(' ');
    row.draggable = !query; // Permitir reordenar arrastrando cuando no hay filtro activo

    const title = document.createElement('span');
    title.className = 'playlist-row-title';
    title.textContent =
      track.artist && track.artist !== 'Artista desconocido'
        ? `${index + 1}. ${track.artist} - ${track.title}`
        : `${index + 1}. ${track.title}`;

    const dur = document.createElement('span');
    dur.className = 'playlist-row-dur';
    dur.textContent = track.isLive ? 'LIVE' : formatTime(track.duration);

    row.append(title, dur);

    // Clic simple: seleccionar (Ctrl / Shift para selección múltiple)
    row.addEventListener('click', (event) => {
      playlist.toggleRowSelection(index, event.ctrlKey || event.metaKey, event.shiftKey);
    });

    // Doble clic: reproducir
    row.addEventListener('dblclick', () => playlist.selectIndex(index));

    // Drag & Drop interno para reordenar pistas
    row.addEventListener('dragstart', (event) => {
      draggingRowIndex = index;
      event.dataTransfer?.setData('text/plain', String(index));
      event.stopPropagation();
    });

    row.addEventListener('dragover', (event) => {
      if (draggingRowIndex === null) return;
      event.preventDefault();
      event.stopPropagation();
      row.classList.add('drag-over');
    });

    row.addEventListener('dragleave', () => {
      row.classList.remove('drag-over');
    });

    row.addEventListener('drop', (event) => {
      if (draggingRowIndex === null) return;
      event.preventDefault();
      event.stopPropagation();
      row.classList.remove('drag-over');
      const from = draggingRowIndex;
      draggingRowIndex = null;
      playlist.moveTrack(from, index);
    });

    row.addEventListener('dragend', () => {
      draggingRowIndex = null;
    });

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

// 1. Motor de Audio
const engine = new AudioEngine({
  onAudioGraphReady: (analyser) => visualizer?.attachAnalyser(analyser),

  onTrackLoaded: (_title, duration) => {
    classicView?.updateTime(0, duration);
    updatePlaylistTimeDisplay();
  },

  onTimeUpdate: (current, duration) => {
    classicView?.updateTime(current, duration);
    if (miniTime) miniTime.textContent = formatTime(current);
    window.electronAPI.broadcastTime(current);
  },

  onStateChange: (state) => {
    classicView?.updatePlaybackState(state);
    if (miniPlay) miniPlay.textContent = state === 'playing' ? '⏸' : '▶';
  },

  onEnded: () => playlist.handleTrackEnded(),
});

// 2. Gestor de Playlist
const playlist = new PlaylistManager({
  onChange: (tracks, activeIndex, selectedIndices) =>
    renderPlaylist(tracks, activeIndex, selectedIndices),

  onTrackSelect: (track) => {
    classicView?.updateTrackInfo(track);
    if (miniTitle) miniTitle.textContent = `${track.title} — ${track.artist}`;
    engine.load(track.fileUrl, track.title);
    void engine.play();
    window.electronAPI.broadcastTrack(track);
    updatePlaylistTimeDisplay();
  },

  onModeChange: (shuffle, repeatMode) => classicView?.updateModes(shuffle, repeatMode),
});

// 3. Vista Winamp Unificada
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
      onBalance: (pan) => engine.setBalance(pan),
      onPreampChange: (db) => engine.setPreampGain(db),
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
      onPanelsVisibilityChange: (eqState, plState) => {
        void window.electronAPI.setWindowPanels(eqState, plState);
      },
      onOpenSkins: () => void window.electronAPI.openFloatingWindow('skins'),
      onOpenLyrics: () => void window.electronAPI.openFloatingWindow('lyrics'),
      onOpenSources: () => void window.electronAPI.openFloatingWindow('sources'),
      onSelectFolder: () => void selectFolderAction(),
      onToggleAlwaysOnTop: () => window.electronAPI.toggleAlwaysOnTop(),
      onToggleDoubleSize: () => window.electronAPI.toggleDoubleSize(),
      onCycleVisualizer: () => {
        if (!visualizer) return;
        const nextMode = visualizer.cycleMode();
        void window.electronAPI.saveConfig({ visualizerMode: nextMode });
      },
      onMinimize: () => window.electronAPI.minimizeWindow(),
      onClose: () => window.electronAPI.closeWindow(),
      onMiniMode: () => void toggleMiniMode(),
    })
  : null;

// Escalado proporcional fluido
window.addEventListener('resize', () => {
  if (!isMiniMode) classicView?.fitToWindowWidth();
});

// Visualizador
visCanvas?.addEventListener('click', () => {
  if (!visualizer) return;
  const nextMode = visualizer.cycleMode();
  void window.electronAPI.saveConfig({ visualizerMode: nextMode });
});

// Mini-barra Shade
miniPrev?.addEventListener('click', () => playlist.previous());
miniPlay?.addEventListener('click', () => triggerPlayOrStartFirst());
miniNext?.addEventListener('click', () => playlist.next());
miniRestore?.addEventListener('click', () => void toggleMiniMode());

// Mini transporte en la barra pledit.bmp
document.getElementById('pl-mini-prev')?.addEventListener('click', () => playlist.previous());
document.getElementById('pl-mini-play')?.addEventListener('click', () => {
  if (!engine.hasTrack && playlist.allTracks.length > 0) playlist.selectIndex(0);
  else void engine.play();
});
document.getElementById('pl-mini-pause')?.addEventListener('click', () => engine.pause());
document.getElementById('pl-mini-stop')?.addEventListener('click', () => engine.stop());
document.getElementById('pl-mini-next')?.addEventListener('click', () => playlist.next());
document.getElementById('pl-mini-eject')?.addEventListener('click', () => void openAudioFilesAction());

// Botones clásicos ADD / REM / SEL / MISC / LIST OPTS
document.getElementById('pl-btn-add')?.addEventListener('click', (e) => {
  e.stopPropagation();
  togglePlMenu('add');
});
document.getElementById('pl-btn-rem')?.addEventListener('click', (e) => {
  e.stopPropagation();
  togglePlMenu('rem');
});
document.getElementById('pl-btn-sel')?.addEventListener('click', (e) => {
  e.stopPropagation();
  togglePlMenu('sel');
});
document.getElementById('pl-btn-misc')?.addEventListener('click', (e) => {
  e.stopPropagation();
  togglePlMenu('misc');
});
document.getElementById('pl-btn-list')?.addEventListener('click', (e) => {
  e.stopPropagation();
  togglePlMenu('list');
});

// Acciones de los 5 menús de Playlist
document.querySelectorAll<HTMLElement>('[data-pl-action]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const action = btn.dataset.plAction;
    closeAllPlMenus();

    if (action === 'add-files') await openAudioFilesAction();
    else if (action === 'add-folder') await selectFolderAction();
    else if (action === 'add-url') await window.electronAPI.openFloatingWindow('sources');
    else if (action === 'rem-selected') playlist.removeSelected();
    else if (action === 'rem-crop') playlist.cropSelected();
    else if (action === 'rem-dupes') {
      const removed = playlist.removeDuplicates();
      classicView?.showTempMarquee(`DUPLICADOS QUITADOS: ${removed}`);
    } else if (action === 'rem-all' || action === 'list-new') {
      engine.stop();
      playlist.clear();
    } else if (action === 'sel-all') playlist.selectAll();
    else if (action === 'sel-none') playlist.selectNone();
    else if (action === 'sel-inv') playlist.invertSelection();
    else if (action === 'sort-title') playlist.sortBy('title');
    else if (action === 'sort-artist') playlist.sortBy('artist');
    else if (action === 'sort-duration') playlist.sortBy('duration');
    else if (action === 'misc-shuffle') playlist.randomizeOrder();
    else if (action === 'misc-reverse') playlist.reverseOrder();
    else if (action === 'list-import') {
      const tracks = await window.electronAPI.importPlaylistM3u();
      if (tracks.length > 0) {
        playlist.setTracks(tracks, false);
        classicView?.showTempMarquee(`M3U IMPORTADA (${tracks.length})`);
      }
    } else if (action === 'list-export') {
      const ok = await window.electronAPI.exportPlaylistM3u(playlist.allTracks);
      if (ok) classicView?.showTempMarquee('M3U EXPORTADA');
    }
  });
});

// Guardar playlist con nombre desde LIST OPTS
async function saveCurrentPlaylistInline(): Promise<void> {
  const name = plSaveNameInput?.value.trim() ?? '';
  if (!name || playlist.allTracks.length === 0) return;
  await window.electronAPI.saveNamedPlaylist(name, playlist.allTracks);
  if (plSaveNameInput) plSaveNameInput.value = '';
  classicView?.showTempMarquee(`GUARDADA: ${name.toUpperCase()}`);
  await refreshSavedPlaylistsMenu();
}

plSaveConfirmBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  void saveCurrentPlaylistInline();
});
plSaveNameInput?.addEventListener('click', (e) => e.stopPropagation());
plSaveNameInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') void saveCurrentPlaylistInline();
});

document.addEventListener('click', (event) => {
  const target = event.target as Node;
  const insideAnyMenu = Object.values(plMenus).some((m) => m && m.contains(target));
  if (!insideAnyMenu) closeAllPlMenus();
});

// Tira inferior Exum
btnSources?.addEventListener('click', () => void window.electronAPI.openFloatingWindow('sources'));
btnLyrics?.addEventListener('click', () => void window.electronAPI.openFloatingWindow('lyrics'));
btnSkins?.addEventListener('click', () => void window.electronAPI.openFloatingWindow('skins'));

searchInput?.addEventListener('input', () => {
  searchQuery = searchInput.value;
  renderPlaylist(playlist.allTracks, playlist.activeIndex, playlist.selected);
});

// Drag & Drop externo (música y skins .wsz) — ignorado si estamos reordenando filas internas
let dragDepth = 0;

playerShell?.addEventListener('dragenter', (event) => {
  if (draggingRowIndex !== null) return;
  event.preventDefault();
  dragDepth++;
  dropOverlay?.classList.add('visible');
});

playerShell?.addEventListener('dragover', (event) => {
  if (draggingRowIndex !== null) return;
  event.preventDefault();
});

playerShell?.addEventListener('dragleave', () => {
  if (draggingRowIndex !== null) return;
  dragDepth--;
  if (dragDepth <= 0) {
    dragDepth = 0;
    dropOverlay?.classList.remove('visible');
  }
});

playerShell?.addEventListener('drop', async (event) => {
  if (draggingRowIndex !== null) return;
  event.preventDefault();
  dragDepth = 0;
  dropOverlay?.classList.remove('visible');

  const files = Array.from(event.dataTransfer?.files ?? []);
  if (files.length === 0) return;

  const paths = files
    .map((file) => window.electronAPI.getPathForFile(file))
    .filter((p) => Boolean(p));

  const wszPath = paths.find((p) => p.toLowerCase().endsWith('.wsz'));
  if (wszPath) await window.electronAPI.importWszPath(wszPath);

  const audioPaths = paths.filter((p) => !p.toLowerCase().endsWith('.wsz'));
  if (audioPaths.length > 0) {
    const tracks = await window.electronAPI.readDroppedPaths(audioPaths);
    playlist.addTracks(tracks, !engine.hasTrack);
  }
});

// Atajos locales (incluye Supr/Delete para quitar filas seleccionadas)
window.addEventListener('keydown', (event) => {
  const tag = (document.activeElement as HTMLElement | null)?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

  if (event.code === 'Delete') {
    playlist.removeSelected();
    return;
  }

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

window.electronAPI.onSeekRequested((seconds: number) => engine.seek(seconds));
window.electronAPI.onSkinApplied((skin: WszSkinData | null) => applySkinOrDefault(skin));
window.electronAPI.onExternalTrackReceived((track: Track, autoPlay: boolean) => {
  playlist.addTracks([track], autoPlay);
});

window.electronAPI.onReplacePlaylistReceived((tracks: Track[], label?: string) => {
  playlist.setTracks(tracks, tracks.length > 0);
  if (label) classicView?.showTempMarquee(label.toUpperCase());
});

window.electronAPI.onPauseLocalRequested(() => {
  engine.pause();
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
