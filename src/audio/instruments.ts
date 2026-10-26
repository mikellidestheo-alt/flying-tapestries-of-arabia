// Synthesised instruments (no samples): oud-like pluck, ney-like flute, darbuka, drone pad.
import type { AudioEngine } from './engine';

type Ctx = { ctx: AudioContext; out: AudioNode; noise: AudioBuffer };

function ctxOf(e: AudioEngine, out: AudioNode): Ctx | null {
  return e.ctx && e.noise ? { ctx: e.ctx, out, noise: e.noise } : null;
}

export class Instruments {
  private c: Ctx | null = null;
  private drone: { stop: () => void } | null = null;

  constructor(private engine: AudioEngine) {}

  private get(): Ctx | null {
    if (!this.c) this.c = ctxOf(this.engine, this.engine.music);
    return this.c;
  }

  /** Plucked string: bright attack that darkens and decays, like an oud. */
  oud(t: number, freq: number, dur: number, vel: number): void {
    const c = this.get();
    if (!c) return;
    const { ctx, out } = c;
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3200, t);
    lp.frequency.exponentialRampToValueAtTime(500, t + 0.35);
    lp.Q.value = 1.2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5 * vel, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35 + dur * 0.25);
    // Two slightly detuned strings (a course) plus a body resonance.
    for (const detune of [-4, 5]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(freq * 1.006, t);
      o.frequency.exponentialRampToValueAtTime(freq, t + 0.05);
      o.detune.value = detune;
      o.connect(lp);
      o.start(t);
      o.stop(t + 0.5 + dur * 0.25);
    }
    const sub = ctx.createOscillator();
    sub.type = 'triangle';
    sub.frequency.value = freq / 2;
    const sg = ctx.createGain();
    sg.gain.value = 0.35;
    sub.connect(sg).connect(lp);
    sub.start(t);
    sub.stop(t + 0.5 + dur * 0.25);
    lp.connect(g).connect(out);
    // Pick noise click.
    const n = ctx.createBufferSource();
    n.buffer = c.noise;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.18 * vel, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3500;
    n.connect(bp).connect(ng).connect(out);
    n.start(t, 0.1, 0.05);
  }

  /** Breathy flute with vibrato. */
  ney(t: number, freq: number, dur: number, vel: number): void {
    const c = this.get();
    if (!c) return;
    const { ctx, out } = c;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.28 * vel, t + 0.12);
    g.gain.setValueAtTime(0.28 * vel, t + dur - 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.2);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = freq * 2;
    const g2 = ctx.createGain();
    g2.gain.value = 0.12;
    // Vibrato fades in after the attack.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.2;
    const lg = ctx.createGain();
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(freq * 0.007, t + 0.5);
    lfo.connect(lg);
    lg.connect(o.frequency);
    lg.connect(o2.frequency);
    o.connect(lp);
    o2.connect(g2).connect(lp);
    // Breath.
    const n = ctx.createBufferSource();
    n.buffer = c.noise;
    n.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq * 2;
    bp.Q.value = 3;
    const ng = ctx.createGain();
    ng.gain.value = 0.35;
    n.connect(bp).connect(ng).connect(lp);
    lp.connect(g).connect(out);
    const end = t + dur + 0.3;
    for (const s of [o, o2, lfo, n]) {
      s.start(t);
      s.stop(end);
    }
  }

  /** Darbuka: deep "dum", crisp "tek", soft "ka". */
  drum(t: number, kind: 'dum' | 'tek' | 'ka', vel: number): void {
    const c = this.get();
    if (!c) return;
    const { ctx, out } = c;
    if (kind === 'dum') {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(190, t);
      o.frequency.exponentialRampToValueAtTime(62, t + 0.14);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.9 * vel, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.35);
      return;
    }
    const n = ctx.createBufferSource();
    n.buffer = c.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = kind === 'tek' ? 3600 : 2400;
    bp.Q.value = 1.4;
    const g = ctx.createGain();
    const peak = (kind === 'tek' ? 0.5 : 0.22) * vel;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === 'tek' ? 0.07 : 0.05));
    n.connect(bp).connect(g).connect(out);
    n.start(t, Math.random() * 0.5, 0.1);
    // A hint of pitched skin on the tek.
    if (kind === 'tek') {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(420, t);
      o.frequency.exponentialRampToValueAtTime(260, t + 0.05);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.18 * vel, t);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      o.connect(og).connect(out);
      o.start(t);
      o.stop(t + 0.08);
    }
  }

  /** Low drone on the root and fifth. Runs until stopped. */
  startDrone(rootHz: number, level: number): void {
    const c = this.get();
    if (!c || this.drone) return;
    const { ctx, out } = c;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.16 * level, ctx.currentTime + 4);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.12;
    const lg = ctx.createGain();
    lg.gain.value = 220;
    lfo.connect(lg).connect(lp.frequency);
    const oscs: OscillatorNode[] = [lfo];
    for (const [mult, det] of [[0.5, -6], [0.5, 6], [0.75, 0], [1, 3]] as const) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = rootHz * mult;
      o.detune.value = det;
      o.connect(lp);
      oscs.push(o);
    }
    lp.connect(g).connect(out);
    for (const o of oscs) o.start();
    this.drone = {
      stop: () => {
        const t = ctx.currentTime;
        g.gain.cancelScheduledValues(t);
        g.gain.setTargetAtTime(0.0001, t, 0.4);
        for (const o of oscs) o.stop(t + 2);
      },
    };
  }

  stopDrone(): void {
    this.drone?.stop();
    this.drone = null;
  }
}
