import { BrowserWindow, dialog } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import {
  ArchiveAlbumItem,
  DirectDownloadResult,
  DiscoverTrackItem,
  RadioStationItem,
} from '../shared/types';
import { loadConfig, saveConfig } from './configStore';
import { buildTrackFromFile } from './libraryScanner';

const RADIO_BROWSER_MIRRORS = [
  'https://de1.api.radio-browser.info',
  'https://at1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
];

const AUDIUS_API = 'https://api.audius.co/v1';
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

// ---------- 1. AUDIUS (MÚSICA LIBRE ABIERTA, CERO CUENTAS, 206 MP3 + CORS *) ----------
interface RawAudiusTrack {
  id?: string;
  title?: string;
  duration?: number;
  genre?: string;
  is_streamable?: boolean;
  is_stream_gated?: boolean;
  is_downloadable?: boolean;
  artwork?: { '150x150'?: string };
  user?: { name?: string };
}

export async function searchAudiusTracks(query: string): Promise<DiscoverTrackItem[]> {
  const trimmed = query.trim();
  const endpoint = trimmed
    ? `${AUDIUS_API}/tracks/search?query=${encodeURIComponent(trimmed)}&app_name=ExumPlayer`
    : `${AUDIUS_API}/tracks/trending?app_name=ExumPlayer`;

  try {
    const res = await fetch(endpoint, { headers: { 'User-Agent': 'ExumPlayer/1.1' } });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: RawAudiusTrack[] };
    const list = Array.isArray(json.data) ? json.data : [];

    return list
      .filter((t) => Boolean(t.id && t.title && t.is_streamable !== false && !t.is_stream_gated))
      .slice(0, 25)
      .map((t) => {
        const streamUrl = `${AUDIUS_API}/tracks/${encodeURIComponent(t.id!)}/stream?app_name=ExumPlayer`;
        return {
          id: `audius:${t.id}`,
          source: 'audius' as const,
          title: t.title!.trim(),
          artist: t.user?.name?.trim() || 'Artista Audius',
          album: t.genre || 'Audius',
          duration: Math.round(t.duration || 0),
          genre: t.genre || 'Libre',
          streamUrl,
          downloadUrl: t.is_downloadable ? streamUrl : undefined,
          artworkUrl: t.artwork?.['150x150'],
        };
      });
  } catch {
    return [];
  }
}

// ---------- 2. INTERNET ARCHIVE (NETLABELS & CREATIVE COMMONS — STREAM + DESCARGA MP3) ----------
interface RawArchiveDoc {
  identifier?: string;
  title?: string;
  creator?: string | string[];
}

export async function searchArchiveAlbums(query: string): Promise<ArchiveAlbumItem[]> {
  const trimmed = query.trim();
  const searchPart = trimmed
    ? `collection:(netlabels OR opensource_audio) AND mediatype:audio AND format:"VBR MP3" AND (${trimmed})`
    : `collection:(netlabels OR opensource_audio) AND mediatype:audio AND format:"VBR MP3"`;

  try {
    const url =
      `https://archive.org/advancedsearch.php?q=${encodeURIComponent(searchPart)}` +
      `&fl[]=identifier&fl[]=title&fl[]=creator&sort[]=downloads+desc&rows=20&output=json`;
    const res = await fetch(url, { headers: { 'User-Agent': 'ExumPlayer/1.1' } });
    if (!res.ok) return [];

    const json = (await res.json()) as { response?: { docs?: RawArchiveDoc[] } };
    const docs = json.response?.docs ?? [];

    return docs
      .filter((d) => Boolean(d.identifier && d.title))
      .map((d) => ({
        identifier: d.identifier!,
        title: d.title!.trim(),
        creator: Array.isArray(d.creator) ? d.creator.join(', ') : d.creator || 'Internet Archive',
        artworkUrl: `https://archive.org/services/img/${encodeURIComponent(d.identifier!)}`,
      }));
  } catch {
    return [];
  }
}

interface RawArchiveFile {
  name?: string;
  title?: string;
  artist?: string;
  length?: string;
}

