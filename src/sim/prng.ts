// Seeded PRNG (mulberry32) and integer hashing. The only source of randomness in the sim.

export function hashInts(...vals: number[]): number {
  let h = 0x811c9dc5;
  for (const v of vals) {
    h = Math.imul(h ^ (v | 0), 0x01000193);
    h ^= h >>> 15;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
  }
  return h >>> 0;
}

export class Prng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  int(lo: number, hiExclusive: number): number {
    return lo + Math.floor(this.next() * (hiExclusive - lo));
  }

  getState(): number {
    return this.s;
  }

  setState(s: number): void {
    this.s = s >>> 0;
  }
}
