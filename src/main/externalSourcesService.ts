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
import { AUDIO_EXTENSIONS, buildTrackFromFile } from './libraryScanner';

const RADIO_BROWSER_MIRRORS = [
  'https://de1.api.radio-browser.info',
  'https://at1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
];

const AUDIUS_API = 'https://api.audius.co/v1';
const API_TIMEOUT_MS = 10_000;
const DOWNLOAD_TIMEOUT_MS = 45_000;
const MAX_PLAYLIST_BYTES = 512 * 1024;
const MAX_AUDIO_DOWNLOAD_BYTES = 150 * 1024 * 1024;
const WINDOWS_RESERVED_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

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

function isPrivateOrLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h === '::1' || h === '0.0.0.0' || h.endsWith('.local')) return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  return false;
}

function parseSafeRemoteUrl(rawUrl: string, blockPrivate: boolean): URL | null {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (blockPrivate && isPrivateOrLoopbackHost(parsed.hostname)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function sanitizeHttpsUrl(rawUrl?: string): string | undefined {
  if (!rawUrl) return undefined;
  try {
    const u = new URL(rawUrl);
    return u.protocol === 'https:' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

async function readResponseTextBounded(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error('Respuesta demasiado grande.');
      }
      chunks.push(Buffer.from(value));
    }
  }
  return Buffer.concat(chunks).toString('utf-8');
}

function escapeLuceneQuery(raw: string): string {
  return raw.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, ' ').replace(/\s+/g, ' ').trim();
}

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
    const res = await fetch(endpoint, {
      headers: { 'User-Agent': 'ExumPlayer/1.1' },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
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
          artworkUrl: sanitizeHttpsUrl(t.artwork?.['150x150']),
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
  const escaped = escapeLuceneQuery(query);
  const searchPart = escaped
    ? `collection:(netlabels OR opensource_audio) AND mediatype:audio AND format:"VBR MP3" AND (${escaped})`
    : `collection:(netlabels OR opensource_audio) AND mediatype:audio AND format:"VBR MP3"`;

  try {
    const url =
      `https://archive.org/advancedsearch.php?q=${encodeURIComponent(searchPart)}` +
      `&fl[]=identifier&fl[]=title&fl[]=creator&sort[]=downloads+desc&rows=20&output=json`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'ExumPlayer/1.1' },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
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
      {
        headers: { 'User-Agent': 'ExumPlayer/1.1' },
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      }
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
        fetch(endpoint, {
          headers: { 'User-Agent': 'ExumPlayer/1.1' },
          signal: AbortSignal.timeout(API_TIMEOUT_MS),
        }),
      ];
      if (trimmed) {
        requests.push(
          fetch(
            `${base}/json/stations/bytag/${encodeURIComponent(trimmed.toLowerCase())}?hidebroken=true&order=clickcount&reverse=true&limit=20`,
            {
              headers: { 'User-Agent': 'ExumPlayer/1.1' },
              signal: AbortSignal.timeout(API_TIMEOUT_MS),
            }
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
        if (!parseSafeRemoteUrl(streamUrl, true)) continue;
        if (seenUrls.has(streamUrl)) continue;
        seenUrls.add(streamUrl);

        stations.push({
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

// ---------- 4. RESOLVER .m3u / .pls Y DESCARGA SEGURA EN STREAMING ----------
export async function resolveStreamUrl(rawUrl: string): Promise<{ url: string; title?: string }> {
  const parsed = parseSafeRemoteUrl(rawUrl, false);
  if (!parsed) return { url: '' };

  const cleanUrl = parsed.toString();
  const lowerPath = parsed.pathname.toLowerCase();
  const isPlaylistUrl =
    lowerPath.endsWith('.m3u') || lowerPath.endsWith('.m3u8') || lowerPath.endsWith('.pls');

  if (!isPlaylistUrl) return { url: cleanUrl };

  try {
    const res = await fetch(cleanUrl, {
      headers: { 'User-Agent': 'ExumPlayer/1.1' },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (!res.ok) return { url: cleanUrl };
    const text = await readResponseTextBounded(res, MAX_PLAYLIST_BYTES);

    if (lowerPath.endsWith('.pls')) {
      const fileMatch = text.match(/^File1\s*=\s*(.+)$/im);
      const titleMatch = text.match(/^Title1\s*=\s*(.+)$/im);
      const candidate = fileMatch?.[1]?.trim();
      // Validamos estrictamente esquema http/https para evitar bypass hacia file:// o data:
      if (candidate && parseSafeRemoteUrl(candidate, false)) {
        return { url: candidate, title: titleMatch?.[1]?.trim() };
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
        if (parseSafeRemoteUrl(line, false)) {
          return { url: line, title: extTitle };
        }
      }
    }
  } catch {
    // Fallback al enlace original validado
  }

  return { url: cleanUrl };
}

function sanitizeDownloadStem(raw: string): string {
  const cleaned = raw
    .replace(/[\x00-\x1f<>:"/\\|?*]+/g, '_')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 120);
  if (!cleaned || WINDOWS_RESERVED_RE.test(cleaned)) {
    return `audio-${Date.now()}`;
  }
  return cleaned;
}

async function resolveUniqueDestPath(folder: string, stem: string, ext: string): Promise<string> {
  let candidate = path.join(folder, `${stem}${ext}`);
  for (let n = 2; n < 1000; n++) {
    try {
      await fs.promises.access(candidate);
      candidate = path.join(folder, `${stem}-${n}${ext}`);
    } catch {
      return candidate;
    }
  }
  return path.join(folder, `${stem}-${Date.now()}${ext}`);
}

export async function downloadDirectAudioToLibrary(
  rawUrl: string,
  customName: string | undefined,
  owner: BrowserWindow | null
): Promise<DirectDownloadResult> {
  if (!parseSafeRemoteUrl(rawUrl, true)) {
    return { ok: false, error: 'Ingresa una URL pública válida (http:// o https://).' };
  }

  let tmpPath: string | null = null;
  try {
    const resolved = await resolveStreamUrl(rawUrl);
    const resolvedParsed = parseSafeRemoteUrl(resolved.url, true);
    if (!resolvedParsed) {
      return { ok: false, error: 'La URL resuelta no es una dirección pública HTTP/HTTPS válida.' };
    }

    const res = await fetch(resolvedParsed.toString(), {
      headers: { 'User-Agent': 'ExumPlayer/1.1' },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!res.ok || !res.body) {
      return { ok: false, error: `El servidor respondió HTTP ${res.status}.` };
    }

    // Validamos destino final tras posibles redirecciones HTTP
    if (res.url && !parseSafeRemoteUrl(res.url, true)) {
      return { ok: false, error: 'Redirección bloqueada por seguridad.' };
    }

    // Rechazamos radios continuas Icecast/Shoutcast para evitar descargas infinitas / OOM
    if (res.headers.has('icy-metaint') || res.headers.has('icy-name') || res.headers.has('icy-br')) {
      await res.body.cancel().catch(() => undefined);
      return {
        ok: false,
        error: 'Es una radio en vivo (stream continuo), no un archivo descargable.',
      };
    }

    const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const urlPath = resolvedParsed.pathname;
    const urlExt = path.extname(urlPath).toLowerCase();

    const ext = AUDIO_EXTENSIONS.has(urlExt) ? urlExt : MIME_TO_EXT[contentType];
    if (!ext) {
      await res.body.cancel().catch(() => undefined);
      return {
        ok: false,
        error: 'La URL no apunta a un archivo de audio directo (.mp3, .wav, .flac, .ogg, .m4a).',
      };
    }

    const contentLength = Number(res.headers.get('content-length') || 0);
    if (contentLength > MAX_AUDIO_DOWNLOAD_BYTES) {
      await res.body.cancel().catch(() => undefined);
      return { ok: false, error: 'El archivo excede el límite de seguridad de 150 MB.' };
    }

    const config = await loadConfig();
    let targetFolder = config.musicFolder;

    if (!targetFolder) {
      if (!owner || owner.isDestroyed()) {
        await res.body.cancel().catch(() => undefined);
        return { ok: false, error: 'Elige primero una carpeta de música.' };
      }
      const pick = await dialog.showOpenDialog(owner, {
        title: 'Elegir carpeta para guardar el audio',
        properties: ['openDirectory'],
      });
      if (pick.canceled || pick.filePaths.length === 0) {
        await res.body.cancel().catch(() => undefined);
        return { ok: false, error: 'Descarga cancelada.' };
      }
      targetFolder = pick.filePaths[0];
      await saveConfig({ musicFolder: targetFolder }, true);
    }

    let decodedUrlStem = '';
    try {
      decodedUrlStem = decodeURIComponent(path.parse(urlPath).name);
    } catch {
      decodedUrlStem = path.parse(urlPath).name;
    }

    const baseNameRaw = customName?.trim() || resolved.title || decodedUrlStem || `audio-${Date.now()}`;
    const safeStem = sanitizeDownloadStem(baseNameRaw);
    const destPath = await resolveUniqueDestPath(targetFolder, safeStem, ext);
    tmpPath = path.join(targetFolder, `.exum-dl-${process.pid}-${Date.now()}.tmp`);

    // Descarga en streaming directo a disco con tope real de bytes (cero OOM en RAM)
    const fileStream = fs.createWriteStream(tmpPath);
    const reader = res.body.getReader();
    let writtenBytes = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          writtenBytes += value.byteLength;
          if (writtenBytes > MAX_AUDIO_DOWNLOAD_BYTES) {
            await reader.cancel();
            fileStream.destroy();
            return { ok: false, error: 'La descarga superó el límite de seguridad de 150 MB.' };
          }
          if (!fileStream.write(Buffer.from(value))) {
            await new Promise<void>((resolve, reject) => {
              fileStream.once('drain', resolve);
              fileStream.once('error', reject);
            });
          }
        }
      }
      await new Promise<void>((resolve, reject) => {
        fileStream.end(() => resolve());
        fileStream.once('error', reject);
      });
    } catch (streamErr) {
      fileStream.destroy();
      throw streamErr;
    }

    await fs.promises.rename(tmpPath, destPath);
    tmpPath = null;

    const track = await buildTrackFromFile(destPath, true);
    return { ok: true, track };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'No se pudo descargar el archivo de audio.',
    };
  } finally {
    if (tmpPath) {
      await fs.promises.unlink(tmpPath).catch(() => undefined);
    }
  }
}
