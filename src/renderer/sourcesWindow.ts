import type {
  ArchiveAlbumItem,
  DiscoverTrackItem,
  ElectronAPI,
  RadioStationItem,
  SavedStream,
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

// Tabs principales
const tabs = {
  library: { btn: document.getElementById('tab-library'), panel: document.getElementById('panel-library') },
  discover: { btn: document.getElementById('tab-discover'), panel: document.getElementById('panel-discover') },
  radios: { btn: document.getElementById('tab-radios'), panel: document.getElementById('panel-radios') },
  urls: { btn: document.getElementById('tab-urls'), panel: document.getElementById('panel-urls') },
};

// Pestaña 1: Biblioteca Local (Mi Música)
const libSearchInput = document.getElementById('lib-search-input') as HTMLInputElement | null;
const btnLibFolder = document.getElementById('btn-lib-folder');
const btnLibLoadAll = document.getElementById('btn-lib-load-all');
const btnLibAll = document.getElementById('btn-lib-all');
const btnLibFavs = document.getElementById('btn-lib-favs');
const libArtistFilter = document.getElementById('lib-artist-filter') as HTMLSelectElement | null;
const libAlbumFilter = document.getElementById('lib-album-filter') as HTMLSelectElement | null;
const libStatusBanner = document.getElementById('lib-status-banner');
const libTracksList = document.getElementById('lib-tracks-list');

// Pestaña 2: Explorador Libre (Audius + Internet Archive)
const subAudiusBtn = document.getElementById('sub-audius');
const subArchiveBtn = document.getElementById('sub-archive');
const discoverSearchInput = document.getElementById('discover-search-input') as HTMLInputElement | null;
const btnDiscoverSearch = document.getElementById('btn-discover-search');
const discoverStatusBanner = document.getElementById('discover-status-banner');
const discoverResultsList = document.getElementById('discover-results-list');

// Pestaña 3: Radio Browser
const radioSearchInput = document.getElementById('radio-search-input') as HTMLInputElement | null;
const btnRadioSearch = document.getElementById('btn-radio-search');
const radioResultsList = document.getElementById('radio-results-list');

// Pestaña 4: URLs / .m3u / Descargar audio directo
const streamNameInput = document.getElementById('stream-name') as HTMLInputElement | null;
const streamUrlInput = document.getElementById('stream-url') as HTMLInputElement | null;
const btnAddStream = document.getElementById('btn-add-stream');
const btnDownloadAudio = document.getElementById('btn-download-audio');
const urlStatusBanner = document.getElementById('url-status-banner');
const streamsListEl = document.getElementById('streams-list');

// Estado de la ventana
let musicFolder: string | null = null;
let localTracks: Track[] = [];
let favoriteIds = new Set<string>();
let libOnlyFavorites = false;
let savedStreams: SavedStream[] = [];

let discoverMode: 'audius' | 'archive' = 'audius';
let discoverLoadedOnce = false;
let radiosLoadedOnce = false;
let lastArchiveAlbums: ArchiveAlbumItem[] = [];

function switchTab(target: keyof typeof tabs): void {
  (Object.keys(tabs) as Array<keyof typeof tabs>).forEach((key) => {
    tabs[key].btn?.classList.toggle('active', key === target);
    tabs[key].panel?.classList.toggle('hidden', key !== target);
  });

  if (target === 'discover' && !discoverLoadedOnce) {
    discoverLoadedOnce = true;
    void runDiscoverSearch('');
  }
  if (target === 'radios' && !radiosLoadedOnce) {
    radiosLoadedOnce = true;
    void searchRadios('');
  }
}

function showBanner(el: HTMLElement | null, text: string): void {
  if (!el) return;
  el.textContent = text;
  el.classList.remove('hidden');
}

function stripCoverForIpc(track: Track): Track {
  const { coverDataUrl: _omitted, ...lite } = track;
  return lite;
}

function getMonogram(title: string, artist: string): string {
  const source = (artist && artist !== 'Artista desconocido' ? artist : title).trim();
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase() || 'EX';
}

function createThumbElement(imageUrl: string | undefined, title: string, artist: string): HTMLElement {
  const monogram = getMonogram(title, artist);
  if (!imageUrl) {
    const fallback = document.createElement('div');
    fallback.className = 'track-thumb track-thumb-fallback';
    fallback.textContent = monogram;
    return fallback;
  }

  const img = document.createElement('img');
  img.className = 'track-thumb';
  img.src = imageUrl;
  img.alt = '';
  img.loading = 'lazy';
  img.addEventListener('error', () => {
    const fallback = document.createElement('div');
    fallback.className = 'track-thumb track-thumb-fallback';
    fallback.textContent = monogram;
    img.replaceWith(fallback);
  });
  return img;
}

function discoverToTrack(item: DiscoverTrackItem): Track {
  return {
    id: item.id,
    filePath: item.streamUrl,
    fileUrl: item.streamUrl,
    fileName: `${item.artist} - ${item.title}.mp3`,
    title: item.title,
    artist: item.artist,
    album: item.album,
    duration: item.duration,
    codec: item.source === 'audius' ? 'AUDIUS' : 'ARCHIVE',
    sourceType: item.source,
    isLive: false,
  };
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

// =========================================================================
// 1. MI MÚSICA (BIBLIOTECA LOCAL CON PORTADAS ID3, FILTROS Y FAVORITOS)
// =========================================================================
function updateFavoritesCounter(): void {
  const existingFavs = localTracks.filter((t) => favoriteIds.has(t.id)).length;
  if (btnLibFavs) btnLibFavs.textContent = `Favoritos (${existingFavs})`;
}

function populateLibraryFilters(): void {
  if (!libArtistFilter || !libAlbumFilter) return;
  const prevArtist = libArtistFilter.value;
  const prevAlbum = libAlbumFilter.value;

  const artists = Array.from(new Set(localTracks.map((t) => t.artist).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  );
  const albums = Array.from(new Set(localTracks.map((t) => t.album).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  );

  libArtistFilter.innerHTML = '<option value="">Todos los artistas</option>';
  for (const artist of artists) {
    const opt = document.createElement('option');
    opt.value = artist;
    opt.textContent = artist;
    libArtistFilter.appendChild(opt);
  }
  if (artists.includes(prevArtist)) libArtistFilter.value = prevArtist;

  libAlbumFilter.innerHTML = '<option value="">Todos los álbumes</option>';
  for (const album of albums) {
    const opt = document.createElement('option');
    opt.value = album;
    opt.textContent = album;
    libAlbumFilter.appendChild(opt);
  }
  if (albums.includes(prevAlbum)) libAlbumFilter.value = prevAlbum;
}

function getFilteredLibraryTracks(): Track[] {
  const query = (libSearchInput?.value ?? '').trim().toLowerCase();
  const artist = libArtistFilter?.value ?? '';
  const album = libAlbumFilter?.value ?? '';

  return localTracks.filter((t) => {
    if (libOnlyFavorites && !favoriteIds.has(t.id)) return false;
    if (artist && t.artist !== artist) return false;
    if (album && t.album !== album) return false;
    if (!query) return true;
    return (
      t.title.toLowerCase().includes(query) ||
      t.artist.toLowerCase().includes(query) ||
      t.album.toLowerCase().includes(query)
    );
  });
}

function renderLocalLibrary(): void {
  if (!libTracksList) return;
  updateFavoritesCounter();
  libTracksList.innerHTML = '';

  if (!musicFolder) {
    showBanner(libStatusBanner, 'Aún no has vinculado una carpeta de música local.');
    const box = document.createElement('div');
    box.className = 'lib-empty-box';
    const msg = document.createElement('p');
    msg.textContent =
      'Elige tu carpeta de música para ver portadas de álbumes, filtrar por artista y guardar favoritos.';
    const pickBtn = document.createElement('button');
    pickBtn.className = 'float-btn';
    pickBtn.textContent = 'Elegir mi carpeta de música';
    pickBtn.addEventListener('click', () => void pickLibraryFolder());
    box.append(msg, pickBtn);
    libTracksList.appendChild(box);
    return;
  }

  const filtered = getFilteredLibraryTracks();
  showBanner(
    libStatusBanner,
    `${musicFolder}  •  ${filtered.length} de ${localTracks.length} pistas`
  );

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'lyrics-message';
    empty.textContent = libOnlyFavorites
      ? 'No tienes canciones marcadas como favoritas todavía (usa el botón Fav).'
      : 'No hay canciones que coincidan con ese filtro.';
    libTracksList.appendChild(empty);
    return;
  }

  for (const track of filtered) {
    const row = document.createElement('div');
    row.className = 'source-row';

    const thumb = createThumbElement(track.coverDataUrl, track.title, track.artist);

    const meta = document.createElement('div');
    meta.className = 'source-meta';

    const name = document.createElement('span');
    name.className = 'source-name';
    name.textContent = track.title;

    const sub = document.createElement('span');
    sub.className = 'source-sub';
    sub.textContent = `${track.artist} • ${track.album} • ${formatTime(track.duration)}`;

    meta.append(name, sub);

    const actions = document.createElement('div');
    actions.className = 'float-actions';

    const isFav = favoriteIds.has(track.id);
    const favBtn = document.createElement('button');
    favBtn.className = `float-btn fav-btn${isFav ? ' active' : ''}`;
    favBtn.textContent = 'Fav';
    favBtn.title = isFav ? 'Quitar de favoritos' : 'Marcar como favorita';
    favBtn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      if (favoriteIds.has(track.id)) favoriteIds.delete(track.id);
      else favoriteIds.add(track.id);
      await window.electronAPI.saveConfig({ favoriteTrackIds: Array.from(favoriteIds) });
      renderLocalLibrary();
    });

    const queueBtn = document.createElement('button');
    queueBtn.className = 'float-btn';
    queueBtn.textContent = '+Cola';
    queueBtn.title = 'Agregar a la cola de Exum sin interrumpir';
    queueBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      window.electronAPI.sendExternalTrack(stripCoverForIpc(track), false);
      queueBtn.textContent = 'OK';
      setTimeout(() => {
        queueBtn.textContent = '+Cola';
      }, 900);
    });

    const playBtn = document.createElement('button');
    playBtn.className = 'float-btn';
    playBtn.textContent = 'Play';
    playBtn.title = 'Reproducir ahora en Exum';
    playBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      window.electronAPI.sendExternalTrack(stripCoverForIpc(track), true);
    });

    row.addEventListener('dblclick', () => {
      window.electronAPI.sendExternalTrack(stripCoverForIpc(track), true);
    });

    actions.append(favBtn, queueBtn, playBtn);
    row.append(thumb, meta, actions);
    libTracksList.appendChild(row);
  }
}

