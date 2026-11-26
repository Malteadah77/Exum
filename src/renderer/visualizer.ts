import type { VisualizerMode } from '../shared/types.js';

/**
 * Visualizador de espectro estilo Winamp usando <canvas> + AnalyserNode + requestAnimationFrame.
 * Usa la paleta activa de pledit.txt o viscolor.txt (.wsz), con buffers reutilizables y pausa en reposo.
 */
export class AudioVisualizer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private analyser: AnalyserNode | null = null;
  private freqData: Uint8Array<ArrayBuffer> | null = null;
  private timeData: Uint8Array<ArrayBuffer> | null = null;

  private mode: VisualizerMode = 'bars';
  private animationId: number | null = null;
  private customPalette: string[] | null = null;
  private cachedColors = { accent: '#c93b52', muted: '#5a1423', peak: '#fce7eb' };
  private cachedBarFill: string | CanvasGradient = '#c93b52';

  private isPlaying = false;
  private isVisible = true;

  private readonly barCount: number;
  private peaks: number[] = [];

  constructor(canvas: HTMLCanvasElement, barCount = 24) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('No se pudo inicializar el contexto 2D del visualizador.');
    }
    this.ctx = context;
    this.barCount = barCount;
    this.peaks = new Array(this.barCount).fill(0);
    this.refreshPalette();
    this.drawIdleFrame();
  }

  public setCustomPalette(colors: string[] | null): void {
    this.customPalette = colors && colors.length >= 18 ? colors : null;
    this.refreshPalette();
  }

  public refreshPalette(): void {
    if (this.customPalette) {
      this.cachedColors = {
        accent: this.customPalette[10] ?? this.customPalette[2] ?? '#00ff66',
        muted: this.customPalette[1] ?? '#555555',
        peak: this.customPalette[23] ?? '#ffffff',
      };
      const grad = this.ctx.createLinearGradient(0, 0, 0, this.canvas.height);
      grad.addColorStop(0, this.customPalette[2]);
      grad.addColorStop(0.5, this.customPalette[9]);
      grad.addColorStop(1, this.customPalette[17]);
      this.cachedBarFill = grad;
    } else {
      const styles = getComputedStyle(document.documentElement);
      this.cachedColors = {
        accent: styles.getPropertyValue('--wsz-pl-normal').trim() || '#c93b52',
        muted: styles.getPropertyValue('--wsz-pl-sel').trim() || '#5a1423',
        peak: styles.getPropertyValue('--wsz-pl-current').trim() || '#fce7eb',
      };
      this.cachedBarFill = this.cachedColors.accent;
    }

    if (this.animationId === null) {
      if (this.mode === 'off') this.drawOffLabel();
      else this.drawIdleFrame();
    }
  }

  public attachAnalyser(analyser: AnalyserNode): void {
    this.analyser = analyser;
    this.freqData = new Uint8Array(analyser.frequencyBinCount);
    this.timeData = new Uint8Array(analyser.fftSize);
    this.syncLoopState();
  }

  public setPlaying(playing: boolean): void {
    this.isPlaying = playing;
    this.syncLoopState();
    if (!playing && this.mode !== 'off') {
      this.peaks.fill(0);
      this.drawIdleFrame();
    }
  }

  public setVisible(visible: boolean): void {
    this.isVisible = visible;
    this.syncLoopState();
  }

  public setMode(mode: VisualizerMode): void {
    this.mode = mode;
    if (mode === 'off') {
      this.stop();
      this.drawOffLabel();
    } else {
      this.syncLoopState();
      if (this.animationId === null) {
        this.drawIdleFrame();
      }
    }
  }

  public cycleMode(): VisualizerMode {
    const order: VisualizerMode[] = ['bars', 'wave', 'off'];
    const next = order[(order.indexOf(this.mode) + 1) % order.length];
    this.setMode(next);
    return next;
  }

  private syncLoopState(): void {
    if (this.analyser && this.mode !== 'off' && this.isPlaying && this.isVisible) {
      this.start();
    } else {
      this.stop();
    }
  }

  public start(): void {
    if (this.animationId !== null || !this.analyser || this.mode === 'off') return;
    const loop = (): void => {
      this.renderFrame();
      this.animationId = requestAnimationFrame(loop);
    };
    this.animationId = requestAnimationFrame(loop);
  }

  public stop(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  private drawIdleFrame(): void {
    const { width, height } = this.canvas;
    this.ctx.clearRect(0, 0, width, height);

    this.ctx.strokeStyle = this.cachedColors.muted;
    this.ctx.globalAlpha = 0.35;
    this.ctx.beginPath();
    this.ctx.moveTo(0, height - 2);
    this.ctx.lineTo(width, height - 2);
    this.ctx.stroke();
    this.ctx.globalAlpha = 1;
  }

  private drawOffLabel(): void {
    const { width, height } = this.canvas;
    this.ctx.clearRect(0, 0, width, height);
    this.ctx.fillStyle = this.cachedColors.muted;
    this.ctx.font = '9px Consolas, monospace';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText('VIS OFF', width / 2, height / 2);
  }

  private renderFrame(): void {
    if (!this.analyser) return;
    const { width, height } = this.canvas;
    const { accent, peak } = this.cachedColors;

    this.ctx.clearRect(0, 0, width, height);

    if (this.mode === 'bars' && this.freqData) {
      this.analyser.getByteFrequencyData(this.freqData);

      const gap = 1;
      const barWidth = Math.max(1, (width - gap * (this.barCount - 1)) / this.barCount);
      const usableBins = Math.floor(this.freqData.length * 0.7);
      const step = Math.max(1, Math.floor(usableBins / this.barCount));

      for (let i = 0; i < this.barCount; i++) {
        let sum = 0;
        for (let j = 0; j < step; j++) {
          sum += this.freqData[i * step + j] ?? 0;
        }
        const avg = sum / step;
        const barHeight = (avg / 255) * (height - 2);
        const x = i * (barWidth + gap);
        const y = height - barHeight;

        this.ctx.fillStyle = this.cachedBarFill;
        this.ctx.globalAlpha = 0.92;
        this.ctx.fillRect(x, y, barWidth, barHeight);
        this.ctx.globalAlpha = 1;

        if (barHeight > this.peaks[i]) {
          this.peaks[i] = barHeight;
        } else {
          this.peaks[i] = Math.max(0, this.peaks[i] - 0.55);
        }

        if (this.peaks[i] > 1) {
          this.ctx.fillStyle = peak;
          this.ctx.fillRect(x, Math.max(0, height - this.peaks[i] - 1), barWidth, 1.5);
        }
      }
    } else if (this.mode === 'wave' && this.timeData) {
      this.analyser.getByteTimeDomainData(this.timeData);

      this.ctx.lineWidth = 1.5;
      this.ctx.strokeStyle = this.customPalette?.[18] ?? accent;
      this.ctx.beginPath();

      const sliceWidth = width / this.timeData.length;
      let x = 0;
      for (let i = 0; i < this.timeData.length; i++) {
        const normalized = this.timeData[i] / 128.0;
        const y = (normalized * height) / 2;
        if (i === 0) this.ctx.moveTo(x, y);
        else this.ctx.lineTo(x, y);
        x += sliceWidth;
      }

      this.ctx.lineTo(width, height / 2);
      this.ctx.stroke();
    }
  }
}
