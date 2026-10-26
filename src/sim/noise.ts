// Seeded 2D value noise. Integer hashing + polynomial interpolation only (no sin/pow),
// so results are bit-identical on every device and in the Durable Object.

function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Value noise in [0, 1). */
export function valueNoise2(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = fade(x - x0);
  const fz = fade(z - z0);
  const a = hash2(x0, z0, seed);
  const b = hash2(x0 + 1, z0, seed);
  const c = hash2(x0, z0 + 1, seed);
  const d = hash2(x0 + 1, z0 + 1, seed);
  const top = a + (b - a) * fx;
  const bot = c + (d - c) * fx;
  return top + (bot - top) * fz;
}

/** Fractal noise normalised to [0, 1). Lacunarity 2, gain 0.5. */
export function fbm2(x: number, z: number, seed: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let fx = x;
  let fz = z;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2(fx, fz, seed + i * 101);
    norm += amp;
    amp *= 0.5;
    // Offset each octave so lattice points do not line up.
    fx = fx * 2 + 17.31;
    fz = fz * 2 + 9.47;
  }
  return sum / norm;
}