async function refreshLocalLibrary(): Promise<void> {
  if (!musicFolder) {
    localTracks = [];
    renderLocalLibrary();
    return;
  }
  showBanner(libStatusBanner, 'Escaneando carpeta y leyendo portadas ID3...');
  localTracks = await window.electronAPI.scanFolderWithCovers(musicFolder);
  populateLibraryFilters();
  renderLocalLibrary();
}

async function pickLibraryFolder(): Promise<void> {
  const picked = await window.electronAPI.selectMusicFolder();
  if (!picked) return;
  musicFolder = picked.folderPath;
  window.electronAPI.replaceMainPlaylist(picked.tracks, 'CARPETA LOCAL');
  await refreshLocalLibrary();
}

// =========================================================================
// 2. EXPLORADOR LIBRE (AUDIUS STREAMING + INTERNET ARCHIVE ÁLBUMES MP3 CC)
// =========================================================================
function setDiscoverMode(mode: 'audius' | 'archive'): void {
  discoverMode = mode;
  subAudiusBtn?.classList.toggle('active', mode === 'audius');
  subArchiveBtn?.classList.toggle('active', mode === 'archive');
  if (discoverSearchInput) {
    discoverSearchInput.placeholder =
      mode === 'audius'
        ? 'Buscar en Audius (streaming directo con EQ y Visualizador)...'
        : 'Buscar álbumes CC en Internet Archive (streaming + descarga MP3)...';
  }
  void runDiscoverSearch(discoverSearchInput?.value ?? '');
}

