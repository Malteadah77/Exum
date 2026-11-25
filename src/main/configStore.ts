import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { AppConfig, SavedStream } from '../shared/types';

const DEFAULT_EQ_GAINS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

// Emisoras abiertas y legales de SomaFM para probar streams en vivo con 1 clic
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
  eqPreset: 'flat',
  eqGains: [...DEFAULT_EQ_GAINS],
  visualizerMode: 'bars',
  savedStreams: [...DEFAULT_STREAMS],
  spotifyClientId: null,
};

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'config.json');
}

export async function loadConfig(): Promise<AppConfig> {
  const configPath = getConfigPath();
  try {
    const raw = await fs.promises.readFile(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    const merged: AppConfig = { ...DEFAULT_CONFIG, ...parsed };

    if (!Array.isArray(merged.eqGains) || merged.eqGains.length !== 10) {
      merged.eqGains = [...DEFAULT_EQ_GAINS];
    }
    if (!Array.isArray(merged.savedStreams)) {
      merged.savedStreams = [...DEFAULT_STREAMS];
    }

    return merged;
  } catch {
    return {
      ...DEFAULT_CONFIG,
      eqGains: [...DEFAULT_EQ_GAINS],
      savedStreams: [...DEFAULT_STREAMS],
    };
  }
}

export async function saveConfig(partial: Partial<AppConfig>): Promise<AppConfig> {
  const current = await loadConfig();
  const updated: AppConfig = { ...current, ...partial };
  const configPath = getConfigPath();

  await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
  await fs.promises.writeFile(configPath, JSON.stringify(updated, null, 2), 'utf-8');
  return updated;
}
