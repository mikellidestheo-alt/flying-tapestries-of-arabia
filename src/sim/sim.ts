// Deterministic fixed-step simulation. No rendering, DOM or UI imports: the same file
// runs in the browser (solo) and inside the Durable Object (co-op).
import simData from '../data/sim.json';
import flightData from '../data/flight.json';
import matchData from '../data/match.json';
import { clamp, dcos, dsin, wrapAngle } from './dmath';
import { DeltaStore, DELTA_BUMP, DELTA_CRATER } from './deltas';
import { Prng, hashInts } from './prng';
import {
  CREATURE_WANDER,
  type Castle, type Creature, type Faction, type Orb, type Projectile, type SimEvent, type SimEventType, type Structure, type Well,
} from './entities';
import { CREATURES, creatureHp, stepProjectiles, tryCast } from './combat';
import { findCastleSite, makeCastle, refreshObstacle, stepCastles, tryDeposit, tryUpgrade } from './castles';
import { DIFFICULTIES, stepMatch, type MatchSetup, type MatchState } from './match';
import { makeRivalAI, rivalInput, type Personality, type RivalAI } from './rivals';
import { stepCreatures, stepNests, stepOrbs, stepPlayerVitals, stepWells } from './world';
import { Terrain, baseHeight, cityFactor, findSpawn, type TerrainParams } from './terrain';

export const SIM_DT = 1 / simData.tickRate;
export const SIM_TICK_RATE = simData.tickRate;
export type FlightTuning = typeof flightData;

export const ACTION_CRATER = 1;
export const ACTION_MOUND = 2;
export const ACTION_SPELL = 4;
export const ACTION_UPGRADE = 8;
export const ACTION_DEPOSIT = 16;

export interface PlayerInput {
  /** -1 (left) .. 1 (right) */
  steer: number;
  /** -1 (brake) .. 1 (boost); 0 = cruise */
  throttle: number;
  /** Bitmask of ACTION_* pressed this tick. */
  actions: number;
  /** Castle upgrade branch choice, 1-3 (0 = none). Only read with ACTION_UPGRADE. */
  branch?: number;
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
  casts: number;
  /** Id of the mana well being drawn from this tick, or 0. */
  drawing: number;
  faction: number;
  isRival: boolean;
  /** Index into Sim.ai for AI-driven wizards (rivals, autopilot humans), -1 for humans. */
  rivalIndex: number;
  /** False once a rival's faction is eliminated. */
  active: boolean;
  /** Index of the wizard who last damaged this one (-1 none). */
  lastHitBy: number;
}

export interface SimOptions {
  terrain: TerrainParams;
  playerCount?: number;
  /** Creature type ids that may spawn (from the chapter's creatureSet). */
  creatureTypes?: string[];
  flight?: FlightTuning;
  /** Full match: castles, rivals, factions, win rules. Omit for a free-flight sandbox. */
  match?: MatchSetup;
  /** Drive the human wizards with the rival AI (balance simulations, AI-vs-AI tests). */
  autopilot?: Personality;
}

function sanitize(v: number): number {
  return Number.isFinite(v) ? clamp(v, -1, 1) : 0;
}

export class Sim {
  tick = 0;
  readonly terrain: Terrain;
  players: PlayerState[] = [];
  prevPlayers: PlayerState[] = [];
  humanCount = 1;
  orbs: Orb[] = [];
  projectiles: Projectile[] = [];
  creatures: Creature[] = [];
  wells: Well[] = [];
  structures: Structure[] = [];
  castles: Castle[] = [];
  factions: Faction[] = [];
  ai: RivalAI[] = [];
  events: SimEvent[] = [];
  eventSeq = 0;
  nextId = 1;
  nextWellTick = simData.wells.firstTick;
  readonly rng: Prng;
  readonly creatureTypes: string[];
  readonly spawn: { x: number; z: number };
  readonly setup: MatchSetup | undefined;
  match: MatchState = { status: 'playing', reason: '', targetShare: 1, suddenDeath: false, shares: [], endTick: 0 };
  private flight: FlightTuning;

