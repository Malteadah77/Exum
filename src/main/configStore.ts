import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { AppConfig, RepeatMode, SavedStream, VisualizerMode } from '../shared/types';

const DEFAULT_EQ_GAINS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const VALID_REPEAT: Set<RepeatMode> = new Set(['off', 'all', 'one']);
const VALID_VIS: Set<VisualizerMode> = new Set(['bars', 'wave', 'off']);

const DEFAULT_STREAMS: SavedStream[] = [
  {
    id: 'somafm-groovesalad',
    name: 'SomaFM — Groove Salad (Ambient / Chill)',
    url: 'https://ice2.somafm.com/groovesalad-128-mp3',
    genre: 'Chill',
  },
  {
    id: 'somafm-vaporwaves',
    name: 'SomaFM — Vaporwaves (Synthwave / Vapor)',
    url: 'https://ice2.somafm.com/vaporwaves-128-mp3',
    genre: 'Synthwave',
  },
  {
    id: 'somafm-dronezone',
    name: 'SomaFM — Drone Zone (Dark Ambient)',
    url: 'https://ice2.somafm.com/dronezone-128-mp3',
    genre: 'Ambient',
  },
];

const DEFAULT_CONFIG: AppConfig = {
  musicFolder: null,
  activeWszSkinId: null,
  volume: 80,
  shuffle: false,
  repeatMode: 'off',
  eqEnabled: true,
  eqGains: [...DEFAULT_EQ_GAINS],
  visualizerMode: 'bars',
  savedStreams: [...DEFAULT_STREAMS],
  favoriteTrackIds: [],
};

// Cola serializada para evitar carreras read-modify-write y corrupción de JSON en Windows
let writeQueue: Promise<unknown> = Promise.resolve();

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'config.json');
}

export async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}.tmp`;
  await fs.promises.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');

  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await fs.promises.rename(tmpPath, filePath);
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 25 * (attempt + 1)));
    }
  }
  await fs.promises.unlink(tmpPath).catch(() => undefined);
  throw lastErr;
}

function sanitizePartial(partial: Partial<AppConfig>, allowPrivilegedFields: boolean): Partial<AppConfig> {
  const clean: Partial<AppConfig> = {};
  if (!partial || typeof partial !== 'object') return clean;

  if (allowPrivilegedFields && 'musicFolder' in partial) {
    if (partial.musicFolder === null || (typeof partial.musicFolder === 'string' && partial.musicFolder.length <= 512)) {
      clean.musicFolder = partial.musicFolder;
    }
  }
  if (allowPrivilegedFields && 'activeWszSkinId' in partial) {
    if (partial.activeWszSkinId === null || typeof partial.activeWszSkinId === 'string') {
      clean.activeWszSkinId = partial.activeWszSkinId;
    }
  }
  if (typeof partial.volume === 'number' && Number.isFinite(partial.volume)) {
    clean.volume = Math.max(0, Math.min(100, Math.round(partial.volume)));
  }
  if (typeof partial.shuffle === 'boolean') {
    clean.shuffle = partial.shuffle;
  }
  if (partial.repeatMode && VALID_REPEAT.has(partial.repeatMode)) {
    clean.repeatMode = partial.repeatMode;
  }
  if (typeof partial.eqEnabled === 'boolean') {
    clean.eqEnabled = partial.eqEnabled;
  }
  if (Array.isArray(partial.eqGains) && partial.eqGains.length === 10) {
    clean.eqGains = partial.eqGains.map((g) =>
      typeof g === 'number' && Number.isFinite(g) ? Math.max(-12, Math.min(12, g)) : 0
    );
  }
  if (partial.visualizerMode && VALID_VIS.has(partial.visualizerMode)) {
    clean.visualizerMode = partial.visualizerMode;
  }
  if (Array.isArray(partial.savedStreams)) {
    clean.savedStreams = partial.savedStreams
      .filter(
        (s): s is SavedStream =>
          Boolean(s && typeof s.id === 'string' && typeof s.name === 'string' && typeof s.url === 'string')
      )
      .slice(0, 500)
      .map((s) => ({
        id: s.id.slice(0, 120),
        name: s.name.slice(0, 200),
        url: s.url.slice(0, 2048),
        genre: typeof s.genre === 'string' ? s.genre.slice(0, 80) : '',
      }));
  }
  if (Array.isArray(partial.favoriteTrackIds)) {
    clean.favoriteTrackIds = partial.favoriteTrackIds
      .filter((id): id is string => typeof id === 'string')
      .slice(0, 10_000);
  }

  return clean;
}

export async function loadConfig(): Promise<AppConfig> {
  const configPath = getConfigPath();
  try {
    const raw = await fs.promises.readFile(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    const sanitized = sanitizePartial(parsed, true);
    return {
      ...DEFAULT_CONFIG,
      eqGains: [...DEFAULT_EQ_GAINS],
      savedStreams: [...DEFAULT_STREAMS],
      favoriteTrackIds: [],
      ...sanitized,
    };
  } catch {
    return {
      ...DEFAULT_CONFIG,
      eqGains: [...DEFAULT_EQ_GAINS],
      savedStreams: [...DEFAULT_STREAMS],
      favoriteTrackIds: [],
    };
  }
}

export function saveConfig(
  partial: Partial<AppConfig>,
  allowPrivilegedFields = true
): Promise<AppConfig> {
  const task = writeQueue.then(async () => {
    const current = await loadConfig();
    const safePartial = sanitizePartial(partial, allowPrivilegedFields);
    const updated: AppConfig = { ...current, ...safePartial };
    await atomicWriteJson(getConfigPath(), updated);
    return updated;
  });

  writeQueue = task.catch(() => undefined);
  return task;
}
