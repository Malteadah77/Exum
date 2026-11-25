import type { RepeatMode, Track } from '../shared/types.js';

export type PlaylistSortField = 'title' | 'artist' | 'duration';

export interface PlaylistCallbacks {
  onChange?: (tracks: Track[], currentIndex: number, selectedIndices: Set<number>) => void;
  onTrackSelect?: (track: Track, index: number) => void;
  onModeChange?: (shuffle: boolean, repeatMode: RepeatMode) => void;
}

/**
 * Gestor completo de Playlist estilo Winamp (Patrón Observer):
 * soporta reproducción, selección simple/múltiple, borrar/recortar, ordenar,
 * mezclar, invertir y reordenar arrastrando.
 */
export class PlaylistManager {
  private tracks: Track[] = [];
  private currentIndex = -1;
  private selectedIndices = new Set<number>();
  private lastSelectedAnchor = -1;
  private shuffle = false;
  private repeatMode: RepeatMode = 'off';
  private callbacks: PlaylistCallbacks;

  constructor(callbacks: PlaylistCallbacks = {}) {
    this.callbacks = callbacks;
  }

  private emitChange(): void {
    this.callbacks.onChange?.(this.tracks, this.currentIndex, new Set(this.selectedIndices));
  }

  public setModes(shuffle: boolean, repeatMode: RepeatMode): void {
    this.shuffle = shuffle;
    this.repeatMode = repeatMode;
    this.callbacks.onModeChange?.(this.shuffle, this.repeatMode);
  }

  public setTracks(newTracks: Track[], autoSelectFirst = false): void {
    this.tracks = [...newTracks];
    this.currentIndex = -1;
    this.selectedIndices.clear();
    this.lastSelectedAnchor = -1;
    this.emitChange();

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
      this.emitChange();
    }

