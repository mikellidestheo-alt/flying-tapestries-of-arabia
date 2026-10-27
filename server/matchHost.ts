// One co-op room: lobby, the authoritative simulation, input queues, snapshots, reconnects and abuse limits.
// Pure TypeScript (no Cloudflare types) so it runs under vitest with a fake transport; server/room.ts
// is the thin Durable Object wrapper that owns the sockets and the 30 Hz timer.
import { CHAPTERS } from '../src/data/chapters';
import type { Element } from '../src/data/elements';
import matchData from '../src/data/match.json';
import { NET, PROTOCOL_VERSION, coopSetup, decodeRuns, parseClientMsg, pickFreeElement, type ClientMsg, type ErrorCode, type LobbySeat, type LobbyState, type RoomPhase, type ServerMsg } from '../src/net/protocol';
import { buildSnapshot, deltaKey, type SnapshotContext } from '../src/net/snapshot';
import type { DifficultyId } from '../src/sim/match';
import { NEUTRAL_INPUT, Sim, SIM_TICK_RATE, type PlayerInput } from '../src/sim/sim';

export interface Transport {
  send(conn: number, data: string): void;
  close(conn: number, reason: string): void;
}

interface Seat {
  token: string;
  name: string;
  element: Element;
  conn: number; // -1 when disconnected
  /** Ticks of queued input, oldest first. */
  queue: { seq: number; input: PlayerInput }[];
  lastRecvSeq: number;
  ack: number;
  lastInput: PlayerInput;
  lastInputMs: number;
  disconnectedTick: number;
}

interface Conn {
  seat: number; // -1 until hello
  openedMs: number;
  windowStart: number;
  count: number;
  strikes: number;
}

export interface PersistedLobby {
  room: string;
  chapter: number;
  difficulty: DifficultyId;
  host: number;
  seats: { token: string; name: string; element: Element }[];
}

const randToken = (): string => {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
};

export class MatchHost {
  phase: RoomPhase = 'lobby';
  chapter = 0;
  difficulty: DifficultyId = 'normal';
  hostSlot = 0;
  sim: Sim | null = null;
  /** Incoming client messages since the last `takeMessageCount()` (for the free-plan budget). */
  private incoming = 0;
  private seats: Seat[] = [];
  private conns = new Map<number, Conn>();
  private ctx: SnapshotContext = { acks: [0, 0], lastEventSeq: 0, deltaKey: '' };
  private endedAtTick = -1;
  private createdMs: number;
  private startedMs = 0;
  /** Set when the room should be torn down (the driver reads this). */
  closed = false;

  constructor(readonly room: string, private transport: Transport, private nowMs: () => number) {
    this.createdMs = nowMs();
  }

  // ---------------------------------------------------------------- persistence (lobby only)
  persist(): PersistedLobby {
    return { room: this.room, chapter: this.chapter, difficulty: this.difficulty, host: this.hostSlot, seats: this.seats.map((s) => ({ token: s.token, name: s.name, element: s.element })) };
  }

  restore(p: PersistedLobby): void {
    this.chapter = p.chapter;
    this.difficulty = p.difficulty;
    this.hostSlot = p.host;
    this.seats = p.seats.map((s) => this.newSeat(s.token, s.name, s.element));
  }

  /** After hibernation: tie a still-open socket back to its seat. */
  rebind(conn: number, slot: number): void {
    const seat = this.seats[slot];
    if (!seat) return;
    seat.conn = conn;
    this.conns.set(conn, { seat: slot, openedMs: this.nowMs(), windowStart: this.nowMs(), count: 0, strikes: 0 });
  }

  // ---------------------------------------------------------------- connections
  connect(conn: number): void {
    const now = this.nowMs();
    this.conns.set(conn, { seat: -1, openedMs: now, windowStart: now, count: 0, strikes: 0 });
  }