async function downloadDiscoverTrack(item: DiscoverTrackItem, triggerBtn: HTMLButtonElement): Promise<void> {
  const url = item.downloadUrl;
  if (!url) return;
  const originalLabel = triggerBtn.textContent;
  triggerBtn.disabled = true;
  triggerBtn.textContent = '...';
  showBanner(discoverStatusBanner, `Descargando "${item.title}" en tu carpeta local...`);

  const res = await window.electronAPI.downloadDirectAudio(url, `${item.artist} - ${item.title}`);
  triggerBtn.disabled = false;

  if (res.ok && res.track) {
    triggerBtn.textContent = 'OK';
    showBanner(discoverStatusBanner, `Guardado en Mi Música: ${res.track.fileName}`);
    const updatedCfg = await window.electronAPI.loadConfig();
    if (updatedCfg.musicFolder) {
      musicFolder = updatedCfg.musicFolder;
      void refreshLocalLibrary();
    }
  } else {
    triggerBtn.textContent = originalLabel;
    showBanner(discoverStatusBanner, `Aviso: ${res.error ?? 'No se pudo descargar.'}`);
  }
}

function renderDiscoverTrackRows(tracks: DiscoverTrackItem[], headerEl?: HTMLElement): void {
  if (!discoverResultsList) return;
  discoverResultsList.innerHTML = '';
  if (headerEl) discoverResultsList.appendChild(headerEl);

  if (tracks.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'lyrics-message';
    empty.textContent = 'No se encontraron pistas reproducibles. Prueba otra búsqueda o género.';
    discoverResultsList.appendChild(empty);
    return;
  }

  for (const item of tracks) {
    const row = document.createElement('div');
    row.className = 'source-row';

    const thumb = createThumbElement(item.artworkUrl, item.title, item.artist);

    const meta = document.createElement('div');
    meta.className = 'source-meta';

    const name = document.createElement('span');
    name.className = 'source-name';
    name.textContent = item.title;

    const sub = document.createElement('span');
    sub.className = 'source-sub';
    const parts = [item.artist, item.genre, item.duration ? formatTime(item.duration) : ''].filter(Boolean);
    sub.textContent = parts.join(' • ');

    meta.append(name, sub);

    const actions = document.createElement('div');
    actions.className = 'float-actions';

    const playBtn = document.createElement('button');
    playBtn.className = 'float-btn';
    playBtn.textContent = 'Play';
    playBtn.title = 'Reproducir en Exum (con EQ y Visualizador)';
    playBtn.addEventListener('click', () => {
      window.electronAPI.sendExternalTrack(discoverToTrack(item), true);
      showBanner(discoverStatusBanner, `Reproduciendo en Exum: ${item.artist} - ${item.title}`);
    });

    const queueBtn = document.createElement('button');
    queueBtn.className = 'float-btn';
    queueBtn.textContent = '+Cola';
    queueBtn.title = 'Agregar a la playlist de Exum';
    queueBtn.addEventListener('click', () => {
      window.electronAPI.sendExternalTrack(discoverToTrack(item), false);
      queueBtn.textContent = 'OK';
      setTimeout(() => {
        queueBtn.textContent = '+Cola';
      }, 900);
    });

    actions.append(playBtn, queueBtn);

    if (item.downloadUrl) {
      const dlBtn = document.createElement('button');
      dlBtn.className = 'float-btn';
      dlBtn.textContent = 'MP3';
      dlBtn.title = 'Descargar MP3 legalmente a tu carpeta Mi Música';
      dlBtn.addEventListener('click', () => void downloadDiscoverTrack(item, dlBtn));
      actions.appendChild(dlBtn);
    }

    row.append(thumb, meta, actions);
    discoverResultsList.appendChild(row);
  }
}

