// Procedural terrain: a pure function of (params, deltas). No state, no Math.random.
import { dcos, dsin, lerp, smoothstep } from './dmath';
import { fbm2 } from './noise';
import { hashInts } from './prng';
import { DeltaStore, deltaHeight, type TerrainDelta } from './deltas';

/** Optional walled-city districts: flattened plateaus covered by a grid of buildings. */
export interface CityParams {
  scale: number;
  threshold: number;
  softness: number;
  /** Absolute height of the city plateau. */
  plateau: number;
  /** Building grid cell size (world units). Must divide the chunk size. */
  cell: number;
  /** Fraction of cells that contain a building. */
  density: number;
  minHeight: number;
  maxHeight: number;
  canopyChance: number;
  domeChance: number;
}

export interface TerrainParams {
  city?: CityParams;
  seed: number;
  baseHeight: number;
  /** Wide, slow undulation. */
  swellAmplitude: number;
  swellScale: number;
  /** Ridged dune crests. */
  duneAmplitude: number;
  duneScale: number;
  duneWarp: number;
  duneSharpness: number;
  /** Fine surface detail. */
  detailAmplitude: number;
  detailScale: number;
  waterLevel: number;
  /** Oasis basins (lakes ringed by green). */
  oasisScale: number;
  oasisThreshold: number;
  oasisSoftness: number;
  oasisDepth: number;
  oasisRim: number;
}

/** Oasis factor in [0, 1]: 0 = open desert, 1 = lake basin. */
export function oasisFactor(p: TerrainParams, x: number, z: number): number {
  const m = fbm2(x * p.oasisScale, z * p.oasisScale, p.seed + 7, 2);
  return smoothstep(p.oasisThreshold, p.oasisThreshold + p.oasisSoftness, m);
}

/** City factor in [0, 1]: 1 deep inside a district. 0 when the chapter has no city. */
export function cityFactor(p: TerrainParams, x: number, z: number): number {
  const c = p.city;
  if (!c) return 0;
  const m = fbm2(x * c.scale, z * c.scale, p.seed + 31, 2);
  return smoothstep(c.threshold, c.threshold + c.softness, m);
}

function cellHash(ix: number, iz: number, seed: number, salt: number): number {
  return hashInts(ix, iz, seed, salt) / 4294967296;
}

export interface BuildingCell {
  /** Cell origin in world space. */
  x0: number;
  z0: number;
  /** Footprint centre and half-size. */
  cx: number;
  cz: number;
  half: number;
  /** Absolute top height. */
  top: number;
  dome: boolean;
  canopy: boolean;
  tint: number;
}

/** Deterministic building occupying grid cell (ix, iz), or null. */
export function buildingCell(p: TerrainParams, ix: number, iz: number): BuildingCell | null {
  const c = p.city;
  if (!c) return null;
  const x0 = ix * c.cell;
  const z0 = iz * c.cell;
  const cx = x0 + c.cell / 2;
  const cz = z0 + c.cell / 2;
  if (cityFactor(p, cx, cz) < 0.9) return null;
  if (cellHash(ix, iz, p.seed, 1) > c.density) return null;
  const half = c.cell * (0.26 + 0.14 * cellHash(ix, iz, p.seed, 2));
  const h = c.minHeight + (c.maxHeight - c.minHeight) * cellHash(ix, iz, p.seed, 3);
  return {
    x0, z0, cx, cz, half,
    top: c.plateau + h,
    dome: cellHash(ix, iz, p.seed, 4) < c.domeChance,
    canopy: cellHash(ix, iz, p.seed, 5) < c.canopyChance,
    tint: cellHash(ix, iz, p.seed, 6),
  };
}

/** Top of the building under (x, z), or 0 when open ground. */
export function buildingTopAt(p: TerrainParams, x: number, z: number): number {
  const c = p.city;
  if (!c) return 0;
  const ix = Math.floor(x / c.cell);
  const iz = Math.floor(z / c.cell);
  const b = buildingCell(p, ix, iz);
  if (!b) return 0;
  return Math.abs(x - b.cx) < b.half && Math.abs(z - b.cz) < b.half ? b.top : 0;
}

/** Terrain height without deformation. */
export function baseHeight(p: TerrainParams, x: number, z: number): number {
  const h = baseHeightOpen(p, x, z);
  if (!p.city) return h;
  const f = cityFactor(p, x, z);
  return f <= 0 ? h : lerp(h, p.city.plateau, smoothstep(0, 0.6, f));
}

function baseHeightOpen(p: TerrainParams, x: number, z: number): number {
  const s = p.seed;
  const wx = (fbm2(x * p.duneScale * 0.5, z * p.duneScale * 0.5, s + 3, 2) - 0.5) * 2 * p.duneWarp;
  const wz = (fbm2(x * p.duneScale * 0.5 + 40, z * p.duneScale * 0.5 - 40, s + 5, 2) - 0.5) * 2 * p.duneWarp;
  const n = fbm2((x + wx) * p.duneScale, (z + wz) * p.duneScale, s + 11, 3);
  const ridge = 1 - Math.abs(2 * n - 1); // crest at n = 0.5
  let crest = ridge;
  for (let i = 1; i < p.duneSharpness; i++) crest *= ridge;
  const swell = (fbm2(x * p.swellScale, z * p.swellScale, s + 17, 3) - 0.5) * 2;
  const detail = (fbm2(x * p.detailScale, z * p.detailScale, s + 23, 2) - 0.5) * 2;

  const desert = p.baseHeight + swell * p.swellAmplitude + crest * p.duneAmplitude + detail * p.detailAmplitude;

  const o = oasisFactor(p, x, z);
  if (o <= 0) return desert;
  const basin = p.waterLevel - p.oasisDepth * o + detail * p.detailAmplitude * 0.4;
  const bank = p.waterLevel + p.oasisRim * (1 - o);
  const oasis = o > 0.55 ? basin : lerp(bank, basin, smoothstep(0, 0.55, o));
  return lerp(desert, oasis, smoothstep(0, 0.6, o));
}

