// Chunked, LOD'd terrain meshes built from the sim's height function.
// Lighting is baked into vertex colours (MeshBasicMaterial): no lights, no shadow maps, no textures.
import * as THREE from 'three';
import simData from '../data/sim.json';
import type { ChapterConfig } from '../data/chapters';
import { buildingCell, cityFactor, sampleChunkHeights, type Terrain } from '../sim/terrain';
import { Mesher, lightingFromPalette, type Lighting } from './mesher';
import { buildLandmarks, kitFor, type Beacon } from './kits';
import { chunkProps } from '../sim/props';
import { valueNoise2 } from '../sim/noise';
import { Prng, hashInts } from '../sim/prng';
import type { QualityPresetData } from './quality';

const CHUNK = simData.chunkSize;

interface ChunkEntry {
  cx: number;
  cz: number;
  lod: number;
  mesh: THREE.Mesh;
  dirty: boolean;
}

const key = (cx: number, cz: number) => `${cx},${cz}`;

class Palette {
  sand: THREE.Color;
  sandShade: THREE.Color;
  rock: THREE.Color;
  grass: THREE.Color;
  bank: THREE.Color;
  sun: THREE.Color;
  ambient: THREE.Color;
  sunDir: THREE.Vector3;
  trunk = new THREE.Color('#6b4a2e');
  paving: THREE.Color;
  frond: THREE.Color;
  constructor(c: ChapterConfig) {
    const p = c.palette;
    this.sand = new THREE.Color(p.sand);
    this.sandShade = new THREE.Color(p.sandShade);
    this.rock = new THREE.Color(p.rock);
    this.grass = new THREE.Color(p.grass);
    this.bank = new THREE.Color(p.bank);
    this.sun = new THREE.Color(p.sunLight);
    this.ambient = new THREE.Color(p.ambient);
    this.sunDir = new THREE.Vector3(...p.sunDir).normalize();
    this.frond = this.grass.clone().multiplyScalar(0.9);
    this.paving = this.sand.clone().lerp(this.rock, 0.5);
  }
}

