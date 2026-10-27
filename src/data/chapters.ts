import type { PropParams } from '../sim/props';
import type { TerrainParams } from '../sim/terrain';
import ch1 from '../../chapters/chapter1.json';
import ch2 from '../../chapters/chapter2.json';
import ch3 from '../../chapters/chapter3.json';
import ch4 from '../../chapters/chapter4.json';
import ch5 from '../../chapters/chapter5.json';
import ch6 from '../../chapters/chapter6.json';

export const PERSONALITIES = ['aggressive', 'greedy', 'defensive'] as const;
export type Personality = (typeof PERSONALITIES)[number];
export const MUSIC_SCALES = ['hijaz', 'bayati', 'nahawand', 'rast', 'saba'] as const;
export const RHYTHMS = ['maqsum', 'saidi', 'baladi'] as const;

export interface ChapterPalette {
  skyTop: string;
  skyMid: string;
  horizon: string;
  sun: string;
  fog: string;
  sand: string;
  sandShade: string;
  rock: string;
  grass: string;
  bank: string;
  waterShallow: string;
  waterDeep: string;
  sunDir: [number, number, number];
  sunLight: string;
  ambient: string;
  /** Night skies: stars and a moon disc. */
  stars?: boolean;
  moon?: boolean;
  /** Water is drawn as an opaque sea of billowing clouds (chapter 6). */
  cloudSea?: boolean;
}

/** Render-only weather (never touches the sim). */
export interface WeatherConfig {
  sandstorm?: {
    /** How much gusts pull the fog in (0..1 of the view distance). */
    fogTighten: number;
    /** Peak opacity of the drifting sand layer (0..1). */
    layer: number;
  };
}

export interface RivalConfig {
  id: string;
  name: string;
  personality: Personality;
}

export interface ChapterConfig {
  id: string;
  number: number;
  name: string;
  tagline: string;
  palette: ChapterPalette;
  terrain: TerrainParams;
  props: PropParams;
  structureKit: string;
  structureStyle: { wall: string; shade: string; dome: string; trim: string; roof: string };
  nest: { name: string; color: string; glow: string };
  creatureSet: string[];
  ambient: { sound: string; birds: boolean };
  weather?: WeatherConfig;
  music: { scale: string; rootMidi: number; tempoBpm: number; rhythm: string; motif: number[] };
  rivals: RivalConfig[];
  targetShare: number;
  /** Win by owning a top-tier castle AND having captured at least this much mana. */
  palaceWinMana: number;
  matchLengthMinutes: number;
  aiLevel: number;
  /** Hostile creature population multiplier (1 = base). */
  enemyDensity: number;
  comeback: {
    startMinute: number;
    trailingIncomeBonus: number;
    suddenDeathMinute: number;
    suddenDeathShare: number;
  };
}

export const CHAPTERS: ChapterConfig[] = [ch1, ch2, ch3, ch4, ch5, ch6] as unknown as ChapterConfig[];

/** Every chapter is a four-player free-for-all: you plus three rivals (changed from 1/1/2/2/3/3 on user request). */
export const RIVALS_PER_CHAPTER = 3;
export function rivalCountForChapter(): number {
  return RIVALS_PER_CHAPTER;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Returns a list of problems; empty when valid. */
export function validateChapter(c: ChapterConfig): string[] {
  const errs: string[] = [];
  const need = (ok: boolean, msg: string) => {
    if (!ok) errs.push(`${c.id}: ${msg}`);
  };
  need(typeof c.id === 'string' && /^[a-z0-9-]+$/.test(c.id), 'id must be kebab-case');
  need(Number.isInteger(c.number) && c.number >= 1 && c.number <= 6, 'number must be 1-6');
  need(c.name.length > 0, 'name missing');
  need(c.rivals.length === rivalCountForChapter(), `needs ${rivalCountForChapter()} rivals`);
  need(new Set(c.rivals.map((r) => r.id)).size === c.rivals.length, 'rival ids must be unique');
  need(new Set(c.rivals.map((r) => r.name)).size === c.rivals.length, 'rival names must be unique');
  for (const r of c.rivals) {
    need((PERSONALITIES as readonly string[]).includes(r.personality), `rival ${r.id}: bad personality`);
  }
  for (const [k, v] of Object.entries(c.palette)) {
    if (k === 'sunDir') {
      need(Array.isArray(v) && v.length === 3, 'sunDir must be [x,y,z]');
    } else if (k === 'stars' || k === 'moon' || k === 'cloudSea') {
      need(typeof v === 'boolean', `palette.${k} must be a boolean`);
    } else {
      need(typeof v === 'string' && HEX.test(v), `palette.${k} must be #rrggbb`);
    }
  }
  need((MUSIC_SCALES as readonly string[]).includes(c.music.scale), `unknown music scale ${c.music.scale}`);
  need((RHYTHMS as readonly string[]).includes(c.music.rhythm), `unknown rhythm ${c.music.rhythm}`);
  need(c.music.tempoBpm >= 60 && c.music.tempoBpm <= 160, 'tempo out of range');
  need(c.music.motif.length >= 4, 'motif too short');
  need(c.targetShare > 0.2 && c.targetShare < 1, 'targetShare out of range');
  need(c.palaceWinMana >= 800 && c.palaceWinMana <= 14000, 'palaceWinMana out of range');
  need(c.matchLengthMinutes >= 8 && c.matchLengthMinutes <= 16, 'matchLengthMinutes should be 8-16');
  need(c.comeback.startMinute < c.comeback.suddenDeathMinute, 'comeback must start before sudden death');
  need(c.comeback.suddenDeathMinute > c.matchLengthMinutes - 3, 'sudden death should start near match end');
  need(c.terrain.waterLevel < c.terrain.baseHeight + c.terrain.swellAmplitude, 'terrain: waterLevel above land');
  need(c.creatureSet.length > 0, 'creatureSet empty');
  need(c.enemyDensity >= 0.3 && c.enemyDensity <= 2, 'enemyDensity must be 0.3-2');
  for (const [k, v] of Object.entries(c.structureStyle)) need(HEX.test(v), `structureStyle.${k} must be #rrggbb`);
  need(HEX.test(c.nest.color) && HEX.test(c.nest.glow), 'nest colours must be #rrggbb');
  if (c.weather?.sandstorm) {
    const w = c.weather.sandstorm;
    need(w.fogTighten >= 0 && w.fogTighten <= 0.7, 'weather.sandstorm.fogTighten must be 0-0.7');
    need(w.layer >= 0 && w.layer <= 0.5, 'weather.sandstorm.layer must be 0-0.5');
  }
  if (c.terrain.city) {
    const city = c.terrain.city;
    need(64 % city.cell === 0, 'city.cell must divide the 64-unit chunk size');
    need(city.density > 0 && city.density <= 1, 'city.density must be 0-1');
    need(city.minHeight < city.maxHeight, 'city heights inverted');
  }
  return errs;
}

export function getChapter(index: number): ChapterConfig {
  return CHAPTERS[Math.max(0, Math.min(CHAPTERS.length - 1, index))]!;
}
