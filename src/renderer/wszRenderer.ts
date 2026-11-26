import type { PanelState, RepeatMode, Track, WszPleditColors, WszSkinData } from '../shared/types.js';
import type { PlaybackState } from './audioEngine.js';
import { formatTime } from './audioEngine.js';
import { EQ_BANDS, EQ_PRESETS } from './equalizerPresets.js';

export const DEFAULT_PALETTE: WszPleditColors = {
  normal: '#c93b52',
  current: '#fce7eb',
  normalBg: '#0e090b',
  selectedBg: '#5a1423',
  font: 'Consolas, monospace',
};

export interface ClassicViewCallbacks {
  onPrev: () => void;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onNext: () => void;
  onEject: () => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onSeek: (seconds: number) => void;
  onVolume: (percent: number) => void;
  onBalance: (pan: number) => void;
  onPreampChange: (db: number) => void;
  onEqBandChange: (bandIndex: number, db: number, commit: boolean) => void;
  onEqToggle: () => void;
  onEqReset: () => void;
  onEqPresetSelect: (presetId: string, gains: number[]) => void;
  onPanelsVisibilityChange: (eqState: PanelState, plState: PanelState) => void;
  onOpenSkins: () => void;
  onOpenLyrics: () => void;
  onOpenSources: () => void;
  onSelectFolder: () => void;
  onToggleAlwaysOnTop: () => Promise<boolean>;
  onToggleDoubleSize: () => Promise<boolean>;
  onCycleVisualizer: () => void;
  onMinimize: () => void;
  onClose: () => void;
  onMiniMode: () => void;
}

const SPRITE_VARS = [
  '--wsz-main',
  '--wsz-titlebar',
  '--wsz-cbuttons',
  '--wsz-posbar',
  '--wsz-volume',
  '--wsz-balance',
  '--wsz-shufrep',
  '--wsz-numbers',
  '--wsz-playpaus',
  '--wsz-monoster',
  '--wsz-eqmain',
  '--wsz-eq-ex',
  '--wsz-pledit',
] as const;

interface EqSliderControl {
  wrap: HTMLElement;
  thumb: HTMLElement;
  input: HTMLInputElement;
}

export function applyPaletteToDocument(palette: WszPleditColors): void {
  const root = document.documentElement.style;
  root.setProperty('--wsz-pl-normal', palette.normal);
  root.setProperty('--wsz-pl-current', palette.current);
  root.setProperty('--wsz-pl-bg', palette.normalBg);
  root.setProperty('--wsz-pl-sel', palette.selectedBg);
  root.setProperty('--wsz-pl-font', palette.font);
}

function paintEqSliderSprite(ctrl: EqSliderControl, db: number): void {
  const clamped = Math.max(-12, Math.min(12, db));
  const ratio = (clamped + 12) / 24;
  const frame = Math.round(ratio * 27);

  const col = frame % 14;
  const row = Math.floor(frame / 14);
  const bgX = 13 + col * 15;
  const bgY = row === 0 ? 164 : 229;
  ctrl.wrap.style.backgroundPosition = `${-bgX}px ${-bgY}px`;

  const topPx = Math.round((1 - ratio) * 52);
  ctrl.thumb.style.top = `${topPx}px`;
  ctrl.input.value = String(clamped);
}

/**
 * Renderizador unificado Winamp 2.x (.wsz) con los 8 elementos de Webamp:
 * Kbps/Khz, Mono/Stereo, PlayPause, perillas Vol/Bal, Marquee con scroll + feedback,
 * reloj transcurrido/restante, ClutterBar (O A I D V) y EqGraph en vivo.
 */
export class WszClassicView {
  private stage: HTMLElement;
  private callbacks: ClassicViewCallbacks;
  private currentSkin: WszSkinData | null = null;
  private currentTrack: Track | null = null;
  private duration = 0;
  private lastCurrentSec = 0;
  private showRemainingTime = false;
  private isSeeking = false;

  private eqState: PanelState = 'open';
  private plState: PanelState = 'open';
  private eqEnabled = true;
  private preampDb = 0;
  private eqGains: number[] = EQ_BANDS.map(() => 0);

  private baseMarqueeText = 'EXUM — ARRASTRA MP3 O ELIGE CARPETA';
  private tempMarqueeTimer: ReturnType<typeof setTimeout> | null = null;

