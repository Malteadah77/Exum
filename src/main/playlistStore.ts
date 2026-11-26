import { app, BrowserWindow, dialog } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { SavedPlaylist, Track } from '../shared/types';
import { atomicWriteJson } from './configStore';
import { isAudioFile, isUncPath, parseTracksInBatches } from './libraryScanner';

const MAX_M3U_BYTES = 5 * 1024 * 1024;
let playlistWriteQueue: Promise<unknown> = Promise.resolve();

function getPlaylistsFile(): string {
  return path.join(app.getPath('userData'), 'playlists.json');
}

export async function listSavedPlaylists(): Promise<SavedPlaylist[]> {
  try {
    const raw = await fs.promises.readFile(getPlaylistsFile(), 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedPlaylist[]) : [];
  } catch {
    return [];
  }
}

export function saveNamedPlaylist(name: string, tracks: Track[]): Promise<SavedPlaylist[]> {
  const cleanName = name.trim();
  if (!cleanName) return listSavedPlaylists();

  const task = playlistWriteQueue.then(async () => {
    const existing = await listSavedPlaylists();
    const idx = existing.findIndex((p) => p.name.toLowerCase() === cleanName.toLowerCase());
    const item: SavedPlaylist = {
      id: idx >= 0 ? existing[idx].id : `pl-${Date.now()}`,
      name: cleanName,
      tracks: [...tracks],
    };

    if (idx >= 0) existing[idx] = item;
    else existing.unshift(item);

    await atomicWriteJson(getPlaylistsFile(), existing);
    return existing;
  });

  playlistWriteQueue = task.catch(() => undefined);
  return task;
}

export function deleteSavedPlaylist(id: string): Promise<SavedPlaylist[]> {
  const task = playlistWriteQueue.then(async () => {
    const existing = await listSavedPlaylists();
    const filtered = existing.filter((p) => p.id !== id);
    await atomicWriteJson(getPlaylistsFile(), filtered);
    return filtered;
  });

  playlistWriteQueue = task.catch(() => undefined);
  return task;
}

function stripNewlines(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

export async function exportM3uDialog(
  owner: BrowserWindow | null,
  tracks: Track[]
): Promise<boolean> {
  if (!owner || owner.isDestroyed() || tracks.length === 0) return false;

  const result = await dialog.showSaveDialog(owner, {
    title: 'Exportar playlist (.m3u)',
    defaultPath: 'exum-playlist.m3u8',
    filters: [{ name: 'Playlist M3U', extensions: ['m3u8', 'm3u'] }],
  });

  if (result.canceled || !result.filePath) return false;

  const lines: string[] = ['#EXTM3U'];
  for (const track of tracks) {
    const sec = track.isLive ? -1 : Math.round(track.duration || 0);
    const rawLabel =
      track.artist && track.artist !== 'Artista desconocido'
        ? `${track.artist} - ${track.title}`
        : track.title;
    lines.push(`#EXTINF:${sec},${stripNewlines(rawLabel)}`);
    lines.push(stripNewlines(track.filePath));
  }

  await fs.promises.writeFile(result.filePath, lines.join('\r\n'), 'utf-8');
  return true;
}

export async function importM3uDialog(owner: BrowserWindow | null): Promise<Track[]> {
  if (!owner || owner.isDestroyed()) return [];

  const result = await dialog.showOpenDialog(owner, {
    title: 'Importar playlist (.m3u / .m3u8)',
    properties: ['openFile'],
    filters: [{ name: 'Playlist M3U', extensions: ['m3u', 'm3u8'] }],
  });

  if (result.canceled || result.filePaths.length === 0) return [];

  const m3uPath = result.filePaths[0];
  if (isUncPath(m3uPath)) return [];

  const stat = await fs.promises.stat(m3uPath).catch(() => null);
  if (!stat || stat.size > MAX_M3U_BYTES) return [];

  const baseDir = path.dirname(m3uPath);
  const rawContent = await fs.promises.readFile(m3uPath, 'utf-8');
  const content = rawContent.replace(/^\uFEFF/, '');

  const orderedEntries: Array<{ kind: 'stream'; track: Track } | { kind: 'local'; filePath: string }> = [];
  const localPathsToParse: string[] = [];
  let pendingTitle = '';

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('#EXTINF:')) {
      const commaIdx = line.indexOf(',');
      if (commaIdx !== -1) pendingTitle = line.slice(commaIdx + 1).trim();
      continue;
    }

    if (line.startsWith('#')) continue;

    if (line.startsWith('http://') || line.startsWith('https://')) {
      try {
        const parsed = new URL(line);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          orderedEntries.push({
            kind: 'stream',
            track: {
              id: `stream:${line}`,
              filePath: line,
              fileUrl: line,
              fileName: pendingTitle || line,
              title: pendingTitle || line,
              artist: 'Stream M3U',
              album: '',
              duration: 0,
              codec: 'STREAM',
              isLive: true,
            },
          });
        }
      } catch {
        // URL inválida
      }
      pendingTitle = '';
      continue;
    }

    let candidate = line;
    if (line.toLowerCase().startsWith('file://')) {
      try {
        candidate = fileURLToPath(line);
      } catch {
        pendingTitle = '';
        continue;
      }
    }

    if (isUncPath(candidate)) {
      pendingTitle = '';
      continue;
    }

    const resolved = path.isAbsolute(candidate) ? candidate : path.resolve(baseDir, candidate);
    if (!isUncPath(resolved) && isAudioFile(resolved)) {
      try {
        await fs.promises.access(resolved);
        orderedEntries.push({ kind: 'local', filePath: resolved });
        localPathsToParse.push(resolved);
      } catch {
        // Omitimos archivos faltantes
      }
    }
    pendingTitle = '';
  }

  const parsedLocals = await parseTracksInBatches(Array.from(new Set(localPathsToParse)), false);
  const localMap = new Map(parsedLocals.map((t) => [t.filePath, t]));

  const tracks: Track[] = [];
  for (const entry of orderedEntries) {
    if (entry.kind === 'stream') {
      tracks.push(entry.track);
    } else {
      const found = localMap.get(entry.filePath);
      if (found) tracks.push(found);
    }
  }

  return tracks;
}
