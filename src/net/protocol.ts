// Co-op wire protocol (JSON over one WebSocket per player). Shared by the browser client and the
// server so both sides use exactly the same types and limits (src/data/net.json).
import net from '../data/net.json';
import { CHAPTERS } from '../data/chapters';
import { ELEMENTS, type Element } from '../data/elements';
import { matchSetupFromChapter } from '../data/matchSetup';
import type { DifficultyId, MatchSetup } from '../sim/match';
import type { PlayerInput } from '../sim/sim';

export const NET = net;
export const PROTOCOL_VERSION = net.protocol;

export type RoomPhase = 'lobby' | 'playing' | 'ended';

export interface LobbySeat {
  slot: number;
  element: Element;
  connected: boolean;
  name: string;
}

export interface LobbyState {
  phase: RoomPhase;
  chapter: number;
  difficulty: DifficultyId;
  seats: LobbySeat[];
  /** Slot of the host (the only one who can change chapter/difficulty and start). */
  host: number;
}

// ---------------------------------------------------------------- client -> server
/** [steer, throttle, actions, branch, pitch (null = touch play), strafe, count], steer/throttle/pitch/strafe in hundredths. */
export type RunInput = [steer: number, throttle: number, actions: number, branch: number, pitch: number | null, strafe: number, count: number];

export type ClientMsg =
  | { t: 'hello'; v: number; token?: string; name?: string; element?: Element }
  | { t: 'setup'; chapter: number; difficulty: DifficultyId }
  | { t: 'pick'; element: Element }
  | { t: 'start' }
  | { t: 'in'; seq: number; runs: RunInput[] }
  | { t: 'ping'; c: number }
  | { t: 'leave' };

// ---------------------------------------------------------------- server -> client
export type ServerMsg =
  | { t: 'welcome'; v: number; slot: number; token: string; room: string; lobby: LobbyState }
  | { t: 'lobby'; lobby: LobbyState }
  | { t: 'start'; slot: number; chapter: number; difficulty: DifficultyId; elements: [Element, Element]; tick: number }
  | { t: 'snap'; s: SnapshotWire }
  | { t: 'pong'; c: number; tick: number }
  | { t: 'notice'; text: string }
  | { t: 'error'; code: ErrorCode; text: string };

export type ErrorCode = 'bad_message' | 'bad_version' | 'room_full' | 'no_such_room' | 'rate_limited' | 'not_host' | 'not_ready' | 'busy' | 'budget' | 'match_lost' | 'timeout' | 'closed';

/** Compact snapshot: see snapshot.ts for the field layout. */
export interface SnapshotWire {
  k: number; // server tick
  a: number[]; // last input seq applied per human slot
  m: [status: string, reason: string, targetShare: number, suddenDeath: number, winner: number, endTick: number, shares: number[]];
  f: number[][]; // factions [captured, eliminated]
  p: (number | string)[][]; // wizards
  c: (number | string)[][]; // castles
  cr: (number | string)[][]; // creatures
  o: number[][]; // orbs
  pr: (number | string)[][]; // projectiles
  z: (number | string)[][]; // zones
  w: number[][]; // wells
  s: (number | string)[][]; // structures
  ev: (number | string)[][]; // events new since the previous snapshot
  d?: { e: number; n: number; l: number[][] }; // terrain deltas, only when changed
}

// ---------------------------------------------------------------- helpers
export function isElement(v: unknown): v is Element {
  return typeof v === 'string' && (ELEMENTS as readonly string[]).includes(v);
}

export function isDifficulty(v: unknown): v is DifficultyId {
  return v === 'easy' || v === 'normal' || v === 'hard';
}

/** Identical match setup on the server and on both clients. */
export function coopSetup(chapter: number, elements: [Element, Element], difficulty: DifficultyId): MatchSetup {
  const c = CHAPTERS[Math.max(0, Math.min(CHAPTERS.length - 1, chapter))]!;
  return { ...matchSetupFromChapter(c, elements, difficulty), coop: true };
}

