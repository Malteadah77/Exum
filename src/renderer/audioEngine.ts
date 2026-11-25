import { EQ_BANDS } from './equalizerPresets.js';

export type PlaybackState = 'idle' | 'playing' | 'paused' | 'stopped';

export interface AudioEngineCallbacks {
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  onStateChange?: (state: PlaybackState) => void;
  onTrackLoaded?: (title: string, duration: number) => void;
  onAudioGraphReady?: (analyser: AnalyserNode) => void;
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
 * Motor de audio (Patrón Facade) con grafo de Web Audio API:
 * AudioElement -> MediaElementSource -> 10 BiquadFilterNodes (EQ) -> AnalyserNode -> Destination
 */
export class AudioEngine {
  private audio: HTMLAudioElement;
  private state: PlaybackState = 'idle';
  private currentTitle = '';
  private callbacks: AudioEngineCallbacks;

  // Nodos de Web Audio API (se crean la primera vez que se reproduce audio)
  private audioCtx: AudioContext | null = null;
  private preampNode: GainNode | null = null;
  private pannerNode: StereoPannerNode | null = null;
  private filters: BiquadFilterNode[] = [];
  private analyser: AnalyserNode | null = null;

  // Estado lógico del ecualizador y balance
  private eqEnabled = true;
  private preampDb = 0;
  private balance = 0; // -1 (izquierda) a +1 (derecha)
  private eqGains: number[] = EQ_BANDS.map(() => 0);

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

  /**
   * Construye el grafo de procesamiento de audio una sola vez (lazy init).
   */
  private ensureAudioGraph(): void {
    if (this.audioCtx) return;

    const ctx = new AudioContext();
    const source = ctx.createMediaElementSource(this.audio);

    // Preamp (ganancia global del EQ en dB)
    const preamp = ctx.createGain();
    preamp.gain.value = this.eqEnabled ? Math.pow(10, this.preampDb / 20) : 1;

    // Creamos los 10 filtros de frecuencia en serie
    this.filters = EQ_BANDS.map((band, index) => {
      const filter = ctx.createBiquadFilter();
      if (index === 0) {
        filter.type = 'lowshelf';
      } else if (index === EQ_BANDS.length - 1) {
        filter.type = 'highshelf';
      } else {
        filter.type = 'peaking';
        filter.Q.value = 1.4;
      }
      filter.frequency.value = band.freq;
      filter.gain.value = this.eqEnabled ? this.eqGains[index] : 0;
      return filter;
    });

    // Balance estéreo (Izquierda <-> Derecha)
    const panner = ctx.createStereoPanner();
    panner.pan.value = this.balance;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;

    // Cadena: source -> preamp -> filter[0..9] -> panner -> analyser -> speakers
    source.connect(preamp);
    let currentNode: AudioNode = preamp;
    for (const filter of this.filters) {
      currentNode.connect(filter);
      currentNode = filter;
    }
    currentNode.connect(panner);
    panner.connect(analyser);
    analyser.connect(ctx.destination);

    this.audioCtx = ctx;
    this.preampNode = preamp;
    this.pannerNode = panner;
    this.analyser = analyser;
    this.callbacks.onAudioGraphReady?.(analyser);
  }

  private applyFilterGains(): void {
    if (this.preampNode) {
      this.preampNode.gain.value = this.eqEnabled ? Math.pow(10, this.preampDb / 20) : 1;
    }
    if (this.filters.length === 0) return;
    this.filters.forEach((filter, idx) => {
      filter.gain.value = this.eqEnabled ? this.eqGains[idx] : 0;
    });
  }

  private setState(newState: PlaybackState): void {
    this.state = newState;
    this.callbacks.onStateChange?.(newState);
  }

  public load(fileUrl: string, title: string): void {
    this.currentTitle = title;
    const isRemote = fileUrl.startsWith('http://') || fileUrl.startsWith('https://');
    // Permite que streams HTTP/HTTPS con CORS pasen por el Ecualizador y Visualizador Web Audio
    this.audio.crossOrigin = isRemote ? 'anonymous' : null;
    this.audio.src = fileUrl;
    this.audio.load();
    this.setState('stopped');
  }

  public async play(): Promise<void> {
    if (!this.audio.src) return;
    try {
      this.ensureAudioGraph();
      if (this.audioCtx?.state === 'suspended') {
        await this.audioCtx.resume();
      }
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

  // API del Ecualizador y Balance
  public setEqEnabled(enabled: boolean): void {
    this.eqEnabled = enabled;
    this.applyFilterGains();
  }

  public setPreampGain(db: number): void {
    this.preampDb = Math.max(-12, Math.min(12, db));
    if (this.preampNode && this.eqEnabled) {
      this.preampNode.gain.value = Math.pow(10, this.preampDb / 20);
    }
  }

  public setBalance(pan: number): void {
    this.balance = Math.max(-1, Math.min(1, pan));
    if (this.pannerNode) {
      this.pannerNode.pan.value = this.balance;
    }
  }

  public setBandGain(bandIndex: number, db: number): void {
    if (bandIndex < 0 || bandIndex >= this.eqGains.length) return;
    const clamped = Math.max(-12, Math.min(12, db));
    this.eqGains[bandIndex] = clamped;
    if (this.filters[bandIndex] && this.eqEnabled) {
      this.filters[bandIndex].gain.value = clamped;
    }
  }

  public setAllBandGains(gains: number[]): void {
    if (gains.length !== this.eqGains.length) return;
    this.eqGains = gains.map((g) => Math.max(-12, Math.min(12, g)));
    this.applyFilterGains();
  }

  public getEqGains(): number[] {
    return [...this.eqGains];
  }

  public get isEqEnabled(): boolean {
    return this.eqEnabled;
  }

  public getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  public get hasTrack(): boolean {
    return Boolean(this.audio.src);
  }

  public get isMuted(): boolean {
    return this.audio.muted;
  }

  public get currentTime(): number {
    return this.audio.currentTime;
  }
}
