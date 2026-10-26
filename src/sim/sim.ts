// Deterministic fixed-step simulation. No rendering, DOM or UI imports: the same file
// runs in the browser (solo) and inside the Durable Object (co-op).
import simData from '../data/sim.json';
import flightData from '../data/flight.json';
import { clamp, dcos, dsin, wrapAngle } from './dmath';
import { DeltaStore, DELTA_BUMP, DELTA_CRATER } from './deltas';
import { Prng, hashInts } from './prng';
import { CREATURE_WANDER, type Creature, type Orb, type Projectile, type SimEvent, type SimEventType, type Well } from './entities';
import { CREATURES, stepProjectiles, tryCast } from './combat';
import { stepCreatures, stepOrbs, stepPlayerVitals, stepWells } from './world';
import { Terrain, findSpawn, type TerrainParams } from './terrain';

export const SIM_DT = 1 / simData.tickRate;
export const SIM_TICK_RATE = simData.tickRate;
export type FlightTuning = typeof flightData;

export const ACTION_CRATER = 1;
export const ACTION_MOUND = 2;
export const ACTION_SPELL = 4;

export interface PlayerInput {
  /** -1 (left) .. 1 (right) */
  steer: number;
  /** -1 (brake) .. 1 (boost); 0 = cruise */
  throttle: number;
  /** Bitmask of ACTION_* pressed this tick. */
  actions: number;
}

export const NEUTRAL_INPUT: PlayerInput = { steer: 0, throttle: 0, actions: 0 };

export interface PlayerState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  heading: number;
  speed: number;
  turnRate: number;
  /** Cooldown for the debug terrain tools (ticks). */
  cooldown: number;
  hp: number;
  mana: number;
  spellCd: number;
  invuln: number;
  kills: number;
  deaths: number;
  /** Id of the mana well being drawn from this tick, or 0. */
  drawing: number;
}

export function clonePlayer(p: PlayerState): PlayerState {
  return { ...p };
}

export interface SimOptions {
  terrain: TerrainParams;
  playerCount?: number;
  /** Creature type ids that may spawn (from the chapter's creatureSet). */
  creatureTypes?: string[];
  flight?: FlightTuning;
}

function sanitize(v: number): number {
  return Number.isFinite(v) ? clamp(v, -1, 1) : 0;
}

export class Sim {
  tick = 0;
  readonly terrain: Terrain;
  players: PlayerState[] = [];
  prevPlayers: PlayerState[] = [];
  orbs: Orb[] = [];
  projectiles: Projectile[] = [];
  creatures: Creature[] = [];
  wells: Well[] = [];
  events: SimEvent[] = [];
  eventSeq = 0;
  nextId = 1;
  nextWellTick = simData.wells.firstTick;
  readonly rng: Prng;
  readonly creatureTypes: string[];
  readonly spawn: { x: number; z: number };
  private flight: FlightTuning;

  constructor(opts: SimOptions) {
    this.flight = opts.flight ?? flightData;
    this.terrain = new Terrain(opts.terrain, new DeltaStore(simData.deltas));
    const count = opts.playerCount ?? 1;
    this.rng = new Prng(hashInts(opts.terrain.seed, 0x51a9));
    this.creatureTypes = (opts.creatureTypes ?? ['dust-sprite']).filter((t) => t in CREATURES);
    const spawn = findSpawn(opts.terrain);
    this.spawn = spawn;
    for (let i = 0; i < count; i++) {
      const x = spawn.x + i * 8;
      const y = this.terrain.surfaceAt(x, spawn.z) + this.flight.hoverHeight;
      this.players.push({
        x, y, z: spawn.z, vx: 0, vy: 0, vz: 0, heading: 0, speed: this.flight.cruiseSpeed, turnRate: 0, cooldown: 0,
        hp: simData.player.maxHp, mana: simData.player.startMana, spellCd: 0, invuln: 0, kills: 0, deaths: 0, drawing: 0,
      });
    }
    this.prevPlayers = this.players.map(clonePlayer);
  }

  step(inputs: readonly PlayerInput[]): void {
    for (let i = 0; i < this.players.length; i++) Object.assign(this.prevPlayers[i]!, this.players[i]);
    this.tick++;
    for (let i = 0; i < this.players.length; i++) {
      const input = inputs[i] ?? NEUTRAL_INPUT;
      this.stepPlayer(this.players[i]!, input);
      if ((input.actions | 0) & ACTION_SPELL) tryCast(this, i);
    }
    stepProjectiles(this);
    stepCreatures(this);
    stepOrbs(this);
    stepWells(this);
    stepPlayerVitals(this);
    this.trimEvents();
    if (this.tick % simData.deltas.compactEveryTicks === 0) this.terrain.deltas.compact(this.tick);
  }

