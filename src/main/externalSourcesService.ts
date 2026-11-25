import { BrowserWindow, dialog } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import {
  DirectDownloadResult,
  RadioStationItem,
  SpotifyMatchResult,
  SpotifyTrackItem,
  Track,
} from '../shared/types';
import { loadConfig, saveConfig } from './configStore';
import { buildTrackFromFile, scanFolder } from './libraryScanner';
import { saveNamedPlaylist } from './playlistStore';
import { getSpotifyPlaylistDetails, getSpotifyState } from './spotifyService';

const RADIO_BROWSER_MIRRORS = [
  'https://de1.api.radio-browser.info',
  'https://at1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
];

const DIRECT_AUDIO_EXTS = new Set(['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac']);
const MIME_TO_EXT: Record<string, string> = {
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/flac': '.flac',
  'audio/ogg': '.ogg',
  'audio/mp4': '.m4a',
  'audio/aac': '.aac',
};

interface RawRadioStation {
  stationuuid?: string;
  name?: string;
  url_resolved?: string;
  url?: string;
  country?: string;
  tags?: string;
  bitrate?: number;
  codec?: string;
}

/**
 * Busca entre +30,000 radios abiertas en la API comunitaria gratuita Radio Browser.
 */
export async function searchWorldRadios(query: string): Promise<RadioStationItem[]> {
  const trimmed = query.trim();

  for (const base of RADIO_BROWSER_MIRRORS) {
    try {
      const endpoint = trimmed
        ? `${base}/json/stations/search?name=${encodeURIComponent(trimmed)}&hidebroken=true&order=clickcount&reverse=true&limit=24`
        : `${base}/json/stations/topclick/24?hidebroken=true`;

      // Si el usuario buscó un género/tag (ej. "lofi", "synthwave") y por nombre hay pocos,
      // hacemos búsqueda por tag en paralelo y combinamos sin duplicados.
      const requests: Promise<Response>[] = [
        fetch(endpoint, { headers: { 'User-Agent': 'ExumPlayer/0.8' } }),
      ];
      if (trimmed) {
        requests.push(
          fetch(
            `${base}/json/stations/bytag/${encodeURIComponent(trimmed.toLowerCase())}?hidebroken=true&order=clickcount&reverse=true&limit=20`,
            { headers: { 'User-Agent': 'ExumPlayer/0.8' } }
          )
        );
      }

      const responses = await Promise.all(requests);
      if (!responses[0].ok) continue;

      const combined: RawRadioStation[] = [];
      for (const res of responses) {
        if (res.ok) {
          const data = (await res.json()) as RawRadioStation[];
          if (Array.isArray(data)) combined.push(...data);
        }
      }

      const seenUrls = new Set<string>();
      const stations: RadioStationItem[] = [];

      for (const st of combined) {
        const streamUrl = (st.url_resolved || st.url || '').trim();
        if (!streamUrl.startsWith('http://') && !streamUrl.startsWith('https://')) continue;
        if (seenUrls.has(streamUrl)) continue;
        seenUrls.add(streamUrl);

        stations.push({
          id: st.stationuuid || streamUrl,
          name: (st.name || 'Radio sin nombre').trim(),
          url: streamUrl,
          country: st.country || '',
          tags: st.tags || '',
          bitrate: st.bitrate || 0,
          codec: st.codec || 'STREAM',
        });

        if (stations.length >= 28) break;
      }

      return stations;
    } catch {
      // Probamos el siguiente espejo de Radio Browser
    }
  }

  return [];
}

/**
 * Resuelve URLs de playlist de radio (.m3u / .m3u8 / .pls) a su URL directa de audio.
 */
export async function resolveStreamUrl(rawUrl: string): Promise<{ url: string; title?: string }> {
  const cleanUrl = rawUrl.trim();
  const lower = cleanUrl.toLowerCase().split('?')[0];
  const isPlaylistUrl =
    lower.endsWith('.m3u') || lower.endsWith('.m3u8') || lower.endsWith('.pls');

  if (!isPlaylistUrl) {
    return { url: cleanUrl };
  }

  try {
    const res = await fetch(cleanUrl, { headers: { 'User-Agent': 'ExumPlayer/0.8' } });
    if (!res.ok) return { url: cleanUrl };
    const text = await res.text();

    if (lower.endsWith('.pls')) {
      const fileMatch = text.match(/^File1\s*=\s*(.+)$/im);
      const titleMatch = text.match(/^Title1\s*=\s*(.+)$/im);
      if (fileMatch?.[1]) {
        return {
          url: fileMatch[1].trim(),
          title: titleMatch?.[1]?.trim(),
        };
      }
    } else {
      let extTitle: string | undefined;
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        if (line.startsWith('#EXTINF:')) {
          const comma = line.indexOf(',');
          if (comma !== -1) extTitle = line.slice(comma + 1).trim();
          continue;
        }
        if (line.startsWith('http://') || line.startsWith('https://')) {
          return { url: line, title: extTitle };
        }
      }
    }
  } catch {
    // Fallback a la URL original
  }

  return { url: cleanUrl };
}

function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*]+/g, '_').trim();
}

/**
 * Descarga un archivo de audio directo abierto (URL .mp3/.wav/.flac/.ogg/.m4a)
 * en la carpeta local de música configurada del usuario.
 */
