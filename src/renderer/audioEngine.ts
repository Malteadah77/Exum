import { EQ_BANDS } from './equalizerPresets.js';

export type PlaybackState = 'idle' | 'playing' | 'paused' | 'stopped';

export interface AudioEngineCallbacks {
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  onStateChange?: (state: PlaybackState) => void;
  onTrackLoaded?: (duration: number) => void;
  onAudioGraphReady?: (analyser: AnalyserNode) => void;
  onCorsFallback?: () => void;
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
 * AudioElement -> MediaElementSource -> GainNode (Preamp) -> 10 BiquadFilterNodes (EQ)
 * -> StereoPannerNode (Balance) -> AnalyserNode -> Destination
 * Incluye fallback automático sin CORS para radios online que no envían Access-Control-Allow-Origin.
 */
export class AudioEngine {
  private primaryAudio: HTMLAudioElement;
  private fallbackAudio: HTMLAudioElement;
  private activeAudio: HTMLAudioElement;
  private usingFallback = false;

  private state: PlaybackState = 'idle';
  private currentUrl = '';
  private volume = 0.8;
  private callbacks: AudioEngineCallbacks;

  // Nodos de Web Audio API (creados la primera vez que se reproduce audio en primaryAudio)
  private audioCtx: AudioContext | null = null;
  private preampNode: GainNode | null = null;
  private pannerNode: StereoPannerNode | null = null;
  private filters: BiquadFilterNode[] = [];

  // Estado lógico del ecualizador y balance
  private eqEnabled = true;
  private preampDb = 0;
  private balance = 0;
  private eqGains: number[] = EQ_BANDS.map(() => 0);

  constructor(callbacks: AudioEngineCallbacks = {}) {
    this.primaryAudio = new Audio();
    this.fallbackAudio = new Audio();
    this.primaryAudio.volume = this.volume;
    this.fallbackAudio.volume = this.volume;
    this.activeAudio = this.primaryAudio;
    this.callbacks = callbacks;

    this.bindAudioEvents(this.primaryAudio, false);
    this.bindAudioEvents(this.fallbackAudio, true);
  }

  private isRemoteUrl(url: string): boolean {
    return url.startsWith('http://') || url.startsWith('https://');
  }

  private bindAudioEvents(el: HTMLAudioElement, isFallback: boolean): void {
    el.addEventListener('loadedmetadata', () => {
      if (el !== this.activeAudio) return;
      this.callbacks.onTrackLoaded?.(el.duration);
    });

    el.addEventListener('timeupdate', () => {
      if (el !== this.activeAudio) return;
      this.callbacks.onTimeUpdate?.(el.currentTime, el.duration);
    });

    el.addEventListener('ended', () => {
      if (el !== this.activeAudio) return;
      this.setState('stopped');
      this.callbacks.onTimeUpdate?.(0, el.duration);
      this.callbacks.onEnded?.();
    });

    el.addEventListener('error', () => {
      if (el !== this.activeAudio || !this.currentUrl) return;
      if (!isFallback && !this.usingFallback && this.isRemoteUrl(this.currentUrl)) {
        void this.activateCorsFallback();
        return;
      }
      this.setState('stopped');
      this.callbacks.onError?.('No se pudo reproducir este audio.');
    });
  }

  private async activateCorsFallback(): Promise<void> {
    if (!this.currentUrl || this.usingFallback) return;
    const targetUrl = this.currentUrl;
    this.usingFallback = true;

    this.primaryAudio.pause();
    this.primaryAudio.removeAttribute('src');
    this.primaryAudio.load();

    this.activeAudio = this.fallbackAudio;
    this.fallbackAudio.crossOrigin = null;
    this.fallbackAudio.volume = this.volume;
    this.fallbackAudio.src = targetUrl;
    this.fallbackAudio.load();

    this.callbacks.onCorsFallback?.();

    try {
      await this.fallbackAudio.play();
      if (this.currentUrl === targetUrl) {
        this.setState('playing');
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      this.setState('stopped');
      this.callbacks.onError?.('No se pudo reproducir este stream.');
    }
  }

  private ensureAudioGraph(): void {
    if (this.audioCtx) return;

    const ctx = new AudioContext();
    const source = ctx.createMediaElementSource(this.primaryAudio);

    const preamp = ctx.createGain();
    preamp.gain.value = this.eqEnabled ? Math.pow(10, this.preampDb / 20) : 1;

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

    const panner = ctx.createStereoPanner();
    panner.pan.value = this.balance;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;

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

  public load(fileUrl: string): void {
    this.currentUrl = fileUrl;

    // Limpiamos cualquier reproducción previa en el fallback
    if (this.usingFallback) {
      this.fallbackAudio.pause();
      this.fallbackAudio.removeAttribute('src');
      this.fallbackAudio.load();
    }

    this.usingFallback = false;
    this.activeAudio = this.primaryAudio;
    this.primaryAudio.crossOrigin = this.isRemoteUrl(fileUrl) ? 'anonymous' : null;
    this.primaryAudio.volume = this.volume;
    this.primaryAudio.src = fileUrl;
    this.primaryAudio.load();
    this.setState('stopped');
  }

  public async play(): Promise<void> {
    if (!this.currentUrl) return;
    try {
      if (!this.usingFallback) {
        this.ensureAudioGraph();
        if (this.audioCtx?.state === 'suspended') {
          await this.audioCtx.resume();
        }
      }
      await this.activeAudio.play();
      this.setState('playing');
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      if (!this.usingFallback && this.isRemoteUrl(this.currentUrl)) {
        await this.activateCorsFallback();
        return;
      }
      this.setState('stopped');
      this.callbacks.onError?.('Error al iniciar la reproducción.');
    }
  }

  public pause(): void {
    if (!this.currentUrl) return;
    this.activeAudio.pause();
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
    if (!this.currentUrl) return;
    // Para streams en vivo liberamos la conexión HTTP para no seguir descargando en segundo plano
    if (!Number.isFinite(this.activeAudio.duration)) {
      const savedUrl = this.currentUrl;
      this.activeAudio.pause();
      this.activeAudio.removeAttribute('src');
      this.activeAudio.load();
      this.load(savedUrl);
      this.callbacks.onTimeUpdate?.(0, 0);
      return;
    }

    this.activeAudio.pause();
    this.activeAudio.currentTime = 0;
    this.setState('stopped');
    this.callbacks.onTimeUpdate?.(0, this.activeAudio.duration);
  }

  public unload(): void {
    this.currentUrl = '';
    this.usingFallback = false;

    for (const el of [this.primaryAudio, this.fallbackAudio]) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    this.activeAudio = this.primaryAudio;
    this.setState('idle');
    this.callbacks.onTimeUpdate?.(0, 0);
  }

  public seek(seconds: number): void {
    if (!this.currentUrl || !Number.isFinite(this.activeAudio.duration)) return;
    this.activeAudio.currentTime = Math.max(0, Math.min(seconds, this.activeAudio.duration));
  }

  public setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
    this.primaryAudio.volume = this.volume;
    this.fallbackAudio.volume = this.volume;
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

  public get hasTrack(): boolean {
    return Boolean(this.currentUrl);
  }

  public get currentTime(): number {
    return this.activeAudio.currentTime;
  }
}
