import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { AppConfig } from '../shared/types';

const DEFAULT_EQ_GAINS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

const DEFAULT_CONFIG: AppConfig = {
  musicFolder: null,
  theme: 'winamp-classic',
  volume: 80,
  shuffle: false,
  repeatMode: 'off',
  eqEnabled: true,
  eqPreset: 'flat',
  eqGains: [...DEFAULT_EQ_GAINS],
  visualizerMode: 'bars',
};

function getConfigPath(): string {
  // Carpeta estándar de datos de usuario en Windows (%APPDATA%/reproductor-de-musica/config.json)
  return path.join(app.getPath('userData'), 'config.json');
}

export async function loadConfig(): Promise<AppConfig> {
  const configPath = getConfigPath();
  try {
    const raw = await fs.promises.readFile(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    const merged: AppConfig = { ...DEFAULT_CONFIG, ...parsed };

    // Validación defensiva: garantizamos exactamente 10 bandas numéricas
    if (!Array.isArray(merged.eqGains) || merged.eqGains.length !== 10) {
      merged.eqGains = [...DEFAULT_EQ_GAINS];
    }

    return merged;
  } catch {
    return { ...DEFAULT_CONFIG, eqGains: [...DEFAULT_EQ_GAINS] };
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
