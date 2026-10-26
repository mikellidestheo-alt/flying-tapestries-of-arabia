// Deterministic fixed-step simulation. No rendering, DOM or UI imports: the same file
// runs in the browser (solo) and inside the Durable Object (co-op).
import simData from '../data/sim.json';
import flightData from '../data/flight.json';
import { clamp, dcos, dsin, wrapAngle } from './dmath';
import { DeltaStore, DELTA_BUMP, DELTA_CRATER } from './deltas';
import { Terrain, findSpawn, type TerrainParams } from './terrain';

export const SIM_DT = 1 / simData.tickRate;
export const SIM_TICK_RATE = simData.tickRate;
export type FlightTuning = typeof flightData;

export const ACTION_CRATER = 1;
export const ACTION_MOUND = 2;

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
  cooldown: number;
}

export function clonePlayer(p: PlayerState): PlayerState {
  return { ...p };
}

export interface SimOptions {
  terrain: TerrainParams;
  playerCount?: number;
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
  private flight: FlightTuning;

  constructor(opts: SimOptions) {
    this.flight = opts.flight ?? flightData;
    this.terrain = new Terrain(opts.terrain, new DeltaStore(simData.deltas));
    const count = opts.playerCount ?? 1;
    const spawn = findSpawn(opts.terrain);
    for (let i = 0; i < count; i++) {
      const x = spawn.x + i * 8;
      const y = this.terrain.surfaceAt(x, spawn.z) + this.flight.hoverHeight;
      this.players.push({
        x, y, z: spawn.z, vx: 0, vy: 0, vz: 0, heading: 0, speed: this.flight.cruiseSpeed, turnRate: 0, cooldown: 0,
      });
    }
    this.prevPlayers = this.players.map(clonePlayer);
  }

  step(inputs: readonly PlayerInput[]): void {
    this.prevPlayers = this.players.map(clonePlayer);
    this.tick++;
    for (let i = 0; i < this.players.length; i++) {
      this.stepPlayer(this.players[i]!, inputs[i] ?? NEUTRAL_INPUT);
    }
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
}
