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
import { isUncPath } from './libraryScanner';

export const DEFAULT_PLEDIT: WszPleditColors = {
  normal: '#c93b52',
  current: '#fce7eb',
  normalBg: '#0e090b',
  selectedBg: '#5a1423',
  font: 'Consolas, monospace',
};

const MAX_WSZ_ARCHIVE_BYTES = 20 * 1024 * 1024;
const MAX_ENTRY_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_EXTRACTED_BYTES = 30 * 1024 * 1024;
const WINDOWS_RESERVED_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const ALLOWED_MUSEUM_HOSTS = new Set([
  'r2.webampskins.org',
  'cdn.webampskins.org',
  'skins.webamp.org',
  'webampskins.org',
  'archive.org',
]);

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

function sanitizeSkinFilename(name: string): string {
  const raw = path
    .basename(name)
    .replace(/[\x00-\x1f<>:"/\\|?*]+/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();

  const stem = raw.toLowerCase().endsWith('.wsz') ? raw.slice(0, -4) : raw;
  const safeStem = !stem || WINDOWS_RESERVED_RE.test(stem) ? `skin-${Date.now()}` : stem.slice(0, 100);
  return `${safeStem}.wsz`;
}

function resolveSafeSkinPath(skinsDir: string, skinId: string): string | null {
  if (!skinId || skinId.includes('/') || skinId.includes('\\') || skinId === '.' || skinId === '..') {
    return null;
  }
  if (!skinId.toLowerCase().endsWith('.wsz')) return null;

  const baseDir = path.resolve(skinsDir);
  const resolved = path.resolve(baseDir, skinId);
  if (!resolved.startsWith(baseDir + path.sep)) return null;
  return resolved;
}

function sanitizeHexColor(raw: string, fallback: string): string {
  const stripped = raw.split(';')[0].trim();
  const match = stripped.match(/^#?([0-9a-fA-F]{6})$/);
  return match ? `#${match[1].toLowerCase()}` : fallback;
}

function sanitizeFontName(raw: string): string {
  const cleaned = raw.split(';')[0].replace(/[^a-zA-Z0-9\s\-_]/g, '').trim().slice(0, 48);
  return cleaned ? `"${cleaned}", Consolas, monospace` : DEFAULT_PLEDIT.font;
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

    if (key === 'normal') result.normal = sanitizeHexColor(val, DEFAULT_PLEDIT.normal);
    else if (key === 'current') result.current = sanitizeHexColor(val, DEFAULT_PLEDIT.current);
    else if (key === 'normalbg') result.normalBg = sanitizeHexColor(val, DEFAULT_PLEDIT.normalBg);
    else if (key === 'selectedbg') result.selectedBg = sanitizeHexColor(val, DEFAULT_PLEDIT.selectedBg);
    else if (key === 'font') result.font = sanitizeFontName(val);
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
      const r = Math.min(255, Number(match[1]));
      const g = Math.min(255, Number(match[2]));
      const b = Math.min(255, Number(match[3]));
      colors.push(`rgb(${r}, ${g}, ${b})`);
    }
  }
  return colors;
}

export function parseWszSkin(filePath: string, overrideId?: string): WszSkinData {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_WSZ_ARCHIVE_BYTES) {
    throw new Error('El archivo .wsz supera el límite de 20 MB.');
  }

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

  let totalExtracted = 0;
  const safeGetData = (entry: AdmZip.IZipEntry): Buffer => {
    const expected = entry.header?.size ?? 0;
    if (expected > MAX_ENTRY_BYTES || totalExtracted + expected > MAX_TOTAL_EXTRACTED_BYTES) {
      throw new Error('Entrada descomprimida del .wsz demasiado grande.');
    }
    const buf = entry.getData();
    totalExtracted += buf.length;
    if (buf.length > MAX_ENTRY_BYTES || totalExtracted > MAX_TOTAL_EXTRACTED_BYTES) {
      throw new Error('Contenido descomprimido del .wsz excede el límite de seguridad.');
    }
    return buf;
  };

  const sprites: WszSkinSprites = {};
  for (const { key, candidates } of SPRITE_FILES) {
    for (const candidate of candidates) {
      const entry = entryMap.get(candidate);
      if (entry) {
        const mime = candidate.endsWith('.png') ? 'image/png' : 'image/bmp';
        const base64 = safeGetData(entry).toString('base64');
        sprites[key] = `data:${mime};base64,${base64}`;
        break;
      }
    }
  }

  const pleditEntry = entryMap.get('pledit.txt');
  const pledit = pleditEntry
    ? parsePleditTxt(safeGetData(pleditEntry).toString('utf-8'))
    : { ...DEFAULT_PLEDIT };

  const visEntry = entryMap.get('viscolor.txt');
  const visColors = visEntry ? parseVisColorTxt(safeGetData(visEntry).toString('utf-8')) : [];

  const id = overrideId ?? path.basename(filePath);
  const meta: WszSkinMeta = {
    id,
    name: path.parse(id).name,
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
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function importWszFromPath(sourcePath: string): Promise<WszSkinData | null> {
  if (!sourcePath || isUncPath(sourcePath)) return null;
  try {
    const dir = await ensureSkinsDir();
    const filename = sanitizeSkinFilename(path.basename(sourcePath));
    // Validamos el ZIP antes de copiarlo a userData/skins para no dejar archivos corruptos huérfanos
    const parsed = parseWszSkin(sourcePath, filename);
    const destPath = path.join(dir, filename);

    if (path.resolve(sourcePath) !== path.resolve(destPath)) {
      await fs.promises.copyFile(sourcePath, destPath);
    }

    return parsed;
  } catch {
    return null;
  }
}

export async function loadSavedWszSkin(skinId: string): Promise<WszSkinData | null> {
  try {
    const dir = await ensureSkinsDir();
    const filePath = resolveSafeSkinPath(dir, skinId);
    if (!filePath) return null;
    await fs.promises.access(filePath);
    return parseWszSkin(filePath);
  } catch {
    return null;
  }
}

export async function deleteSavedWszSkin(skinId: string): Promise<boolean> {
  try {
    const dir = await ensureSkinsDir();
    const filePath = resolveSafeSkinPath(dir, skinId);
    if (!filePath) return false;
    await fs.promises.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

function isAllowedMuseumUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    return (
      ALLOWED_MUSEUM_HOSTS.has(host) ||
      host.endsWith('.webampskins.org') ||
      host.endsWith('.archive.org')
    );
  } catch {
    return false;
  }
}

interface MuseumGraphQLSkin {
  filename: string;
  download_url: string;
  screenshot_url: string;
}

export async function searchMuseumSkins(query: string): Promise<MuseumSkinItem[]> {
  const trimmed = query.trim();

  const body = trimmed
    ? {
        query:
          'query($q: String!) { search_classic_skins(query: $q, first: 18, nsfw: false) { filename download_url screenshot_url } }',
        variables: { q: trimmed },
      }
    : {
        query:
          '{ skins(first: 18, sort: MUSEUM, filter: APPROVED) { nodes { filename download_url screenshot_url } } }',
      };

  try {
    const res = await fetch('https://api.webamp.org/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'ExumPlayer/1.1',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
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
      .filter((s) => Boolean(s.download_url && s.screenshot_url && isAllowedMuseumUrl(s.download_url)))
      .map((s) => ({
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
  if (!isAllowedMuseumUrl(downloadUrl)) return null;

  let tmpPath: string | null = null;
  try {
    const res = await fetch(downloadUrl, {
      headers: { 'User-Agent': 'ExumPlayer/1.1' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok || !res.body) return null;

    const declaredLen = Number(res.headers.get('content-length') || 0);
    if (declaredLen > MAX_WSZ_ARCHIVE_BYTES) return null;

    const dir = await ensureSkinsDir();
    const safeName = sanitizeSkinFilename(filename);
    tmpPath = path.join(dir, `.tmp-${process.pid}-${Date.now()}.wsz`);

    const reader = res.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > MAX_WSZ_ARCHIVE_BYTES) {
          await reader.cancel();
          return null;
        }
        chunks.push(Buffer.from(value));
      }
    }

    await fs.promises.writeFile(tmpPath, Buffer.concat(chunks));
    const parsed = parseWszSkin(tmpPath, safeName);

    const destPath = path.join(dir, safeName);
    await fs.promises.rename(tmpPath, destPath);
    tmpPath = null;
    return parsed;
  } catch {
    return null;
  } finally {
    if (tmpPath) {
      await fs.promises.unlink(tmpPath).catch(() => undefined);
    }
  }
}
