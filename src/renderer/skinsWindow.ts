import type {
  ElectronAPI,
  MuseumSkinItem,
  WszPleditColors,
  WszSkinData,
} from '../shared/types.js';
import { applyPaletteToDocument } from './wszRenderer.js';

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

const btnPin = document.getElementById('btn-pin');
const btnMin = document.getElementById('btn-min');
const btnClose = document.getElementById('btn-close');
const btnImport = document.getElementById('btn-import');
const btnResetSkin = document.getElementById('btn-reset-skin');

const savedListEl = document.getElementById('saved-skins-list');
const searchInput = document.getElementById('museum-search-input') as HTMLInputElement | null;
const btnSearch = document.getElementById('btn-museum-search');
const museumGrid = document.getElementById('museum-grid');

let activeSkinId: string | null = null;

async function renderSavedSkins(): Promise<void> {
  if (!savedListEl) return;
  const skins = await window.electronAPI.listWszSkins();
  savedListEl.innerHTML = '';

  if (skins.length === 0) {
    const empty = document.createElement('span');
    empty.style.fontSize = '11px';
    empty.style.opacity = '0.75';
    empty.textContent = 'Aún no tienes skins .wsz guardadas. Descarga una abajo o importa un .wsz.';
    savedListEl.appendChild(empty);
    return;
  }

  for (const skin of skins) {
    const item = document.createElement('div');
    item.className = `saved-skin-item${skin.id === activeSkinId ? ' active' : ''}`;

    const applyBtn = document.createElement('button');
    applyBtn.className = 'saved-skin-apply';
    applyBtn.textContent = skin.name;
    applyBtn.title = `Aplicar ${skin.name}`;
    applyBtn.addEventListener('click', async () => {
      await window.electronAPI.selectWszSkin(skin.id);
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'saved-skin-del';
    delBtn.textContent = '×';
    delBtn.title = `Eliminar ${skin.name}`;
    delBtn.addEventListener('click', async () => {
      await window.electronAPI.deleteWszSkin(skin.id);
      await renderSavedSkins();
    });

    item.append(applyBtn, delBtn);
    savedListEl.appendChild(item);
  }
}

async function runMuseumSearch(query: string): Promise<void> {
  if (!museumGrid) return;
  museumGrid.innerHTML = '<div class="lyrics-message">Buscando en Webamp Skin Museum...</div>';

  const items: MuseumSkinItem[] = await window.electronAPI.searchMuseumSkins(query);
  museumGrid.innerHTML = '';

  if (items.length === 0) {
    museumGrid.innerHTML =
      '<div class="lyrics-message">No se encontraron skins (o sin conexión). Prueba otro término.</div>';
    return;
  }

  for (const item of items) {
    const card = document.createElement('div');
    card.className = 'museum-card';
    card.title = `Descargar y aplicar: ${item.filename}`;

    const img = document.createElement('img');
    img.className = 'museum-thumb';
    img.src = item.screenshotUrl;
    img.alt = item.filename;
    img.loading = 'lazy';

    const label = document.createElement('div');
    label.className = 'museum-name';
    label.textContent = item.filename.replace(/\.wsz$/i, '');

    card.append(img, label);
    card.addEventListener('click', async () => {
      label.textContent = 'Descargando...';
      const data = await window.electronAPI.downloadMuseumSkin(item.downloadUrl, item.filename);
      if (data) {
        label.textContent = `✓ ${data.meta.name}`;
        await renderSavedSkins();
      } else {
        label.textContent = 'Error al descargar';
      }
    });

    museumGrid.appendChild(card);
  }
}

btnPin?.addEventListener('click', async () => {
  const pinned = await window.electronAPI.toggleAlwaysOnTop();
  btnPin.classList.toggle('active', pinned);
});
btnMin?.addEventListener('click', () => window.electronAPI.minimizeWindow());
btnClose?.addEventListener('click', () => window.electronAPI.closeWindow());

btnImport?.addEventListener('click', async () => {
  const skin = await window.electronAPI.importWszDialog();
  if (skin) await renderSavedSkins();
});

btnResetSkin?.addEventListener('click', async () => {
  await window.electronAPI.selectWszSkin(null);
  await renderSavedSkins();
});

btnSearch?.addEventListener('click', () => void runMuseumSearch(searchInput?.value ?? ''));
searchInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') void runMuseumSearch(searchInput.value);
});

window.electronAPI.onPaletteUpdated((palette: WszPleditColors) => applyPaletteToDocument(palette));
window.electronAPI.onSkinApplied((skin: WszSkinData | null) => {
  activeSkinId = skin?.meta.id ?? null;
  void renderSavedSkins();
});

async function init(): Promise<void> {
  const state = await window.electronAPI.getSyncState();
  activeSkinId = state.activeSkinId;
  applyPaletteToDocument(state.palette);
  await renderSavedSkins();
  void runMuseumSearch('');
}

void init();