  disconnect(conn: number): void {
    const c = this.conns.get(conn);
    this.conns.delete(conn);
    if (!c || c.seat < 0) return;
    const seat = this.seats[c.seat];
    if (!seat || seat.conn !== conn) return;
    seat.conn = -1;
    seat.disconnectedTick = this.sim?.tick ?? 0;
    if (this.phase === 'lobby') {
      // Leaving the lobby frees the seat; the host role passes on.
      this.seats.splice(c.seat, 1);
      this.fixSlots();
      if (this.seats.length === 0) this.closed = true;
      else this.broadcastLobby();
    }
  }

  private fixSlots(): void {
    this.seats.forEach((s, i) => {
      if (s.conn >= 0) {
        const c = this.conns.get(s.conn);
        if (c) c.seat = i;
      }
    });
    if (this.hostSlot >= this.seats.length) this.hostSlot = 0;
  }

  /** Handle one raw message from a connection. */
  message(conn: number, raw: string): void {
    const c = this.conns.get(conn);
    if (!c) return;
    this.incoming++;
    const now = this.nowMs();
    if (now - c.windowStart >= 1000) {
      c.windowStart = now;
      c.count = 0;
    }
    if (++c.count > NET.maxMessagesPerSecond) {
      if (++c.strikes >= 3) return this.kick(conn, 'rate_limited', 'Too many messages.');
      return;
    }
    const m = parseClientMsg(typeof raw === 'string' ? raw : '');
    if (!m) {
      if (++c.strikes >= 3) this.kick(conn, 'bad_message', 'Invalid message.');
      return;
    }
    if (m.t === 'hello') return this.hello(conn, c, m);
    if (c.seat < 0) return this.kick(conn, 'bad_message', 'Say hello first.');
    switch (m.t) {
      case 'setup': return this.setup(conn, c, m);
      case 'pick': return this.pick(c, m.element);
      case 'start': return this.start(conn, c);
      case 'in': return this.input(c, m);
      case 'ping': return this.send(conn, { t: 'pong', c: m.c, tick: this.sim?.tick ?? 0 });
      case 'leave': return this.kick(conn, 'closed', 'Left the room.');
    }
  }

  private kick(conn: number, code: ErrorCode, text: string): void {
    this.send(conn, { t: 'error', code, text });
    this.transport.close(conn, code);
    this.disconnect(conn);
  }

  private newSeat(token: string, name: string, element: Element): Seat {
    return { token, name, element, conn: -1, queue: [], lastRecvSeq: 0, ack: 0, lastInput: NEUTRAL_INPUT, lastInputMs: this.nowMs(), disconnectedTick: 0 };
  }

  private hello(conn: number, c: Conn, m: Extract<ClientMsg, { t: 'hello' }>): void {
    if (m.v !== PROTOCOL_VERSION) return this.kick(conn, 'bad_version', 'Please reload the game: your version does not match the server.');
    if (c.seat >= 0) return;
    // Reconnect with a known token.
    const known = m.token ? this.seats.findIndex((s) => s.token === m.token) : -1;
    if (known >= 0) {
      const seat = this.seats[known]!;
      if (seat.conn >= 0 && seat.conn !== conn) {
        this.transport.close(seat.conn, 'replaced');
        this.conns.delete(seat.conn);
      }
      seat.conn = conn;
      c.seat = known;
      if (this.phase === 'playing' && this.sim) this.sim.setAutopilot(known, null);
      this.send(conn, { t: 'welcome', v: PROTOCOL_VERSION, slot: known, token: seat.token, room: this.room, lobby: this.lobby() });
      if (this.phase === 'playing') this.sendStart(known);
      else this.broadcastLobby();
      return;
    }
    if (this.phase !== 'lobby') return this.kick(conn, 'room_full', 'This match has already started.');
    if (this.seats.length >= 2) return this.kick(conn, 'room_full', 'This room is full.');
    const element = pickFreeElement(this.seats.map((s) => s.element), m.element);
    const seat = this.newSeat(randToken(), (m.name ?? '').slice(0, 24) || `Wizard ${this.seats.length + 1}`, element);
    seat.conn = conn;
    this.seats.push(seat);
    c.seat = this.seats.length - 1;
    this.send(conn, { t: 'welcome', v: PROTOCOL_VERSION, slot: c.seat, token: seat.token, room: this.room, lobby: this.lobby() });
    this.broadcastLobby();
  }