function renderArchiveAlbums(albums: ArchiveAlbumItem[]): void {
  if (!discoverResultsList) return;
  discoverResultsList.innerHTML = '';

  if (albums.length === 0) {
    discoverResultsList.innerHTML =
      '<div class="lyrics-message">No se encontraron álbumes en Internet Archive. Prueba otro género.</div>';
    return;
  }

  for (const album of albums) {
    const row = document.createElement('div');
    row.className = 'source-row';

    const thumb = createThumbElement(album.artworkUrl, album.title, album.creator);

    const meta = document.createElement('div');
    meta.className = 'source-meta';

    const name = document.createElement('span');
    name.className = 'source-name';
    name.textContent = album.title;

    const sub = document.createElement('span');
    sub.className = 'source-sub';
    sub.textContent = album.creator;

    meta.append(name, sub);

    const openBtn = document.createElement('button');
    openBtn.className = 'float-btn';
    openBtn.textContent = 'Abrir';
    openBtn.title = 'Ver pistas del álbum (Play o descargar MP3)';
    openBtn.addEventListener('click', () => void openArchiveAlbum(album));

    row.append(thumb, meta, openBtn);
    discoverResultsList.appendChild(row);
  }
}

async function openArchiveAlbum(album: ArchiveAlbumItem): Promise<void> {
  if (!discoverResultsList) return;
  showBanner(discoverStatusBanner, `Cargando pistas de "${album.title}"...`);
  discoverResultsList.innerHTML = '<div class="lyrics-message">Leyendo pistas MP3 del álbum...</div>';

  const tracks = await window.electronAPI.getArchiveAlbumTracks(
    album.identifier,
    album.title,
    album.creator
  );

  const headerBar = document.createElement('div');
  headerBar.className = 'album-header-bar';

  const backBtn = document.createElement('button');
  backBtn.className = 'float-btn';
  backBtn.textContent = '← Volver a álbumes';
  backBtn.addEventListener('click', () => {
    showBanner(discoverStatusBanner, `${lastArchiveAlbums.length} álbumes libres en Internet Archive`);
    renderArchiveAlbums(lastArchiveAlbums);
  });

  const loadAllBtn = document.createElement('button');
  loadAllBtn.className = 'float-btn';
  loadAllBtn.textContent = `Cargar álbum (${tracks.length})`;
  loadAllBtn.addEventListener('click', () => {
    if (tracks.length === 0) return;
    window.electronAPI.replaceMainPlaylist(
      tracks.map(discoverToTrack),
      `ARCHIVE: ${album.title}`
    );
    showBanner(discoverStatusBanner, `Álbum "${album.title}" cargado en Exum.`);
  });

  headerBar.append(backBtn, loadAllBtn);
  showBanner(discoverStatusBanner, `"${album.title}" — ${tracks.length} pistas MP3 abiertas`);
  renderDiscoverTrackRows(tracks, headerBar);
}

