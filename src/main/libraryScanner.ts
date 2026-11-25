import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { Track } from '../shared/types';

const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac']);

type MusicMetadataModule = typeof import('music-metadata');
let metadataModulePromise: Promise<MusicMetadataModule> | null = null;

function getMusicMetadata(): Promise<MusicMetadataModule> {
  if (!metadataModulePromise) {
    // Carga ESM dinámica segura desde un proceso Main en CommonJS
    metadataModulePromise = Function('return import("music-metadata")')() as Promise<MusicMetadataModule>;
  }
  return metadataModulePromise;
}

function isAudioFile(filePath: string): boolean {
  return AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/**
 * Lee los metadatos ID3 / tags de un archivo de audio.
 * Si un archivo no tiene etiquetas o falla el parser, usa el nombre del archivo como fallback.
 */
export async function buildTrackFromFile(filePath: string): Promise<Track> {
  const fileName = path.basename(filePath);
  const fallbackTitle = path.parse(filePath).name;
  const fallbackCodec = path.extname(filePath).slice(1).toUpperCase();

  try {
    const mm = await getMusicMetadata();
    const metadata = await mm.parseFile(filePath, { duration: true, skipCovers: true });

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
      codec: metadata.format.container || fallbackCodec,
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
    // Ignoramos carpetas sin permiso de lectura para no romper el escaneo
  }

  return results;
}

export async function scanFolder(folderPath: string): Promise<Track[]> {
  const filePaths = await collectAudioFilesRecursively(folderPath);
  const tracks = await Promise.all(filePaths.map((fp) => buildTrackFromFile(fp)));
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
      // Si la ruta ya no existe o es inválida, la omitimos
    }
  }

  // Eliminamos duplicados por ruta
  const uniquePaths = Array.from(new Set(audioPaths));
  return Promise.all(uniquePaths.map((fp) => buildTrackFromFile(fp)));
}
