import { LyricLine, LyricsResult } from '../shared/types';

interface LrcLibRecord {
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
}

const lyricsCache = new Map<string, LyricsResult>();

/**
 * Parsea formato LRC estándar: "[01:23.45] Texto de la línea"
 */
function parseLrc(lrcText: string): LyricLine[] {
  const lines: LyricLine[] = [];
  const regex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]\s*(.*)/;

  for (const rawLine of lrcText.split(/\r?\n/)) {
    const match = rawLine.match(regex);
    if (!match) continue;

    const mins = Number(match[1]);
    const secs = Number(match[2]);
    const msRaw = match[3] ?? '0';
    const ms = Number(msRaw.padEnd(3, '0')) / 1000;
    const text = match[4].trim();

    if (text.length > 0) {
      lines.push({ time: mins * 60 + secs + ms, text });
    }
  }

  return lines.sort((a, b) => a.time - b.time);
}

/**
 * Si el MP3 no tiene tag de artista pero su nombre es "Artista - Canción",
 * separamos ambos para mejorar la búsqueda en LRCLIB.
 */
function normalizeQuery(title: string, artist: string): { cleanTitle: string; cleanArtist: string } {
  const cleanedTitle = title.replace(/\s*\(.*?\)\s*|\s*\[.*?\]\s*/g, ' ').trim();
  const isUnknownArtist = !artist || artist.toLowerCase() === 'artista desconocido';

  if (isUnknownArtist && cleanedTitle.includes(' - ')) {
    const [maybeArtist, ...rest] = cleanedTitle.split(' - ');
    return {
      cleanArtist: maybeArtist.trim(),
      cleanTitle: rest.join(' - ').trim(),
    };
  }

  return {
    cleanTitle: cleanedTitle || title,
    cleanArtist: isUnknownArtist ? '' : artist.trim(),
  };
}

function buildResult(record: LrcLibRecord | null): LyricsResult {
  if (!record) {
    return { found: false, synced: false, lines: [], plainText: '' };
  }

  if (record.syncedLyrics) {
    const lines = parseLrc(record.syncedLyrics);
    if (lines.length > 0) {
      return {
        found: true,
        synced: true,
        lines,
        plainText: record.plainLyrics ?? lines.map((l) => l.text).join('\n'),
      };
    }
  }

  if (record.plainLyrics) {
    return {
      found: true,
      synced: false,
      lines: [],
      plainText: record.plainLyrics,
    };
  }

  return { found: false, synced: false, lines: [], plainText: '' };
}

/**
 * Consulta letras sincronizadas en LRCLIB (API pública gratuita) desde el Main Process.
 * Hacerlo aquí mantiene estricta la seguridad CSP del Renderer y evita problemas de CORS.
 */
export async function fetchLyrics(params: {
  title: string;
  artist: string;
  album: string;
  duration: number;
}): Promise<LyricsResult> {
  const { cleanTitle, cleanArtist } = normalizeQuery(params.title, params.artist);
  const cacheKey = `${cleanArtist.toLowerCase()}::${cleanTitle.toLowerCase()}`;

  const cached = lyricsCache.get(cacheKey);
  if (cached) return cached;

  const headers = { 'User-Agent': 'ExumPlayer/0.4 (https://github.com/Malteadah77/Exum)' };

  try {
    // 1. Intento exacto si tenemos artista y título
    if (cleanArtist && cleanTitle) {
      const url = new URL('https://lrclib.net/api/get');
      url.searchParams.set('track_name', cleanTitle);
      url.searchParams.set('artist_name', cleanArtist);
      if (params.album) url.searchParams.set('album_name', params.album);
      if (params.duration > 0) url.searchParams.set('duration', String(Math.round(params.duration)));

      const res = await fetch(url.toString(), { headers });
      if (res.ok) {
        const data = (await res.json()) as LrcLibRecord;
        const result = buildResult(data);
        if (result.found) {
          lyricsCache.set(cacheKey, result);
          return result;
        }
      }
    }

    // 2. Fallback: búsqueda general por texto
    const queryText = cleanArtist ? `${cleanArtist} ${cleanTitle}` : cleanTitle;
    const searchUrl = new URL('https://lrclib.net/api/search');
    searchUrl.searchParams.set('q', queryText);

    const searchRes = await fetch(searchUrl.toString(), { headers });
    if (searchRes.ok) {
      const list = (await searchRes.json()) as LrcLibRecord[];
      // Preferimos el primer resultado que tenga letra sincronizada
      const best = list.find((item) => Boolean(item.syncedLyrics)) ?? list[0] ?? null;
      const result = buildResult(best);
      lyricsCache.set(cacheKey, result);
      return result;
    }
  } catch {
    // Sin conexión o error temporal de red
  }

  return { found: false, synced: false, lines: [], plainText: '' };
}