async function runDiscoverSearch(query: string): Promise<void> {
  if (!discoverResultsList) return;
  const trimmed = query.trim();

  if (discoverMode === 'audius') {
    showBanner(
      discoverStatusBanner,
      trimmed ? `Buscando "${trimmed}" en Audius...` : 'Cargando tendencias libres de Audius...'
    );
    discoverResultsList.innerHTML = '<div class="lyrics-message">Consultando Audius...</div>';
    const items = await window.electronAPI.searchAudius(trimmed);
    showBanner(
      discoverStatusBanner,
      trimmed
        ? `Audius: ${items.length} resultados para "${trimmed}"`
        : `Audius: ${items.length} tendencias listas para reproducir`
    );
    renderDiscoverTrackRows(items);
  } else {
    showBanner(
      discoverStatusBanner,
      trimmed
        ? `Buscando álbumes CC "${trimmed}" en Internet Archive...`
        : 'Cargando álbumes Netlabels populares en Internet Archive...'
    );
    discoverResultsList.innerHTML = '<div class="lyrics-message">Consultando Internet Archive...</div>';
    lastArchiveAlbums = await window.electronAPI.searchArchiveAlbums(trimmed);
    showBanner(
      discoverStatusBanner,
      `Internet Archive: ${lastArchiveAlbums.length} álbumes libres con MP3`
    );
    renderArchiveAlbums(lastArchiveAlbums);
  }
}

// =========================================================================
// 3. RADIO BROWSER (+30,000 RADIOS DEL MUNDO)
// =========================================================================
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
    playBtn.textContent = 'Play';
    playBtn.title = 'Escuchar en Exum (con EQ y Visualizador)';
    playBtn.addEventListener('click', () => {
      window.electronAPI.sendExternalTrack(
        buildStreamTrack(st.name, st.url, st.country || 'Radio Mundial', st.bitrate),
        true
      );
    });

    const favBtn = document.createElement('button');
    favBtn.className = 'float-btn';
    favBtn.textContent = '+Fav';
    favBtn.title = 'Guardar en URL/.m3u';
    favBtn.addEventListener('click', async () => {
      if (!savedStreams.some((s) => s.url === st.url)) {
        savedStreams = [
          { id: `radio-${Date.now()}`, name: st.name, url: st.url, genre: st.country || 'Radio' },
          ...savedStreams,
        ];
        await window.electronAPI.saveConfig({ savedStreams });
        renderStreams();
      }
      favBtn.textContent = 'OK';
    });

    actions.append(playBtn, favBtn);
    row.append(meta, actions);
    radioResultsList.appendChild(row);
  }
}