export async function downloadDirectAudioToLibrary(
  rawUrl: string,
  customName: string | undefined,
  owner: BrowserWindow | null
): Promise<DirectDownloadResult> {
  const cleanUrl = rawUrl.trim();
  if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
    return { ok: false, error: 'Ingresa una URL válida (http:// o https://).' };
  }

  try {
    const resolved = await resolveStreamUrl(cleanUrl);
    const res = await fetch(resolved.url, { headers: { 'User-Agent': 'ExumPlayer/0.8' } });
    if (!res.ok) {
      return { ok: false, error: `El servidor respondió HTTP ${res.status}.` };
    }

    const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const urlPath = new URL(resolved.url).pathname;
    const urlExt = path.extname(urlPath).toLowerCase();

    const ext = DIRECT_AUDIO_EXTS.has(urlExt) ? urlExt : MIME_TO_EXT[contentType];
    if (!ext) {
      return {
        ok: false,
        error: 'La URL no apunta a un archivo de audio directo (.mp3, .wav, .flac, .ogg, .m4a).',
      };
    }

    // Evitamos descargar streams infinitos (radios sin Content-Length o mayores a 150 MB)
    const contentLength = Number(res.headers.get('content-length') || 0);
    if (!contentLength) {
      return {
        ok: false,
        error: 'Esta URL parece ser una radio en vivo continua (usa ▶ Escuchar en vez de Guardar).',
      };
    }
    if (contentLength > 150 * 1024 * 1024) {
      return { ok: false, error: 'El archivo excede el límite de seguridad de 150 MB.' };
    }

    const config = await loadConfig();
    let targetFolder = config.musicFolder;

    if (!targetFolder) {
      if (!owner) return { ok: false, error: 'Elige primero una carpeta de música.' };
      const pick = await dialog.showOpenDialog(owner, {
        title: 'Elegir carpeta para guardar el audio',
        properties: ['openDirectory'],
      });
      if (pick.canceled || pick.filePaths.length === 0) {
        return { ok: false, error: 'Descarga cancelada.' };
      }
      targetFolder = pick.filePaths[0];
      await saveConfig({ musicFolder: targetFolder });
    }

    const baseNameRaw =
      customName?.trim() ||
      resolved.title ||
      decodeURIComponent(path.parse(urlPath).name || `audio-${Date.now()}`);
    const safeFileName = `${sanitizeFileName(baseNameRaw)}${ext}`;
    const destPath = path.join(targetFolder, safeFileName);

    const buffer = Buffer.from(await res.arrayBuffer());
    await fs.promises.writeFile(destPath, buffer);

    const track = await buildTrackFromFile(destPath);
    return { ok: true, track };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'No se pudo descargar el archivo de audio.',
    };
  }
}

function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quitar tildes
    .replace(/\s*[\(\[].*?[\)\]]\s*/g, ' ') // quitar (feat...), [remastered], etc.
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSpotifyPlaylistId(input: string): string | null {
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/spotify\.com\/playlist\/([a-zA-Z0-9]+)/);
  if (urlMatch?.[1]) return urlMatch[1];
  const uriMatch = trimmed.match(/spotify:playlist:([a-zA-Z0-9]+)/);
  if (uriMatch?.[1]) return uriMatch[1];
  if (/^[a-zA-Z0-9]{15,30}$/.test(trimmed)) return trimmed;
  return null;
}

/**
 * Lee una playlist de Spotify por link o ID y la empareja con los MP3 locales del usuario.
 * Guarda automáticamente las coincidencias como una nueva playlist en Exum.
 */
export async function matchSpotifyPlaylistToLocal(urlOrId: string): Promise<SpotifyMatchResult> {
  const spState = getSpotifyState();
  if (!spState.connected) {
    return {
      playlistName: '',
      matchedTracks: [],
      missingTracks: [],
      error: 'Primero vincula tu cuenta de Spotify arriba con tu Client ID.',
    };
  }

  const playlistId = extractSpotifyPlaylistId(urlOrId);
  if (!playlistId) {
    return {
      playlistName: '',
      matchedTracks: [],
      missingTracks: [],
      error: 'Link de playlist de Spotify inválido (ej: https://open.spotify.com/playlist/...).',
    };
  }

  const details = await getSpotifyPlaylistDetails(playlistId);
  if (!details) {
    return {
      playlistName: '',
      matchedTracks: [],
      missingTracks: [],
      error: 'No se pudo leer esa playlist desde Spotify.',
    };
  }

  const config = await loadConfig();
  const localTracks = config.musicFolder ? await scanFolder(config.musicFolder) : [];

  const indexedLocal = localTracks.map((t) => ({
    track: t,
    normTitle: normalizeForMatch(t.title),
    normArtist: normalizeForMatch(t.artist),
    normFile: normalizeForMatch(path.parse(t.fileName).name),
  }));

  const matchedTracks: Track[] = [];
  const missingTracks: SpotifyTrackItem[] = [];
  const usedLocalIds = new Set<string>();

  for (const spTrack of details.tracks) {
    const spTitle = normalizeForMatch(spTrack.title);
    const spFirstArtist = normalizeForMatch(spTrack.artist.split(',')[0] || '');

    const hit = indexedLocal.find((loc) => {
      if (usedLocalIds.has(loc.track.id)) return false;
      const titleMatch =
        (spTitle.length >= 3 && (loc.normTitle.includes(spTitle) || spTitle.includes(loc.normTitle))) ||
        (spTitle.length >= 4 && loc.normFile.includes(spTitle));
      if (!titleMatch) return false;
      if (!spFirstArtist || loc.normArtist === 'artista desconocido') return true;
      return (
        loc.normArtist.includes(spFirstArtist) ||
        spFirstArtist.includes(loc.normArtist) ||
        loc.normFile.includes(spFirstArtist)
      );
    });

    if (hit) {
      usedLocalIds.add(hit.track.id);
      matchedTracks.push(hit.track);
    } else {
      missingTracks.push(spTrack);
    }
  }

  if (matchedTracks.length > 0) {
    await saveNamedPlaylist(`Spotify: ${details.name}`, matchedTracks);
  }

  return {
    playlistName: details.name,
    matchedTracks,
    missingTracks,
  };
}
