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

export type SimEventType =
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
}
