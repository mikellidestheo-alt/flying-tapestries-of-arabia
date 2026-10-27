// Free-plan guard for the whole game (one Durable Object instance, name "gate"). It hands out room
// codes, rate-limits creation per (hashed) IP, caps rooms per day, and keeps a running total of incoming
// WebSocket messages so the day's free Durable Object request allowance (100k) is never exhausted:
// new rooms are refused once the soft budget is used, and running rooms are wound down at the hard budget.
// Pure logic (no Cloudflare types) so it can be unit-tested; the DO wrapper only loads and saves `state`.
import { NET } from '../src/net/protocol';

export interface GateState {
  day: string;
  rooms: number;
  messages: number;
  issued: Record<string, number>;
  ips: Record<string, { hour: number; n: number }>;
}

export type IssueResult = { ok: true; code: string } | { ok: false; code: 'rate_limited' | 'budget' };
export type ReportResult = 'ok' | 'stop';

const G = NET.gate;

export function emptyGate(day: string): GateState {
  return { day, rooms: 0, messages: 0, issued: {}, ips: {} };
}

export function utcDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export class GateCore {
  constructor(public state: GateState) {}

  private roll(nowMs: number): void {
    const day = utcDay(nowMs);
    if (this.state.day !== day) this.state = emptyGate(day); // the free quotas reset at 00:00 UTC
    for (const [code, exp] of Object.entries(this.state.issued)) if (exp < nowMs) delete this.state.issued[code];
    const hour = Math.floor(nowMs / 3600000);
    for (const [ip, v] of Object.entries(this.state.ips)) if (v.hour < hour) delete this.state.ips[ip];
  }

  issue(ipHash: string, nowMs: number, makeCode: () => string): IssueResult {
    this.roll(nowMs);
    const s = this.state;
    if (s.rooms >= G.dailyRoomCap || s.messages >= G.dailyMessageBudget) return { ok: false, code: 'budget' };
    const hour = Math.floor(nowMs / 3600000);
    const rec = s.ips[ipHash];
    if (rec && rec.hour === hour && rec.n >= G.createPerIpPerHour) return { ok: false, code: 'rate_limited' };
    let code = makeCode();
    for (let i = 0; i < 20 && s.issued[code] !== undefined; i++) code = makeCode();
    s.issued[code] = nowMs + G.roomTtlSeconds * 1000;
    s.rooms++;
    s.ips[ipHash] = rec && rec.hour === hour ? { hour, n: rec.n + 1 } : { hour, n: 1 };
    return { ok: true, code };
  }

  /** Is this a room code we issued recently? (Stops anyone from spinning up Durable Objects with made-up codes.) */
  check(code: string, nowMs: number): boolean {
    this.roll(nowMs);
    return this.state.issued[code] !== undefined;
  }

  /** A room reports how many client messages it received since its last report. */
  report(messages: number, nowMs: number): ReportResult {
    this.roll(nowMs);
    this.state.messages += Math.max(0, messages) * G.messageWeight;
    return this.state.messages >= G.hardMessageBudget ? 'stop' : 'ok';
  }

  release(code: string): void {
    delete this.state.issued[code];
  }
}
