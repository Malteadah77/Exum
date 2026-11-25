import type {
  ElectronAPI,
  SavedStream,
  SpotifyAuthState,
  Track,
  WszPleditColors,
} from '../shared/types.js';
import { formatTime } from './audioEngine.js';
import { applyPaletteToDocument } from './wszRenderer.js';

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

const btnPin = document.getElementById('btn-pin');
const btnMin = document.getElementById('btn-min');
const btnClose = document.getElementById('btn-close');

const tabStreams = document.getElementById('tab-streams');
const tabSpotify = document.getElementById('tab-spotify');
const panelStreams = document.getElementById('panel-streams');
const panelSpotify = document.getElementById('panel-spotify');

// Streams
const streamNameInput = document.getElementById('stream-name') as HTMLInputElement | null;
const streamUrlInput = document.getElementById('stream-url') as HTMLInputElement | null;
const btnAddStream = document.getElementById('btn-add-stream');
const streamsListEl = document.getElementById('streams-list');

// Spotify
const spotifyClientInput = document.getElementById('spotify-client-id') as HTMLInputElement | null;
const btnSpotifyConnect = document.getElementById('btn-spotify-connect');
const btnSpotifyDisconnect = document.getElementById('btn-spotify-disconnect');
const spotifyStatusEl = document.getElementById('spotify-status');
const spotifyListEl = document.getElementById('spotify-list');

let savedStreams: SavedStream[] = [];

function buildStreamTrack(stream: SavedStream): Track {
  return {
    id: `stream:${stream.url}`,
    filePath: stream.url,
    fileUrl: stream.url,
    fileName: stream.name,
    title: stream.name,
    artist: stream.genre || 'Radio / Stream Online',
    album: 'Stream en vivo',
    duration: 0,
    codec: 'STREAM',
    sourceType: 'stream',
    isLive: true,
  };
}

