import AdmZip from 'adm-zip';
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import {
  MuseumSkinItem,
  WszPleditColors,
  WszSkinData,
  WszSkinMeta,
  WszSkinSprites,
} from '../shared/types';

export const DEFAULT_PLEDIT: WszPleditColors = {
  normal: '#c93b52',
  current: '#fce7eb',
  normalBg: '#0e090b',
  selectedBg: '#5a1423',
  font: 'Consolas, monospace',
};

const SPRITE_FILES: Array<{ key: keyof WszSkinSprites; candidates: string[] }> = [
  { key: 'main', candidates: ['main.bmp', 'main.png'] },
  { key: 'titlebar', candidates: ['titlebar.bmp', 'titlebar.png'] },
  { key: 'cbuttons', candidates: ['cbuttons.bmp', 'cbuttons.png'] },
  { key: 'posbar', candidates: ['posbar.bmp', 'posbar.png'] },
  { key: 'volume', candidates: ['volume.bmp', 'volume.png'] },
  { key: 'balance', candidates: ['balance.bmp', 'balance.png'] },
  { key: 'shufrep', candidates: ['shufrep.bmp', 'shufrep.png'] },
  { key: 'numbers', candidates: ['nums_ex.bmp', 'numbers.bmp', 'numbers.png'] },
  { key: 'playpaus', candidates: ['playpaus.bmp', 'playpaus.png'] },
  { key: 'monoster', candidates: ['monoster.bmp', 'monoster.png'] },
  { key: 'eqmain', candidates: ['eqmain.bmp', 'eqmain.png'] },
  { key: 'eqEx', candidates: ['eq_ex.bmp', 'eq_ex.png'] },
  { key: 'pledit', candidates: ['pledit.bmp', 'pledit.png'] },
];

function getSkinsDir(): string {
  return path.join(app.getPath('userData'), 'skins');
}

async function ensureSkinsDir(): Promise<string> {
  const dir = getSkinsDir();
  await fs.promises.mkdir(dir, { recursive: true });
  return dir;
}

function sanitizeFilename(name: string): string {
  const base = path.basename(name).replace(/[<>:"/\\|?*]+/g, '_').trim();
  if (!base.toLowerCase().endsWith('.wsz')) {
    return `${base || 'skin'}.wsz`;
  }
  return base;
}

function parsePleditTxt(text: string): WszPleditColors {
  const result: WszPleditColors = { ...DEFAULT_PLEDIT };
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('[') || line.startsWith(';')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;

    const key = line.slice(0, eqIdx).trim().toLowerCase();
    const val = line.slice(eqIdx + 1).trim();
    if (!val) continue;

    if (key === 'normal') result.normal = val;
    else if (key === 'current') result.current = val;
    else if (key === 'normalbg') result.normalBg = val;
    else if (key === 'selectedbg') result.selectedBg = val;
    else if (key === 'font') result.font = `${val}, Consolas, monospace`;
  }
  return result;
}

function parseVisColorTxt(text: string): string[] {
  const colors: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const clean = rawLine.split('//')[0].trim();
    if (!clean) continue;
    const match = clean.match(/(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/);
    if (match) {
      colors.push(`rgb(${match[1]}, ${match[2]}, ${match[3]})`);
    }
  }
  return colors;
}

export function parseWszSkin(filePath: string): WszSkinData {
  const zip = new AdmZip(filePath);
  const entries = zip.getEntries();

  const entryMap = new Map<string, AdmZip.IZipEntry>();
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const baseName = path.basename(entry.entryName).toLowerCase();
    if (!entryMap.has(baseName)) {
      entryMap.set(baseName, entry);
    }
  }

  const sprites: WszSkinSprites = {};
  for (const { key, candidates } of SPRITE_FILES) {
    for (const candidate of candidates) {
      const entry = entryMap.get(candidate);
      if (entry) {
        const mime = candidate.endsWith('.png') ? 'image/png' : 'image/bmp';
        const base64 = entry.getData().toString('base64');
        sprites[key] = `data:${mime};base64,${base64}`;
        break;
      }
    }
  }

  const pleditEntry = entryMap.get('pledit.txt');
  const pledit = pleditEntry
    ? parsePleditTxt(pleditEntry.getData().toString('utf-8'))
    : { ...DEFAULT_PLEDIT };

  const visEntry = entryMap.get('viscolor.txt');
  const visColors = visEntry ? parseVisColorTxt(visEntry.getData().toString('utf-8')) : [];

  const id = path.basename(filePath);
  const meta: WszSkinMeta = {
    id,
    name: path.parse(id).name,
    filePath,
  };

  return { meta, sprites, pledit, visColors };
}

