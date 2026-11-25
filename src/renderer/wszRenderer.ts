import type { RepeatMode, WszPleditColors, WszSkinData } from '../shared/types.js';
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
  onPanelsVisibilityChange: (eqVisible: boolean, plVisible: boolean) => void;
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
  '--wsz-eqmain',
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

/**
 * Actualiza el frame de fondo (28 niveles en eqmain.bmp) y la posición de la perilla (thumb 11x11)
 * para un valor en dB entre -12 y +12.
 */
function paintEqSliderSprite(ctrl: EqSliderControl, db: number): void {
  const clamped = Math.max(-12, Math.min(12, db));
  const ratio = (clamped + 12) / 24; // 0 = -12dB (abajo), 1 = +12dB (arriba)
  const frame = Math.round(ratio * 27); // 0..27

  const col = frame % 14;
  const row = Math.floor(frame / 14);
  const bgX = 13 + col * 15;
  const bgY = row === 0 ? 164 : 229;
  ctrl.wrap.style.backgroundPosition = `${-bgX}px ${-bgY}px`;

  // Alto del slider = 63px, alto de la perilla = 11px -> recorrido útil = 52px
  const topPx = Math.round((1 - ratio) * 52);
  ctrl.thumb.style.top = `${topPx}px`;
  ctrl.input.value = String(clamped);
}

/**
 * Renderizador unificado Winamp 2.x (.wsz) con escalado proporcional al 100% del ancho de ventana.
 */
export class WszClassicView {
  private stage: HTMLElement;
  private callbacks: ClassicViewCallbacks;
  private currentSkin: WszSkinData | null = null;
  private duration = 0;

  private eqVisible = true;
  private plVisible = true;

  private digitEls: HTMLElement[] = [];
  private titleEl: HTMLElement | null;
  private posSlider: HTMLInputElement | null;
  private posThumb: HTMLElement | null;
  private volSlider: HTMLInputElement | null;
  private volBg: HTMLElement | null;
  private balSlider: HTMLInputElement | null;
  private balBg: HTMLElement | null;
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

    this.titleEl = document.getElementById('wsz-track-title');
    this.posSlider = document.getElementById('wsz-pos-slider') as HTMLInputElement | null;
    this.posThumb = document.getElementById('wsz-pos-thumb');
    this.volSlider = document.getElementById('wsz-vol-slider') as HTMLInputElement | null;
    this.volBg = document.getElementById('wsz-vol-bg');
    this.balSlider = document.getElementById('wsz-bal-slider') as HTMLInputElement | null;
    this.balBg = document.getElementById('wsz-bal-bg');
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

