import type { VisualizerMode } from '../shared/types.js';

/**
 * Visualizador de espectro estilo Winamp usando <canvas> + AnalyserNode + requestAnimationFrame.
 * Soporta colores automáticos de la skin CSS (--accent) o paleta exacta de viscolor.txt (.wsz).
 */
export class AudioVisualizer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private analyser: AnalyserNode | null = null;
  private mode: VisualizerMode = 'bars';
  private animationId: number | null = null;
  private customPalette: string[] | null = null;

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
    this.drawIdleFrame();
  }

  public setCustomPalette(colors: string[] | null): void {
    this.customPalette = colors && colors.length >= 18 ? colors : null;
  }

  public attachAnalyser(analyser: AnalyserNode): void {
    this.analyser = analyser;
    if (this.mode !== 'off') {
      this.start();
    }
  }

  public setMode(mode: VisualizerMode): void {
    this.mode = mode;
    if (mode === 'off') {
      this.stop();
      this.drawOffLabel();
    } else if (this.analyser) {
      this.start();
    } else {
      this.drawIdleFrame();
    }
  }

  public cycleMode(): VisualizerMode {
    const order: VisualizerMode[] = ['bars', 'wave', 'off'];
    const next = order[(order.indexOf(this.mode) + 1) % order.length];
    this.setMode(next);
    return next;
  }

  public get currentMode(): VisualizerMode {
    return this.mode;
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

  private getThemeColors(): { accent: string; muted: string; peak: string } {
    if (this.customPalette) {
      return {
        accent: this.customPalette[10] ?? this.customPalette[2] ?? '#00ff66',
        muted: this.customPalette[1] ?? '#555555',
        peak: this.customPalette[23] ?? '#ffffff',
      };
    }

    const styles = getComputedStyle(document.documentElement);
    return {
      accent:
        styles.getPropertyValue('--wsz-pl-normal').trim() ||
        styles.getPropertyValue('--accent').trim() ||
        '#c93b52',
      muted: styles.getPropertyValue('--wsz-pl-sel').trim() || '#5a1423',
      peak: styles.getPropertyValue('--wsz-pl-current').trim() || '#fce7eb',
    };
  }

  private drawIdleFrame(): void {
    const { width, height } = this.canvas;
    const { muted } = this.getThemeColors();
    this.ctx.clearRect(0, 0, width, height);

    this.ctx.strokeStyle = muted;
    this.ctx.globalAlpha = 0.35;
    this.ctx.beginPath();
    this.ctx.moveTo(0, height - 2);
    this.ctx.lineTo(width, height - 2);
    this.ctx.stroke();
    this.ctx.globalAlpha = 1;
  }

  private drawOffLabel(): void {
    const { width, height } = this.canvas;
    const { muted } = this.getThemeColors();
    this.ctx.clearRect(0, 0, width, height);
    this.ctx.fillStyle = muted;
    this.ctx.font = '9px Consolas, monospace';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText('VIS OFF', width / 2, height / 2);
  }

  private renderFrame(): void {
    if (!this.analyser) return;
    const { width, height } = this.canvas;
    const { accent, peak } = this.getThemeColors();

    this.ctx.clearRect(0, 0, width, height);

    if (this.mode === 'bars') {
      const freqData = new Uint8Array(this.analyser.frequencyBinCount);
      this.analyser.getByteFrequencyData(freqData);

      const gap = width < 100 ? 1 : 2;
      const barWidth = Math.max(1, (width - gap * (this.barCount - 1)) / this.barCount);
      const usableBins = Math.floor(freqData.length * 0.7);
      const step = Math.max(1, Math.floor(usableBins / this.barCount));

      // Si tenemos viscolor.txt, creamos el gradiente vertical clásico (líneas 2..17)
      let fillStyle: string | CanvasGradient = accent;
      if (this.customPalette && this.customPalette.length >= 18) {
        const grad = this.ctx.createLinearGradient(0, 0, 0, height);
        grad.addColorStop(0, this.customPalette[2]);
        grad.addColorStop(0.5, this.customPalette[9]);
        grad.addColorStop(1, this.customPalette[17]);
        fillStyle = grad;
      }

      for (let i = 0; i < this.barCount; i++) {
        let sum = 0;
        for (let j = 0; j < step; j++) {
          sum += freqData[i * step + j] ?? 0;
        }
        const avg = sum / step;
        const barHeight = (avg / 255) * (height - 2);
        const x = i * (barWidth + gap);
        const y = height - barHeight;

        this.ctx.fillStyle = fillStyle;
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
    } else if (this.mode === 'wave') {
      const timeData = new Uint8Array(this.analyser.fftSize);
      this.analyser.getByteTimeDomainData(timeData);

      this.ctx.lineWidth = 1.5;
      this.ctx.strokeStyle = this.customPalette?.[18] ?? accent;
      this.ctx.beginPath();

      const sliceWidth = width / timeData.length;
      let x = 0;
      for (let i = 0; i < timeData.length; i++) {
        const normalized = timeData[i] / 128.0;
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
