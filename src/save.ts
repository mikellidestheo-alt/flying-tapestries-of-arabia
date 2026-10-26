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
}

export interface Progress {
  unlockedChapters: number;
  wizard: string;
  tutorialDone: boolean;
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
};

export const DEFAULT_PROGRESS: Progress = { unlockedChapters: 1, wizard: 'fire', tutorialDone: false };

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
  return { version: 1, settings, progress: mergeKnown(DEFAULT_PROGRESS, o.progress) };
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
