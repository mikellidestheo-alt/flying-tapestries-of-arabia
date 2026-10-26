// Synthesised sound effects. Each spell element gets its own timbre (fire first; the other
// three arrive with their wizards in M4). Voices are capped so a busy fight cannot pile up nodes.
import type { AudioEngine } from './engine';

const MAX_VOICES = 28;

export class Sfx {
  private voices = 0;

  constructor(private engine: AudioEngine) {}

  private out(pan: number, gain: number): { ctx: AudioContext; dest: AudioNode } | null {
    const ctx = this.engine.ctx;
    if (!ctx || !this.engine.ready || this.voices >= MAX_VOICES || gain < 0.02) return null;
    const g = ctx.createGain();
    g.gain.value = gain;
    let tail: AudioNode = g;
    if (pan !== 0 && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p);
      tail = p;
    }
    tail.connect(this.engine.sfx);
    this.voices++;
    window.setTimeout(() => {
      this.voices--;
      g.disconnect();
    }, 1500);
    return { ctx, dest: g };
  }

  private noise(ctx: AudioContext, dest: AudioNode, t: number, dur: number, f0: number, f1: number, q: number, peak: number): void {
    const n = ctx.createBufferSource();
    n.buffer = this.engine.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = q;
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + Math.min(0.03, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(bp).connect(g).connect(dest);
    n.start(t, Math.random() * 0.4, dur + 0.05);
  }

  private tone(ctx: AudioContext, dest: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, dur: number, peak: number): void {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Fire cast: a rising whoosh with a crackle. */
  castFire(pan: number, gain: number): void {
    const o = this.out(pan, gain);
    if (!o) return;
    const t = o.ctx.currentTime;
    this.noise(o.ctx, o.dest, t, 0.32, 500, 2600, 1.1, 0.7);
    this.tone(o.ctx, o.dest, t, 'sawtooth', 220, 90, 0.28, 0.16);
    this.noise(o.ctx, o.dest, t + 0.04, 0.12, 4200, 3200, 2, 0.25);
  }

  impactFire(pan: number, gain: number): void {
    const o = this.out(pan, gain);
    if (!o) return;
    const t = o.ctx.currentTime;
    this.noise(o.ctx, o.dest, t, 0.55, 1200, 160, 0.8, 0.95);
    this.tone(o.ctx, o.dest, t, 'sine', 110, 38, 0.5, 0.9);
    this.noise(o.ctx, o.dest, t + 0.05, 0.25, 3800, 1200, 1.5, 0.3);
  }

  hit(pan: number, gain: number): void {
    const o = this.out(pan, gain);
    if (!o) return;
    const t = o.ctx.currentTime;
    this.tone(o.ctx, o.dest, t, 'square', 520, 300, 0.07, 0.25);
    this.noise(o.ctx, o.dest, t, 0.06, 3000, 2000, 2, 0.35);
  }

  kill(pan: number, gain: number): void {
    const o = this.out(pan, gain);
    if (!o) return;
    const t = o.ctx.currentTime;
    this.tone(o.ctx, o.dest, t, 'triangle', 700, 180, 0.25, 0.45);
    this.noise(o.ctx, o.dest, t, 0.3, 2400, 400, 0.9, 0.5);
    this.tone(o.ctx, o.dest, t + 0.1, 'sine', 1320, 1760, 0.22, 0.2);
  }

  /** Mana chime: pitch climbs while orbs keep coming, then resets. */
  orb(pan: number, gain: number, hz: number): void {
    const o = this.out(pan, gain);
    if (!o) return;
    const t = o.ctx.currentTime;
    this.tone(o.ctx, o.dest, t, 'sine', hz, hz * 1.003, 0.32, 0.4);
    this.tone(o.ctx, o.dest, t, 'sine', hz * 2, hz * 2, 0.18, 0.1);
  }

  playerHit(gain: number): void {
    const o = this.out(0, gain);
    if (!o) return;
    const t = o.ctx.currentTime;
    this.tone(o.ctx, o.dest, t, 'sawtooth', 160, 60, 0.28, 0.5);
    this.noise(o.ctx, o.dest, t, 0.2, 900, 300, 1, 0.4);
  }

  respawn(gain: number): void {
    const o = this.out(0, gain);
    if (!o) return;
    const t = o.ctx.currentTime;
    this.tone(o.ctx, o.dest, t, 'sine', 220, 880, 0.7, 0.35);
    this.noise(o.ctx, o.dest, t, 0.7, 600, 5000, 1, 0.3);
  }

  /** A bright bell when a mana well appears. */
  wellSpawn(pan: number, gain: number, hz: number): void {
    const o = this.out(pan, gain);
    if (!o) return;
    const t = o.ctx.currentTime;
    for (const [m, d] of [[1, 1.6], [1.5, 1.4], [2.01, 1.0], [3, 0.7]] as const) {
      this.tone(o.ctx, o.dest, t, 'sine', hz * m, hz * m, d, 0.28 / m);
    }
  }

  wellEnd(pan: number, gain: number, hz: number): void {
    const o = this.out(pan, gain);
    if (!o) return;
    const t = o.ctx.currentTime;
    this.tone(o.ctx, o.dest, t, 'sine', hz * 1.5, hz * 0.75, 0.9, 0.3);
  }

  /** A soft shimmer tick while channelling a well. */
  wellDraw(gain: number, hz: number): void {
    const o = this.out(0, gain);
    if (!o) return;
    const t = o.ctx.currentTime;
    this.tone(o.ctx, o.dest, t, 'sine', hz, hz * 1.5, 0.3, 0.16);
  }

  /** Short victory / defeat stings: a rising major-ish arpeggio or a falling minor one. */
  sting(win: boolean, rootHz: number, gain: number): void {
    const o = this.out(0, gain);
    if (!o) return;
    const t = o.ctx.currentTime;
    const steps = win ? [1, 1.25, 1.5, 2, 2.5] : [1, 0.944, 0.75, 0.667, 0.5];
    steps.forEach((m, i) => {
      this.tone(o.ctx, o.dest, t + i * 0.13, win ? 'triangle' : 'sawtooth', rootHz * m * 2, rootHz * m * 2, win ? 0.9 : 1.1, win ? 0.32 : 0.2);
    });
    if (win) this.noise(o.ctx, o.dest, t + 0.5, 0.8, 6000, 3000, 1, 0.15);
  }

  denied(gain: number): void {
    const o = this.out(0, gain);
    if (!o) return;
    this.tone(o.ctx, o.dest, o.ctx.currentTime, 'square', 180, 120, 0.1, 0.12);
  }
}
