import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { AppConfig, CustomSkinConfig } from '../shared/types';

const DEFAULT_EQ_GAINS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

const DEFAULT_CUSTOM_SKIN: CustomSkinConfig = {
  bgShell: '#14111d',
  bgTitlebar: '#1e192b',
  bgLcd: '#0c0914',
  textMain: '#f4f0ff',
  accent: '#c084fc',
  fontLcd: "'Consolas', monospace",
};

const DEFAULT_CONFIG: AppConfig = {
  musicFolder: null,
  theme: 'winamp-classic',
  customSkin: { ...DEFAULT_CUSTOM_SKIN },
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
    const merged: AppConfig = {
      ...DEFAULT_CONFIG,
      ...parsed,
      customSkin: { ...DEFAULT_CUSTOM_SKIN, ...(parsed.customSkin ?? {}) },
    };

    if (!Array.isArray(merged.eqGains) || merged.eqGains.length !== 10) {
      merged.eqGains = [...DEFAULT_EQ_GAINS];
    }

    return merged;
  } catch {
    return {
      ...DEFAULT_CONFIG,
      customSkin: { ...DEFAULT_CUSTOM_SKIN },
      eqGains: [...DEFAULT_EQ_GAINS],
    };
  }
}

export async function saveConfig(partial: Partial<AppConfig>): Promise<AppConfig> {
  const current = await loadConfig();
  const updated: AppConfig = {
    ...current,
    ...partial,
    customSkin: partial.customSkin
      ? { ...current.customSkin, ...partial.customSkin }
      : current.customSkin,
  };
  const configPath = getConfigPath();

  await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
  await fs.promises.writeFile(configPath, JSON.stringify(updated, null, 2), 'utf-8');
  return updated;
}
