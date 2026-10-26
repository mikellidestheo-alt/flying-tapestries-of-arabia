// Music director: a look-ahead scheduler that plays the planner's events with the synthesised
// instruments. Also supports a recorded OGG per chapter as a drop-in replacement.
import music from '../data/music.json';
import type { AudioEngine } from './engine';
import { Instruments } from './instruments';
import { MusicPlanner, degreeHz, stepSeconds, type MusicSpec } from './musicPlanner';

export class MusicDirector {
  private inst: Instruments;
  private planner: MusicPlanner | null = null;
  private spec: MusicSpec | null = null;
  private timer: number | null = null;
  private nextBarTime = 0;
  private bar = 0;
  private fileSource: AudioBufferSourceNode | null = null;
  private token = 0;

  constructor(private engine: AudioEngine) {
    this.inst = new Instruments(engine);
  }

  /** Start (or restart) music for a chapter. `file` is an optional recorded OGG url. */
  async play(spec: MusicSpec, file?: string | null): Promise<void> {
    this.stop();
    const token = ++this.token;
    const ctx = this.engine.ctx;
    if (!ctx) return;
    if (file && (await this.playFile(file, token))) return;
    if (token !== this.token) return;
    this.spec = spec;
    this.planner = new MusicPlanner(spec);
    this.bar = 0;
    this.nextBarTime = ctx.currentTime + 0.2;
    this.inst.startDrone(degreeHz(spec, -7), music.layers.calm.drone);
    this.timer = window.setInterval(() => this.tick(), music.tickMs);
  }

  private async playFile(url: string, token: number): Promise<boolean> {
    const ctx = this.engine.ctx!;
    try {
      const res = await fetch(url);
      const type = res.headers.get('content-type') ?? '';
      // The site falls back to index.html for unknown paths: only accept real audio.
      if (!res.ok || !/audio|ogg|octet/.test(type)) return false;
      const buf = await ctx.decodeAudioData(await res.arrayBuffer());
      if (token !== this.token) return true;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(this.engine.music);
      src.start();
      this.fileSource = src;
      return true;
    } catch {
      return false;
    }
  }

  private tick(): void {
    const ctx = this.engine.ctx;
    if (!ctx || !this.planner || !this.spec) return;
    const step = stepSeconds(this.spec.tempoBpm);
    while (this.nextBarTime < ctx.currentTime + music.scheduleAheadSeconds) {
      const t0 = this.nextBarTime;
      for (const e of this.planner.planBar(this.bar)) {
        const t = t0 + e.step * step;
        if (e.inst === 'oud') this.inst.oud(t, e.freq!, (e.dur ?? 1) * step, e.vel * music.layers.calm.oud);
        else if (e.inst === 'ney') this.inst.ney(t, e.freq!, (e.dur ?? 2) * step, e.vel * music.layers.calm.ney);
        else this.inst.drum(t, e.inst, e.vel * music.layers.calm.drums);
      }
      this.bar++;
      this.nextBarTime += step * 8;
    }
  }

  stop(): void {
    this.token++;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.inst.stopDrone();
    try {
      this.fileSource?.stop();
    } catch {
      /* already stopped */
    }
    this.fileSource = null;
    this.planner = null;
  }
}
