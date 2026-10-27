// Local persistence (localStorage). Every access is wrapped in try/catch: storage can be
// unavailable, blocked or empty (private windows, cleared data) and the game must still run.

export type QualityPreset = 'high' | 'medium' | 'low';

export interface Settings {
  quality: QualityPreset;
  qualityAuto: boolean;
  batterySaver: boolean;
  leftHanded: boolean;
  tilt: boolean;
  haptics: boolean;
  debugOverlay: boolean;
  reducedFlashing: boolean;
  musicVolume: number;
  sfxVolume: number;
  muted: boolean;
  difficulty: 'easy' | 'normal' | 'hard';
  terrainTools: boolean;
  /** Accessibility: UI text scale (1, 1.2 or 1.4), stronger outlines, steadier camera, colour-blind-safe faction colours. */
  textScale: number;
  highContrast: boolean;
  reducedMotion: boolean;
  colorBlind: boolean;
}

export interface Progress {
  unlockedChapters: number;
  wizard: string;
  tutorialDone: boolean;
  /** Bitmask of cleared chapters (bit n-1 = chapter n). */
  cleared: number;
  /** Best winning time in seconds per chapter (0 = not won yet). */
  bestSeconds: number[];
  /** Matches won and played. */
  wins: number;
  played: number;
}

export interface SaveData {
  version: 1;
  settings: Settings;
  progress: Progress;
}

export const DEFAULT_SETTINGS: Settings = {
  quality: 'medium',
  qualityAuto: true,
  batterySaver: false,
  leftHanded: false,
  tilt: false,
  haptics: true,
  debugOverlay: false,
  reducedFlashing: false,
  musicVolume: 0.7,
  sfxVolume: 0.8,
  muted: false,
  difficulty: 'normal',
  terrainTools: true,
  textScale: 1,
  highContrast: false,
  reducedMotion: false,
  colorBlind: false,
};

export const DEFAULT_PROGRESS: Progress = { unlockedChapters: 1, wizard: 'fire', tutorialDone: false, cleared: 0, bestSeconds: [0, 0, 0, 0, 0, 0], wins: 0, played: 0 };

const KEY = 'fta-save-v1';

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Keep only known keys whose runtime type matches the default; everything else falls back. */
function mergeKnown<T extends object>(defaults: T, loaded: unknown): T {
  const out = { ...defaults } as Record<string, unknown>;
  if (isObject(loaded)) {
    for (const k of Object.keys(defaults)) {
      const v = loaded[k];
      if (typeof v === typeof (defaults as Record<string, unknown>)[k]) out[k] = v;
    }
  }
  return out as T;
}

export function loadSave(): SaveData {
  let raw: unknown = null;
  try {
    const text = localStorage.getItem(KEY);
    if (text) raw = JSON.parse(text);
  } catch {
    raw = null;
  }
  const o = isObject(raw) ? raw : {};
  const settings = mergeKnown(DEFAULT_SETTINGS, o.settings);
  if (!['high', 'medium', 'low'].includes(settings.quality)) settings.quality = DEFAULT_SETTINGS.quality;
  if (!['easy', 'normal', 'hard'].includes(settings.difficulty)) settings.difficulty = DEFAULT_SETTINGS.difficulty;
  if (![1, 1.2, 1.4].includes(settings.textScale)) settings.textScale = 1;
  const progress = mergeKnown(DEFAULT_PROGRESS, o.progress);
  const best = Array.isArray(progress.bestSeconds) ? progress.bestSeconds : [];
  progress.bestSeconds = DEFAULT_PROGRESS.bestSeconds.map((_, i) => (typeof best[i] === 'number' && Number.isFinite(best[i]) && best[i]! > 0 ? best[i]! : 0));
  for (const k of ['wins', 'played'] as const) if (!Number.isInteger(progress[k]) || progress[k] < 0) progress[k] = 0;
  if (!(progress.unlockedChapters >= 1 && progress.unlockedChapters <= 6)) progress.unlockedChapters = 1;
  if (!Number.isInteger(progress.cleared) || progress.cleared < 0) progress.cleared = 0;
  return { version: 1, settings, progress };
}

export function writeSave(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable: play on without saving */
  }
}

export function hasSavedSettings(): boolean {
  try {
    return localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}