  constructor(opts: SimOptions) {
    this.flight = opts.flight ?? flightData;
    this.setup = opts.match;
    this.terrain = new Terrain(opts.terrain, new DeltaStore(simData.deltas));
    this.rng = new Prng(hashInts(opts.terrain.seed, 0x51a9));
    this.creatureTypes = (opts.creatureTypes ?? ['dust-sprite']).filter((t) => t in CREATURES);
    const count = opts.playerCount ?? 1;
    this.humanCount = count;
    this.spawn = this.chooseSpawn(opts.terrain);

    const setup = this.setup;
    if (setup) this.buildMatch(setup, count);

    for (let i = 0; i < count; i++) {
      const home = this.homeOf(0);
      const x = home.x + i * 8;
      const y = this.terrain.surfaceAt(x, home.z + 14) + this.flight.hoverHeight + (setup ? 10 : 0);
      this.players.push(this.newWizard(x, y, home.z + 14, 0, false, -1));
    }
    if (setup) {
      setup.rivals.forEach((r, i) => {
        const f = i + 1;
        const home = this.homeOf(f);
        const y = this.terrain.surfaceAt(home.x, home.z + 14) + this.flight.hoverHeight + 10;
        const w = this.newWizard(home.x, y, home.z + 14, f, true, this.ai.length);
        w.hp = this.maxHpFor(w);
        this.players.push(w);
        this.ai.push(makeRivalAI(r.personality, i));
      });
      if (opts.autopilot) {
        for (let i = 0; i < count; i++) {
          this.players[i]!.rivalIndex = this.ai.length;
          this.ai.push(makeRivalAI(opts.autopilot, this.ai.length));
        }
      }
      this.spawnStarterOrbs();
      this.placeNests();
    }
    this.prevPlayers = this.players.map((p) => ({ ...p }));
  }

  private chooseSpawn(params: TerrainParams): { x: number; z: number } {
    return findSpawn(params);
  }

  private newWizard(x: number, y: number, z: number, faction: number, isRival: boolean, rivalIndex: number): PlayerState {
    return {
      x, y, z, vx: 0, vy: 0, vz: 0, heading: 0, speed: this.flight.cruiseSpeed, turnRate: 0, cooldown: 0,
      hp: simData.player.maxHp, mana: simData.player.startMana, spellCd: 0, invuln: 0, kills: 0, deaths: 0, casts: 0,
      drawing: 0, faction, isRival, rivalIndex, active: true, lastHitBy: -1,
    };
  }

  /** Where a faction's wizards (re)spawn: beside its castle, or the sandbox spawn point. */
  homeOf(faction: number): { x: number; z: number } {
    const c = this.castles.find((q) => q.faction === faction);
    return c ? { x: c.x, z: c.z } : this.spawn;
  }

  maxHpFor(p: PlayerState): number {
    if (!p.isRival || !this.setup) return simData.player.maxHp;
    return matchData.wizardMaxHp * DIFFICULTIES[this.setup.difficulty].rivalHp;
  }

  private buildMatch(setup: MatchSetup, humanCount: number): void {
    const count = setup.rivals.length + 1;
    this.factions.push({ id: 0, human: true, name: humanCount > 1 ? 'Your team' : 'You', captured: 0, eliminated: false, castle: 0, personality: '' });
    setup.rivals.forEach((r, i) => {
      this.factions.push({ id: i + 1, human: false, name: r.name, captured: 0, eliminated: false, castle: 0, personality: r.personality });
    });
    for (let f = 0; f < count; f++) {
      const site = findCastleSite(this.terrain.params, this.spawn, f, count);
      this.terrain.pads.push({ x: site.x, z: site.z, r: matchData.castlePadRadius, h: site.h });
      const castle = makeCastle(this.nextId++, f, site.x, site.h, site.z);
      this.factions[f]!.castle = castle.id;
      this.castles.push(castle);
      refreshObstacle(this, castle);
    }
    this.match = {
      status: 'playing', reason: '', targetShare: setup.targetShare, suddenDeath: false,
      shares: this.factions.map(() => 1 / count), endTick: 0,
    };
  }

  private spawnStarterOrbs(): void {
    const home = this.homeOf(0);
    for (let i = 0; i < matchData.starterOrbs; i++) {
      const a = this.rng.range(0, 6.283185307);
      const r = this.rng.range(25, matchData.starterOrbRadius);
      const x = home.x + dcos(a) * r;
      const z = home.z + dsin(a) * r;
      this.spawnOrb(x, this.terrain.surfaceAt(x, z) + simData.orbs.ambientAltitude, z, simData.orbs.ambientValue, 0, 0);
    }
  }

  private placeNests(): void {
    const cfg = matchData.nests;
    const setup = this.setup!;
    const count = setup.nestCount ?? cfg.count;
    const home = this.homeOf(0);
    for (let i = 0; i < count; i++) {
      for (let attempt = 0; attempt < 20; attempt++) {
        const a = this.rng.range(0, 6.283185307);
        const r = this.rng.range(cfg.minDistance, cfg.maxDistance);
        const x = home.x + dcos(a) * r;
        const z = home.z + dsin(a) * r;
        const h = baseHeight(this.terrain.params, x, z);
        if (h < this.terrain.params.waterLevel + 2 || cityFactor(this.terrain.params, x, z) > 0.05) continue;
        this.structures.push({ id: this.nextId++, kind: 'nest', x, y: h, z, hp: cfg.hp, max: cfg.hp, alive: true, spawnCd: 120, respawnAt: 0 });
        break;
      }
    }
  }