export async function listSavedWszSkins(): Promise<WszSkinMeta[]> {
  const dir = await ensureSkinsDir();
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });

  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.wsz'))
    .map((e) => ({
      id: e.name,
      name: path.parse(e.name).name,
      filePath: path.join(dir, e.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function importWszFromPath(sourcePath: string): Promise<WszSkinData | null> {
  try {
    const dir = await ensureSkinsDir();
    const filename = sanitizeFilename(path.basename(sourcePath));
    const destPath = path.join(dir, filename);

    if (path.resolve(sourcePath) !== path.resolve(destPath)) {
      await fs.promises.copyFile(sourcePath, destPath);
    }

    return parseWszSkin(destPath);
  } catch {
    return null;
  }
}

export async function loadSavedWszSkin(skinId: string): Promise<WszSkinData | null> {
  try {
    const dir = await ensureSkinsDir();
    const filePath = path.join(dir, path.basename(skinId));
    await fs.promises.access(filePath);
    return parseWszSkin(filePath);
  } catch {
    return null;
  }
}

export async function deleteSavedWszSkin(skinId: string): Promise<boolean> {
  try {
    const dir = await ensureSkinsDir();
    const filePath = path.join(dir, path.basename(skinId));
    await fs.promises.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

interface MuseumGraphQLSkin {
  md5: string;
  filename: string;
  download_url: string;
  screenshot_url: string;
}

export async function searchMuseumSkins(query: string): Promise<MuseumSkinItem[]> {
  const trimmed = query.trim();

  const body = trimmed
    ? {
        query:
          'query($q: String!) { search_classic_skins(query: $q, first: 18, nsfw: false) { md5 filename download_url screenshot_url } }',
        variables: { q: trimmed },
      }
    : {
        query:
          '{ skins(first: 18, sort: MUSEUM, filter: APPROVED) { nodes { md5 filename download_url screenshot_url } } }',
      };

  try {
    const res = await fetch('https://api.webamp.org/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'ExumPlayer/0.5',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) return [];
    const json = (await res.json()) as {
      data?: {
        search_classic_skins?: MuseumGraphQLSkin[];
        skins?: { nodes?: MuseumGraphQLSkin[] };
      };
    };

    const rawList = trimmed
      ? json.data?.search_classic_skins ?? []
      : json.data?.skins?.nodes ?? [];

    return rawList
      .filter((s) => Boolean(s.download_url && s.screenshot_url))
      .map((s) => ({
        md5: s.md5,
        filename: s.filename,
        downloadUrl: s.download_url,
        screenshotUrl: s.screenshot_url,
      }));
  } catch {
    return [];
  }
}

export async function downloadMuseumSkin(
  downloadUrl: string,
  filename: string
): Promise<WszSkinData | null> {
  try {
    const res = await fetch(downloadUrl, {
      headers: { 'User-Agent': 'ExumPlayer/0.5' },
    });
    if (!res.ok) return null;

    const buffer = Buffer.from(await res.arrayBuffer());
    const dir = await ensureSkinsDir();
    const safeName = sanitizeFilename(filename);
    const destPath = path.join(dir, safeName);

    await fs.promises.writeFile(destPath, buffer);
    return parseWszSkin(destPath);
  } catch {
    return null;
  }
}
