// Web Audio context, buses and volume control. The context is created on the first user tap.

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  music!: GainNode;
  sfx!: GainNode;
  private musicVol = 0.7;
  private sfxVol = 0.8;
  private muted = false;
  /** Shared white-noise buffer for percussion and whooshes. */
  noise: AudioBuffer | null = null;

  /** Call from a user gesture (tap). Safe to call repeatedly. */
  unlock(): boolean {
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return false;
        this.ctx = new Ctor({ latencyHint: 'interactive' });
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.ratio.value = 4;
        this.master = this.ctx.createGain();
        this.music = this.ctx.createGain();
        this.sfx = this.ctx.createGain();
        this.music.connect(this.master);
        this.sfx.connect(this.master);
        this.master.connect(comp);
        comp.connect(this.ctx.destination);
        const len = this.ctx.sampleRate * 1;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        let seed = 22222;
        for (let i = 0; i < len; i++) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          d[i] = seed / 2147483648 - 1;
        }
        this.applyVolumes();
      }
      void this.ctx.resume();
      return true;
    } catch {
      return false;
    }
  }

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  setVolumes(music: number, sfx: number, muted: boolean): void {
    this.musicVol = music;
    this.sfxVol = sfx;
    this.muted = muted;
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // Squared curve: perceptually smoother slider.
    this.music.gain.setTargetAtTime(this.muted ? 0 : this.musicVol * this.musicVol * 0.9, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.muted ? 0 : this.sfxVol * this.sfxVol, t, 0.05);
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    if (this.ctx) void this.ctx.resume();
  }
}