  private stepPlayer(p: PlayerState, input: PlayerInput): void {
    const f = this.flight;
    const dt = SIM_DT;
    const steer = sanitize(input.steer);
    const throttle = sanitize(input.throttle);

    // Speed: ease toward a target set by the throttle (cruise when the stick is centred).
    const target =
      throttle >= 0
        ? f.cruiseSpeed + (f.maxSpeed - f.cruiseSpeed) * throttle
        : f.cruiseSpeed + (f.minSpeed - f.cruiseSpeed) * -throttle;
    const rate = target > p.speed ? f.accel : f.decel;
    p.speed = p.speed < target ? Math.min(target, p.speed + rate * dt) : Math.max(target, p.speed - rate * dt);

    // Turning has inertia, and is a little slower at high speed.
    const speedFrac = clamp((p.speed - f.cruiseSpeed) / (f.maxSpeed - f.cruiseSpeed), 0, 1);
    const turnScale = 1 - (1 - f.highSpeedTurnScale) * speedFrac;
    const wantTurn = steer * f.maxTurnRate * turnScale;
    p.turnRate += (wantTurn - p.turnRate) * clamp(f.turnResponse * dt, 0, 1);
    p.heading = wrapAngle(p.heading - p.turnRate * dt); // steer right = clockwise from above

    // Horizontal momentum: velocity chases the heading direction with limited grip.
    const fx = dsin(p.heading);
    const fz = dcos(p.heading);
    const grip = clamp(f.grip * dt, 0, 1);
    p.vx += (fx * p.speed - p.vx) * grip;
    p.vz += (fz * p.speed - p.vz) * grip;
    p.x += p.vx * dt;
    p.z += p.vz * dt;

    // Hover above terrain: spring toward (highest nearby ground + hover height).
    const ahead = f.lookAheadSeconds;
    let ground = this.terrain.surfaceAt(p.x, p.z);
    ground = Math.max(ground, this.terrain.surfaceAt(p.x + p.vx * ahead * 0.5, p.z + p.vz * ahead * 0.5));
    ground = Math.max(ground, this.terrain.surfaceAt(p.x + p.vx * ahead, p.z + p.vz * ahead));
    const targetY = ground + f.hoverHeight + f.boostLift * speedFrac;
    const damping = 2 * f.springDamping * Math.sqrt(f.springK);
    p.vy += (f.springK * (targetY - p.y) - damping * p.vy) * dt;
    p.y += p.vy * dt;
    const floor = this.terrain.surfaceAt(p.x, p.z) + f.minClearance;
    if (p.y < floor) {
      p.y = floor;
      if (p.vy < 0) p.vy = 0;
    }
    if (p.y > f.maxAltitude) {
      p.y = f.maxAltitude;
      if (p.vy > 0) p.vy = 0;
    }

    // Debug terrain tools (stand-ins for earth spells until M2/M4).
    if (p.cooldown > 0) p.cooldown--;
    const actions = input.actions | 0;
    if (p.cooldown === 0 && (actions & (ACTION_CRATER | ACTION_MOUND)) !== 0) {
      const tools = simData.debugTools;
      const tx = p.x + fx * tools.targetDistance;
      const tz = p.z + fz * tools.targetDistance;
      const t = actions & ACTION_CRATER ? tools.crater : tools.mound;
      this.terrain.deltas.add(tx, tz, t.radius, t.amount, t.kind === 1 ? DELTA_CRATER : DELTA_BUMP, this.tick);
      p.cooldown = tools.cooldownTicks;
    }
  }

  // ------------------------------------------------------------ helpers
  emit(type: SimEventType, x: number, y: number, z: number, v: number): void {
    this.events.push({ seq: ++this.eventSeq, tick: this.tick, type, x, y, z, v });
  }

  private trimEvents(): void {
    const extra = this.events.length - simData.caps.events;
    if (extra > 0) this.events.splice(0, extra);
  }

  spawnOrb(x: number, y: number, z: number, value: number, vx: number, vz: number): void {
    if (this.orbs.length >= simData.caps.orbs) return;
    this.orbs.push({ id: this.nextId++, x, y, z, px: x, py: y, pz: z, vx, vz, value, age: 0 });
  }

  spawnCreature(type: string, x: number, z: number): void {
    const def = CREATURES[type];
    if (!def || this.creatures.length >= simData.caps.creatures) return;
    const y = this.terrain.surfaceAt(x, z) + def.hover;
    this.creatures.push({
      id: this.nextId++, type, x, y, z, px: x, py: y, pz: z, vx: 0, vz: 0, hp: def.hp,
      state: CREATURE_WANDER, cd: 0, burnTicks: 0, burnDps: 0, homeX: x, homeZ: z, wx: x, wz: z, wanderUntil: 0,
    });
  }

  /** Back to the spawn point with a mana penalty (castle respawn replaces this in M3). */
  respawn(p: PlayerState): void {
    p.deaths++;
    p.hp = simData.player.maxHp;
    p.mana = Math.floor(p.mana * (1 - simData.player.respawnManaLossFrac));
    p.x = this.spawn.x;
    p.z = this.spawn.z;
    p.y = this.terrain.surfaceAt(p.x, p.z) + this.flight.hoverHeight;
    p.vx = p.vy = p.vz = 0;
    p.speed = this.flight.cruiseSpeed;
    p.turnRate = 0;
    p.invuln = simData.player.invulnTicks;
    this.emit('respawn', p.x, p.y, p.z, 0);
  }
}
