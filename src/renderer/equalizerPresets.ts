// Frecuencias clásicas del ecualizador de 10 bandas de Winamp (en Hz)
export const EQ_BANDS = [
  { freq: 60, label: '60' },
  { freq: 170, label: '170' },
  { freq: 310, label: '310' },
  { freq: 600, label: '600' },
  { freq: 1000, label: '1K' },
  { freq: 3000, label: '3K' },
  { freq: 6000, label: '6K' },
  { freq: 12000, label: '12K' },
  { freq: 14000, label: '14K' },
  { freq: 16000, label: '16K' },
] as const;

export interface EqPreset {
  id: string;
  name: string;
  gains: number[]; // 10 valores en dB (-12 a +12)
}

export const EQ_PRESETS: EqPreset[] = [
  { id: 'flat', name: 'Flat (Plano)', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: 'rock', name: 'Rock', gains: [4, 3, 2, 0, -1, 0, 2, 4, 5, 5] },
  { id: 'pop', name: 'Pop', gains: [-1, 2, 4, 4, 2, 0, -1, -1, 1, 2] },
  { id: 'bass-boost', name: 'Bass Boost', gains: [7, 6, 4, 2, 0, 0, 0, 0, 0, 0] },
  { id: 'vocal', name: 'Vocal', gains: [-2, -1, 0, 3, 5, 5, 3, 1, 0, -1] },
  { id: 'electronic', name: 'Electronic', gains: [5, 4, 1, 0, -2, 1, 3, 4, 5, 6] },
];