  private setup(conn: number, c: Conn, m: Extract<ClientMsg, { t: 'setup' }>): void {
    if (c.seat !== this.hostSlot) return this.send(conn, { t: 'error', code: 'not_host', text: 'Only the host picks the chapter.' });
    if (this.phase !== 'lobby') return;
    this.chapter = m.chapter;
    this.difficulty = m.difficulty;
    this.broadcastLobby();
  }

  private pick(c: Conn, element: Element): void {
    if (this.phase !== 'lobby') return;
    const seat = this.seats[c.seat];
    if (!seat || this.seats.some((s) => s !== seat && s.element === element)) return; // the partner already has it
    seat.element = element;
    this.broadcastLobby();
  }

  private start(conn: number, c: Conn): void {
    if (c.seat !== this.hostSlot) return this.send(conn, { t: 'error', code: 'not_host', text: 'Only the host can start.' });
    if (this.phase !== 'lobby') return;
    if (this.seats.length < 2 || this.seats.some((s) => s.conn < 0)) return this.send(conn, { t: 'error', code: 'not_ready', text: 'Waiting for your partner.' });
    const elements: [Element, Element] = [this.seats[0]!.element, this.seats[1]!.element];
    const ch = CHAPTERS[this.chapter]!;
    this.sim = new Sim({ terrain: ch.terrain, creatureTypes: ch.creatureSet, match: coopSetup(this.chapter, elements, this.difficulty), playerCount: 2 });
    this.phase = 'playing';
    this.startedMs = this.nowMs();
    this.ctx = { acks: [0, 0], lastEventSeq: 0, deltaKey: '' };
    for (const s of this.seats) {
      s.queue = [];
      s.lastRecvSeq = 0;
      s.ack = 0;
      s.lastInputMs = this.nowMs();
    }
    this.seats.forEach((_, i) => this.sendStart(i));
    this.broadcastLobby();
  }

  private sendStart(slot: number): void {
    const seat = this.seats[slot]!;
    if (seat.conn < 0) return;
    this.send(seat.conn, { t: 'start', slot, chapter: this.chapter, difficulty: this.difficulty, elements: [this.seats[0]!.element, this.seats[1]!.element], tick: this.sim?.tick ?? 0 });
  }

  private input(c: Conn, m: Extract<ClientMsg, { t: 'in' }>): void {
    if (this.phase !== 'playing') return;
    const seat = this.seats[c.seat];
    if (!seat) return;
    const inputs = decodeRuns(m.runs);
    const first = m.seq - inputs.length + 1;
    seat.lastInputMs = this.nowMs();
    for (let i = 0; i < inputs.length; i++) {
      const seq = first + i;
      if (seq <= seat.lastRecvSeq) continue; // already have it
      seat.queue.push({ seq, input: inputs[i]! });
      seat.lastRecvSeq = seq;
    }
    // Never let a lagging client pile up latency: drop the oldest ticks beyond the backlog.
    while (seat.queue.length > NET.maxInputBacklogTicks) seat.ack = seat.queue.shift()!.seq;
  }

