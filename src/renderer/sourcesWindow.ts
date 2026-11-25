import type {
  ElectronAPI,
  RadioStationItem,
  SavedStream,
  SavedYouTubeItem,
  SpotifyAuthState,
  SpotifyMatchResult,
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

// Tabs
const tabs = {
  radios: { btn: document.getElementById('tab-radios'), panel: document.getElementById('panel-radios') },
  urls: { btn: document.getElementById('tab-urls'), panel: document.getElementById('panel-urls') },
  youtube: { btn: document.getElementById('tab-youtube'), panel: document.getElementById('panel-youtube') },
  spotify: { btn: document.getElementById('tab-spotify'), panel: document.getElementById('panel-spotify') },
};

// Pestaña 1: Radio Browser
const radioSearchInput = document.getElementById('radio-search-input') as HTMLInputElement | null;
const btnRadioSearch = document.getElementById('btn-radio-search');
const radioResultsList = document.getElementById('radio-results-list');

// Pestaña 2: URLs / .m3u / Descargar audio directo
const streamNameInput = document.getElementById('stream-name') as HTMLInputElement | null;
const streamUrlInput = document.getElementById('stream-url') as HTMLInputElement | null;
const btnAddStream = document.getElementById('btn-add-stream');
const btnDownloadAudio = document.getElementById('btn-download-audio');
const urlStatusBanner = document.getElementById('url-status-banner');
const streamsListEl = document.getElementById('streams-list');

// Pestaña 3: YouTube Embed
const ytUrlInput = document.getElementById('yt-url-input') as HTMLInputElement | null;
const btnYtPlay = document.getElementById('btn-yt-play');
const btnYtStop = document.getElementById('btn-yt-stop');
const ytStatusBanner = document.getElementById('yt-status-banner');
const ytPlayerBox = document.getElementById('yt-player-box');
const ytIframe = document.getElementById('yt-iframe') as HTMLIFrameElement | null;
const ytSavedList = document.getElementById('yt-saved-list');

// Pestaña 4: Spotify
const spotifyClientInput = document.getElementById('spotify-client-id') as HTMLInputElement | null;
const btnSpotifyConnect = document.getElementById('btn-spotify-connect');
const btnSpotifyDisconnect = document.getElementById('btn-spotify-disconnect');
const spotifyLinkInput = document.getElementById('spotify-link-input') as HTMLInputElement | null;
const btnSpotifyMatch = document.getElementById('btn-spotify-match');
const spotifyStatusEl = document.getElementById('spotify-status');
const spotifyListEl = document.getElementById('spotify-list');

let savedStreams: SavedStream[] = [];
let savedYouTube: SavedYouTubeItem[] = [];

function switchTab(target: keyof typeof tabs): void {
  (Object.keys(tabs) as Array<keyof typeof tabs>).forEach((key) => {
    tabs[key].btn?.classList.toggle('active', key === target);
    tabs[key].panel?.classList.toggle('hidden', key !== target);
  });
}

function showBanner(el: HTMLElement | null, text: string): void {
  if (!el) return;
  el.textContent = text;
  el.classList.remove('hidden');
}

function buildStreamTrack(name: string, url: string, genre = 'Radio Online', bitrate?: number): Track {
  return {
    id: `stream:${url}`,
    filePath: url,
    fileUrl: url,
    fileName: name,
    title: name,
    artist: genre,
    album: 'Stream en vivo',
    duration: 0,
    bitrate: bitrate || undefined,
    codec: 'STREAM',
    sourceType: 'stream',
    isLive: true,
  };
}

// ---------- 1. RADIO BROWSER (+30,000 RADIOS) ----------
async function searchRadios(query: string): Promise<void> {
  if (!radioResultsList) return;
  radioResultsList.innerHTML = '<div class="lyrics-message">Buscando radios en el mundo...</div>';

  const stations: RadioStationItem[] = await window.electronAPI.searchWorldRadios(query);
  radioResultsList.innerHTML = '';

  if (stations.length === 0) {
    radioResultsList.innerHTML =
      '<div class="lyrics-message">No se encontraron radios (o sin conexión). Prueba otro género.</div>';
    return;
  }

  for (const st of stations) {
    const row = document.createElement('div');
    row.className = 'source-row';

    const meta = document.createElement('div');
    meta.className = 'source-meta';

    const name = document.createElement('span');
    name.className = 'source-name';
    name.textContent = st.name;

    const infoParts = [st.country, st.codec, st.bitrate ? `${st.bitrate}kbps` : ''].filter(Boolean);
    const sub = document.createElement('span');
    sub.className = 'source-sub';
    sub.textContent = infoParts.join(' • ') || st.tags || st.url;

    meta.append(name, sub);

    const actions = document.createElement('div');
    actions.className = 'float-actions';

    const playBtn = document.createElement('button');
    playBtn.className = 'float-btn';
    playBtn.textContent = '▶';
    playBtn.title = 'Escuchar en Exum (con EQ y Visualizador)';
    playBtn.addEventListener('click', () => {
      window.electronAPI.sendExternalTrack(
        buildStreamTrack(st.name, st.url, st.country || 'Radio Mundial', st.bitrate),
        true
      );
    });

    const favBtn = document.createElement('button');
    favBtn.className = 'float-btn';
    favBtn.textContent = '★';
    favBtn.title = 'Guardar en favoritos (URL/.m3u)';
    favBtn.addEventListener('click', async () => {
      if (!savedStreams.some((s) => s.url === st.url)) {
        savedStreams = [
          { id: `radio-${Date.now()}`, name: st.name, url: st.url, genre: st.country || 'Radio' },
          ...savedStreams,
        ];
        await window.electronAPI.saveConfig({ savedStreams });
        renderStreams();
      }
      favBtn.textContent = '✓';
    });

    actions.append(playBtn, favBtn);
    row.append(meta, actions);
    radioResultsList.appendChild(row);
  }
}

// ---------- 2. STREAMS / .m3u / .pls / AUDIO DIRECTO ----------
function renderStreams(): void {
  if (!streamsListEl) return;
  streamsListEl.innerHTML = '';

  if (savedStreams.length === 0) {
    streamsListEl.innerHTML = '<div class="lyrics-message">No hay streams guardados.</div>';
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
      window.electronAPI.sendExternalTrack(buildStreamTrack(stream.name, stream.url, stream.genre), true);
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'saved-skin-del';
    delBtn.textContent = '🗑';
    delBtn.title = 'Eliminar';
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

// ---------- 3. YOUTUBE OFICIAL EMBED ----------
function parseYouTubeEmbed(rawUrl: string): { embedUrl: string; title: string; isPlaylist: boolean } | null {
  try {
    const u = new URL(rawUrl.trim());
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    const listId = u.searchParams.get('list');
    let videoId: string | null = null;

    if (host === 'youtu.be') {
      videoId = u.pathname.slice(1).split('/')[0] || null;
    } else if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      if (u.pathname === '/watch') {
        videoId = u.searchParams.get('v');
      } else if (u.pathname.startsWith('/shorts/') || u.pathname.startsWith('/embed/')) {
        videoId = u.pathname.split('/')[2] || null;
      }
    } else {
      return null;
    }

    if (videoId && listId) {
      return {
        embedUrl: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?list=${encodeURIComponent(listId)}&autoplay=1`,
        title: `YouTube Playlist (${videoId})`,
        isPlaylist: true,
      };
    }
    if (listId) {
      return {
        embedUrl: `https://www.youtube-nocookie.com/embed/videoseries?list=${encodeURIComponent(listId)}&autoplay=1`,
        title: `YouTube Playlist (${listId.slice(0, 12)})`,
        isPlaylist: true,
      };
    }
    if (videoId) {
      return {
        embedUrl: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1`,
        title: `YouTube Video (${videoId})`,
        isPlaylist: false,
      };
    }
  } catch {
    return null;
  }
  return null;
}

function playYouTubeItem(item: SavedYouTubeItem): void {
  window.electronAPI.pauseLocalAudio(); // Pausa el audio local de Exum automáticamente
  if (ytIframe) ytIframe.src = item.embedUrl;
  ytPlayerBox?.classList.remove('hidden');
  showBanner(ytStatusBanner, `Reproduciendo en YouTube Embed: ${item.title}`);
}

function renderSavedYouTube(): void {
  if (!ytSavedList) return;
  ytSavedList.innerHTML = '';

  if (savedYouTube.length === 0) {
    ytSavedList.innerHTML = '<div class="lyrics-message">Pega arriba un link de video o playlist de YouTube.</div>';
    return;
  }

  for (const item of savedYouTube) {
    const row = document.createElement('div');
    row.className = 'source-row';

    const meta = document.createElement('div');
    meta.className = 'source-meta';

    const name = document.createElement('span');
    name.className = 'source-name';
    name.textContent = item.title;

    const sub = document.createElement('span');
    sub.className = 'source-sub';
    sub.textContent = item.originalUrl;

    meta.append(name, sub);

    const actions = document.createElement('div');
    actions.className = 'float-actions';

    const playBtn = document.createElement('button');
    playBtn.className = 'float-btn';
    playBtn.textContent = '▶';
    playBtn.addEventListener('click', () => playYouTubeItem(item));

    const delBtn = document.createElement('button');
    delBtn.className = 'saved-skin-del';
    delBtn.textContent = '🗑';
    delBtn.addEventListener('click', async () => {
      savedYouTube = savedYouTube.filter((y) => y.id !== item.id);
      await window.electronAPI.saveConfig({ savedYouTube });
      renderSavedYouTube();
    });

    actions.append(playBtn, delBtn);
    row.append(meta, actions);
    ytSavedList.appendChild(row);
  }
}

// ---------- 4. SPOTIFY + EMPAREJAMIENTO LOCAL ----------
function renderSpotifyMatchResult(res: SpotifyMatchResult): void {
  if (!spotifyListEl) return;

  if (res.error) {
    showBanner(spotifyStatusEl, `Error: ${res.error}`);
    return;
  }

  showBanner(
    spotifyStatusEl,
    `"${res.playlistName}": ${res.matchedTracks.length} encontradas en tu PC, ${res.missingTracks.length} faltantes.`
  );

  if (res.matchedTracks.length > 0) {
    window.electronAPI.replaceMainPlaylist(res.matchedTracks, `SPOTIFY: ${res.playlistName}`);
  }

  spotifyListEl.innerHTML = '';

  const backBtn = document.createElement('button');
  backBtn.className = 'float-btn';
  backBtn.textContent = '← Volver a mis playlists';
  backBtn.addEventListener('click', () => void renderSpotifyPlaylists());
  spotifyListEl.appendChild(backBtn);

  if (res.missingTracks.length === 0) {
    const done = document.createElement('div');
    done.className = 'lyrics-message';
    done.textContent = '¡Todas las canciones coincidieron con tu carpeta local y ya cargaron en Exum!';
    spotifyListEl.appendChild(done);
    return;
  }

  const header = document.createElement('div');
  header.className = 'section-title';
  header.style.marginTop = '4px';
  header.textContent = `CANCIONES FALTANTES EN TU CARPETA LOCAL (${res.missingTracks.length}):`;
  spotifyListEl.appendChild(header);

  for (const t of res.missingTracks) {
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
      extBtn.textContent = '↗ Spotify';
      extBtn.addEventListener('click', () => void window.electronAPI.openExternalUrl(t.externalUrl));
      actions.appendChild(extBtn);
    }

    row.append(meta, actions);
    spotifyListEl.appendChild(row);
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

    const matchBtn = document.createElement('button');
    matchBtn.className = 'float-btn';
    matchBtn.textContent = 'Emparejar MP3';
    matchBtn.title = 'Crea playlist en Exum con coincidencias de tu carpeta local';
    matchBtn.addEventListener('click', async () => {
      showBanner(spotifyStatusEl, `Emparejando "${pl.name}" con tu carpeta local...`);
      const res = await window.electronAPI.matchSpotifyPlaylist(pl.id);
      renderSpotifyMatchResult(res);
    });

    row.append(meta, matchBtn);
    spotifyListEl.appendChild(row);
  }
}

function updateSpotifyUI(state: SpotifyAuthState): void {
  if (state.connected) {
    showBanner(spotifyStatusEl, `Conectado: ${state.displayName} (${state.product ?? 'free'})`);
    void renderSpotifyPlaylists();
  } else if (state.error) {
    showBanner(spotifyStatusEl, `Error: ${state.error}`);
  } else {
    showBanner(spotifyStatusEl, 'No vinculado');
  }
  btnSpotifyDisconnect?.classList.toggle('hidden', !state.connected);
}

// Eventos ventana y pestañas
btnPin?.addEventListener('click', async () => {
  const pinned = await window.electronAPI.toggleAlwaysOnTop();
  btnPin.classList.toggle('active', pinned);
});
btnMin?.addEventListener('click', () => window.electronAPI.minimizeWindow());
btnClose?.addEventListener('click', () => window.electronAPI.closeWindow());

tabs.radios.btn?.addEventListener('click', () => switchTab('radios'));
tabs.urls.btn?.addEventListener('click', () => switchTab('urls'));
tabs.youtube.btn?.addEventListener('click', () => switchTab('youtube'));
tabs.spotify.btn?.addEventListener('click', () => switchTab('spotify'));

// Eventos Radios
btnRadioSearch?.addEventListener('click', () => void searchRadios(radioSearchInput?.value ?? ''));
radioSearchInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') void searchRadios(radioSearchInput.value);
});
document.querySelectorAll<HTMLElement>('.radio-tag-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    const tag = chip.dataset.tag ?? '';
    if (radioSearchInput) radioSearchInput.value = tag;
    void searchRadios(tag);
  });
});

// Eventos URL / .m3u / Descargar directo
btnAddStream?.addEventListener('click', async () => {
  const rawUrl = streamUrlInput?.value.trim() ?? '';
  if (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://')) {
    showBanner(urlStatusBanner, 'Ingresa una URL válida (http:// o https://).');
    return;
  }

  showBanner(urlStatusBanner, 'Resolviendo URL...');
  const resolved = await window.electronAPI.resolveStreamUrl(rawUrl);
  const name = streamNameInput?.value.trim() || resolved.title || new URL(resolved.url).hostname;

  const newStream: SavedStream = {
    id: `custom-${Date.now()}`,
    name,
    url: resolved.url,
    genre: 'Stream personalizado',
  };

  savedStreams = [newStream, ...savedStreams];
  await window.electronAPI.saveConfig({ savedStreams });
  renderStreams();
  window.electronAPI.sendExternalTrack(buildStreamTrack(newStream.name, newStream.url, newStream.genre), true);
  showBanner(urlStatusBanner, `Reproduciendo: ${name}`);

  if (streamNameInput) streamNameInput.value = '';
  if (streamUrlInput) streamUrlInput.value = '';
});

btnDownloadAudio?.addEventListener('click', async () => {
  const rawUrl = streamUrlInput?.value.trim() ?? '';
  if (!rawUrl) {
    showBanner(urlStatusBanner, 'Pega primero una URL directa de audio (.mp3/.wav/.flac).');
    return;
  }

  showBanner(urlStatusBanner, 'Descargando audio abierto en tu carpeta local...');
  const res = await window.electronAPI.downloadDirectAudio(rawUrl, streamNameInput?.value);
  if (res.ok && res.track) {
    window.electronAPI.sendExternalTrack(res.track, true);
    showBanner(urlStatusBanner, `✓ Guardado en tu carpeta local: ${res.track.fileName}`);
    if (streamNameInput) streamNameInput.value = '';
    if (streamUrlInput) streamUrlInput.value = '';
  } else {
    showBanner(urlStatusBanner, `Aviso: ${res.error ?? 'No se pudo descargar.'}`);
  }
});

// Eventos YouTube
btnYtPlay?.addEventListener('click', async () => {
  const raw = ytUrlInput?.value.trim() ?? '';
  const parsed = parseYouTubeEmbed(raw);
  if (!parsed) {
    showBanner(ytStatusBanner, 'Link de YouTube inválido (pega un video o playlist de youtube.com / youtu.be).');
    return;
  }

  const item: SavedYouTubeItem = {
    id: `yt-${Date.now()}`,
    title: parsed.title,
    originalUrl: raw,
    embedUrl: parsed.embedUrl,
    isPlaylist: parsed.isPlaylist,
  };

  if (!savedYouTube.some((y) => y.embedUrl === item.embedUrl)) {
    savedYouTube = [item, ...savedYouTube];
    await window.electronAPI.saveConfig({ savedYouTube });
    renderSavedYouTube();
  }

  playYouTubeItem(item);
  if (ytUrlInput) ytUrlInput.value = '';
});

btnYtStop?.addEventListener('click', () => {
  if (ytIframe) ytIframe.src = 'about:blank';
  ytPlayerBox?.classList.add('hidden');
  showBanner(ytStatusBanner, 'Reproductor de YouTube detenido.');
});

// Eventos Spotify
btnSpotifyConnect?.addEventListener('click', async () => {
  const clientId = spotifyClientInput?.value.trim() ?? '';
  showBanner(spotifyStatusEl, 'Esperando inicio de sesión en tu navegador...');
  const state = await window.electronAPI.spotifyConnect(clientId);
  updateSpotifyUI(state);
});

btnSpotifyDisconnect?.addEventListener('click', async () => {
  const state = await window.electronAPI.spotifyDisconnect();
  updateSpotifyUI(state);
  if (spotifyListEl) spotifyListEl.innerHTML = '<div class="lyrics-message">Sesión cerrada.</div>';
});

btnSpotifyMatch?.addEventListener('click', async () => {
  const link = spotifyLinkInput?.value.trim() ?? '';
  if (!link) return;
  showBanner(spotifyStatusEl, 'Buscando coincidencias en tu carpeta local...');
  const res = await window.electronAPI.matchSpotifyPlaylist(link);
  renderSpotifyMatchResult(res);
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
  savedYouTube = config.savedYouTube;
  renderStreams();
  renderSavedYouTube();

  if (spotifyClientInput && config.spotifyClientId) {
    spotifyClientInput.value = config.spotifyClientId;
  }
  updateSpotifyUI(spState);
  void searchRadios('');
}

void init();