/** Run-length encode a list of per-tick inputs (quantised to 0.01). */
export function encodeRuns(inputs: readonly PlayerInput[]): RunInput[] {
  const runs: RunInput[] = [];
  for (const i of inputs) {
    const st = Math.round(clampUnit(i.steer) * 100);
    const th = Math.round(clampUnit(i.throttle) * 100);
    const ac = i.actions | 0;
    const br = (i.branch ?? 0) | 0;
    const pi = i.pitch === undefined ? null : Math.round(clampUnit(i.pitch) * 100);
    const sd = Math.round(clampUnit(i.strafe ?? 0) * 100);
    const last = runs[runs.length - 1];
    if (last && last[0] === st && last[1] === th && last[2] === ac && last[3] === br && last[4] === pi && last[5] === sd && last[6] < 255) last[6]++;
    else runs.push([st, th, ac, br, pi, sd, 1]);
  }
  return runs;
}

export function decodeRuns(runs: readonly RunInput[]): PlayerInput[] {
  const out: PlayerInput[] = [];
  for (const [st, th, ac, br, pi, sd, n] of runs) {
    for (let k = 0; k < n; k++) out.push({ steer: st / 100, throttle: th / 100, actions: ac, branch: br, pitch: pi === null ? undefined : pi / 100, strafe: sd / 100 });
  }
  return out;
}

function clampUnit(v: number): number {
  return Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;
}

/** Strict validation of an untrusted client message. Returns null when it is not acceptable. */
export function parseClientMsg(raw: string): ClientMsg | null {
  if (raw.length > NET.maxMessageBytes) return null;
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof m !== 'object' || m === null) return null;
  const o = m as Record<string, unknown>;
  const int = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
  switch (o.t) {
    case 'hello':
      if (!int(o.v, 0, 1000)) return null;
      if (o.token !== undefined && (typeof o.token !== 'string' || o.token.length > 64)) return null;
      if (o.name !== undefined && (typeof o.name !== 'string' || o.name.length > 24)) return null;
      if (o.element !== undefined && !isElement(o.element)) return null;
      return { t: 'hello', v: o.v, token: o.token as string | undefined, name: o.name as string | undefined, element: o.element as Element | undefined };
    case 'setup':
      if (!int(o.chapter, 0, CHAPTERS.length - 1) || !isDifficulty(o.difficulty)) return null;
      return { t: 'setup', chapter: o.chapter, difficulty: o.difficulty };
    case 'pick':
      return isElement(o.element) ? { t: 'pick', element: o.element } : null;
    case 'start':
      return { t: 'start' };
    case 'ping':
      return int(o.c, 0, 2 ** 31) ? { t: 'ping', c: o.c } : null;
    case 'leave':
      return { t: 'leave' };
    case 'in': {
      if (!int(o.seq, 0, 2 ** 31) || !Array.isArray(o.runs) || o.runs.length === 0 || o.runs.length > NET.maxInputRuns) return null;
      const runs: RunInput[] = [];
      let total = 0;
      for (const r of o.runs) {
        if (!Array.isArray(r) || r.length !== 7) return null;
        const [st, th, ac, br, pi, sd, n] = r as unknown[];
        if (!int(st, -100, 100) || !int(th, -100, 100) || !int(ac, 0, 1023) || !int(br, 0, 3) || !(pi === null || int(pi, -100, 100)) || !int(sd, -100, 100) || !int(n, 1, 255)) return null;
        total += n;
        runs.push([st, th, ac, br, pi as number | null, sd, n]);
      }
      if (total > 255) return null;
      return { t: 'in', seq: o.seq, runs };
    }
    default:
      return null;
  }
}

export function pickFreeElement(taken: Element[], wanted?: Element): Element {
  if (wanted && !taken.includes(wanted)) return wanted;
  return ELEMENTS.find((e) => !taken.includes(e)) ?? 'fire';
}