function renderStreams(): void {
  if (!streamsListEl) return;
  streamsListEl.innerHTML = '';

  if (savedStreams.length === 0) {
    streamsListEl.innerHTML = '<div class="lyrics-message">No hay streams guardados. Pega una URL arriba.</div>';
    return;
  }

  for (const stream of savedStreams) {
    const row = document.createElement('div');
    row.className = 'source-row';

    const meta = document.createElement('div');
    meta.className = 'source-meta';

    const name = document.createElement('span');
    name.className = 'source-name';
    name.textContent = stream.name;

    const url = document.createElement('span');
    url.className = 'source-sub';
    url.textContent = stream.url;

    meta.append(name, url);

    const actions = document.createElement('div');
    actions.className = 'float-actions';

    const playBtn = document.createElement('button');
    playBtn.className = 'float-btn';
    playBtn.textContent = '▶';
    playBtn.title = 'Reproducir en Exum';
    playBtn.addEventListener('click', () => {
      window.electronAPI.sendExternalTrack(buildStreamTrack(stream), true);
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'saved-skin-del';
    delBtn.textContent = '🗑';
    delBtn.title = 'Eliminar stream';
    delBtn.addEventListener('click', async () => {
      savedStreams = savedStreams.filter((s) => s.id !== stream.id);
      await window.electronAPI.saveConfig({ savedStreams });
      renderStreams();
    });

    actions.append(playBtn, delBtn);
    row.append(meta, actions);
    streamsListEl.appendChild(row);
  }
}

async function renderSpotifyPlaylists(): Promise<void> {
  if (!spotifyListEl) return;
  spotifyListEl.innerHTML = '<div class="lyrics-message">Cargando tus playlists de Spotify...</div>';
  const playlists = await window.electronAPI.spotifyListPlaylists();
  spotifyListEl.innerHTML = '';

  if (playlists.length === 0) {
    spotifyListEl.innerHTML = '<div class="lyrics-message">No se encontraron playlists en tu cuenta.</div>';
    return;
  }

  for (const pl of playlists) {
    const row = document.createElement('div');
    row.className = 'source-row';

    const meta = document.createElement('div');
    meta.className = 'source-meta';

    const name = document.createElement('span');
    name.className = 'source-name';
    name.textContent = pl.name;

    const sub = document.createElement('span');
    sub.className = 'source-sub';
    sub.textContent = `${pl.trackCount} canciones`;

    meta.append(name, sub);

    const openBtn = document.createElement('button');
    openBtn.className = 'float-btn';
    openBtn.textContent = 'Ver pistas';
    openBtn.addEventListener('click', () => void renderSpotifyTracks(pl.id, pl.name));

    row.append(meta, openBtn);
    spotifyListEl.appendChild(row);
  }
}

async function renderSpotifyTracks(playlistId: string, playlistName: string): Promise<void> {
  if (!spotifyListEl) return;
  spotifyListEl.innerHTML = `<div class="lyrics-message">Cargando "${playlistName}"...</div>`;
  const tracks = await window.electronAPI.spotifyGetPlaylistTracks(playlistId);
  spotifyListEl.innerHTML = '';

  const backBtn = document.createElement('button');
  backBtn.className = 'float-btn';
  backBtn.textContent = `← Volver a playlists (${playlistName})`;
  backBtn.addEventListener('click', () => void renderSpotifyPlaylists());
  spotifyListEl.appendChild(backBtn);

  for (const t of tracks) {
    const row = document.createElement('div');
    row.className = 'source-row';

    const meta = document.createElement('div');
    meta.className = 'source-meta';

    const name = document.createElement('span');
    name.className = 'source-name';
    name.textContent = `${t.title} (${formatTime(t.duration)})`;

    const sub = document.createElement('span');
    sub.className = 'source-sub';
    sub.textContent = t.artist;

    meta.append(name, sub);

    const actions = document.createElement('div');
    actions.className = 'float-actions';

    if (t.previewUrl) {
      const playBtn = document.createElement('button');
      playBtn.className = 'float-btn';
      playBtn.textContent = '▶ Preview';
      playBtn.addEventListener('click', () => {
        window.electronAPI.sendExternalTrack(
          {
            id: `spotify:${t.id}`,
            filePath: t.previewUrl!,
            fileUrl: t.previewUrl!,
            fileName: t.title,
            title: t.title,
            artist: t.artist,
            album: t.album,
            duration: 30,
            codec: 'SPOTIFY',
            sourceType: 'spotify',
            externalUrl: t.externalUrl,
          },
          true
        );
      });
      actions.appendChild(playBtn);
    }

    if (t.externalUrl) {
      const extBtn = document.createElement('button');
      extBtn.className = 'float-btn';
      extBtn.textContent = '↗';
      extBtn.title = 'Abrir en Spotify';
      extBtn.addEventListener('click', () => void window.electronAPI.openExternalUrl(t.externalUrl));
      actions.appendChild(extBtn);
    }

    row.append(meta, actions);
    spotifyListEl.appendChild(row);
  }
}

function updateSpotifyUI(state: SpotifyAuthState): void {
  if (spotifyStatusEl) {
    if (state.connected) {
      spotifyStatusEl.textContent = `Conectado: ${state.displayName} (${state.product ?? 'free'})`;
    } else if (state.error) {
      spotifyStatusEl.textContent = `Error: ${state.error}`;
    } else {
      spotifyStatusEl.textContent = 'No vinculado';
    }
  }
  btnSpotifyDisconnect?.classList.toggle('hidden', !state.connected);
  if (state.connected) {
    void renderSpotifyPlaylists();
  }
}

// Eventos ventana y pestañas
btnPin?.addEventListener('click', async () => {
  const pinned = await window.electronAPI.toggleAlwaysOnTop();
  btnPin.classList.toggle('active', pinned);
});
btnMin?.addEventListener('click', () => window.electronAPI.minimizeWindow());
btnClose?.addEventListener('click', () => window.electronAPI.closeWindow());

tabStreams?.addEventListener('click', () => {
  tabStreams.classList.add('active');
  tabSpotify?.classList.remove('active');
  panelStreams?.classList.remove('hidden');
  panelSpotify?.classList.add('hidden');
});

tabSpotify?.addEventListener('click', () => {
  tabSpotify.classList.add('active');
  tabStreams?.classList.remove('active');
  panelSpotify?.classList.remove('hidden');
  panelStreams?.classList.add('hidden');
});

btnAddStream?.addEventListener('click', async () => {
  const url = streamUrlInput?.value.trim() ?? '';
  if (!url.startsWith('http://') && !url.startsWith('https://')) return;

  const name = streamNameInput?.value.trim() || new URL(url).hostname;
  const newStream: SavedStream = {
    id: `custom-${Date.now()}`,
    name,
    url,
    genre: 'Stream personalizado',
  };

  savedStreams = [newStream, ...savedStreams];
  await window.electronAPI.saveConfig({ savedStreams });
  renderStreams();
  window.electronAPI.sendExternalTrack(buildStreamTrack(newStream), true);

  if (streamNameInput) streamNameInput.value = '';
  if (streamUrlInput) streamUrlInput.value = '';
});

btnSpotifyConnect?.addEventListener('click', async () => {
  const clientId = spotifyClientInput?.value.trim() ?? '';
  if (spotifyStatusEl) spotifyStatusEl.textContent = 'Esperando inicio de sesión en el navegador...';
  const state = await window.electronAPI.spotifyConnect(clientId);
  updateSpotifyUI(state);
});

btnSpotifyDisconnect?.addEventListener('click', async () => {
  const state = await window.electronAPI.spotifyDisconnect();
  updateSpotifyUI(state);
  if (spotifyListEl) {
    spotifyListEl.innerHTML = '<div class="lyrics-message">Sesión cerrada.</div>';
  }
});

window.electronAPI.onPaletteUpdated((palette: WszPleditColors) => applyPaletteToDocument(palette));

async function init(): Promise<void> {
  const [sync, config, spState] = await Promise.all([
    window.electronAPI.getSyncState(),
    window.electronAPI.loadConfig(),
    window.electronAPI.spotifyGetState(),
  ]);

  applyPaletteToDocument(sync.palette);
  savedStreams = config.savedStreams;
  renderStreams();

  if (spotifyClientInput && config.spotifyClientId) {
    spotifyClientInput.value = config.spotifyClientId;
  }
  updateSpotifyUI(spState);
}

void init();