function parseArchiveDuration(raw?: string): number {
  if (!raw) return 0;
  if (raw.includes(':')) {
    const parts = raw.split(':').map(Number);
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  const num = Number(raw);
  return Number.isFinite(num) ? Math.round(num) : 0;
}

export async function getArchiveAlbumTracks(
  identifier: string,
  albumTitle: string,
  creator: string
): Promise<DiscoverTrackItem[]> {
  try {
    const res = await fetch(
      `https://archive.org/metadata/${encodeURIComponent(identifier)}/files`,
      { headers: { 'User-Agent': 'ExumPlayer/1.1' } }
    );
    if (!res.ok) return [];

    const json = (await res.json()) as { result?: RawArchiveFile[] };
    const files = (json.result ?? []).filter(
      (f) => f.name && f.name.toLowerCase().endsWith('.mp3') && !f.name.includes('_64kb')
    );

    const artworkUrl = `https://archive.org/services/img/${encodeURIComponent(identifier)}`;

    return files.slice(0, 40).map((f) => {
      const encodedName = f.name!.split('/').map(encodeURIComponent).join('/');
      const url = `https://archive.org/download/${encodeURIComponent(identifier)}/${encodedName}`;
      const cleanName = f.title?.trim() || path.parse(f.name!).name.replace(/[_-]+/g, ' ');
      return {
        id: `archive:${identifier}:${f.name}`,
        source: 'archive' as const,
        title: cleanName,
        artist: f.artist?.trim() || creator || 'Internet Archive',
        album: albumTitle,
        duration: parseArchiveDuration(f.length),
        genre: 'Archive CC',
        streamUrl: url,
        downloadUrl: url,
        artworkUrl,
      };
    });
  } catch {
    return [];
  }
}

// ---------- 3. RADIO BROWSER (+30,000 EMISORAS DEL MUNDO) ----------
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

export async function searchWorldRadios(query: string): Promise<RadioStationItem[]> {
  const trimmed = query.trim();

  for (const base of RADIO_BROWSER_MIRRORS) {
    try {
      const endpoint = trimmed
        ? `${base}/json/stations/search?name=${encodeURIComponent(trimmed)}&hidebroken=true&order=clickcount&reverse=true&limit=24`
        : `${base}/json/stations/topclick/24?hidebroken=true`;

      const requests: Promise<Response>[] = [
        fetch(endpoint, { headers: { 'User-Agent': 'ExumPlayer/1.1' } }),
      ];
      if (trimmed) {
        requests.push(
          fetch(
            `${base}/json/stations/bytag/${encodeURIComponent(trimmed.toLowerCase())}?hidebroken=true&order=clickcount&reverse=true&limit=20`,
            { headers: { 'User-Agent': 'ExumPlayer/1.1' } }
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
      // Probamos el siguiente espejo
    }
  }

  return [];
}

// ---------- 4. RESOLVER .m3u / .pls Y DESCARGA DE AUDIO DIRECTO ABIERTO ----------
export async function resolveStreamUrl(rawUrl: string): Promise<{ url: string; title?: string }> {
  const cleanUrl = rawUrl.trim();
  const lower = cleanUrl.toLowerCase().split('?')[0];
  const isPlaylistUrl =
    lower.endsWith('.m3u') || lower.endsWith('.m3u8') || lower.endsWith('.pls');

  if (!isPlaylistUrl) return { url: cleanUrl };

  try {
    const res = await fetch(cleanUrl, { headers: { 'User-Agent': 'ExumPlayer/1.1' } });
    if (!res.ok) return { url: cleanUrl };
    const text = await res.text();

    if (lower.endsWith('.pls')) {
      const fileMatch = text.match(/^File1\s*=\s*(.+)$/im);
      const titleMatch = text.match(/^Title1\s*=\s*(.+)$/im);
      if (fileMatch?.[1]) {
        return { url: fileMatch[1].trim(), title: titleMatch?.[1]?.trim() };
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
    // Fallback
  }

  return { url: cleanUrl };
}

function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*]+/g, '_').trim();
}

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
    const res = await fetch(resolved.url, { headers: { 'User-Agent': 'ExumPlayer/1.1' } });
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

    const contentLength = Number(res.headers.get('content-length') || 0);
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

    const track = await buildTrackFromFile(destPath, true);
    return { ok: true, track };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'No se pudo descargar el archivo de audio.',
    };
  }
}
