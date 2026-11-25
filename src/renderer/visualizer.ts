import type { VisualizerMode } from '../shared/types.js';

/**
 * Visualizador de espectro estilo Winamp usando <canvas> + AnalyserNode + requestAnimationFrame.
 * Lee automáticamente las variables CSS de la skin activa (--accent, --text-muted).
 */
export class AudioVisualizer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private analyser: AnalyserNode | null = null;
  private mode: VisualizerMode = 'bars';
  private animationId: number | null = null;

  // Picos flotantes que caen lentamente por gravedad (detalle clásico de Winamp)
  private readonly barCount = 24;
  private peaks: number[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('No se pudo inicializar el contexto 2D del visualizador.');
    }
    this.ctx = context;
    this.peaks = new Array(this.barCount).fill(0);
    this.drawIdleFrame();
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

  private getThemeColors(): { accent: string; muted: string } {
    const styles = getComputedStyle(document.documentElement);
    return {
      accent: styles.getPropertyValue('--accent').trim() || '#00ff66',
      muted: styles.getPropertyValue('--text-muted').trim() || '#7a869a',
    };
  }

  private drawIdleFrame(): void {
    const { width, height } = this.canvas;
    const { muted } = this.getThemeColors();
    this.ctx.clearRect(0, 0, width, height);

    // Línea base sutil en reposo
    this.ctx.strokeStyle = muted;
    this.ctx.globalAlpha = 0.35;
    this.ctx.beginPath();
    this.ctx.moveTo(0, height - 3);
    this.ctx.lineTo(width, height - 3);
    this.ctx.stroke();
    this.ctx.globalAlpha = 1;
  }

  private drawOffLabel(): void {
    const { width, height } = this.canvas;
    const { muted } = this.getThemeColors();
    this.ctx.clearRect(0, 0, width, height);
    this.ctx.fillStyle = muted;
    this.ctx.font = '10px Consolas, monospace';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText('VIS OFF', width / 2, height / 2);
  }

  private renderFrame(): void {
    if (!this.analyser) return;
    const { width, height } = this.canvas;
    const { accent } = this.getThemeColors();

    this.ctx.clearRect(0, 0, width, height);

    if (this.mode === 'bars') {
      const freqData = new Uint8Array(this.analyser.frequencyBinCount);
      this.analyser.getByteFrequencyData(freqData);

      const gap = 2;
      const barWidth = (width - gap * (this.barCount - 1)) / this.barCount;
      // Usamos el primer 70% del espectro donde vive casi toda la energía musical
      const usableBins = Math.floor(freqData.length * 0.7);
      const step = Math.max(1, Math.floor(usableBins / this.barCount));

      for (let i = 0; i < this.barCount; i++) {
        let sum = 0;
        for (let j = 0; j < step; j++) {
          sum += freqData[i * step + j] ?? 0;
        }
        const avg = sum / step;
        const barHeight = (avg / 255) * (height - 4);
        const x = i * (barWidth + gap);
        const y = height - barHeight;

        // Barra principal
        this.ctx.fillStyle = accent;
        this.ctx.globalAlpha = 0.85;
        this.ctx.fillRect(x, y, barWidth, barHeight);
        this.ctx.globalAlpha = 1;

        // Pico flotante con gravedad suave
        if (barHeight > this.peaks[i]) {
          this.peaks[i] = barHeight;
        } else {
          this.peaks[i] = Math.max(0, this.peaks[i] - 0.7);
        }

        if (this.peaks[i] > 1) {
          this.ctx.fillStyle = '#ffffff';
          this.ctx.fillRect(x, height - this.peaks[i] - 2, barWidth, 2);
        }
      }
    } else if (this.mode === 'wave') {
      const timeData = new Uint8Array(this.analyser.fftSize);
      this.analyser.getByteTimeDomainData(timeData);

      this.ctx.lineWidth = 1.8;
      this.ctx.strokeStyle = accent;
      this.ctx.beginPath();

      const sliceWidth = width / timeData.length;
      let x = 0;
      for (let i = 0; i < timeData.length; i++) {
        const normalized = timeData[i] / 128.0; // 1.0 = silencio (centro)
        const y = (normalized * height) / 2;
        if (i === 0) {
          this.ctx.moveTo(x, y);
        } else {
          this.ctx.lineTo(x, y);
        }
        x += sliceWidth;
      }

      this.ctx.lineTo(width, height / 2);
      this.ctx.stroke();
    }
  }
}