/** Flat building pad (e.g. under a castle): terrain eases to `h` inside the radius. */
export interface Pad {
  x: number;
  z: number;
  r: number;
  h: number;
}

/** Solid cylinder (castle) that flyers hover over and projectiles hit. */
export interface Obstacle {
  id: number;
  x: number;
  z: number;
  r: number;
  /** Absolute top height. */
  top: number;
}

export function applyPad(pad: Pad, x: number, z: number, h: number): number {
  const dx = x - pad.x;
  const dz = z - pad.z;
  const d2 = dx * dx + dz * dz;
  if (d2 >= pad.r * pad.r) return h;
  const w = smoothstep(pad.r, pad.r * 0.55, Math.sqrt(d2));
  return lerp(h, pad.h, w);
}

export class Terrain {
  readonly deltas: DeltaStore;
  pads: Pad[] = [];
  obstacles: Obstacle[] = [];

  constructor(
    readonly params: TerrainParams,
    deltas: DeltaStore,
  ) {
    this.deltas = deltas;
  }

  heightAt(x: number, z: number): number {
    let h = baseHeight(this.params, x, z);
    for (let i = 0; i < this.pads.length; i++) h = applyPad(this.pads[i]!, x, z, h);
    const list = this.deltas.list;
    for (let i = 0; i < list.length; i++) h += deltaHeight(list[i]!, x, z);
    return h;
  }

  /** Surface height including water: flyers hover above the lake, not under it. */
  surfaceAt(x: number, z: number): number {
    let s = Math.max(this.heightAt(x, z), this.params.waterLevel);
    const b = buildingTopAt(this.params, x, z);
    if (b > s) s = b;
    for (let i = 0; i < this.obstacles.length; i++) {
      const o = this.obstacles[i]!;
      const dx = x - o.x;
      const dz = z - o.z;
      if (dx * dx + dz * dz < o.r * o.r && o.top > s) s = o.top;
    }
    return s;
  }

  /** Deltas whose footprint overlaps the given rectangle. */
  deltasInRect(x0: number, z0: number, x1: number, z1: number): TerrainDelta[] {
    const out: TerrainDelta[] = [];
    for (const d of this.deltas.list) {
      if (d.x + d.r > x0 && d.x - d.r < x1 && d.z + d.r > z0 && d.z - d.r < z1) out.push(d);
    }
    return out;
  }
}

/**
 * Sample a chunk's heights on an (n+3) x (n+3) grid: the chunk's (n+1)^2 vertices plus a
 * one-cell border used for smooth normals. Index = j * (n + 3) + i, with
 * world x = cx * size + (i - 1) * cell and world z = cz * size + (j - 1) * cell.
 */
export function sampleChunkHeights(
  terrain: Terrain,
  cx: number,
  cz: number,
  n: number,
  size: number,
  out?: Float32Array,
): Float32Array {
  const stride = n + 3;
  const grid = out ?? new Float32Array(stride * stride);
  const cell = size / n;
  const ox = cx * size;
  const oz = cz * size;
  const local = terrain.deltasInRect(ox - cell, oz - cell, ox + size + cell, oz + size + cell);
  const p = terrain.params;
  const pads = terrain.pads.filter((q) => q.x + q.r > ox - cell && q.x - q.r < ox + size + cell && q.z + q.r > oz - cell && q.z - q.r < oz + size + cell);
  for (let j = 0; j < stride; j++) {
    const z = oz + (j - 1) * cell;
    for (let i = 0; i < stride; i++) {
      const x = ox + (i - 1) * cell;
      let h = baseHeight(p, x, z);
      for (let k = 0; k < pads.length; k++) h = applyPad(pads[k]!, x, z, h);
      for (let k = 0; k < local.length; k++) h += deltaHeight(local[k]!, x, z);
      grid[j * stride + i] = h;
    }
  }
  return grid;
}

/** FNV-1a over the raw float bits; used by determinism tests and (later) net checksums. */
export function checksumFloats(values: Float32Array): number {
  const view = new Uint32Array(values.buffer, values.byteOffset, values.length);
  let h = 0x811c9dc5;
  for (let i = 0; i < view.length; i++) {
    h ^= view[i]!;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}


/**
 * Deterministic spawn point: the first dry spot near an oasis on an outward spiral from the
 * origin (falls back to any dry land). Same answer on every device and in the Durable Object.
 */
export function findSpawn(p: TerrainParams): { x: number; z: number } {
  let fallback: { x: number; z: number } | null = null;
  const golden = 2.399963229728653; // golden angle (rad)
  for (let i = 0; i < 400; i++) {
    const r = 28 * Math.sqrt(i);
    const a = i * golden;
    // Spiral using table-free deterministic trig (ESLint bans Math.sin/cos in the sim).
    const x = r * dcos(a);
    const z = r * dsin(a);
    const h = baseHeight(p, x, z);
    if (h < p.waterLevel + 2.5) continue;
    fallback ??= { x, z };
    const o = oasisFactor(p, x, z);
    if (o > 0.05 && o < 0.5 && h < p.waterLevel + p.oasisRim + 4) return { x, z };
  }
  return fallback ?? { x: 0, z: 0 };
}