// =========================================================================
// 4. URLs DIRECTAS, .m3u / .pls Y GUARDAR AUDIO ABIERTO
// =========================================================================
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
    playBtn.textContent = 'Play';
    playBtn.title = 'Reproducir en Exum';
    playBtn.addEventListener('click', () => {
      window.electronAPI.sendExternalTrack(buildStreamTrack(stream.name, stream.url, stream.genre), true);
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'saved-skin-del';
    delBtn.textContent = '×';
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

// =========================================================================
// EVENTOS DE VENTANA Y CONTROLES
// =========================================================================
btnPin?.addEventListener('click', async () => {
  const pinned = await window.electronAPI.toggleAlwaysOnTop();
  btnPin.classList.toggle('active', pinned);
});
btnMin?.addEventListener('click', () => window.electronAPI.minimizeWindow());
btnClose?.addEventListener('click', () => window.electronAPI.closeWindow());

tabs.library.btn?.addEventListener('click', () => switchTab('library'));
tabs.discover.btn?.addEventListener('click', () => switchTab('discover'));
tabs.radios.btn?.addEventListener('click', () => switchTab('radios'));
tabs.urls.btn?.addEventListener('click', () => switchTab('urls'));

// Eventos Mi Música
libSearchInput?.addEventListener('input', () => renderLocalLibrary());
libArtistFilter?.addEventListener('change', () => renderLocalLibrary());
libAlbumFilter?.addEventListener('change', () => renderLocalLibrary());
btnLibFolder?.addEventListener('click', () => void pickLibraryFolder());
btnLibAll?.addEventListener('click', () => {
  libOnlyFavorites = false;
  btnLibAll.classList.add('active');
  btnLibFavs?.classList.remove('active');
  renderLocalLibrary();
});
btnLibFavs?.addEventListener('click', () => {
  libOnlyFavorites = true;
  btnLibFavs.classList.add('active');
  btnLibAll?.classList.remove('active');
  renderLocalLibrary();
});
btnLibLoadAll?.addEventListener('click', () => {
  const tracks = getFilteredLibraryTracks().map(stripCoverForIpc);
  if (tracks.length === 0) return;
  const label = libOnlyFavorites
    ? 'FAVORITOS'
    : libArtistFilter?.value || libAlbumFilter?.value || 'MI MUSICA';
  window.electronAPI.replaceMainPlaylist(tracks, label);
  showBanner(libStatusBanner, `Cargadas ${tracks.length} pistas en la playlist de Exum.`);
});

// Eventos Explorador Libre
subAudiusBtn?.addEventListener('click', () => setDiscoverMode('audius'));
subArchiveBtn?.addEventListener('click', () => setDiscoverMode('archive'));
btnDiscoverSearch?.addEventListener('click', () => void runDiscoverSearch(discoverSearchInput?.value ?? ''));
discoverSearchInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') void runDiscoverSearch(discoverSearchInput.value);
});
document.querySelectorAll<HTMLElement>('.discover-tag-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    const tag = chip.dataset.tag ?? '';
    if (discoverSearchInput) discoverSearchInput.value = tag;
    void runDiscoverSearch(tag);
  });
});

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
    window.electronAPI.sendExternalTrack(stripCoverForIpc(res.track), true);
    showBanner(urlStatusBanner, `Guardado en tu carpeta local: ${res.track.fileName}`);
    if (streamNameInput) streamNameInput.value = '';
    if (streamUrlInput) streamUrlInput.value = '';
    const updatedCfg = await window.electronAPI.loadConfig();
    if (updatedCfg.musicFolder) {
      musicFolder = updatedCfg.musicFolder;
      void refreshLocalLibrary();
    }
  } else {
    showBanner(urlStatusBanner, `Aviso: ${res.error ?? 'No se pudo descargar.'}`);
  }
});

window.electronAPI.onPaletteUpdated((palette: WszPleditColors) => applyPaletteToDocument(palette));

async function init(): Promise<void> {
  const [sync, config] = await Promise.all([
    window.electronAPI.getSyncState(),
    window.electronAPI.loadConfig(),
  ]);

  applyPaletteToDocument(sync.palette);
  musicFolder = config.musicFolder;
  favoriteIds = new Set(config.favoriteTrackIds ?? []);
  savedStreams = config.savedStreams;

  renderStreams();
  await refreshLocalLibrary();
}

void init();
