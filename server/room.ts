// Durable Object: one instance per co-op match (named by its room code). It owns the WebSockets
// (hibernation API, so an idle lobby costs nothing), the 30 Hz timer while a match runs, and delegates all
// game logic to MatchHost. A match lives in memory: if the runtime ever evicts the object mid-match the
// players get a clear "match lost" message (see webSocketMessage) instead of a silent hang.
import { DurableObject } from 'cloudflare:workers';
import { NET } from '../src/net/protocol';
import { MatchHost, type PersistedLobby } from './matchHost';

interface Attachment {
  conn: number;
  slot: number;
}

const TICK_MS = 1000 / 30;
const MAX_CATCH_UP = 3;

export class MatchRoom extends DurableObject<Env> {
  private host: MatchHost | null = null;
  private nextConn = 1;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTickMs = 0;
  private acc = 0;
  private housekeepingAt = 0;
  private reportAt = 0;
  private roomCode = '';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Restore a lobby after hibernation: players are still connected, their sockets carry {conn, slot}.
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get<PersistedLobby>('lobby');
      if (!saved) return;
      this.roomCode = saved.room;
      const host = this.makeHost(saved.room);
      host.restore(saved);
      for (const ws of ctx.getWebSockets()) {
        const a = ws.deserializeAttachment() as Attachment | null;
        if (a) {
          host.rebind(a.conn, a.slot);
          this.nextConn = Math.max(this.nextConn, a.conn + 1);
        }
      }
      this.host = host;
    });
  }

  private makeHost(room: string): MatchHost {
    return new MatchHost(
      room,
      {
        send: (conn, data) => this.socketOf(conn)?.send(data),
        close: (conn, reason) => {
          try {
            this.socketOf(conn)?.close(1000, reason.slice(0, 100));
          } catch {
            /* already closed */
          }
        },
      },
      () => Date.now(),
    );
  }

  private socketOf(conn: number): WebSocket | undefined {
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a && a.conn === conn) return ws;
    }
    return undefined;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const url = new URL(request.url);
    const code = url.pathname.split('/').pop() ?? '';
    if (!this.host) {
      this.roomCode = code;
      this.host = this.makeHost(code);
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    const conn = this.nextConn++;
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ conn, slot: -1 } satisfies Attachment);
    this.host.connect(conn);
    this.ensureTimers();
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    const a = ws.deserializeAttachment() as Attachment | null;
    if (!a) return;
    if (!this.host) {
      // The object was evicted while a match was running: nothing to resume.
      try {
        ws.send(JSON.stringify({ t: 'error', code: 'match_lost', text: 'The match was interrupted. Please create a new room.' }));
        ws.close(1011, 'match_lost');
      } catch {
        /* ignore */
      }
      return;
    }
    this.host.message(a.conn, typeof message === 'string' ? message : '');
    this.afterMessage(ws, a);
  }

  private afterMessage(ws: WebSocket, a: Attachment): void {
    const host = this.host!;
    // Seat assignment happens inside the host on hello; mirror it into the socket attachment.
    const seat = host.slotOf(a.conn);
    if (seat !== a.slot) {
      a.slot = seat;
      ws.serializeAttachment(a);
    }
    if (host.phase === 'lobby') void this.ctx.storage.put('lobby', host.persist());
    if (host.phase === 'playing') this.ensureTimers();
    if (host.closed) void this.retire();
  }

  webSocketClose(ws: WebSocket): void {
    this.dropSocket(ws);
  }

  webSocketError(ws: WebSocket): void {
    this.dropSocket(ws);
  }

  private dropSocket(ws: WebSocket): void {
    const a = ws.deserializeAttachment() as Attachment | null;
    if (!a || !this.host) return;
    this.host.disconnect(a.conn);
    if (this.host.phase === 'lobby') void this.ctx.storage.put('lobby', this.host.persist());
    if (this.host.closed) void this.retire();
  }

  // ---------------------------------------------------------------- 30 Hz loop (only while a match runs)
  private ensureTimers(): void {
    if (this.timer !== null || !this.host) return;
    this.lastTickMs = Date.now();
    this.acc = 0;
    this.timer = setInterval(() => this.loop(), TICK_MS / 2);
    void this.ctx.storage.setAlarm(Date.now() + 60_000); // backstop: wake up to clean a dead room even without sockets
  }

  private loop(): void {
    const host = this.host;
    if (!host) return this.stopTimer();
    const now = Date.now();
    this.acc += now - this.lastTickMs;
    this.lastTickMs = now;
    let n = 0;
    while (this.acc >= TICK_MS && n < MAX_CATCH_UP) {
      host.tickOnce();
      this.acc -= TICK_MS;
      n++;
    }
    if (n === MAX_CATCH_UP) this.acc = 0; // fell behind: drop the backlog instead of spiralling
    if (now >= this.housekeepingAt) {
      this.housekeepingAt = now + 1000;
      host.housekeeping();
    }
    if (now >= this.reportAt) {
      this.reportAt = now + NET.gate.reportEverySeconds * 1000;
      void this.reportUsage();
    }
    if (host.closed) void this.retire();
    else if (host.connected === 0 && host.phase !== 'playing') this.stopTimer();
  }

  /** Tell the Gate how many messages this room received; it answers "stop" when the day's budget is spent. */
  private async reportUsage(): Promise<void> {
    const host = this.host;
    if (!host) return;
    const count = host.takeMessageCount();
    if (count === 0) return;
    try {
      const stub = this.env.GATE.get(this.env.GATE.idFromName('gate'));
      const res = await stub.fetch('https://gate/report', { method: 'POST', body: JSON.stringify({ n: count }) });
      const body = (await res.json()) as { state: 'ok' | 'stop' };
      if (body.state === 'stop') host.closeRoom('budget', 'The free daily limit for co-op has been reached. Please come back tomorrow.');
    } catch {
      /* the gate is best-effort */
    }
  }

  private stopTimer(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private async retire(): Promise<void> {
    this.stopTimer();
    const code = this.roomCode;
    this.host = null;
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(1000, 'closed');
      } catch {
        /* ignore */
      }
    }
    await this.ctx.storage.deleteAll();
    try {
      const stub = this.env.GATE.get(this.env.GATE.idFromName('gate'));
      await stub.fetch('https://gate/release', { method: 'POST', body: JSON.stringify({ code }) });
    } catch {
      /* best effort */
    }
  }

  async alarm(): Promise<void> {
    if (!this.host || this.host.closed || this.ctx.getWebSockets().length === 0) await this.retire();
    else void this.ctx.storage.setAlarm(Date.now() + 60_000);
  }
}
