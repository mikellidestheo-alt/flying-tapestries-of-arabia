// Plain-data entity types for the simulation (serialisable for co-op snapshots).

export interface Orb {
  id: number;
  x: number;
  y: number;
  z: number;
  px: number;
  py: number;
  pz: number;
  vx: number;
  vz: number;
  value: number;
  age: number;
}

export interface Projectile {
  id: number;
  owner: number;
  faction: number;
  /** Hit points: archers shoot incoming projectiles down. */
  hp: number;
  spell: string;
  x: number;
  y: number;
  z: number;
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  travelled: number;
}

export const CREATURE_WANDER = 0;
export const CREATURE_CHASE = 1;

export interface Creature {
  id: number;
  type: string;
  /** Nest that spawned it (0 = wild). */
  nest: number;
  x: number;
  y: number;
  z: number;
  px: number;
  py: number;
  pz: number;
  vx: number;
  vz: number;
  hp: number;
  state: number;
  cd: number;
  burnTicks: number;
  burnDps: number;
  homeX: number;
  homeZ: number;
  wx: number;
  wz: number;
  wanderUntil: number;
}

export interface Well {
  id: number;
  x: number;
  y: number;
  z: number;
  reserve: number;
  max: number;
  age: number;
  /** Counts down once the well is spent or expired; removed at 0. */
  fade: number;
}

export interface Faction {
  id: number;
  human: boolean;
  name: string;
  /** Mana captured over the whole match (orbs, wells, income). Drives the win share. */
  captured: number;
  eliminated: boolean;
  castle: number;
  personality: string;
}

export interface Castle {
  id: number;
  faction: number;
  x: number;
  y: number;
  z: number;
  tier: number;
  /** Branch ids picked at branch tiers, in order. */
  branches: string[];
  hp: number;
  maxHp: number;
  /** Shared castle mana pool: passive income, spent on upgrades. */
  bank: number;
  invuln: number;
  ruined: boolean;
  archerCd: number[];
  /** Cached threat for the archers (creature id or projectile id, 0 = none). */
  threat: number;
  /** Cached upgrade availability flag for the HUD. */
  lastHit: number;
}

export interface Structure {
  id: number;
  kind: 'nest';
  x: number;
  y: number;
  z: number;
  hp: number;
  max: number;
  alive: boolean;
  spawnCd: number;
  respawnAt: number;
}

export type SimEventType =
  | 'arrow'
  | 'upgrade'
  | 'castleHit'
  | 'castleDowngrade'
  | 'castleDestroyed'
  | 'nestDestroyed'
  | 'wizardDown'
  | 'matchEnd'
  | 'cast'
  | 'impact'
  | 'fizzle'
  | 'hit'
  | 'kill'
  | 'orb'
  | 'playerHit'
  | 'respawn'
  | 'wellSpawn'
  | 'wellEnd'
  | 'wellDraw';

export interface SimEvent {
  seq: number;
  tick: number;
  type: SimEventType;
  x: number;
  y: number;
  z: number;
  /** Payload: damage, mana value, owner index, ... depending on the type. */
  v: number;
  /** Second point (arrows: where the arrow lands). */
  x2: number;
  y2: number;
  z2: number;
}