    if (autoPlayFirstAdded) {
      if (uniqueNew.length > 0) {
        this.selectIndex(startIndex);
      } else {
        const existingIndex = this.tracks.findIndex((t) => t.id === incoming[0].id);
        if (existingIndex !== -1) this.selectIndex(existingIndex);
      }
    }
  }

  /**
   * Reproduce la pista en `index` (doble clic o navegación).
   */
  public selectIndex(index: number): Track | null {
    if (index < 0 || index >= this.tracks.length) return null;
    this.currentIndex = index;
    this.selectedIndices.clear();
    this.selectedIndices.add(index);
    this.lastSelectedAnchor = index;
    const track = this.tracks[index];
    this.emitChange();
    this.callbacks.onTrackSelect?.(track, index);
    return track;
  }

  /**
   * Selección visual de filas (clic simple, Ctrl+clic, Shift+clic) sin cambiar la canción que suena.
   */
  public toggleRowSelection(index: number, ctrlKey: boolean, shiftKey: boolean): void {
    if (index < 0 || index >= this.tracks.length) return;

    if (shiftKey && this.lastSelectedAnchor >= 0) {
      const start = Math.min(this.lastSelectedAnchor, index);
      const end = Math.max(this.lastSelectedAnchor, index);
      if (!ctrlKey) this.selectedIndices.clear();
      for (let i = start; i <= end; i++) this.selectedIndices.add(i);
    } else if (ctrlKey) {
      if (this.selectedIndices.has(index)) this.selectedIndices.delete(index);
      else this.selectedIndices.add(index);
      this.lastSelectedAnchor = index;
    } else {
      this.selectedIndices.clear();
      this.selectedIndices.add(index);
      this.lastSelectedAnchor = index;
    }

    this.emitChange();
  }

  // Operaciones SEL (Winamp)
  public selectAll(): void {
    this.selectedIndices.clear();
    for (let i = 0; i < this.tracks.length; i++) this.selectedIndices.add(i);
    this.emitChange();
  }

  public selectNone(): void {
    this.selectedIndices.clear();
    this.lastSelectedAnchor = -1;
    this.emitChange();
  }

  public invertSelection(): void {
    const next = new Set<number>();
    for (let i = 0; i < this.tracks.length; i++) {
      if (!this.selectedIndices.has(i)) next.add(i);
    }
    this.selectedIndices = next;
    this.emitChange();
  }

  // Operaciones REM (Winamp)
  public removeSelected(): void {
    if (this.selectedIndices.size === 0) return;
    const currentId = this.currentTrack?.id ?? null;

    this.tracks = this.tracks.filter((_t, idx) => !this.selectedIndices.has(idx));
    this.selectedIndices.clear();
    this.lastSelectedAnchor = -1;
    this.currentIndex = currentId ? this.tracks.findIndex((t) => t.id === currentId) : -1;
    this.emitChange();
  }

  public cropSelected(): void {
    if (this.selectedIndices.size === 0) return;
    const currentId = this.currentTrack?.id ?? null;

    this.tracks = this.tracks.filter((_t, idx) => this.selectedIndices.has(idx));
    this.selectedIndices.clear();
    this.lastSelectedAnchor = -1;
    this.currentIndex = currentId ? this.tracks.findIndex((t) => t.id === currentId) : -1;
    this.emitChange();
  }

  public removeDuplicates(): number {
    const currentId = this.currentTrack?.id ?? null;
    const seen = new Set<string>();
    const before = this.tracks.length;

    this.tracks = this.tracks.filter((t) => {
      const key = `${t.artist.toLowerCase()}::${t.title.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    this.selectedIndices.clear();
    this.currentIndex = currentId ? this.tracks.findIndex((t) => t.id === currentId) : -1;
    this.emitChange();
    return before - this.tracks.length;
  }

  // Operaciones MISC (Winamp: ordenar, mezclar, invertir, reordenar)
  public sortBy(field: PlaylistSortField): void {
    const currentId = this.currentTrack?.id ?? null;
    this.tracks.sort((a, b) => {
      if (field === 'duration') return (a.duration || 0) - (b.duration || 0);
      return a[field].localeCompare(b[field]);
    });
    this.selectedIndices.clear();
    this.currentIndex = currentId ? this.tracks.findIndex((t) => t.id === currentId) : -1;
    this.emitChange();
  }

  public randomizeOrder(): void {
    const currentId = this.currentTrack?.id ?? null;
    for (let i = this.tracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.tracks[i], this.tracks[j]] = [this.tracks[j], this.tracks[i]];
    }
    this.selectedIndices.clear();
    this.currentIndex = currentId ? this.tracks.findIndex((t) => t.id === currentId) : -1;
    this.emitChange();
  }

  public reverseOrder(): void {
    const currentId = this.currentTrack?.id ?? null;
    this.tracks.reverse();
    this.selectedIndices.clear();
    this.currentIndex = currentId ? this.tracks.findIndex((t) => t.id === currentId) : -1;
    this.emitChange();
  }

  public moveTrack(fromIndex: number, toIndex: number): void {
    if (
      fromIndex === toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= this.tracks.length ||
      toIndex >= this.tracks.length
    ) {
      return;
    }

    const currentId = this.currentTrack?.id ?? null;
    const [moved] = this.tracks.splice(fromIndex, 1);
    this.tracks.splice(toIndex, 0, moved);

    this.selectedIndices.clear();
    this.selectedIndices.add(toIndex);
    this.lastSelectedAnchor = toIndex;
    this.currentIndex = currentId ? this.tracks.findIndex((t) => t.id === currentId) : -1;
    this.emitChange();
  }

  // Navegación
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
    if (nextIndex < this.tracks.length) return this.selectIndex(nextIndex);
    if (this.repeatMode === 'all') return this.selectIndex(0);
    return null;
  }

  public previous(): Track | null {
    if (this.tracks.length === 0) return null;
    const prevIndex = this.currentIndex - 1;
    if (prevIndex >= 0) return this.selectIndex(prevIndex);
    if (this.repeatMode === 'all') return this.selectIndex(this.tracks.length - 1);
    return this.selectIndex(0);
  }

  public handleTrackEnded(): Track | null {
    if (this.tracks.length === 0 || this.currentIndex === -1) return null;
    if (this.repeatMode === 'one') return this.selectIndex(this.currentIndex);
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
    this.selectedIndices.clear();
    this.lastSelectedAnchor = -1;
    this.emitChange();
  }

  public getTotalDuration(): number {
    return this.tracks.reduce((acc, t) => acc + (Number.isFinite(t.duration) ? t.duration : 0), 0);
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

  public get selected(): Set<number> {
    return new Set(this.selectedIndices);
  }
}