  private digitEls: HTMLElement[] = [];
  private minusEl: HTMLElement | null;
  private playpausEl: HTMLElement | null;
  private marqueeBox: HTMLElement | null;
  private marqueeTextEl: HTMLElement | null;
  private kbpsEl: HTMLElement | null;
  private khzEl: HTMLElement | null;
  private monoEl: HTMLElement | null;
  private stereoEl: HTMLElement | null;
  private posSlider: HTMLInputElement | null;
  private posThumb: HTMLElement | null;
  private volSlider: HTMLInputElement | null;
  private volBg: HTMLElement | null;
  private volThumb: HTMLElement | null;
  private balSlider: HTMLInputElement | null;
  private balBg: HTMLElement | null;
  private balThumb: HTMLElement | null;
  private shufBtn: HTMLElement | null;
  private repBtn: HTMLElement | null;
  private eqToggleBtn: HTMLElement | null;
  private plToggleBtn: HTMLElement | null;
  private eqDeck: HTMLElement | null;
  private plSection: HTMLElement | null;
  private eqOnBtn: HTMLElement | null;
  private eqAutoBtn: HTMLElement | null;
  private eqPresetsBtn: HTMLElement | null;
  private presetsMenu: HTMLElement | null;
  private mainMenuBtn: HTMLElement | null;
  private mainMenu: HTMLElement | null;
  private plTopScaleWrap: HTMLElement | null;
  private plSideLeft: HTMLElement | null;
  private plSideRight: HTMLElement | null;
  private plClassicScaleWrap: HTMLElement | null;
  private plShadeScaleWrap: HTMLElement | null;
  private plShadeTrackEl: HTMLElement | null;
  private plShadeDurEl: HTMLElement | null;
  private eqShadeVolThumb: HTMLElement | null;
  private eqShadeVolInput: HTMLInputElement | null;
  private eqShadeBalThumb: HTMLElement | null;
  private eqShadeBalInput: HTMLInputElement | null;
  private eqGraphCanvas: HTMLCanvasElement | null;

  private preampCtrl: EqSliderControl | null = null;
  private eqBandCtrls: EqSliderControl[] = [];

  constructor(stage: HTMLElement, callbacks: ClassicViewCallbacks) {
    this.stage = stage;
    this.callbacks = callbacks;

    this.digitEls = [
      document.getElementById('wsz-d0'),
      document.getElementById('wsz-d1'),
      document.getElementById('wsz-d2'),
      document.getElementById('wsz-d3'),
    ].filter((el): el is HTMLElement => Boolean(el));

    this.minusEl = document.getElementById('wsz-minus');
    this.playpausEl = document.getElementById('wsz-playpaus');
    this.marqueeBox = document.getElementById('wsz-track-title');
    this.marqueeTextEl = document.getElementById('wsz-marquee-text');
    this.kbpsEl = document.getElementById('wsz-kbps');
    this.khzEl = document.getElementById('wsz-khz');
    this.monoEl = document.getElementById('wsz-mono');
    this.stereoEl = document.getElementById('wsz-stereo');

    this.posSlider = document.getElementById('wsz-pos-slider') as HTMLInputElement | null;
    this.posThumb = document.getElementById('wsz-pos-thumb');
    this.volSlider = document.getElementById('wsz-vol-slider') as HTMLInputElement | null;
    this.volBg = document.getElementById('wsz-vol-bg');
    this.volThumb = document.getElementById('wsz-vol-thumb');
    this.balSlider = document.getElementById('wsz-bal-slider') as HTMLInputElement | null;
    this.balBg = document.getElementById('wsz-bal-bg');
    this.balThumb = document.getElementById('wsz-bal-thumb');
    this.shufBtn = document.getElementById('wsz-btn-shuffle');
    this.repBtn = document.getElementById('wsz-btn-repeat');
    this.eqToggleBtn = document.getElementById('wsz-btn-eq-toggle');
    this.plToggleBtn = document.getElementById('wsz-btn-pl-toggle');
    this.eqDeck = document.getElementById('wsz-eq-deck');
    this.plSection = document.getElementById('playlist-section');
    this.eqOnBtn = document.getElementById('wsz-eq-on');
    this.eqAutoBtn = document.getElementById('wsz-eq-auto');
    this.eqPresetsBtn = document.getElementById('wsz-eq-presets-btn');
    this.presetsMenu = document.getElementById('wsz-presets-menu');
    this.mainMenuBtn = document.getElementById('wsz-main-menu-btn');
    this.mainMenu = document.getElementById('wsz-main-menu');
    this.plTopScaleWrap = document.getElementById('pl-top-scale-wrap');
    this.plSideLeft = document.getElementById('pl-side-left');
    this.plSideRight = document.getElementById('pl-side-right');
    this.plClassicScaleWrap = document.getElementById('pl-classic-scale-wrap');
    this.plShadeScaleWrap = document.getElementById('pl-shade-scale-wrap');
    this.plShadeTrackEl = document.getElementById('pl-shade-track');
    this.plShadeDurEl = document.getElementById('pl-shade-dur');
    this.eqShadeVolThumb = document.getElementById('wsz-eq-shade-vol-thumb');
    this.eqShadeVolInput = document.getElementById('wsz-eq-shade-vol-input') as HTMLInputElement | null;
    this.eqShadeBalThumb = document.getElementById('wsz-eq-shade-bal-thumb');
    this.eqShadeBalInput = document.getElementById('wsz-eq-shade-bal-input') as HTMLInputElement | null;
    this.eqGraphCanvas = document.getElementById('wsz-eq-graph') as HTMLCanvasElement | null;

    this.buildClassicEqSliders();
    this.buildPresetsMenu();
    this.bindEvents();
    this.updateBalanceSprite(0);
    this.renderEqGraph();
    this.fitToWindowWidth();
  }

