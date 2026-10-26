// CPU particle pool drawn through the shared GlowLayer. Hard-capped per quality preset.
import type { GlowLayer } from './glowLayer';

export class Particles {
  private x: Float32Array;
  private y: Float32Array;
  private z: Float32Array;
  private vx: Float32Array;
  private vy: Float32Array;
  private vz: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size: Float32Array;
  private r: Float32Array;
  private g: Float32Array;
  private b: Float32Array;
  private grav: Float32Array;
  private n = 0;

  constructor(readonly cap: number) {
    const f = () => new Float32Array(cap);
    this.x = f(); this.y = f(); this.z = f(); this.vx = f(); this.vy = f(); this.vz = f();
    this.life = f(); this.maxLife = f(); this.size = f(); this.r = f(); this.g = f(); this.b = f(); this.grav = f();
  }

  get count(): number {
    return this.n;
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, r: number, g: number, b: number, grav = 0): void {
    if (this.n >= this.cap) return; // hard cap: drop new particles rather than grow
    const i = this.n++;
    this.x[i] = x; this.y[i] = y; this.z[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.life[i] = life; this.maxLife[i] = life; this.size[i] = size;
    this.r[i] = r; this.g[i] = g; this.b[i] = b; this.grav[i] = grav;
  }

  /** Random burst helper. `rnd` is a render-side random function (visuals only). */
  burst(rnd: () => number, count: number, x: number, y: number, z: number, speed: number, life: number, size: number, r: number, g: number, b: number, grav = 0, upBias = 0): void {
    for (let i = 0; i < count; i++) {
      const u = rnd() * 2 - 1;
      const a = rnd() * 6.2831853;
      const s = Math.sqrt(1 - u * u);
      const sp = speed * (0.4 + rnd() * 0.6);
      this.spawn(x, y, z, Math.cos(a) * s * sp, (u + upBias) * sp, Math.sin(a) * s * sp, life * (0.6 + rnd() * 0.4), size * (0.7 + rnd() * 0.6), r, g, b, grav);
    }
  }

  update(dt: number, out: GlowLayer): void {
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      const life = this.life[i]! - dt;
      if (life <= 0) continue;
      const drag = 1 - Math.min(1, 2.2 * dt);
      const vx = this.vx[i]! * drag;
      const vy = (this.vy[i]! - this.grav[i]! * dt) * drag;
      const vz = this.vz[i]! * drag;
      const x = this.x[i]! + vx * dt;
      const y = this.y[i]! + vy * dt;
      const z = this.z[i]! + vz * dt;
      const t = life / this.maxLife[i]!;
      out.add(x, y, z, this.r[i]!, this.g[i]!, this.b[i]!, t, this.size[i]! * (0.4 + 0.6 * t));
      if (w !== i) {
        this.x[w] = x; this.y[w] = y; this.z[w] = z; this.vx[w] = vx; this.vy[w] = vy; this.vz[w] = vz;
        this.life[w] = life; this.maxLife[w] = this.maxLife[i]!; this.size[w] = this.size[i]!;
        this.r[w] = this.r[i]!; this.g[w] = this.g[i]!; this.b[w] = this.b[i]!; this.grav[w] = this.grav[i]!;
      } else {
        this.x[i] = x; this.y[i] = y; this.z[i] = z; this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz; this.life[i] = life;
      }
      w++;
    }
    this.n = w;
  }
}
