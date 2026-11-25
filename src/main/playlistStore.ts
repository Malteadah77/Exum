import { app, BrowserWindow, dialog } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { SavedPlaylist, Track } from '../shared/types';
import { buildTrackFromFile } from './libraryScanner';

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

async function writeSavedPlaylists(list: SavedPlaylist[]): Promise<void> {
  const filePath = getPlaylistsFile();
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, JSON.stringify(list, null, 2), 'utf-8');
}

export async function saveNamedPlaylist(name: string, tracks: Track[]): Promise<SavedPlaylist[]> {
  const cleanName = name.trim();
  if (!cleanName) return listSavedPlaylists();

  const existing = await listSavedPlaylists();
  const idx = existing.findIndex((p) => p.name.toLowerCase() === cleanName.toLowerCase());
  const item: SavedPlaylist = {
    id: idx >= 0 ? existing[idx].id : `pl-${Date.now()}`,
    name: cleanName,
    tracks: [...tracks],
    updatedAt: Date.now(),
  };

  if (idx >= 0) existing[idx] = item;
  else existing.unshift(item);

  await writeSavedPlaylists(existing);
  return existing;
}

export async function deleteSavedPlaylist(id: string): Promise<SavedPlaylist[]> {
  const existing = await listSavedPlaylists();
  const filtered = existing.filter((p) => p.id !== id);
  await writeSavedPlaylists(filtered);
  return filtered;
}

export async function exportM3uDialog(
  owner: BrowserWindow | null,
  tracks: Track[]
): Promise<boolean> {
  if (!owner || tracks.length === 0) return false;

  const result = await dialog.showSaveDialog(owner, {
    title: 'Exportar playlist (.m3u)',
    defaultPath: 'exum-playlist.m3u8',
    filters: [{ name: 'Playlist M3U', extensions: ['m3u8', 'm3u'] }],
  });

  if (result.canceled || !result.filePath) return false;

  const lines: string[] = ['#EXTM3U'];
  for (const track of tracks) {
    const sec = track.isLive ? -1 : Math.round(track.duration || 0);
    const label =
      track.artist && track.artist !== 'Artista desconocido'
        ? `${track.artist} - ${track.title}`
        : track.title;
    lines.push(`#EXTINF:${sec},${label}`);
    lines.push(track.filePath);
  }

  await fs.promises.writeFile(result.filePath, lines.join('\r\n'), 'utf-8');
  return true;
}

export async function importM3uDialog(owner: BrowserWindow | null): Promise<Track[]> {
  if (!owner) return [];

  const result = await dialog.showOpenDialog(owner, {
    title: 'Importar playlist (.m3u / .m3u8)',
    properties: ['openFile'],
    filters: [{ name: 'Playlist M3U', extensions: ['m3u', 'm3u8'] }],
  });

  if (result.canceled || result.filePaths.length === 0) return [];

  const m3uPath = result.filePaths[0];
  const baseDir = path.dirname(m3uPath);
  const content = await fs.promises.readFile(m3uPath, 'utf-8');

  const tracks: Track[] = [];
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
      tracks.push({
        id: `stream:${line}`,
        filePath: line,
        fileUrl: line,
        fileName: pendingTitle || line,
        title: pendingTitle || line,
        artist: 'Stream M3U',
        album: '',
        duration: 0,
        codec: 'STREAM',
        sourceType: 'stream',
        isLive: true,
      });
      pendingTitle = '';
      continue;
    }

    const resolved = path.isAbsolute(line) ? line : path.resolve(baseDir, line);
    try {
      await fs.promises.access(resolved);
      const track = await buildTrackFromFile(resolved);
      tracks.push(track);
    } catch {
      // Omitimos archivos faltantes para no romper la carga
    }
    pendingTitle = '';
  }

  return tracks;
}