  public fitToWindowWidth(): void {
    const scale = Math.max(1, Math.min(2.5, window.innerWidth / 275));
    const z = String(scale);
    (this.stage.style as unknown as Record<string, string>).zoom = z;
    if (this.plTopScaleWrap) (this.plTopScaleWrap.style as unknown as Record<string, string>).zoom = z;
    if (this.plSideLeft) (this.plSideLeft.style as unknown as Record<string, string>).zoom = z;
    if (this.plSideRight) (this.plSideRight.style as unknown as Record<string, string>).zoom = z;
    if (this.plClassicScaleWrap) {
      (this.plClassicScaleWrap.style as unknown as Record<string, string>).zoom = z;
    }
    if (this.plShadeScaleWrap) {
      (this.plShadeScaleWrap.style as unknown as Record<string, string>).zoom = z;
    }
  }

  /**
   * Recorta los mosaicos exactos de pledit.bmp en <canvas> para que repeat-x / repeat-y
   * no mezcle otras partes del sprite sheet (técnica estándar de Webamp).
   */
  private extractPleditTiles(pleditDataUrl: string): void {
    const img = new Image();
    img.onload = () => {
      const crop = (sx: number, sy: number, sw: number, sh: number): string => {
        const c = document.createElement('canvas');
        c.width = sw;
        c.height = sh;
        const ctx = c.getContext('2d');
        if (ctx) ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
        return `url("${c.toDataURL()}")`;
      };

      const root = document.documentElement.style;
      root.setProperty('--wsz-pl-top-fill', crop(127, 0, 25, 20));
      root.setProperty('--wsz-pl-left-tile', crop(0, 42, 12, 29));
      root.setProperty('--wsz-pl-right-tile', crop(31, 42, 20, 29));
      root.setProperty('--wsz-pl-shade-mid', crop(72, 57, 25, 14));
    };
    img.src = pleditDataUrl;
  }

  public setEqPanelState(state: PanelState): void {
    this.eqState = state;
    this.eqDeck?.classList.toggle('hidden', state === 'closed');
    this.eqDeck?.classList.toggle('shaded', state === 'shaded');
    this.eqToggleBtn?.classList.toggle('active', state !== 'closed');
    this.callbacks.onPanelsVisibilityChange(this.eqState, this.plState);
  }

  public setPlPanelState(state: PanelState): void {
    this.plState = state;
    this.plSection?.classList.toggle('hidden', state === 'closed');
    this.plSection?.classList.toggle('shaded', state === 'shaded');
    this.plToggleBtn?.classList.toggle('active', state !== 'closed');
    this.callbacks.onPanelsVisibilityChange(this.eqState, this.plState);
  }

  private setMarqueeContent(text: string, allowScroll: boolean): void {
    if (!this.marqueeTextEl || !this.marqueeBox) return;
    this.marqueeTextEl.textContent = text;
    this.marqueeTextEl.classList.remove('scrolling');

    if (allowScroll) {
      // Activamos scroll estilo Winamp solo si el texto excede el ancho de 154px
      requestAnimationFrame(() => {
        if (!this.marqueeTextEl || !this.marqueeBox) return;
        const needsScroll = this.marqueeTextEl.scrollWidth > this.marqueeBox.clientWidth - 4;
        this.marqueeTextEl.classList.toggle('scrolling', needsScroll);
      });
    }
  }

  public showTempMarquee(message: string): void {
    if (this.tempMarqueeTimer) clearTimeout(this.tempMarqueeTimer);
    this.setMarqueeContent(message, false);
    this.tempMarqueeTimer = setTimeout(() => {
      this.tempMarqueeTimer = null;
      this.setMarqueeContent(this.baseMarqueeText, true);
    }, 1200);
  }

