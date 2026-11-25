import type { RepeatMode, Track } from '../shared/types.js';

export interface PlaylistCallbacks {
  onChange?: (tracks: Track[], currentIndex: number) => void;
  onTrackSelect?: (track: Track, index: number) => void;
  onModeChange?: (shuffle: boolean, repeatMode: RepeatMode) => void;
}

/**
 * Gestiona la lista de canciones, el índice actual y las reglas de navegación
 * (siguiente, anterior, aleatorio y repetir). Usa el patrón Observer mediante callbacks.
 */
export class PlaylistManager {
  private tracks: Track[] = [];
  private currentIndex = -1;
  private shuffle = false;
  private repeatMode: RepeatMode = 'off';
  private callbacks: PlaylistCallbacks;

  constructor(callbacks: PlaylistCallbacks = {}) {
    this.callbacks = callbacks;
  }

  public setModes(shuffle: boolean, repeatMode: RepeatMode): void {
    this.shuffle = shuffle;
    this.repeatMode = repeatMode;
    this.callbacks.onModeChange?.(this.shuffle, this.repeatMode);
  }

  public setTracks(newTracks: Track[], autoSelectFirst = false): void {
    this.tracks = [...newTracks];
    this.currentIndex = -1;
    this.callbacks.onChange?.(this.tracks, this.currentIndex);

    if (autoSelectFirst && this.tracks.length > 0) {
      this.selectIndex(0);
    }
  }

  public addTracks(incoming: Track[], autoPlayFirstAdded = false): void {
    if (incoming.length === 0) return;

    const existingIds = new Set(this.tracks.map((t) => t.id));
    const uniqueNew = incoming.filter((t) => !existingIds.has(t.id));
    const startIndex = this.tracks.length;

    if (uniqueNew.length > 0) {
      this.tracks.push(...uniqueNew);
      this.callbacks.onChange?.(this.tracks, this.currentIndex);
    }

    if (autoPlayFirstAdded) {
      if (uniqueNew.length > 0) {
        this.selectIndex(startIndex);
      } else {
        // Si la canción ya existía, la seleccionamos directamente
        const existingIndex = this.tracks.findIndex((t) => t.id === incoming[0].id);
        if (existingIndex !== -1) {
          this.selectIndex(existingIndex);
        }
      }
    }
  }

  public selectIndex(index: number): Track | null {
    if (index < 0 || index >= this.tracks.length) return null;
    this.currentIndex = index;
    const track = this.tracks[index];
    this.callbacks.onChange?.(this.tracks, this.currentIndex);
    this.callbacks.onTrackSelect?.(track, index);
    return track;
  }

  public next(): Track | null {
    if (this.tracks.length === 0) return null;

    if (this.shuffle && this.tracks.length > 1) {
      let randomIndex = this.currentIndex;
      while (randomIndex === this.currentIndex) {
        randomIndex = Math.floor(Math.random() * this.tracks.length);
      }
      return this.selectIndex(randomIndex);
    }

    const nextIndex = this.currentIndex + 1;
    if (nextIndex < this.tracks.length) {
      return this.selectIndex(nextIndex);
    }

    if (this.repeatMode === 'all') {
      return this.selectIndex(0);
    }

    return null;
  }

  public previous(): Track | null {
    if (this.tracks.length === 0) return null;

    const prevIndex = this.currentIndex - 1;
    if (prevIndex >= 0) {
      return this.selectIndex(prevIndex);
    }

    if (this.repeatMode === 'all') {
      return this.selectIndex(this.tracks.length - 1);
    }

    return this.selectIndex(0);
  }

  public handleTrackEnded(): Track | null {
    if (this.tracks.length === 0 || this.currentIndex === -1) return null;

    if (this.repeatMode === 'one') {
      return this.selectIndex(this.currentIndex);
    }

    return this.next();
  }

  public toggleShuffle(): boolean {
    this.shuffle = !this.shuffle;
    this.callbacks.onModeChange?.(this.shuffle, this.repeatMode);
    return this.shuffle;
  }

  public cycleRepeat(): RepeatMode {
    const order: RepeatMode[] = ['off', 'all', 'one'];
    const nextIdx = (order.indexOf(this.repeatMode) + 1) % order.length;
    this.repeatMode = order[nextIdx];
    this.callbacks.onModeChange?.(this.shuffle, this.repeatMode);
    return this.repeatMode;
  }

  public clear(): void {
    this.tracks = [];
    this.currentIndex = -1;
    this.callbacks.onChange?.(this.tracks, this.currentIndex);
  }

  public get allTracks(): Track[] {
    return this.tracks;
  }

  public get activeIndex(): number {
    return this.currentIndex;
  }

  public get currentTrack(): Track | null {
    if (this.currentIndex < 0 || this.currentIndex >= this.tracks.length) return null;
    return this.tracks[this.currentIndex];
  }

  public get isShuffle(): boolean {
    return this.shuffle;
  }

  public get currentRepeatMode(): RepeatMode {
    return this.repeatMode;
  }
}
