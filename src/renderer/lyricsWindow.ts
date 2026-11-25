import type { ElectronAPI, Track, WszPleditColors } from '../shared/types.js';
import { LyricsController } from './lyricsController.js';
import { applyPaletteToDocument } from './wszRenderer.js';

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

const titleEl = document.getElementById('lyrics-win-title');
const contentEl = document.getElementById('lyrics-content');
const btnPin = document.getElementById('btn-pin');
const btnMin = document.getElementById('btn-min');
const btnClose = document.getElementById('btn-close');

const controller = contentEl
  ? new LyricsController(contentEl, (seconds) => {
      window.electronAPI.requestSeekFromLyrics(seconds);
    })
  : null;

function handleTrack(track: Track | null): void {
  if (titleEl) {
    titleEl.textContent = track ? `🎤 ${track.title}` : '🎤 EXUM — LETRAS';
  }
  void controller?.loadForTrack(track);
}

btnPin?.addEventListener('click', async () => {
  const pinned = await window.electronAPI.toggleAlwaysOnTop();
  btnPin.classList.toggle('active', pinned);
});
btnMin?.addEventListener('click', () => window.electronAPI.minimizeWindow());
btnClose?.addEventListener('click', () => window.electronAPI.closeWindow());

window.electronAPI.onPaletteUpdated((palette: WszPleditColors) => applyPaletteToDocument(palette));
window.electronAPI.onTrackChanged((track: Track | null) => handleTrack(track));
window.electronAPI.onTimeUpdated((currentTime: number) => controller?.syncToTime(currentTime));

async function init(): Promise<void> {
  const state = await window.electronAPI.getSyncState();
  applyPaletteToDocument(state.palette);
  handleTrack(state.track);
}

void init();
