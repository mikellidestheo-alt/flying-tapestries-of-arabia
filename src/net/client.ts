// Browser WebSocket client for co-op: room creation over HTTP, then one socket per player.
import { NET, PROTOCOL_VERSION, type ClientMsg, type ServerMsg } from './protocol';

export type CloseInfo = { clean: boolean; reason: string };

export class NetClient {
  private ws: WebSocket | null = null;
  private pingTimer: number | null = null;
  private pingSent = new Map<number, number>();
  private pingId = 0;
  /** Smoothed round-trip time in ms (0 until the first pong). */
  rttMs = 0;
  token = '';
  room = '';
  slot = -1;
  onMessage: (m: ServerMsg) => void = () => undefined;
  onClose: (info: CloseInfo) => void = () => undefined;
  private intentional = false;

  /** Ask the server for a fresh room code. */
  static async createRoom(): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
    try {
      const res = await fetch('/api/room', { method: 'POST' });
      const body = (await res.json()) as { code?: string; error?: string };
      if (res.ok && body.code) return { ok: true, code: body.code };
      return { ok: false, error: body.error ?? `http_${res.status}` };
    } catch {
      return { ok: false, error: 'offline' };
    }
  }

  get open(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(room: string, hello: { name: string; element?: string }): Promise<void> {
    this.room = room.toUpperCase();
    this.intentional = false;
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      let ws: WebSocket;
      try {
        ws = new WebSocket(`${proto}://${location.host}/ws/${this.room}`);
      } catch (e) {
        reject(e);
        return;
      }
      this.ws = ws;
      let opened = false;
      ws.onopen = () => {
        opened = true;
        this.send({ t: 'hello', v: PROTOCOL_VERSION, token: this.token || undefined, name: hello.name, element: hello.element as never });
        this.startPings();
        resolve();
      };
      ws.onmessage = (e) => {
        let m: ServerMsg;
        try {
          m = JSON.parse(String(e.data)) as ServerMsg;
        } catch {
          return;
        }
        if (m.t === 'welcome') {
          this.token = m.token;
          this.slot = m.slot;
        } else if (m.t === 'pong') {
          const sent = this.pingSent.get(m.c);
          if (sent !== undefined) {
            this.pingSent.delete(m.c);
            const rtt = performance.now() - sent;
            this.rttMs = this.rttMs === 0 ? rtt : this.rttMs * 0.7 + rtt * 0.3;
          }
        }
        this.onMessage(m);
      };
      ws.onclose = (e) => {
        this.stopPings();
        if (!opened) reject(new Error('Could not reach the co-op server.'));
        this.onClose({ clean: this.intentional || e.wasClean, reason: e.reason });
      };
      ws.onerror = () => undefined; // onclose follows
    });
  }

  send(m: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  close(): void {
    this.intentional = true;
    this.stopPings();
    try {
      this.send({ t: 'leave' });
      this.ws?.close(1000, 'bye');
    } catch {
      /* already closed */
    }
    this.ws = null;
  }

  private startPings(): void {
    this.stopPings();
    const ping = () => {
      const c = ++this.pingId;
      this.pingSent.set(c, performance.now());
      if (this.pingSent.size > 8) this.pingSent.delete(this.pingSent.keys().next().value as number);
      this.send({ t: 'ping', c });
    };
    ping();
    this.pingTimer = window.setInterval(ping, NET.pingEveryMs);
  }

  private stopPings(): void {
    if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
    this.pingTimer = null;
  }
}