  step(inputs: readonly PlayerInput[]): void {
    for (let i = 0; i < this.players.length; i++) Object.assign(this.prevPlayers[i]!, this.players[i]);
    this.tick++;
    if (this.match.status !== 'playing') {
      // Match over: the world keeps drifting but nobody acts.
      stepCreatures(this);
      stepOrbs(this);
      this.trimEvents();
      return;
    }
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i]!;
      if (!p.active) continue;
      const input = p.rivalIndex >= 0 ? rivalInput(this, i) : (inputs[i] ?? NEUTRAL_INPUT);
      this.stepPlayer(p, input);
      if ((input.actions | 0) & ACTION_SPELL) tryCast(this, i);
      if ((input.actions | 0) & ACTION_UPGRADE) tryUpgrade(this, p, input);
      if ((input.actions | 0) & ACTION_DEPOSIT) tryDeposit(this, p);
    }
    stepProjectiles(this);
    stepCreatures(this);
    stepNests(this);
    stepCastles(this);
    stepOrbs(this);
    stepWells(this);
    stepPlayerVitals(this);
    stepMatch(this);
    this.trimEvents();
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

    // Hover above terrain (and rooftops, castles): spring toward the highest nearby surface.
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

    // Debug terrain tools (stand-ins for earth spells until M4).
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
    this.events.push({ seq: ++this.eventSeq, tick: this.tick, type, x, y, z, v, x2: 0, y2: 0, z2: 0 });
  }

  emitLine(type: SimEventType, x: number, y: number, z: number, x2: number, y2: number, z2: number, v: number): void {
    this.events.push({ seq: ++this.eventSeq, tick: this.tick, type, x, y, z, v, x2, y2, z2 });
  }

  private trimEvents(): void {
    const extra = this.events.length - simData.caps.events;
    if (extra > 0) this.events.splice(0, extra);
  }

  /** Add mana to a wizard's pool (capped) and count it towards the faction's captured share. */
  gainMana(p: PlayerState, amount: number): number {
    const a = Math.max(0, Math.min(amount, simData.player.maxMana - p.mana));
    p.mana += a;
    const f = this.factions[p.faction];
    if (f) f.captured += a;
    return a;
  }

  spawnOrb(x: number, y: number, z: number, value: number, vx: number, vz: number): void {
    if (this.orbs.length >= simData.caps.orbs) return;
    this.orbs.push({ id: this.nextId++, x, y, z, px: x, py: y, pz: z, vx, vz, value, age: 0 });
  }

  spawnCreature(type: string, x: number, z: number, nest = 0): void {
    const def = CREATURES[type];
    if (!def || this.creatures.length >= simData.caps.creatures) return;
    const y = this.terrain.surfaceAt(x, z) + def.hover;
    const hp = creatureHp(type, this.setup?.difficulty ?? 'normal');
    this.creatures.push({
      id: this.nextId++, type, nest, x, y, z, px: x, py: y, pz: z, vx: 0, vz: 0, hp,
      state: CREATURE_WANDER, cd: 0, burnTicks: 0, burnDps: 0, homeX: x, homeZ: z, wx: x, wz: z, wanderUntil: 0,
    });
  }

  /** Respawn at the faction's castle (or the sandbox spawn) with a mana penalty; the lost mana drops as orbs. */
  respawn(p: PlayerState): void {
    p.deaths++;
    p.hp = this.maxHpFor(p);
    const lost = Math.floor(p.mana * matchData.wizardRespawnManaLoss);
    p.mana -= lost;
    const n = clamp(Math.round(lost / 10), 0, 8);
    for (let i = 0; i < n; i++) {
      const a = this.rng.range(0, 6.283185307);
      const sp = this.rng.range(4, 12);
      this.spawnOrb(p.x, p.y, p.z, lost / n, dcos(a) * sp, dsin(a) * sp);
    }
    const credit = this.players[p.lastHitBy];
    if (credit) credit.kills++;
    p.lastHitBy = -1;
    const home = this.homeOf(p.faction);
    p.x = home.x;
    p.z = home.z + 14;
    p.y = this.terrain.surfaceAt(p.x, p.z) + this.flight.hoverHeight + 10;
    p.vx = p.vy = p.vz = 0;
    p.speed = this.flight.cruiseSpeed;
    p.turnRate = 0;
    p.invuln = simData.player.invulnTicks;
    this.emit('respawn', p.x, p.y, p.z, p.isRival ? 0 : 1);
  }
}
