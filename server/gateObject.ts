// Durable Object wrapper around GateCore (state is a tiny JSON blob in storage).
import { DurableObject } from 'cloudflare:workers';
import { NET } from '../src/net/protocol';
import { GateCore, emptyGate, utcDay, type GateState } from './gate';

function makeCode(): string {
  const a = NET.roomCodeAlphabet;
  const bytes = new Uint8Array(NET.roomCodeLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => a[b % a.length]).join('');
}

export class Gate extends DurableObject<Env> {
  private core: GateCore | null = null;

  private async load(): Promise<GateCore> {
    if (!this.core) this.core = new GateCore((await this.ctx.storage.get<GateState>('state')) ?? emptyGate(utcDay(Date.now())));
    return this.core;
  }

  async fetch(request: Request): Promise<Response> {
    const core = await this.load();
    const url = new URL(request.url);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const now = Date.now();
    let out: unknown = { ok: false };
    if (url.pathname === '/issue') out = core.issue(String(body.ip ?? 'unknown'), now, makeCode);
    else if (url.pathname === '/check') out = { ok: core.check(String(body.code ?? ''), now) };
    else if (url.pathname === '/report') out = { state: core.report(Number(body.n) || 0, now) };
    else if (url.pathname === '/release') {
      core.release(String(body.code ?? ''));
      out = { ok: true };
    }
    await this.ctx.storage.put('state', core.state);
    return new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json' } });
  }
}
