import { AudioEngine, PlaybackState, formatTime } from './audioEngine.js';

interface OpenedAudioFile {
  filePath: string;
  fileUrl: string;
  fileName: string;
}

// Definimos el tipo del puente que expusimos en preload.ts
interface ElectronAPI {
  minimizeWindow: () => void;
  closeWindow: () => void;
  openAudioFile: () => Promise<OpenedAudioFile | null>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

// Referencias a los elementos del HTML
const btnMinimize = document.getElementById('btn-minimize');
const btnClose = document.getElementById('btn-close');
const btnTheme = document.getElementById('btn-theme');

const btnOpen = document.getElementById('btn-open');
const btnPlay = document.getElementById('btn-play') as HTMLButtonElement | null;
const btnPause = document.getElementById('btn-pause') as HTMLButtonElement | null;
const btnStop = document.getElementById('btn-stop') as HTMLButtonElement | null;
const btnMute = document.getElementById('btn-mute');

const lcdTime = document.getElementById('lcd-time');
const trackTitle = document.getElementById('track-title');
const statusText = document.getElementById('status-text');

const seekBar = document.getElementById('seek-bar') as HTMLInputElement | null;
const timeCurrent = document.getElementById('time-current');
const timeTotal = document.getElementById('time-total');

const volumeBar = document.getElementById('volume-bar') as HTMLInputElement | null;
const volumeValue = document.getElementById('volume-value');

// Lista de skins (incluyendo tu skin personalizada minimal-blue)
const themes = ['winamp-classic', 'modern-dark', 'minimal-blue'] as const;
let currentThemeIndex = 0;

// Bandera para evitar que la barra salte mientras el usuario la arrastra
let isSeeking = false;

const statusLabels: Record<PlaybackState, string> = {
  idle: 'LISTO',
  playing: 'REPRODUCIENDO',
  paused: 'EN PAUSA',
  stopped: 'DETENIDO',
};

// Instanciamos nuestro motor de audio y le pasamos qué hacer ante cada evento
const engine = new AudioEngine({
  onTrackLoaded: (title, duration) => {
    if (trackTitle) trackTitle.textContent = title;
    if (timeTotal) timeTotal.textContent = formatTime(duration);
    if (seekBar) {
      seekBar.max = String(duration || 0);
      seekBar.value = '0';
      seekBar.disabled = false;
    }
    if (btnPlay) btnPlay.disabled = false;
    if (btnPause) btnPause.disabled = false;
    if (btnStop) btnStop.disabled = false;
  },

  onTimeUpdate: (current, duration) => {
    if (isSeeking) return;
    const formatted = formatTime(current);
    if (lcdTime) lcdTime.textContent = formatted;
    if (timeCurrent) timeCurrent.textContent = formatted;
    if (seekBar && Number.isFinite(duration)) {
      seekBar.value = String(current);
    }
  },

  onStateChange: (state) => {
    if (statusText) statusText.textContent = statusLabels[state];
    btnPlay?.classList.toggle('ctrl-btn-active', state === 'playing');
    btnPause?.classList.toggle('ctrl-btn-active', state === 'paused');
  },

  onError: (message) => {
    if (statusText) statusText.textContent = message.toUpperCase();
  },
});

// Controles de ventana y skin
btnMinimize?.addEventListener('click', () => window.electronAPI.minimizeWindow());
btnClose?.addEventListener('click', () => window.electronAPI.closeWindow());

btnTheme?.addEventListener('click', () => {
  currentThemeIndex = (currentThemeIndex + 1) % themes.length;
  const nextTheme = themes[currentThemeIndex];
  document.documentElement.setAttribute('data-theme', nextTheme);

  if (statusText) {
    statusText.textContent = `SKIN ACTIVA: ${nextTheme.toUpperCase()}`;
  }
});

// Abrir canción desde Windows
btnOpen?.addEventListener('click', async () => {
  const file = await window.electronAPI.openAudioFile();
  if (!file) return;

  engine.load(file.fileUrl, file.fileName);
  void engine.play();
});

// Botones de reproducción
btnPlay?.addEventListener('click', () => void engine.play());
btnPause?.addEventListener('click', () => engine.pause());
btnStop?.addEventListener('click', () => engine.stop());

// Barra de progreso (arrastrar para adelantar o retroceder)
seekBar?.addEventListener('input', () => {
  isSeeking = true;
  const preview = formatTime(Number(seekBar.value));
  if (lcdTime) lcdTime.textContent = preview;
  if (timeCurrent) timeCurrent.textContent = preview;
});

seekBar?.addEventListener('change', () => {
  engine.seek(Number(seekBar.value));
  isSeeking = false;
});

// Control de volumen y silencio
volumeBar?.addEventListener('input', () => {
  const percent = Number(volumeBar.value);
  engine.setVolume(percent / 100);
  if (volumeValue) volumeValue.textContent = `${percent}%`;
  if (btnMute) btnMute.textContent = percent === 0 ? '🔇' : '🔊';
});

btnMute?.addEventListener('click', () => {
  const muted = engine.toggleMute();
  if (btnMute) btnMute.textContent = muted ? '🔇' : '🔊';
});



// Atajos de teclado: Espacio (Play/Pause) y Flechas (adelantar/retroceder 5s)
window.addEventListener('keydown', (event) => {
  if (!engine.hasTrack) return;

  if (event.code === 'Space') {
    event.preventDefault();
    engine.togglePlay();
  } else if (event.code === 'ArrowRight') {
    event.preventDefault();
    engine.seek(engine.currentTime + 5);
  } else if (event.code === 'ArrowLeft') {
    event.preventDefault();
    engine.seek(engine.currentTime - 5);
  }
});