/** Index buffers shared by every chunk of the same resolution. */
function buildIndex(n: number): THREE.BufferAttribute {
  const stride = n + 1;
  const gridV = stride * stride;
  const idx: number[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * stride + i;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  // Skirts: 4 edges, each stride vertices after the grid. Hides LOD seams.
  const skirt = (edge: number, k: number) => gridV + edge * stride + k;
  const edgeVert = [
    (k: number) => k, // south  (j = 0)
    (k: number) => n * stride + k, // north (j = n)
    (k: number) => k * stride, // west  (i = 0)
    (k: number) => k * stride + n, // east  (i = n)
  ];
  for (let e = 0; e < 4; e++) {
    for (let k = 0; k < n; k++) {
      const a = edgeVert[e]!(k);
      const b = edgeVert[e]!(k + 1);
      const a2 = skirt(e, k);
      const b2 = skirt(e, k + 1);
      idx.push(a, b, a2, b, b2, a2);
    }
  }
  return new THREE.BufferAttribute(new Uint32Array(idx), 1);
}

export class TerrainRenderer {
  readonly group = new THREE.Group();
  private chunks = new Map<string, ChunkEntry>();
  private indexCache = new Map<number, THREE.BufferAttribute>();
  private material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  private pal: Palette;
  private seenDeltaId = 0;
  private seenEpoch = 0;
  private wanted: { cx: number; cz: number; lod: number; dist: number; rebuild: boolean }[] = [];
  private planKey = '';
  private pending = 0;

  constructor(
    private terrain: Terrain,
    private chapter: ChapterConfig,
    private quality: QualityPresetData,
  ) {
    this.pal = new Palette(chapter);
    this.cityLight = lightingFromPalette(chapter.palette.sunDir, chapter.palette.sunLight, chapter.palette.ambient);
    this.seenEpoch = terrain.deltas.compactionEpoch;
    this.seenDeltaId = terrain.deltas.nextId - 1;
  }

  private qualityVersion = 0;
  private sunScratch = new THREE.Color();
  private cityLight: Lighting;

  setQuality(q: QualityPresetData): void {
    this.quality = q;
    this.qualityVersion++;
    for (const c of this.chunks.values()) c.dirty = true;
  }

  get chunkCount(): number {
    return this.chunks.size;
  }

  private lodFor(dist: number): number {
    if (dist <= this.quality.lod0Radius) return 0;
    if (dist <= this.quality.lod1Radius) return 1;
    return 2;
  }

  /** Mark chunks overlapping new/changed deltas for rebuild. */
  private syncDeltas(): boolean {
    const store = this.terrain.deltas;
    if (store.compactionEpoch !== this.seenEpoch) {
      this.seenEpoch = store.compactionEpoch;
      this.seenDeltaId = store.nextId - 1;
      for (const c of this.chunks.values()) c.dirty = true;
      return true;
    }
    if (store.nextId - 1 === this.seenDeltaId) return false;
    const list = store.list;
    for (let i = list.length - 1; i >= 0; i--) {
      const d = list[i]!;
      if (d.id <= this.seenDeltaId) break;
      // Include a one-cell margin: neighbouring chunks share border heights and normals.
      const x0 = Math.floor((d.x - d.r - 2) / CHUNK);
      const x1 = Math.floor((d.x + d.r + 2) / CHUNK);
      const z0 = Math.floor((d.z - d.r - 2) / CHUNK);
      const z1 = Math.floor((d.z + d.r + 2) / CHUNK);
      for (let cz = z0; cz <= z1; cz++) {
        for (let cx = x0; cx <= x1; cx++) {
          const e = this.chunks.get(key(cx, cz));
          if (e) e.dirty = true;
        }
      }
    }
    this.seenDeltaId = store.nextId - 1;
    return true;
  }

  /**
   * Keep the right chunks alive around (x, z). Builds at most `budget` chunks (default from
   * the quality preset) so the frame time stays flat.
   */
  update(x: number, z: number, radiusScale: number, budget?: number): void {
    const deltasChanged = this.syncDeltas();
    const R = Math.max(2, Math.round(this.quality.viewRadiusChunks * radiusScale));
    const pcx = Math.floor(x / CHUNK);
    const pcz = Math.floor(z / CHUNK);
    // Nothing to plan unless the player crossed a chunk border, the view/quality changed,
    // terrain changed, or a previous plan still has chunks queued. Saves a per-frame
    // scan + sort of up to ~225 candidates.
    const key2 = `${pcx},${pcz},${R},${this.qualityVersion}`;
    if (!deltasChanged && this.pending === 0 && key2 === this.planKey) return;
    this.planKey = key2;

    // Drop chunks that fell out of range (with hysteresis).
    for (const [k, c] of this.chunks) {
      const d = Math.hypot(c.cx - pcx, c.cz - pcz);
      if (d > R + 1.5) {
        this.group.remove(c.mesh);
        c.mesh.geometry.dispose();
        this.chunks.delete(k);
        this.beaconsByChunk.delete(k);
      }
    }

    this.wanted.length = 0;
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const dist = Math.hypot(dx, dz);
        if (dist > R) continue;
        const cx = pcx + dx;
        const cz = pcz + dz;
        const lod = this.lodFor(Math.max(Math.abs(dx), Math.abs(dz)));
        const e = this.chunks.get(key(cx, cz));
        if (!e) this.wanted.push({ cx, cz, lod, dist, rebuild: false });
        else if (e.lod !== lod || e.dirty) this.wanted.push({ cx, cz, lod, dist: dist - 0.5, rebuild: true });
      }
    }
    this.pending = this.wanted.length;
    if (this.wanted.length === 0) return;
    this.wanted.sort((a, b) => a.dist - b.dist);
    const n = budget ?? this.quality.chunkBuildsPerFrame;
    for (let i = 0; i < Math.min(n, this.wanted.length); i++) {
      const w = this.wanted[i]!;
      this.build(w.cx, w.cz, w.lod);
    }
    this.pending = Math.max(0, this.wanted.length - n);
  }

  /** Build everything in range now (used before the first frame). */
  prime(x: number, z: number, radiusScale: number): void {
    this.update(x, z, radiusScale, 100000);
  }

  private index(n: number): THREE.BufferAttribute {
    let a = this.indexCache.get(n);
    if (!a) {
      a = buildIndex(n);
      this.indexCache.set(n, a);
    }
    return a;
  }

  private build(cx: number, cz: number, lod: number): void {
    const n = this.quality.lodResolutions[lod]!;
    const cell = CHUNK / n;
    const stride = n + 3;
    const heights = sampleChunkHeights(this.terrain, cx, cz, n, CHUNK);
    const verts = (n + 1) * (n + 1);
    const total = verts + 4 * (n + 1);
    const pos = new Float32Array(total * 3);
    const col = new Float32Array(total * 3);
    const pal = this.pal;
    const water = this.chapter.terrain.waterLevel;
    const L = pal.sunDir;
    const tmp = new THREE.Color();
    const base = new THREE.Color();
    const city = this.chapter.terrain.city !== undefined;
    const strata = this.chapter.terrain.strata;
    const ox = cx * CHUNK;
    const oz = cz * CHUNK;
    let minY = Infinity;
    let maxY = -Infinity;
    const skirtDrop = 2.5 + cell * 1.2;

    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const g = (j + 1) * stride + (i + 1);
        const h = heights[g]!;
        const hl = heights[g - 1]!;
        const hr = heights[g + 1]!;
        const hd = heights[g - stride]!;
        const hu = heights[g + stride]!;
        // Normal from central differences.
        let nx = (hl - hr) / (2 * cell);
        let nz = (hd - hu) / (2 * cell);
        const inv = 1 / Math.sqrt(nx * nx + 1 + nz * nz);
        nx *= inv;
        nz *= inv;
        const ny = inv;
        const lam = Math.max(0, nx * L.x + ny * L.y + nz * L.z);
        const slope = 1 - ny;
        const wx = ox + i * cell;
        const wz = oz + j * cell;

        const lush = smooth(water + 7.5, water + 1.2, h);
        const wet = smooth(water + 1.4, water - 0.5, h);
        base.copy(pal.sand).lerp(pal.bank, lush * 0.7).lerp(pal.grass, lush * lush);
        base.lerp(pal.rock, smooth(0.28, 0.5, slope) * (1 - lush * 0.8));
        if (strata) {
          // Alternating sandstone bands up the cliffs; stronger the steeper the wall.
          const band = Math.sin((h + valueNoise2(wx * 0.05, wz * 0.05, 11) * 3) / strata.band * 2.4);
          base.multiplyScalar(1 + band * strata.contrast * (0.25 + smooth(0.2, 0.55, slope)) * 0.5);
        }
        base.lerp(pal.sandShade, wet * 0.6);
        if (city) {
          // Paved plaza under the district, with a faint cobble checker.
          const cf = cityFactor(this.chapter.terrain, wx, wz);
          if (cf > 0) {
            const checker = (Math.floor(wx / 4) + Math.floor(wz / 4)) & 1;
            base.lerp(pal.paving, smooth(0.05, 0.6, cf)).multiplyScalar(1 - 0.06 * checker * cf);
          }
        }
        // Cheap per-vertex sparkle so large dunes do not look flat.
        const sparkle = 1 + (valueNoise2(wx * 0.35, wz * 0.35, 5) - 0.5) * 0.12;
        const lit = smooth(0.0, 0.8, lam);
        tmp.copy(pal.ambient).multiplyScalar(0.55).add(this.sunScratch.copy(pal.sun).multiplyScalar(0.95 * lit));
        const vi = j * (n + 1) + i;
        col[vi * 3] = Math.min(1, base.r * tmp.r * sparkle * 1.35);
        col[vi * 3 + 1] = Math.min(1, base.g * tmp.g * sparkle * 1.35);
        col[vi * 3 + 2] = Math.min(1, base.b * tmp.b * sparkle * 1.35);
        pos[vi * 3] = i * cell;
        pos[vi * 3 + 1] = h;
        pos[vi * 3 + 2] = j * cell;
        if (h < minY) minY = h;
        if (h > maxY) maxY = h;
      }
    }
    // Skirts duplicate the edge vertices, dropped below the surface.
    const edgeVert = [
      (k: number) => k,
      (k: number) => n * (n + 1) + k,
      (k: number) => k * (n + 1),
      (k: number) => k * (n + 1) + n,
    ];
    for (let e = 0; e < 4; e++) {
      for (let k = 0; k <= n; k++) {
        const src = edgeVert[e]!(k);
        const dst = verts + e * (n + 1) + k;
        pos[dst * 3] = pos[src * 3]!;
        pos[dst * 3 + 1] = pos[src * 3 + 1]! - skirtDrop;
        pos[dst * 3 + 2] = pos[src * 3 + 2]!;
        col[dst * 3] = col[src * 3]!;
        col[dst * 3 + 1] = col[src * 3 + 1]!;
        col[dst * 3 + 2] = col[src * 3 + 2]!;
      }
    }

    let positions: Float32Array = pos;
    let colors: Float32Array = col;
    let index: THREE.BufferAttribute = this.index(n);
    const extra = { pos: [] as number[], col: [] as number[], idx: [] as number[] };
    if (this.quality.props && lod <= 1) {
      const props = this.buildProps(cx, cz);
      this.pushExtra(extra, props.pos, props.col, props.idx);
    }
    const beacons: Beacon[] = [];
    if (lod <= 1 || this.chapter.terrain.landmarks) {
      const lm = buildLandmarks({ chapter: this.chapter, terrain: this.terrain, cx, cz, light: this.cityLight, detail: lod === 0 ? 2 : lod === 1 ? 1 : 0 });
      if (lm.mesher.pos.length > 0) {
        this.pushMesher(extra, lm.mesher);
        if (lm.maxY > maxY) maxY = lm.maxY;
      }
      beacons.push(...lm.beacons);
    }
    const kit = this.chapter.structureKit ? kitFor(this.chapter.structureKit) : null;
    if (kit && lod <= 1) {
      const r = kit({ chapter: this.chapter, terrain: this.terrain, cx, cz, light: this.cityLight, detail: lod === 0 ? this.quality.cityDetail + 1 : 1 });
      if (r.mesher.pos.length > 0) {
        this.pushMesher(extra, r.mesher);
        if (r.maxY > maxY) maxY = r.maxY;
      }
      beacons.push(...r.beacons);
    }
    this.beaconsByChunk.set(key(cx, cz), beacons);
    if (city) {
      const b = this.buildCity(cx, cz, lod);
      if (b.maxTop > maxY) maxY = b.maxTop;
      this.pushExtra(extra, b.pos, b.col, b.idx);
    }
    if (extra.pos.length > 0) {
      const vBase = total;
      positions = new Float32Array(pos.length + extra.pos.length);
      positions.set(pos);
      positions.set(extra.pos, pos.length);
      colors = new Float32Array(col.length + extra.col.length);
      colors.set(col);
      colors.set(extra.col, col.length);
      const baseIdx = index.array as Uint32Array;
      const merged = new Uint32Array(baseIdx.length + extra.idx.length);
      merged.set(baseIdx);
      for (let i = 0; i < extra.idx.length; i++) merged[baseIdx.length + i] = extra.idx[i]! + vBase;
      index = new THREE.BufferAttribute(merged, 1);
      maxY += 14;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geom.setIndex(index);
    const c = new THREE.Vector3(CHUNK / 2, (minY + maxY) / 2, CHUNK / 2);
    geom.boundingSphere = new THREE.Sphere(c, Math.hypot(CHUNK / 2, CHUNK / 2, (maxY - minY) / 2 + skirtDrop) + 1);
    geom.boundingBox = null;

    const k = key(cx, cz);
    let entry = this.chunks.get(k);
    if (entry) {
      entry.mesh.geometry.dispose();
      entry.mesh.geometry = geom;
    } else {
      const mesh = new THREE.Mesh(geom, this.material);
      mesh.matrixAutoUpdate = false;
      mesh.position.set(ox, 0, oz);
      mesh.updateMatrix();
      this.group.add(mesh);
      entry = { cx, cz, lod, mesh, dirty: false };
      this.chunks.set(k, entry);
    }
    entry.lod = lod;
    entry.dirty = false;
  }

  private pushMesher(dst: { pos: number[]; col: number[]; idx: number[] }, m: Mesher): void {
    const base = dst.pos.length / 3;
    for (let i = 0; i < m.pos.length; i++) dst.pos.push(m.pos[i]!);
    for (let i = 0; i < m.col.length; i++) dst.col.push(m.col[i]!);
    for (let i = 0; i < m.pos.length / 3; i++) dst.idx.push(base + i);
  }

  /** Lit beacons (lighthouses, lanterns) of the currently loaded chunks; the entity renderer draws their glow. */
  private beaconsByChunk = new Map<string, Beacon[]>();
  beacons(): Beacon[] {
    const out: Beacon[] = [];
    for (const list of this.beaconsByChunk.values()) for (const b of list) out.push(b);
    return out;
  }

  private pushExtra(dst: { pos: number[]; col: number[]; idx: number[] }, pos: ArrayLike<number>, col: ArrayLike<number>, idx: ArrayLike<number>): void {
    const base = dst.pos.length / 3;
    for (let i = 0; i < pos.length; i++) dst.pos.push(pos[i]!);
    for (let i = 0; i < col.length; i++) dst.col.push(col[i]!);
    for (let i = 0; i < idx.length; i++) dst.idx.push(idx[i]! + base);
  }

  /** Terracotta buildings, canopies and lanterns for the chunk's city cells (chapter 2 style). */
  private buildCity(cx: number, cz: number, lod: number): { pos: number[]; col: number[]; idx: number[]; maxTop: number } {
    const p = this.chapter.terrain;
    const city = p.city!;
    const st = this.chapter.structureStyle;
    const m = new Mesher(this.cityLight);
    const detail = lod >= 2 ? 0 : this.quality.cityDetail;
    const per = CHUNK / city.cell;
    const ox = cx * CHUNK;
    const oz = cz * CHUNK;
    const wall = new THREE.Color(st.wall);
    const roof = new THREE.Color(st.roof);
    const tmp = new THREE.Color();
    let maxTop = 0;
    for (let j = 0; j < per; j++) {
      for (let i = 0; i < per; i++) {
        const b = buildingCell(p, cx * per + i, cz * per + j);
        if (!b) continue;
        const lx = b.cx - ox;
        const lz = b.cz - oz;
        const h = b.top - city.plateau;
        const base = city.plateau;
        if (b.top > maxTop) maxTop = b.top;
        tmp.copy(wall).lerp(roof, 0.15 + b.tint * 0.5);
        const body = `#${tmp.getHexString()}`;
        m.box(lx, base + h / 2, lz, b.half * 2, h, b.half * 2, body, 0, st.roof);
        if (detail >= 1) {
          const t = 0.45;
          for (const [dx, dz, sx, sz] of [[0, -b.half, b.half * 2, t], [0, b.half, b.half * 2, t], [-b.half, 0, t, b.half * 2], [b.half, 0, t, b.half * 2]] as const) {
            m.box(lx + dx, base + h + 0.45, lz + dz, sx, 0.9, sz, st.wall);
          }
          m.box(lx, base + h * 0.55, lz + b.half + 0.03, b.half * 0.5, b.half * 0.8, 0.1, st.shade); // door/window slab
        }
        if (b.dome) {
          m.dome(lx, base + h + (detail >= 1 ? 0.9 : 0), lz, b.half * 0.78, st.dome, detail >= 1 ? 8 : 6, detail >= 1 ? 3 : 2, 1.1);
          if (detail >= 1) m.cylinder(lx, base + h + b.half * 0.9, lz, 0.12, 0.04, 1.8, 4, st.trim);
        }
        if (b.canopy && detail >= 1) {
          const y = base + Math.min(4.6, h * 0.5);
          const len = 3.4;
          for (let k = 0; k < 4; k++) {
            m.box(lx + b.half + len / 2, y - k * 0.04, lz - b.half * 0.8 + (k + 0.5) * ((b.half * 1.6) / 4), len, 0.18, (b.half * 1.6) / 4, k % 2 ? '#f4ead0' : '#c94a3a');
          }
          m.box(lx + b.half + len, y - 1.6, lz - b.half * 0.8, 0.14, 3.2, 0.14, st.shade);
          m.box(lx + b.half + len, y - 1.6, lz + b.half * 0.8, 0.14, 3.2, 0.14, st.shade);
        }
        if (detail >= 2) {
          m.box(lx - b.half - 0.2, base + 3.4, lz + b.half * 0.7, 0.12, 2.4, 0.12, st.shade);
          m.box(lx - b.half - 0.2, base + 2.1, lz + b.half * 0.7, 0.55, 0.7, 0.55, '#ffd27a'); // lantern
        }
      }
    }
    const idx: number[] = [];
    for (let i = 0; i < m.pos.length / 3; i++) idx.push(i);
    return { pos: m.pos, col: m.col, idx, maxTop };
  }

  /** Palms near water, rock spires in the open desert, merged into the chunk's geometry. */
  private buildProps(cx: number, cz: number): { pos: Float32Array; col: Float32Array; idx: number[] } {
    const pp = this.chapter.props;
    const density = this.quality.propDensity;
    const list = chunkProps(this.chapter.terrain, pp, cx, cz, CHUNK);
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const rng = new Prng(hashInts(cx, cz, 99));
    const ox = cx * CHUNK;
    const oz = cz * CHUNK;
    const pal = this.pal;
    const water = this.chapter.terrain.waterLevel;

    const vert = (x: number, y: number, z: number, c: THREE.Color, mul: number) => {
      pos.push(x, y, z);
      col.push(Math.min(1, c.r * mul), Math.min(1, c.g * mul), Math.min(1, c.b * mul));
      return pos.length / 3 - 1;
    };
    const tri = (a: number, b: number, c: number) => idx.push(a, b, c);

    const pads = this.terrain.pads;
    for (const p of list) {
      if (rng.next() > density) continue;
      // Keep castle grounds clear of palms and rocks.
      let onPad = false;
      for (const pad of pads) {
        const dx = p.x - pad.x;
        const dz = p.z - pad.z;
        if (dx * dx + dz * dz < (pad.r + 3) * (pad.r + 3)) onPad = true;
      }
      if (onPad) continue;
      const gy = this.terrain.heightAt(p.x, p.z);
      if (gy < water + 0.3) continue;
      const lx = p.x - ox;
      const lz = p.z - oz;
      const s = p.scale;
      if (p.kind === 'palm') {
        const h = 5.2 * s;
        const r0 = 0.45 * s;
        const r1 = 0.25 * s;
        const lean = 0.8 * s;
        const dxl = Math.cos(p.rot) * lean;
        const dzl = Math.sin(p.rot) * lean;
        const trunk: number[] = [];
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * Math.PI * 2 + 0.7;
          trunk.push(vert(lx + Math.cos(a) * r0, gy - 0.4, lz + Math.sin(a) * r0, pal.trunk, 0.9));
        }
        const top: number[] = [];
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * Math.PI * 2 + 0.7;
          top.push(vert(lx + dxl + Math.cos(a) * r1, gy + h, lz + dzl + Math.sin(a) * r1, pal.trunk, 1.1));
        }
        for (let k = 0; k < 4; k++) {
          const k2 = (k + 1) % 4;
          tri(trunk[k]!, top[k]!, trunk[k2]!);
          tri(trunk[k2]!, top[k]!, top[k2]!);
        }
        const cxp = lx + dxl;
        const czp = lz + dzl;
        const cyp = gy + h;
        const leafN = 6;
        for (let f = 0; f < leafN; f++) {
          const a = (f / leafN) * Math.PI * 2 + p.rot;
          const len = 3.4 * s;
          const ex = cxp + Math.cos(a) * len;
          const ez = czp + Math.sin(a) * len;
          const ey = cyp - 1.5 * s;
          const wx = -Math.sin(a) * 0.9 * s;
          const wz = Math.cos(a) * 0.9 * s;
          const v0 = vert(cxp, cyp + 0.35 * s, czp, pal.frond, 1.15);
          const v1 = vert(ex + wx, ey, ez + wz, pal.frond, 0.8);
          const v2 = vert(ex - wx, ey, ez - wz, pal.frond, 0.8);
          tri(v0, v1, v2);
        }
      } else if (p.kind === 'rock') {
        const h = 3.2 * s;
        const r = 1.6 * s;
        const apex = vert(lx, gy + h, lz, pal.rock, 1.15);
        const ring: number[] = [];
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2 + p.rot;
          ring.push(vert(lx + Math.cos(a) * r, gy - 0.5, lz + Math.sin(a) * r, pal.rock, k % 2 ? 0.7 : 0.9));
        }
        for (let k = 0; k < 5; k++) tri(ring[k]!, apex, ring[(k + 1) % 5]!);
      }
    }
    return { pos: new Float32Array(pos), col: new Float32Array(col), idx };
  }

  dispose(): void {
    for (const c of this.chunks.values()) c.mesh.geometry.dispose();
    this.chunks.clear();
    this.material.dispose();
  }
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