  // ---------------------------------------------------------------- simulation
  /** Advance the match by one 30 Hz tick; the driver calls this on a timer. */
  tickOnce(): void {
    const sim = this.sim;
    if (this.phase !== 'playing' || !sim) return;
    const inputs: PlayerInput[] = this.seats.map((seat) => {
      const next = seat.queue.shift();
      if (next) {
        seat.ack = next.seq;
        seat.lastInput = next.input;
        return next.input;
      }
      // Nothing queued (jitter): hold the stick but never repeat a button press.
      return { ...seat.lastInput, actions: 0, branch: 0 };
    });
    // Drop-outs: the AI takes the wizard after a short moment so the teammate is not left alone.
    this.seats.forEach((seat, i) => {
      if (seat.conn < 0 && sim.players[i]!.rivalIndex < 0 && sim.tick - seat.disconnectedTick >= matchData.coop.respawnAutopilotAfterTicks) sim.setAutopilot(i, 'defensive');
    });
    sim.step(inputs);
    if (sim.tick % NET.snapshotEveryTicks === 0) this.broadcastSnapshot();
    if (sim.match.status !== 'playing' && this.endedAtTick < 0) {
      this.endedAtTick = sim.tick;
      this.broadcastSnapshot();
    }
    if (this.endedAtTick >= 0 && sim.tick - this.endedAtTick > SIM_TICK_RATE * 20) {
      this.phase = 'ended';
      this.broadcastLobby();
      this.closed = true;
    }
  }

  private broadcastSnapshot(): void {
    const sim = this.sim!;
    this.ctx.acks = this.seats.map((s) => s.ack);
    const snap = buildSnapshot(sim, this.ctx);
    if (snap.d) this.ctx.deltaKey = deltaKey(sim);
    const data = JSON.stringify({ t: 'snap', s: snap });
    for (const s of this.seats) if (s.conn >= 0) this.transport.send(s.conn, data);
  }

  // ---------------------------------------------------------------- timeouts and housekeeping
  /** Called about once a second by the driver. */
  housekeeping(): void {
    const now = this.nowMs();
    for (const [conn, c] of this.conns) {
      if (c.seat < 0 && now - c.openedMs > NET.helloTimeoutMs) this.kick(conn, 'timeout', 'No hello.');
    }
    if (this.phase === 'lobby' && now - this.createdMs > NET.lobbyTimeoutSeconds * 1000) return this.closeRoom('timeout', 'The room expired.');
    if (this.phase === 'playing') {
      if (now - this.startedMs > NET.matchMaxSeconds * 1000) return this.closeRoom('timeout', 'The match reached its time limit.');
      for (const seat of this.seats) {
        if (seat.conn >= 0 && now - seat.lastInputMs > NET.idleKickSeconds * 1000) this.kick(seat.conn, 'timeout', 'Disconnected for inactivity.');
      }
      const sim = this.sim;
      if (sim && this.seats.every((s) => s.conn < 0) && sim.tick - Math.max(...this.seats.map((s) => s.disconnectedTick)) > NET.reconnectGraceSeconds * SIM_TICK_RATE) this.closeRoom('closed', 'Everyone left.');
    }
  }

  /** The free-plan budget ran out (or the room is being retired): tell everyone and wind down. */
  closeRoom(code: ErrorCode, text: string): void {
    for (const s of this.seats) if (s.conn >= 0) {
      this.send(s.conn, { t: 'error', code, text });
      this.transport.close(s.conn, code);
    }
    this.closed = true;
  }

  takeMessageCount(): number {
    const n = this.incoming;
    this.incoming = 0;
    return n;
  }

  /** Seat index of a connection, or -1 before hello. */
  slotOf(conn: number): number {
    return this.conns.get(conn)?.seat ?? -1;
  }

  get connected(): number {
    return this.seats.filter((s) => s.conn >= 0).length;
  }

  // ---------------------------------------------------------------- lobby plumbing
  lobby(): LobbyState {
    const seats: LobbySeat[] = this.seats.map((s, i) => ({ slot: i, element: s.element, connected: s.conn >= 0, name: s.name }));
    return { phase: this.phase, chapter: this.chapter, difficulty: this.difficulty, seats, host: this.hostSlot };
  }

  private broadcastLobby(): void {
    const msg: ServerMsg = { t: 'lobby', lobby: this.lobby() };
    for (const s of this.seats) if (s.conn >= 0) this.send(s.conn, msg);
  }

  private send(conn: number, m: ServerMsg): void {
    this.transport.send(conn, JSON.stringify(m));
  }
}
