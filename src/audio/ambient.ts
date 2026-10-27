// Ambient bed per chapter: filtered looping noise layers with slow LFOs (wind, waves, murmur).
// Recipes live in src/data/ambient.json; chapters pick one by id (`ambient.sound`).
import recipes from '../data/ambient.json';
import type { AudioEngine } from './engine';

export interface AmbientLayer {
  filter: BiquadFilterType;
  freq: number;
  q: number;
  gain: number;
  /** LFO rate in Hz, and how much it swings the layer's gain and filter frequency. */
  lfoHz: number;
  lfoGain: number;
  lfoFreq: number;
}

export interface AmbientRecipe {
  layers: AmbientLayer[];
  echo?: { delay: number; feedback: number; mix: number };
}

export const AMBIENT = recipes as unknown as Record<string, AmbientRecipe>;

export class AmbientBed {
  private nodes: (AudioNode & { stop?: () => void })[] = [];
  private out: GainNode | null = null;

  constructor(private engine: AudioEngine) {}

  start(id: string): void {
    this.stop();
    const ctx = this.engine.ctx;
    const noise = this.engine.noise;
    const recipe = AMBIENT[id];
    if (!ctx || !noise || !recipe) return;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.gain.setTargetAtTime(1, ctx.currentTime, 1.5); // fade in
    out.connect(this.engine.music);
    this.out = out;
    const bus = ctx.createGain();
    bus.connect(out);
    this.nodes.push(out, bus);
    if (recipe.echo) {
      const delay = ctx.createDelay(1);
      delay.delayTime.value = recipe.echo.delay;
      const fb = ctx.createGain();
      fb.gain.value = recipe.echo.feedback;
      const wet = ctx.createGain();
      wet.gain.value = recipe.echo.mix;
      bus.connect(delay);
      delay.connect(fb);
      fb.connect(delay);
      delay.connect(wet);
      wet.connect(out);
      this.nodes.push(delay, fb, wet);
    }
    recipe.layers.forEach((l, i) => {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      src.loopStart = (i * 0.137) % 0.9; // decorrelate layers sharing the buffer
      const f = ctx.createBiquadFilter();
      f.type = l.filter;
      f.frequency.value = l.freq;
      f.Q.value = l.q;
      const g = ctx.createGain();
      g.gain.value = l.gain;
      src.connect(f);
      f.connect(g);
      g.connect(bus);
      if (l.lfoHz > 0) {
        const lfo = ctx.createOscillator();
        lfo.frequency.value = l.lfoHz;
        const dg = ctx.createGain();
        dg.gain.value = l.lfoGain;
        lfo.connect(dg);
        dg.connect(g.gain);
        if (l.lfoFreq > 0) {
          const df = ctx.createGain();
          df.gain.value = l.lfoFreq;
          lfo.connect(df);
          df.connect(f.frequency);
          this.nodes.push(df);
        }
        lfo.start();
        this.nodes.push(lfo, dg);
      }
      src.start(0, (i * 0.31) % 0.8);
      this.nodes.push(src, f, g);
    });
  }

  stop(): void {
    const ctx = this.engine.ctx;
    if (!ctx || this.nodes.length === 0) return;
    const nodes = this.nodes;
    const out = this.out;
    this.nodes = [];
    this.out = null;
    if (out) out.gain.setTargetAtTime(0, ctx.currentTime, 0.4); // fade out, then tear down
    window.setTimeout(() => {
      for (const n of nodes) {
        try {
          (n as unknown as { stop?: () => void }).stop?.();
        } catch {
          /* already stopped */
        }
        n.disconnect();
      }
    }, 2200);
  }
}
