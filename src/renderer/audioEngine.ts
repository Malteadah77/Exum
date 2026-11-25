export type PlaybackState = 'idle' | 'playing' | 'paused' | 'stopped';

export interface AudioEngineCallbacks {
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  onStateChange?: (state: PlaybackState) => void;
  onTrackLoaded?: (title: string, duration: number) => void;
  onEnded?: () => void;
  onError?: (message: string) => void;
}

/**
 * Formatea segundos (ej. 125) a formato reloj "02:05"
 */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '00:00';
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Motor de audio desacoplado de la interfaz.
 * En Fase 3 conectaremos este mismo elemento a la Web Audio API (ecualizador y visualizador).
 */
export class AudioEngine {
  private audio: HTMLAudioElement;
  private state: PlaybackState = 'idle';
  private currentTitle = '';
  private callbacks: AudioEngineCallbacks;

  constructor(callbacks: AudioEngineCallbacks = {}) {
    this.audio = new Audio();
    this.audio.volume = 0.8;
    this.callbacks = callbacks;

    this.bindEvents();
  }

  private bindEvents(): void {
    this.audio.addEventListener('loadedmetadata', () => {
      this.callbacks.onTrackLoaded?.(this.currentTitle, this.audio.duration);
    });

    this.audio.addEventListener('timeupdate', () => {
      this.callbacks.onTimeUpdate?.(this.audio.currentTime, this.audio.duration);
    });

    this.audio.addEventListener('ended', () => {
      this.setState('stopped');
      this.callbacks.onTimeUpdate?.(0, this.audio.duration);
      this.callbacks.onEnded?.();
    });

    this.audio.addEventListener('error', () => {
      this.callbacks.onError?.('No se pudo reproducir este archivo de audio.');
    });
  }

  private setState(newState: PlaybackState): void {
    this.state = newState;
    this.callbacks.onStateChange?.(newState);
  }

  public load(fileUrl: string, title: string): void {
    this.currentTitle = title;
    this.audio.src = fileUrl;
    this.audio.load();
    this.setState('stopped');
  }

  public async play(): Promise<void> {
    if (!this.audio.src) return;
    try {
      await this.audio.play();
      this.setState('playing');
    } catch {
      this.callbacks.onError?.('Error al iniciar la reproducción.');
    }
  }

  public pause(): void {
    if (!this.audio.src) return;
    this.audio.pause();
    this.setState('paused');
  }

  public togglePlay(): void {
    if (this.state === 'playing') {
      this.pause();
    } else {
      void this.play();
    }
  }

  public stop(): void {
    if (!this.audio.src) return;
    this.audio.pause();
    this.audio.currentTime = 0;
    this.setState('stopped');
    this.callbacks.onTimeUpdate?.(0, this.audio.duration);
  }

  public seek(seconds: number): void {
    if (!this.audio.src || !Number.isFinite(this.audio.duration)) return;
    this.audio.currentTime = Math.max(0, Math.min(seconds, this.audio.duration));
  }

  public setVolume(value: number): void {
    const clamped = Math.max(0, Math.min(1, value));
    this.audio.volume = clamped;
    if (clamped > 0 && this.audio.muted) {
      this.audio.muted = false;
    }
  }

  public toggleMute(): boolean {
    this.audio.muted = !this.audio.muted;
    return this.audio.muted;
  }

  public get hasTrack(): boolean {
    return Boolean(this.audio.src);
  }

  public get isMuted(): boolean {
    return this.audio.muted;
  }

  public get currentTime(): number { return this.audio.currentTime; }
}
