import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { Track } from '../shared/types';

const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac']);
const MAX_COVER_BYTES = 512 * 1024; // 512 KB máx por carátula embebida para mantener baja la RAM

type MusicMetadataModule = typeof import('music-metadata');
let metadataModulePromise: Promise<MusicMetadataModule> | null = null;

function getMusicMetadata(): Promise<MusicMetadataModule> {
  if (!metadataModulePromise) {
    metadataModulePromise = Function('return import("music-metadata")')() as Promise<MusicMetadataModule>;
  }
  return metadataModulePromise;
}

function isAudioFile(filePath: string): boolean {
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
      if (pic.data && pic.data.length <= MAX_COVER_BYTES) {
        const mime = pic.format || 'image/jpeg';
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
      sourceType: 'local',
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
      sourceType: 'local',
    };
  }
}

async function collectAudioFilesRecursively(dirPath: string): Promise<string[]> {
  const results: string[] = [];

  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        const nested = await collectAudioFilesRecursively(fullPath);
        results.push(...nested);
      } else if (entry.isFile() && isAudioFile(fullPath)) {
        results.push(fullPath);
      }
    }
  } catch {
    // Ignoramos carpetas sin permiso de lectura
  }

  return results;
}

async function parseTracksInBatches(
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
  const filePaths = await collectAudioFilesRecursively(folderPath);
  const tracks = await parseTracksInBatches(filePaths, includeCover);
  return tracks.sort((a, b) => a.title.localeCompare(b.title));
}

export async function readTracksFromPaths(inputPaths: string[]): Promise<Track[]> {
  const audioPaths: string[] = [];

  for (const targetPath of inputPaths) {
    try {
      const stats = await fs.promises.stat(targetPath);
      if (stats.isDirectory()) {
        const nested = await collectAudioFilesRecursively(targetPath);
        audioPaths.push(...nested);
      } else if (stats.isFile() && isAudioFile(targetPath)) {
        audioPaths.push(targetPath);
      }
    } catch {
      // Omitir rutas inválidas
    }
  }

  const uniquePaths = Array.from(new Set(audioPaths));
  return parseTracksInBatches(uniquePaths, false);
}
