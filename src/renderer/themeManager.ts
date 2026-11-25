import type { CustomSkinConfig, ThemeName } from '../shared/types.js';

const BUILTIN_THEMES: ThemeName[] = ['winamp-classic', 'modern-dark', 'minimal-blue', 'custom'];

const CUSTOM_CSS_VARS = [
  '--bg-shell',
  '--bg-titlebar',
  '--bg-lcd',
  '--text-main',
  '--text-lcd',
  '--accent',
  '--font-lcd',
] as const;

/**
 * Gestiona las skins integradas (styles/themes.css) y la skin personalizada del usuario
 * aplicando Design Tokens (variables CSS) en tiempo real.
 */
export class ThemeManager {
  private currentTheme: ThemeName = 'winamp-classic';
  private customSkin: CustomSkinConfig = {
    bgShell: '#14111d',
    bgTitlebar: '#1e192b',
    bgLcd: '#0c0914',
    textMain: '#f4f0ff',
    accent: '#c084fc',
    fontLcd: "'Consolas', monospace",
  };

  public apply(theme: ThemeName, customSkin?: CustomSkinConfig): void {
    if (customSkin) {
      this.customSkin = { ...customSkin };
    }
    this.currentTheme = theme;
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);

    if (theme === 'custom') {
      root.style.setProperty('--bg-shell', this.customSkin.bgShell);
      root.style.setProperty('--bg-titlebar', this.customSkin.bgTitlebar);
      root.style.setProperty('--bg-lcd', this.customSkin.bgLcd);
      root.style.setProperty('--text-main', this.customSkin.textMain);
      root.style.setProperty('--text-lcd', this.customSkin.accent);
      root.style.setProperty('--accent', this.customSkin.accent);
      root.style.setProperty('--font-lcd', this.customSkin.fontLcd);
    } else {
      for (const cssVar of CUSTOM_CSS_VARS) {
        root.style.removeProperty(cssVar);
      }
    }
  }

  public cycleTheme(): ThemeName {
    const idx = BUILTIN_THEMES.indexOf(this.currentTheme);
    const next = BUILTIN_THEMES[(idx + 1) % BUILTIN_THEMES.length];
    this.apply(next);
    return next;
  }

  public updateCustomSkin(partial: Partial<CustomSkinConfig>): CustomSkinConfig {
    this.customSkin = { ...this.customSkin, ...partial };
    this.apply('custom', this.customSkin);
    return { ...this.customSkin };
  }

  public get activeTheme(): ThemeName {
    return this.currentTheme;
  }

  public get currentCustomSkin(): CustomSkinConfig {
    return { ...this.customSkin };
  }
}