    this.buildClassicEqSliders();
    this.buildPresetsMenu();
    this.bindEvents();
    this.updateBalanceSprite(0);
    this.fitToWindowWidth();
  }

  public fitToWindowWidth(): void {
    const scale = Math.max(1, Math.min(2.5, window.innerWidth / 275));
    (this.stage.style as unknown as Record<string, string>).zoom = String(scale);
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

    // 1. Preamp a la izquierda (x: 21px, y: 38px)
    const preamp = this.createEqSliderControl(21, 'Preamp (dB)');
    preamp.input.addEventListener('input', () => {
      const db = Number(preamp.input.value);
      paintEqSliderSprite(preamp, db);
      this.callbacks.onPreampChange(db);
    });
    preamp.input.addEventListener('dblclick', () => {
      paintEqSliderSprite(preamp, 0);
      this.callbacks.onPreampChange(0);
    });
    container.appendChild(preamp.wrap);
    this.preampCtrl = preamp;

    // 2. Las 10 bandas de frecuencia (x: 78 + index * 18)
    EQ_BANDS.forEach((band, index) => {
      const ctrl = this.createEqSliderControl(78 + index * 18, `${band.label} Hz`);
      ctrl.input.addEventListener('input', () => {
        const db = Number(ctrl.input.value);
        paintEqSliderSprite(ctrl, db);
        this.callbacks.onEqBandChange(index, db, false);
      });
      ctrl.input.addEventListener('change', () => {
        this.callbacks.onEqBandChange(index, Number(ctrl.input.value), true);
      });
      ctrl.input.addEventListener('dblclick', () => {
        paintEqSliderSprite(ctrl, 0);
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
        this.callbacks.onEqPresetSelect(preset.id, [...preset.gains]);
        this.presetsMenu?.classList.add('hidden');
        this.eqPresetsBtn?.classList.remove('active');
      });
      this.presetsMenu.appendChild(btn);
    }
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

    // Toggle EQ
    this.eqToggleBtn?.addEventListener('click', () => {
      this.eqVisible = !this.eqVisible;
      this.eqDeck?.classList.toggle('hidden', !this.eqVisible);
      this.eqToggleBtn?.classList.toggle('active', this.eqVisible);
      this.callbacks.onPanelsVisibilityChange(this.eqVisible, this.plVisible);
    });

    // Toggle PL (Playlist)
    this.plToggleBtn?.addEventListener('click', () => {
      this.plVisible = !this.plVisible;
      this.plSection?.classList.toggle('hidden', !this.plVisible);
      this.plToggleBtn?.classList.toggle('active', this.plVisible);
      this.callbacks.onPanelsVisibilityChange(this.eqVisible, this.plVisible);
    });

    // EQ ON / AUTO / PRESETS
    this.eqOnBtn?.addEventListener('click', () => this.callbacks.onEqToggle());
    this.eqAutoBtn?.addEventListener('click', () => {
      if (this.preampCtrl) paintEqSliderSprite(this.preampCtrl, 0);
      this.callbacks.onPreampChange(0);
      this.callbacks.onEqReset();
    });
    this.eqPresetsBtn?.addEventListener('click', (event) => {
      event.stopPropagation();
      const hidden = this.presetsMenu?.classList.toggle('hidden');
      this.eqPresetsBtn?.classList.toggle('active', !hidden);
    });

    document.addEventListener('click', (event) => {
      if (!this.presetsMenu || this.presetsMenu.classList.contains('hidden')) return;
      if (!this.presetsMenu.contains(event.target as Node) && event.target !== this.eqPresetsBtn) {
        this.presetsMenu.classList.add('hidden');
        this.eqPresetsBtn?.classList.remove('active');
      }
    });

    document.getElementById('wsz-win-min')?.addEventListener('click', () => this.callbacks.onMinimize());
    document.getElementById('wsz-win-shade')?.addEventListener('click', () => this.callbacks.onMiniMode());
    document.getElementById('wsz-win-close')?.addEventListener('click', () => this.callbacks.onClose());

    this.posSlider?.addEventListener('input', () => {
      if (!this.posSlider) return;
      this.updatePosThumb(Number(this.posSlider.value), this.duration);
    });

    this.posSlider?.addEventListener('change', () => {
      if (!this.posSlider) return;
      this.callbacks.onSeek(Number(this.posSlider.value));
    });

    this.volSlider?.addEventListener('input', () => {
      if (!this.volSlider) return;
      const pct = Number(this.volSlider.value);
      this.updateVolumeSprite(pct);
      this.callbacks.onVolume(pct);
    });

    this.balSlider?.addEventListener('input', () => {
      if (!this.balSlider) return;
      const raw = Number(this.balSlider.value); // -100..100
      this.updateBalanceSprite(raw);
      this.callbacks.onBalance(raw / 100);
    });

    this.balSlider?.addEventListener('dblclick', () => {
      this.updateBalanceSprite(0);
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
    setSprite('--wsz-eqmain', skin.sprites.eqmain);
    setSprite('--wsz-pledit', skin.sprites.pledit);

    if (skin.sprites.pledit) {
      document.documentElement.style.setProperty('--wsz-pledit', `url("${skin.sprites.pledit}")`);
    } else {
      document.documentElement.style.removeProperty('--wsz-pledit');
    }

    applyPaletteToDocument(skin.pledit);
    this.stage.classList.add('has-wsz-skin');
    document.body.classList.add('has-wsz-skin');
    this.stage.classList.toggle('has-numbers-sprite', Boolean(skin.sprites.numbers));
  }

  public clearSkin(): void {
    this.currentSkin = null;
    for (const cssVar of SPRITE_VARS) {
      this.stage.style.removeProperty(cssVar);
    }
    document.documentElement.style.removeProperty('--wsz-pledit');
    applyPaletteToDocument(DEFAULT_PALETTE);
    this.stage.classList.remove('has-wsz-skin', 'has-numbers-sprite');
    document.body.classList.remove('has-wsz-skin');
  }

  public updateTrackInfo(title: string, artist: string): void {
    if (this.titleEl) {
      this.titleEl.textContent =
        artist && artist !== 'Artista desconocido' ? `${artist} - ${title}` : title;
    }
  }

  public updateTime(currentSec: number, durationSec: number): void {
    this.duration = durationSec;
    const safeSec = Number.isFinite(currentSec) && currentSec >= 0 ? Math.floor(currentSec) : 0;
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

    if (this.posSlider) {
      this.posSlider.max = String(durationSec || 0);
      this.posSlider.value = String(currentSec || 0);
    }
    this.updatePosThumb(currentSec, durationSec);
  }

  private updatePosThumb(current: number, duration: number): void {
    if (!this.posThumb) return;
    const ratio = duration > 0 ? Math.max(0, Math.min(1, current / duration)) : 0;
    this.posThumb.style.left = `${Math.round(ratio * 219)}px`;
  }

  public updateVolumeSprite(percent: number): void {
    if (this.volSlider) this.volSlider.value = String(percent);
    if (!this.volBg) return;
    const frame = Math.round((Math.max(0, Math.min(100, percent)) / 100) * 27);
    this.volBg.style.backgroundPosition = `0px ${-frame * 15}px`;
  }

  public updateBalanceSprite(rawBalance: number): void {
    if (this.balSlider) this.balSlider.value = String(rawBalance);
    if (!this.balBg) return;
    // balance.bmp usa 28 frames verticales según distancia desde el centro (0 = centro, 27 = extremo)
    const frame = Math.round((Math.min(100, Math.abs(rawBalance)) / 100) * 27);
    this.balBg.style.backgroundPosition = `-9px ${-frame * 15}px`;
  }

  public updateModes(shuffle: boolean, repeatMode: RepeatMode): void {
    this.shufBtn?.classList.toggle('active', shuffle);
    this.repBtn?.classList.toggle('active', repeatMode !== 'off');
  }

  public updateEq(enabled: boolean, gains: number[]): void {
    this.eqOnBtn?.classList.toggle('active', enabled);
    this.eqDeck?.classList.toggle('eq-off', !enabled);
    gains.forEach((db, idx) => {
      if (this.eqBandCtrls[idx]) {
        paintEqSliderSprite(this.eqBandCtrls[idx], db);
      }
    });
  }
}
