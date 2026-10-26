// Procedural terrain: a pure function of (params, deltas). No state, no Math.random.
import { lerp, smoothstep } from './dmath';
import { fbm2 } from './noise';
import { DeltaStore, deltaHeight, type TerrainDelta } from './deltas';

export interface TerrainParams {
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

/** Terrain height without deformation. */
export function baseHeight(p: TerrainParams, x: number, z: number): number {
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
  return lerp(desert, oasis, smoothstep(0, 0.35, o));
}

export class Terrain {
  readonly deltas: DeltaStore;

  constructor(
    readonly params: TerrainParams,
    deltas: DeltaStore,
  ) {
    this.deltas = deltas;
  }

  heightAt(x: number, z: number): number {
    let h = baseHeight(this.params, x, z);
    const list = this.deltas.list;
    for (let i = 0; i < list.length; i++) h += deltaHeight(list[i]!, x, z);
    return h;
  }

  /** Surface height including water: flyers hover above the lake, not under it. */
  surfaceAt(x: number, z: number): number {
    return Math.max(this.heightAt(x, z), this.params.waterLevel);
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
  for (let j = 0; j < stride; j++) {
    const z = oz + (j - 1) * cell;
    for (let i = 0; i < stride; i++) {
      const x = ox + (i - 1) * cell;
      let h = baseHeight(p, x, z);
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