  private createEqSliderControl(leftPx: number, title: string): EqSliderControl {
    const wrap = document.createElement('div');
    wrap.className = 'wsz-eq-band-wrap';
    wrap.style.left = `${leftPx}px`;

    const thumb = document.createElement('div');
    thumb.className = 'wsz-eq-thumb';

    const input = document.createElement('input');
    input.type = 'range';
    input.className = 'wsz-eq-band-input';
    input.min = '-12';
    input.max = '12';
    input.step = '1';
    input.value = '0';
    input.title = title;

    wrap.append(thumb, input);
    const ctrl = { wrap, thumb, input };
    paintEqSliderSprite(ctrl, 0);
    return ctrl;
  }

  private buildClassicEqSliders(): void {
    const container = document.getElementById('wsz-eq-sliders');
    if (!container) return;
    container.innerHTML = '';

    // Preamp (x: 21px)
    const preamp = this.createEqSliderControl(21, 'Preamp (dB)');
    preamp.input.addEventListener('input', () => {
      const db = Number(preamp.input.value);
      this.preampDb = db;
      paintEqSliderSprite(preamp, db);
      this.renderEqGraph();
      this.showTempMarquee(`EQ PREAMP: ${db > 0 ? `+${db}` : db} dB`);
      this.callbacks.onPreampChange(db);
    });
    preamp.input.addEventListener('dblclick', () => {
      this.preampDb = 0;
      paintEqSliderSprite(preamp, 0);
      this.renderEqGraph();
      this.showTempMarquee('EQ PREAMP: 0 dB');
      this.callbacks.onPreampChange(0);
    });
    container.appendChild(preamp.wrap);
    this.preampCtrl = preamp;

    // 10 bandas
    EQ_BANDS.forEach((band, index) => {
      const ctrl = this.createEqSliderControl(78 + index * 18, `${band.label} Hz`);
      ctrl.input.addEventListener('input', () => {
        const db = Number(ctrl.input.value);
        this.eqGains[index] = db;
        paintEqSliderSprite(ctrl, db);
        this.renderEqGraph();
        this.showTempMarquee(`EQ ${band.label}Hz: ${db > 0 ? `+${db}` : db} dB`);
        this.callbacks.onEqBandChange(index, db, false);
      });
      ctrl.input.addEventListener('change', () => {
        this.callbacks.onEqBandChange(index, Number(ctrl.input.value), true);
      });
      ctrl.input.addEventListener('dblclick', () => {
        this.eqGains[index] = 0;
        paintEqSliderSprite(ctrl, 0);
        this.renderEqGraph();
        this.showTempMarquee(`EQ ${band.label}Hz: 0 dB`);
        this.callbacks.onEqBandChange(index, 0, true);
      });
      container.appendChild(ctrl.wrap);
      this.eqBandCtrls.push(ctrl);
    });
  }

  private buildPresetsMenu(): void {
    if (!this.presetsMenu) return;
    this.presetsMenu.innerHTML = '';

    for (const preset of EQ_PRESETS) {
      const btn = document.createElement('button');
      btn.className = 'wsz-preset-item';
      btn.textContent = preset.name;
      btn.addEventListener('click', () => {
        this.showTempMarquee(`PRESET: ${preset.name.toUpperCase()}`);
        this.callbacks.onEqPresetSelect(preset.id, [...preset.gains]);
        this.presetsMenu?.classList.add('hidden');
        this.eqPresetsBtn?.classList.remove('active');
      });
      this.presetsMenu.appendChild(btn);
    }
  }

