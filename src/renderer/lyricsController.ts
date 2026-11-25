import type { LyricLine, LyricsResult, Track } from '../shared/types.js';

/**
 * Controla el renderizado y sincronización en vivo de las letras (formato LRC o texto plano).
 */
export class LyricsController {
  private container: HTMLElement;
  private onSeek: (seconds: number) => void;
  private lines: LyricLine[] = [];
  private lineElements: HTMLElement[] = [];
  private activeLineIndex = -1;
  private loadedTrackId: string | null = null;

  constructor(container: HTMLElement, onSeek: (seconds: number) => void) {
    this.container = container;
    this.onSeek = onSeek;
  }

  public setMessage(message: string): void {
    this.lines = [];
    this.lineElements = [];
    this.activeLineIndex = -1;
    this.container.innerHTML = '';

    const msg = document.createElement('div');
    msg.className = 'lyrics-message';
    msg.textContent = message;
    this.container.appendChild(msg);
  }

  public async loadForTrack(track: Track | null): Promise<void> {
    if (!track) {
      this.loadedTrackId = null;
      this.setMessage('Reproduce una canción para buscar su letra.');
      return;
    }

    if (this.loadedTrackId === track.id) return;
    this.loadedTrackId = track.id;
    this.setMessage(`Buscando letra de "${track.title}"...`);

    const result: LyricsResult = await window.electronAPI.fetchLyrics({
      title: track.title,
      artist: track.artist,
      album: track.album,
      duration: track.duration,
    });

    // Evita condición de carrera si el usuario cambió de canción mientras llegaba la respuesta
    if (this.loadedTrackId !== track.id) return;

    if (!result.found) {
      this.setMessage('No se encontró letra para esta canción en LRCLIB.');
      return;
    }

    this.container.innerHTML = '';
    this.lineElements = [];
    this.activeLineIndex = -1;

    if (result.synced && result.lines.length > 0) {
      this.lines = result.lines;
      result.lines.forEach((line) => {
        const el = document.createElement('div');
        el.className = 'lyric-line synced';
        el.textContent = line.text;
        el.title = 'Clic para saltar a esta línea';
        el.addEventListener('click', () => this.onSeek(line.time));
        this.container.appendChild(el);
        this.lineElements.push(el);
      });
    } else {
      this.lines = [];
      const plain = document.createElement('pre');
      plain.className = 'lyrics-plain';
      plain.textContent = result.plainText;
      this.container.appendChild(plain);
    }
  }

  public syncToTime(currentTime: number): void {
    if (this.lines.length === 0) return;

    let newIndex = -1;
    for (let i = 0; i < this.lines.length; i++) {
      if (currentTime >= this.lines[i].time) {
        newIndex = i;
      } else {
        break;
      }
    }

    if (newIndex === this.activeLineIndex) return;

    if (this.activeLineIndex >= 0 && this.lineElements[this.activeLineIndex]) {
      this.lineElements[this.activeLineIndex].classList.remove('active');
    }

    this.activeLineIndex = newIndex;

    if (newIndex >= 0 && this.lineElements[newIndex]) {
      const activeEl = this.lineElements[newIndex];
      activeEl.classList.add('active');
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
}
