import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { AppConfig } from '../shared/types';

const DEFAULT_CONFIG: AppConfig = {
  musicFolder: null,
  theme: 'winamp-classic',
  volume: 80,
  shuffle: false,
  repeatMode: 'off',
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
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    // Si es la primera vez o el archivo no existe, devolvemos la configuración por defecto
    return { ...DEFAULT_CONFIG };
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