  private renderEqGraph(): void {
    if (!this.eqGraphCanvas) return;
    const ctx = this.eqGraphCanvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = this.eqGraphCanvas;
    ctx.clearRect(0, 0, width, height);

    const styles = getComputedStyle(document.documentElement);
    const lineColor =
      this.currentSkin?.visColors[10] ||
      styles.getPropertyValue('--wsz-pl-normal').trim() ||
      '#c93b52';

    // Línea de referencia central (0 dB)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    // Curva de respuesta de las 10 bandas + preamp
    ctx.strokeStyle = lineColor;
    ctx.globalAlpha = this.eqEnabled ? 0.95 : 0.35;
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    const stepX = width / (this.eqGains.length - 1);
    this.eqGains.forEach((db, idx) => {
      const effectiveDb = this.eqEnabled ? Math.max(-12, Math.min(12, db + this.preampDb * 0.5)) : 0;
      const x = idx * stepX;
      const y = height / 2 - (effectiveDb / 12) * (height / 2 - 2);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private bindEvents(): void {
    document.getElementById('wsz-btn-prev')?.addEventListener('click', () => this.callbacks.onPrev());
    document.getElementById('wsz-btn-play')?.addEventListener('click', () => this.callbacks.onPlay());
    document.getElementById('wsz-btn-pause')?.addEventListener('click', () => this.callbacks.onPause());
    document.getElementById('wsz-btn-stop')?.addEventListener('click', () => this.callbacks.onStop());
    document.getElementById('wsz-btn-next')?.addEventListener('click', () => this.callbacks.onNext());
    document.getElementById('wsz-btn-eject')?.addEventListener('click', () => this.callbacks.onEject());

    this.shufBtn?.addEventListener('click', () => this.callbacks.onToggleShuffle());
    this.repBtn?.addEventListener('click', () => this.callbacks.onCycleRepeat());

    // Reloj clicable: alterna tiempo transcurrido / restante
    document.getElementById('wsz-clock')?.addEventListener('click', () => {
      this.showRemainingTime = !this.showRemainingTime;
      this.updateTime(this.lastCurrentSec, this.duration);
      this.showTempMarquee(this.showRemainingTime ? 'TIME: REMAINING' : 'TIME: ELAPSED');
    });

    // ClutterBar (O A I D V)
    document.getElementById('wsz-clutter-o')?.addEventListener('click', () => {
      this.callbacks.onOpenSkins();
    });
    const clutterA = document.getElementById('wsz-clutter-a');
    clutterA?.addEventListener('click', async () => {
      const pinned = await this.callbacks.onToggleAlwaysOnTop();
      clutterA.classList.toggle('active', pinned);
      this.showTempMarquee(pinned ? 'ALWAYS ON TOP: ON' : 'ALWAYS ON TOP: OFF');
    });
    document.getElementById('wsz-clutter-i')?.addEventListener('click', () => {
      if (!this.currentTrack) {
        this.showTempMarquee('EXUM v1.1 — NO TRACK');
        return;
      }
      const kbps = this.currentTrack.bitrate ? `${this.currentTrack.bitrate}kbps` : 'LIVE';
      const khz = this.currentTrack.sampleRate ? `${Math.round(this.currentTrack.sampleRate / 1000)}kHz` : '';
      this.showTempMarquee(`${this.currentTrack.codec ?? 'AUDIO'} ${kbps} ${khz}`.trim());
    });
    const clutterD = document.getElementById('wsz-clutter-d');
    clutterD?.addEventListener('click', async () => {
      const isDouble = await this.callbacks.onToggleDoubleSize();
      clutterD.classList.toggle('active', isDouble);
      this.showTempMarquee(isDouble ? 'DOUBLE SIZE: 2X' : 'NORMAL SIZE: 1.5X');
    });
    document.getElementById('wsz-clutter-v')?.addEventListener('click', () => {
      this.callbacks.onCycleVisualizer();
      this.showTempMarquee('VISUALIZER MODE CHANGED');
    });

    // Toggle EQ y PL (botones principales abren/cierran; botones de cada sección resumen/cierran)
    this.eqToggleBtn?.addEventListener('click', () => {
      this.setEqPanelState(this.eqState === 'closed' ? 'open' : 'closed');
    });
    this.plToggleBtn?.addEventListener('click', () => {
      this.setPlPanelState(this.plState === 'closed' ? 'open' : 'closed');
    });

    document.getElementById('wsz-eq-min')?.addEventListener('click', () => {
      this.setEqPanelState(this.eqState === 'shaded' ? 'open' : 'shaded');
    });
    document.getElementById('wsz-eq-close')?.addEventListener('click', () => this.setEqPanelState('closed'));

    document.getElementById('pl-win-min')?.addEventListener('click', () => this.setPlPanelState('shaded'));
    document.getElementById('pl-win-close')?.addEventListener('click', () => this.setPlPanelState('closed'));
    document.getElementById('pl-shade-unshade')?.addEventListener('click', () => this.setPlPanelState('open'));
    document.getElementById('pl-shade-close')?.addEventListener('click', () => this.setPlPanelState('closed'));

    // Mini sliders de Volumen y Balance dentro del EQ Resumido (Shade Mode)
    this.eqShadeVolInput?.addEventListener('input', () => {
      if (!this.eqShadeVolInput) return;
      const pct = Number(this.eqShadeVolInput.value);
      this.updateVolumeSprite(pct);
      this.showTempMarquee(`VOLUME: ${pct}%`);
      this.callbacks.onVolume(pct);
    });
    this.eqShadeBalInput?.addEventListener('input', () => {
      if (!this.eqShadeBalInput) return;
      const raw = Number(this.eqShadeBalInput.value);
      this.updateBalanceSprite(raw);
      const label = raw === 0 ? 'CENTER' : raw < 0 ? `${Math.abs(raw)}% LEFT` : `${raw}% RIGHT`;
      this.showTempMarquee(`BALANCE: ${label}`);
      this.callbacks.onBalance(raw / 100);
    });

    // Menú desplegable superior izquierdo del Main
    this.mainMenuBtn?.addEventListener('click', (event) => {
      event.stopPropagation();
      this.mainMenu?.classList.toggle('hidden');
    });

    this.mainMenu?.querySelectorAll<HTMLElement>('[data-main-action]').forEach((item) => {
      item.addEventListener('click', async () => {
        const action = item.dataset.mainAction;
        this.mainMenu?.classList.add('hidden');
        if (action === 'skins') this.callbacks.onOpenSkins();
        else if (action === 'lyrics') this.callbacks.onOpenLyrics();
        else if (action === 'sources') this.callbacks.onOpenSources();
        else if (action === 'folder') this.callbacks.onSelectFolder();
        else if (action === 'files') this.callbacks.onEject();
        else if (action === 'pin') {
          const pinned = await this.callbacks.onToggleAlwaysOnTop();
          document.getElementById('wsz-clutter-a')?.classList.toggle('active', pinned);
          this.showTempMarquee(pinned ? 'ALWAYS ON TOP: ON' : 'ALWAYS ON TOP: OFF');
        } else if (action === 'mini') {
          this.callbacks.onMiniMode();
        }
      });
    });

    // EQ ON / AUTO / PRESETS
    this.eqOnBtn?.addEventListener('click', () => this.callbacks.onEqToggle());
    this.eqAutoBtn?.addEventListener('click', () => {
      this.preampDb = 0;
      if (this.preampCtrl) paintEqSliderSprite(this.preampCtrl, 0);
      this.callbacks.onPreampChange(0);
      this.callbacks.onEqReset();
      this.showTempMarquee('EQ RESET: FLAT (0 dB)');
    });
    this.eqPresetsBtn?.addEventListener('click', (event) => {
      event.stopPropagation();
      const hidden = this.presetsMenu?.classList.toggle('hidden');
      this.eqPresetsBtn?.classList.toggle('active', !hidden);
    });

    document.addEventListener('click', (event) => {
      const target = event.target as Node;
      if (this.presetsMenu && !this.presetsMenu.classList.contains('hidden')) {
        if (!this.presetsMenu.contains(target) && target !== this.eqPresetsBtn) {
          this.presetsMenu.classList.add('hidden');
          this.eqPresetsBtn?.classList.remove('active');
        }
      }
      if (this.mainMenu && !this.mainMenu.classList.contains('hidden')) {
        if (!this.mainMenu.contains(target) && target !== this.mainMenuBtn) {
          this.mainMenu.classList.add('hidden');
        }
      }
    });

    document.getElementById('wsz-win-min')?.addEventListener('click', () => this.callbacks.onMinimize());
    document.getElementById('wsz-win-shade')?.addEventListener('click', () => this.callbacks.onMiniMode());
    document.getElementById('wsz-win-close')?.addEventListener('click', () => this.callbacks.onClose());

    this.posSlider?.addEventListener('pointerdown', () => {
      this.isSeeking = true;
    });

    this.posSlider?.addEventListener('input', () => {
      if (!this.posSlider) return;
      this.isSeeking = true;
      const sec = Number(this.posSlider.value);
      this.updatePosThumb(sec, this.duration);
      this.showTempMarquee(`SEEK TO: ${formatTime(sec)} / ${formatTime(this.duration)}`);
    });

    const commitSeek = (): void => {
      if (!this.posSlider) return;
      this.isSeeking = false;
      this.callbacks.onSeek(Number(this.posSlider.value));
    };

    this.posSlider?.addEventListener('change', commitSeek);
    this.posSlider?.addEventListener('pointerup', () => {
      this.isSeeking = false;
    });

    this.volSlider?.addEventListener('input', () => {
      if (!this.volSlider) return;
      const pct = Number(this.volSlider.value);
      this.updateVolumeSprite(pct);
      this.showTempMarquee(`VOLUME: ${pct}%`);
      this.callbacks.onVolume(pct);
    });

    this.balSlider?.addEventListener('input', () => {
      if (!this.balSlider) return;
      const raw = Number(this.balSlider.value);
      this.updateBalanceSprite(raw);
      const label =
        raw === 0 ? 'CENTER' : raw < 0 ? `${Math.abs(raw)}% LEFT` : `${raw}% RIGHT`;
      this.showTempMarquee(`BALANCE: ${label}`);
      this.callbacks.onBalance(raw / 100);
    });

    this.balSlider?.addEventListener('dblclick', () => {
      this.updateBalanceSprite(0);
      this.showTempMarquee('BALANCE: CENTER');
      this.callbacks.onBalance(0);
    });
  }

  public applySkin(skin: WszSkinData): void {
    this.currentSkin = skin;
    const s = this.stage.style;

    const setSprite = (varName: string, dataUrl?: string): void => {
      if (dataUrl) s.setProperty(varName, `url("${dataUrl}")`);
      else s.removeProperty(varName);
    };

    setSprite('--wsz-main', skin.sprites.main);
    setSprite('--wsz-titlebar', skin.sprites.titlebar);
    setSprite('--wsz-cbuttons', skin.sprites.cbuttons);
    setSprite('--wsz-posbar', skin.sprites.posbar);
    setSprite('--wsz-volume', skin.sprites.volume);
    setSprite('--wsz-balance', skin.sprites.balance ?? skin.sprites.volume);
    setSprite('--wsz-shufrep', skin.sprites.shufrep);
    setSprite('--wsz-numbers', skin.sprites.numbers);
    setSprite('--wsz-playpaus', skin.sprites.playpaus);
    setSprite('--wsz-monoster', skin.sprites.monoster);
    setSprite('--wsz-eqmain', skin.sprites.eqmain);
    setSprite('--wsz-eq-ex', skin.sprites.eqEx);
    setSprite('--wsz-pledit', skin.sprites.pledit);

    if (skin.sprites.pledit) {
      document.documentElement.style.setProperty('--wsz-pledit', `url("${skin.sprites.pledit}")`);
      this.extractPleditTiles(skin.sprites.pledit);
    } else {
      document.documentElement.style.removeProperty('--wsz-pledit');
      document.documentElement.style.removeProperty('--wsz-pl-top-fill');
      document.documentElement.style.removeProperty('--wsz-pl-left-tile');
      document.documentElement.style.removeProperty('--wsz-pl-right-tile');
      document.documentElement.style.removeProperty('--wsz-pl-shade-mid');
    }

    applyPaletteToDocument(skin.pledit);
    this.stage.classList.add('has-wsz-skin');
    document.body.classList.add('has-wsz-skin');
    this.stage.classList.toggle('has-numbers-sprite', Boolean(skin.sprites.numbers));
    this.renderEqGraph();
  }

  public clearSkin(): void {
    this.currentSkin = null;
    for (const cssVar of SPRITE_VARS) {
      this.stage.style.removeProperty(cssVar);
    }
    document.documentElement.style.removeProperty('--wsz-pledit');
    document.documentElement.style.removeProperty('--wsz-pl-top-fill');
    document.documentElement.style.removeProperty('--wsz-pl-left-tile');
    document.documentElement.style.removeProperty('--wsz-pl-right-tile');
    document.documentElement.style.removeProperty('--wsz-pl-shade-mid');
    applyPaletteToDocument(DEFAULT_PALETTE);
    this.stage.classList.remove('has-wsz-skin', 'has-numbers-sprite');
    document.body.classList.remove('has-wsz-skin');
    this.renderEqGraph();
  }

  public updateTrackInfo(track: Track): void {
    this.currentTrack = track;
    const baseText =
      track.artist && track.artist !== 'Artista desconocido'
        ? `${track.artist} - ${track.title}`
        : track.title;
    this.baseMarqueeText = track.isLive ? `[LIVE] ${baseText}` : baseText;
    if (!this.tempMarqueeTimer) {
      this.setMarqueeContent(this.baseMarqueeText, true);
    }
    if (this.plShadeTrackEl) {
      this.plShadeTrackEl.textContent = this.baseMarqueeText;
    }
    if (this.plShadeDurEl) {
      this.plShadeDurEl.textContent = track.isLive ? 'LIVE' : formatTime(track.duration);
    }

    if (this.kbpsEl) {
      this.kbpsEl.textContent = track.bitrate ? String(track.bitrate) : track.isLive ? '128' : '---';
    }
    if (this.khzEl) {
      this.khzEl.textContent = track.sampleRate
        ? String(Math.round(track.sampleRate / 1000))
        : track.isLive
          ? '44'
          : '--';
    }

    const isMono = track.channels === 1;
    this.monoEl?.classList.toggle('active', isMono);
    this.stereoEl?.classList.toggle('active', !isMono);
  }

  public updatePlaybackState(state: PlaybackState): void {
    if (!this.playpausEl) return;
    this.playpausEl.classList.remove('state-playing', 'state-paused', 'state-stopped');
    if (state === 'playing') {
      this.playpausEl.classList.add('state-playing');
      this.playpausEl.textContent = '>';
    } else if (state === 'paused') {
      this.playpausEl.classList.add('state-paused');
      this.playpausEl.textContent = '||';
    } else {
      this.playpausEl.classList.add('state-stopped');
      this.playpausEl.textContent = '■';
    }
  }

  public updateTime(currentSec: number, durationSec: number): void {
    const finiteDuration = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0;
    this.lastCurrentSec = currentSec;
    this.duration = finiteDuration;

    const useRemaining = this.showRemainingTime && finiteDuration > 0;
    const displaySec = useRemaining ? Math.max(0, finiteDuration - currentSec) : currentSec;
    this.minusEl?.classList.toggle('hidden', !useRemaining);

    const safeSec = Number.isFinite(displaySec) && displaySec >= 0 ? Math.floor(displaySec) : 0;
    const mins = Math.min(99, Math.floor(safeSec / 60));
    const secs = safeSec % 60;
    const digits = [Math.floor(mins / 10), mins % 10, Math.floor(secs / 10), secs % 10];

    digits.forEach((d, idx) => {
      const el = this.digitEls[idx];
      if (!el) return;
      if (this.currentSkin?.sprites.numbers) {
        el.style.backgroundPosition = `${-d * 9}px 0px`;
        el.textContent = '';
      } else {
        el.style.backgroundPosition = '';
        el.textContent = String(d);
      }
    });

    if (!this.isSeeking) {
      if (this.posSlider) {
        this.posSlider.max = String(finiteDuration);
        this.posSlider.value = String(Number.isFinite(currentSec) ? currentSec : 0);
      }
      this.updatePosThumb(currentSec, finiteDuration);
    }
  }

  private updatePosThumb(current: number, duration: number): void {
    if (!this.posThumb) return;
    const ratio = duration > 0 ? Math.max(0, Math.min(1, current / duration)) : 0;
    this.posThumb.style.left = `${Math.round(ratio * 219)}px`;
  }

  public updateVolumeSprite(percent: number): void {
    const clamped = Math.max(0, Math.min(100, percent));
    if (this.volSlider) this.volSlider.value = String(clamped);
    if (this.volBg) {
      const frame = Math.round((clamped / 100) * 27);
      this.volBg.style.backgroundPosition = `0px ${-frame * 15}px`;
    }
    if (this.volThumb) {
      this.volThumb.style.left = `${Math.round((clamped / 100) * 54)}px`;
    }
    if (this.eqShadeVolInput) this.eqShadeVolInput.value = String(clamped);
    if (this.eqShadeVolThumb) {
      this.eqShadeVolThumb.style.left = `${Math.round((clamped / 100) * 94)}px`;
    }
  }

  public updateBalanceSprite(rawBalance: number): void {
    const clamped = Math.max(-100, Math.min(100, rawBalance));
    if (this.balSlider) this.balSlider.value = String(clamped);
    if (this.balBg) {
      const frame = Math.round((Math.abs(clamped) / 100) * 27);
      this.balBg.style.backgroundPosition = `-9px ${-frame * 15}px`;
    }
    if (this.balThumb) {
      const ratio = (clamped + 100) / 200;
      this.balThumb.style.left = `${Math.round(ratio * 24)}px`;
    }
    if (this.eqShadeBalInput) this.eqShadeBalInput.value = String(clamped);
    if (this.eqShadeBalThumb) {
      const ratio = (clamped + 100) / 200;
      this.eqShadeBalThumb.style.left = `${Math.round(ratio * 39)}px`;
    }
  }

  public updateModes(shuffle: boolean, repeatMode: RepeatMode): void {
    this.shufBtn?.classList.toggle('active', shuffle);
    this.repBtn?.classList.toggle('active', repeatMode !== 'off');
  }

  public updateEq(enabled: boolean, gains: number[]): void {
    this.eqEnabled = enabled;
    this.eqGains = [...gains];
    this.eqOnBtn?.classList.toggle('active', enabled);
    this.eqDeck?.classList.toggle('eq-off', !enabled);
    gains.forEach((db, idx) => {
      if (this.eqBandCtrls[idx]) {
        paintEqSliderSprite(this.eqBandCtrls[idx], db);
      }
    });
    this.renderEqGraph();
  }
}
