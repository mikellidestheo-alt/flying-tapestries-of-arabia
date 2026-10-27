// The one spell table: types, tier merging and wizard kits. Data lives in src/data/spells.json.
import spells from '../data/spells.json';
import type { Element } from '../data/elements';

export interface SpellEffect {
  type: 'burn' | 'slow' | 'freeze';
  /** burn: damage per second */
  dps?: number;
  /** slow: speed multiplier (0.5 = half speed) */
  mult?: number;
  durationTicks: number;
}

export interface ChainDef {
  count: number;
  radius: number;
  falloff: number;
}

export interface AftershockDef {
  delayTicks: number;
  radius: number;
  damageMult: number;
}

export interface SpellDef {
  name: string;
  element: string;
  /** 'projectile' (default) or a signature kind. */
  kind?: 'projectile' | 'zone' | 'nova' | 'wall' | 'dash';
  manaCost: number;
  cooldownTicks: number;
  speed: number;
  maxRange: number;
  gravity: number;
  damage: number;
  area: number;
  falloff: number;
  hitRadius: number;
  effects: SpellEffect[];
  chain?: ChainDef;
  aftershock?: AftershockDef;
  terrain?: { radius: number; amount: number; kind: number };
  aimAssist?: { range: number; cosMin: number; distanceWeight: number; homingStrength: number; homingMaxAngle: number; homingRange: number };
  structureMult: number;
  interceptHp: number;
  /** Mana spent to reach this tier (tier 1 = free). */
  upgradeCost?: number;
  // --- signature spells
  castRange?: number;
  radius?: number;
  durationTicks?: number;
  dps?: number;
  wall?: { segments: number; spacing: number; distance: number; amount: number; radius: number };
  dash?: { speedMult: number; durationTicks: number };
}

export type SpellEntry = SpellDef & { tiers?: Partial<SpellDef>[]; tierNames?: string[] };
export const SPELLS = spells as unknown as Record<string, SpellEntry>;
export const MAX_SPELL_TIER = 3;

export interface Kit {
  primary: string;
  signature: string;
}
export const KITS = (spells as unknown as { kits: Record<Element, Kit> }).kits;

/** Spell definition for a tier (1-3): the base entry with that tier's overrides applied. */
export function spellAt(id: string, tier: number): SpellDef {
  const base = SPELLS[id]!;
  const t = Math.max(1, Math.min(MAX_SPELL_TIER, Math.floor(tier || 1)));
  if (t === 1 || !base.tiers) return base;
  const merged: SpellDef = { ...base };
  for (let i = 0; i < t - 1; i++) Object.assign(merged, base.tiers[i] ?? {});
  return merged;
}

export function kitFor(element: Element): Kit {
  return KITS[element];
}

export interface ComboDef {
  id: string;
  name: string;
  needs: [Element, Element];
  description: string;
  durationTicks: number;
  radius: number;
  dps: number;
  slowMult: number;
}
export const COMBOS = (spells as unknown as { combos: ComboDef[] }).combos;
