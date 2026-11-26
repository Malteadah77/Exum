import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { Track } from '../shared/types';

export const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac']);
const ALLOWED_COVER_MIMES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']);
const MAX_COVER_BYTES = 512 * 1024;
const MAX_SCAN_DEPTH = 12;
const MAX_SCAN_FILES = 5000;

type MusicMetadataModule = typeof import('music-metadata');
let metadataModulePromise: Promise<MusicMetadataModule> | null = null;

function getMusicMetadata(): Promise<MusicMetadataModule> {
  if (!metadataModulePromise) {
    metadataModulePromise = (
      Function('return import("music-metadata")')() as Promise<MusicMetadataModule>
    ).catch((err) => {
      metadataModulePromise = null;
      throw err;
    });
  }
  return metadataModulePromise;
}

export function isUncPath(filePath: string): boolean {
  return /^(\\\\|\/\/)/.test(filePath.trim());
}

export function isAudioFile(filePath: string): boolean {
  return AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/**
 * Lee metadatos ID3 (y opcionalmente carátula del álbum) de un archivo de audio local.
 */
export async function buildTrackFromFile(filePath: string, includeCover = false): Promise<Track> {
  const fileName = path.basename(filePath);
  const fallbackTitle = path.parse(filePath).name;
  const fallbackCodec = path.extname(filePath).slice(1).toUpperCase();

  try {
    const mm = await getMusicMetadata();
    const metadata = await mm.parseFile(filePath, {
      duration: true,
      skipCovers: !includeCover,
    });

    let coverDataUrl: string | undefined;
    if (includeCover && metadata.common.picture && metadata.common.picture.length > 0) {
      const pic = metadata.common.picture[0];
      const rawMime = (pic.format || 'image/jpeg').toLowerCase().split(';')[0].trim();
      const mime = rawMime === 'image/jpg' ? 'image/jpeg' : rawMime;
      if (pic.data && pic.data.length <= MAX_COVER_BYTES && ALLOWED_COVER_MIMES.has(mime)) {
        coverDataUrl = `data:${mime};base64,${Buffer.from(pic.data).toString('base64')}`;
      }
    }

    return {
      id: filePath,
      filePath,
      fileUrl: pathToFileURL(filePath).href,
      fileName,
      title: metadata.common.title?.trim() || fallbackTitle,
      artist: metadata.common.artist?.trim() || 'Artista desconocido',
      album: metadata.common.album?.trim() || '',
      duration: metadata.format.duration ?? 0,
      bitrate: metadata.format.bitrate ? Math.round(metadata.format.bitrate / 1000) : undefined,
      sampleRate: metadata.format.sampleRate,
      channels: metadata.format.numberOfChannels,
      codec: metadata.format.container || fallbackCodec,
      coverDataUrl,
    };
  } catch {
    return {
      id: filePath,
      filePath,
      fileUrl: pathToFileURL(filePath).href,
      fileName,
      title: fallbackTitle,
      artist: 'Artista desconocido',
      album: '',
      duration: 0,
      codec: fallbackCodec,
    };
  }
}

async function collectAudioFilesRecursively(
  dirPath: string,
  results: string[] = [],
  depth = 0
): Promise<string[]> {
  if (depth > MAX_SCAN_DEPTH || results.length >= MAX_SCAN_FILES || isUncPath(dirPath)) {
    return results;
  }

  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= MAX_SCAN_FILES) break;
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await collectAudioFilesRecursively(fullPath, results, depth + 1);
      } else if (entry.isFile() && isAudioFile(fullPath)) {
        results.push(fullPath);
      }
    }
  } catch {
    // Ignoramos carpetas sin permiso de lectura
  }

  return results;
}

export async function parseTracksInBatches(
  filePaths: string[],
  includeCover: boolean,
  batchSize = 20
): Promise<Track[]> {
  const tracks: Track[] = [];
  for (let i = 0; i < filePaths.length; i += batchSize) {
    const chunk = filePaths.slice(i, i + batchSize);
    const parsed = await Promise.all(chunk.map((fp) => buildTrackFromFile(fp, includeCover)));
    tracks.push(...parsed);
  }
  return tracks;
}

export async function scanFolder(folderPath: string, includeCover = false): Promise<Track[]> {
  if (!folderPath || isUncPath(folderPath)) return [];
  const filePaths = await collectAudioFilesRecursively(folderPath);
  const tracks = await parseTracksInBatches(filePaths, includeCover);
  return tracks.sort((a, b) => a.title.localeCompare(b.title));
}

export async function readTracksFromPaths(inputPaths: string[]): Promise<Track[]> {
  const audioPaths: string[] = [];

  for (const targetPath of inputPaths) {
    if (!targetPath || isUncPath(targetPath)) continue;
    try {
      const stats = await fs.promises.stat(targetPath);
      if (stats.isDirectory()) {
        await collectAudioFilesRecursively(targetPath, audioPaths, 0);
      } else if (stats.isFile() && isAudioFile(targetPath)) {
        audioPaths.push(targetPath);
      }
    } catch {
      // Omitir rutas inválidas
    }
    if (audioPaths.length >= MAX_SCAN_FILES) break;
  }

  const uniquePaths = Array.from(new Set(audioPaths)).slice(0, MAX_SCAN_FILES);
  return parseTracksInBatches(uniquePaths, false);
}
