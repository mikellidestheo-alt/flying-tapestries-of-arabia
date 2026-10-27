// Structure kits: chapter-specific scenery built into terrain chunks (baked lighting, one mesh).
// Placement is deterministic (seeded per chunk). Anything tall that fliers can hit comes from the
// sim's landmark grid (src/sim/terrain.ts); the rest (tomb facades, docks, ships) is decoration.
import * as THREE from 'three';
import simData from '../data/sim.json';
import type { ChapterConfig } from '../data/chapters';
import { Prng, hashInts } from '../sim/prng';
import { landmarkInCell, type Terrain } from '../sim/terrain';
import { Mesher, type Lighting } from './mesher';

const CHUNK = simData.chunkSize;

export interface Beacon {
  x: number;
  y: number;
  z: number;
  color: [number, number, number];
  size: number;
  /** 'lighthouse' sweeps a beam; others just glow. */
  kind: 'lighthouse' | 'lantern';
}

export interface KitContext {
  chapter: ChapterConfig;
  terrain: Terrain;
  cx: number;
  cz: number;
  light: Lighting;
  /** 0 = far chunk (silhouettes only), 1 = normal, 2 = full detail. */
  detail: number;
}

export interface KitResult {
  mesher: Mesher;
  beacons: Beacon[];
  maxY: number;
}

const col = (hex: string) => new THREE.Color(hex);

/** Surface height at a point including pads and deltas (what the player sees). */
const h = (t: Terrain, x: number, z: number) => t.heightAt(x, z);

// --------------------------------------------------------------------------- landmarks
function needle(m: Mesher, x: number, z: number, ground: number, r: number, height: number, style: ChapterConfig['structureStyle'], seed: number): void {
  const bands = 7;
  const a = col(style.wall);
  const b = col(style.shade);
  const c = new THREE.Color();
  for (let i = 0; i < bands; i++) {
    const t0 = i / bands;
    const t1 = (i + 1) / bands;
    const r0 = r * (1.15 - 0.85 * t0 + 0.05 * Math.sin(seed + i * 2.1));
    const r1 = r * (1.15 - 0.85 * t1 + 0.05 * Math.sin(seed + (i + 1) * 2.1));
    c.copy(a).lerp(b, i % 2 ? 0.55 : 0.1);
    m.cylinder(x, ground + t0 * height - 1, z, Math.max(0.3, r0), Math.max(0.2, r1), height / bands + 0.2, 7, c);
  }
}

function lighthouse(m: Mesher, x: number, z: number, ground: number, r: number, height: number, beacons: Beacon[]): void {
  const segs = 5;
  for (let i = 0; i < segs; i++) {
    const t = i / segs;
    const r0 = r * (1 - 0.35 * t);
    const r1 = r * (1 - 0.35 * (t + 1 / segs));
    m.cylinder(x, ground + t * height * 0.78 - 1, z, r0, r1, (height * 0.78) / segs + 0.2, 10, i % 2 ? '#c9473a' : '#f2ede0');
  }
  const gy = ground + height * 0.78;
  m.cylinder(x, gy - 0.4, z, r * 0.95, r * 0.95, 0.8, 10, '#3a3a48'); // gallery
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    m.box(x + Math.cos(a) * r * 0.9, gy + 0.6, z + Math.sin(a) * r * 0.9, 0.2, 1.0, 0.2, '#3a3a48');
  }
  m.cylinder(x, gy + 0.4, z, r * 0.62, r * 0.62, height * 0.12, 10, '#ffe9a8'); // lantern room
  m.cylinder(x, gy + 0.4 + height * 0.12, z, r * 0.8, 0.1, height * 0.07, 10, '#c9473a'); // roof cone
  m.box(x, ground + 1.2, z + r * 0.8, 1.4, 2.4, 0.3, '#2b1d14'); // door
  beacons.push({ x, y: gy + 2, z, color: [1, 0.9, 0.55], size: 11, kind: 'lighthouse' });
}

export function buildLandmarks(ctx: KitContext): KitResult {
  const p = ctx.terrain.params;
  const m = new Mesher(ctx.light);
  const beacons: Beacon[] = [];
  let maxY = 0;
  const l = p.landmarks;
  if (l) {
    const ox = ctx.cx * CHUNK;
    const oz = ctx.cz * CHUNK;
    const ix0 = Math.floor(ox / l.cell);
    const iz0 = Math.floor(oz / l.cell);
    for (let iz = iz0 - 1; iz <= iz0 + 1; iz++) {
      for (let ix = ix0 - 1; ix <= ix0 + 1; ix++) {
        const lm = landmarkInCell(p, ix, iz);
        if (!lm || lm.x < ox || lm.x >= ox + CHUNK || lm.z < oz || lm.z >= oz + CHUNK) continue; // lives in exactly one chunk
        const local = new Mesher(ctx.light);
        if (lm.kind === 'lighthouse') lighthouse(local, lm.x - ox, lm.z - oz, lm.ground, lm.r, l.height, beacons);
        else needle(local, lm.x - ox, lm.z - oz, lm.ground, lm.r, l.height, ctx.chapter.structureStyle, ix * 7 + iz);
        m.append(local);
        maxY = Math.max(maxY, lm.top + 4);
      }
    }
    for (const b of beacons) {
      b.x += ox;
      b.z += oz;
    }
  }
  return { mesher: m, beacons, maxY };
}

// --------------------------------------------------------------------------- tombs (chapter 3)
/** Carved tomb facades on steep canyon walls and a few toppled columns on the floor. */
export function buildTombs(ctx: KitContext): KitResult {
  const m = new Mesher(ctx.light);
  const st = ctx.chapter.structureStyle;
  const rng = new Prng(hashInts(ctx.cx, ctx.cz, ctx.chapter.terrain.seed, 0x7081b));
  const ox = ctx.cx * CHUNK;
  const oz = ctx.cz * CHUNK;
  const T = ctx.terrain;
  let maxY = 0;
  const tries = ctx.detail >= 1 && rng.next() < 0.45 ? 7 : 0; // tombs are rare finds, not wallpaper
  let placed = 0;
  for (let i = 0; i < tries && placed < 1; i++) {
    const x = ox + rng.range(6, CHUNK - 6);
    const z = oz + rng.range(6, CHUNK - 6);
    const e = 3;
    const gx = (h(T, x + e, z) - h(T, x - e, z)) / (2 * e);
    const gz = (h(T, x, z + e) - h(T, x, z - e)) / (2 * e);
    const slope = Math.hypot(gx, gz);
    if (slope < 0.9) continue; // only on cliffs
    // Facade faces down the slope (away from the rock).
    const nx = -gx / slope;
    const nz = -gz / slope;
    const rot = Math.atan2(nx, nz);
    const y = h(T, x, z);
    const sx = x + nx * 0.2;
    const sz = z + nz * 0.2;
    const cosr = Math.cos(rot);
    const sinr = Math.sin(rot);
    const at = (u: number, yy: number, d: number): [number, number, number] => [sx - ox + u * cosr + d * sinr, yy, sz - oz - u * sinr + d * cosr];
    const dark = '#2a1812';
    // Face plate, two pillars, lintel and cornice, a dark pointed-arch doorway, steps.
    // The plate is back-filled into the rock so it never floats off a leaning cliff face.
    const back = Math.min(16, 12 / slope + 1.5);
    const [fx, , fz] = at(0, 0, -back / 2);
    m.box(fx, y + 5.5, fz, 10, 11, back + 1.2, st.wall, rot, st.shade);
    for (const sxn of [-1, 1]) {
      const [px, , pz] = at(sxn * 3.6, 0, 0.9);
      m.cylinder(px, y + 0.5, pz, 0.8, 0.7, 8.5, 8, st.wall);
      m.box(px, y + 9.2, pz, 2.0, 0.7, 2.0, st.trim, rot);
    }
    const [lx, , lz] = at(0, 0, 0.9);
    m.box(lx, y + 10.3, lz, 9.4, 0.9, 1.6, st.trim, rot);
    m.box(lx, y + 11.2, lz, 10.4, 0.5, 1.9, st.wall, rot);
    const [dx, , dz] = at(0, 0, 1.15);
    m.box(dx, y + 3.2, dz, 3.2, 6.4, 0.3, dark, rot);
    m.archWindow(dx + sinr * 0.2, y + 3.2, dz + cosr * 0.2, 3.2, 8.6, rot, dark);
    const [tx, , tz] = at(0, 0, 2.2);
    m.box(tx, y + 0.3, tz, 5.5, 0.6, 2.2, st.wall, rot);
    maxY = Math.max(maxY, y + 12);
    placed++;
  }
  // Toppled columns on flat canyon floors.
  const colCount = ctx.detail >= 1 ? 2 : 0;
  for (let i = 0; i < colCount; i++) {
    const x = ox + rng.range(4, CHUNK - 4);
    const z = oz + rng.range(4, CHUNK - 4);
    if (rng.next() > 0.45) continue;
    const y0 = h(T, x, z);
    if (Math.abs(h(T, x + 4, z) - y0) > 0.8 || Math.abs(h(T, x, z + 4) - y0) > 0.8) continue;
    m.box(x - ox, y0 + 0.9, z - oz, 7, 1.5, 1.5, st.wall, rng.range(0, 3.1));
    m.box(x - ox + 1.2, y0 + 0.4, z - oz + 3, 1.7, 0.8, 1.7, st.shade, rng.range(0, 3));
  }
  return { mesher: m, beacons: [], maxY };
}

// --------------------------------------------------------------------------- harbour (chapter 4)
function dhow(m: Mesher, wx: number, wz: number, y: number, rot: number, tint: string, beacons: Beacon[], ox: number, oz: number): void {
  const x = wx - ox;
  const z = wz - oz;
  const cs = Math.cos(rot);
  const sn = Math.sin(rot);
  /** Local-chunk point `u` across and `d` along the ship. */
  const P = (u: number, d: number): [number, number] => [x + u * cs + d * sn, z - u * sn + d * cs];
  // Hull: planked body, pointed bow, raised stern castle.
  const [hx, hz] = P(0, 0);
  m.box(hx, y + 0.5, hz, 2.8, 1.4, 11, '#5a3a22', rot, '#7a5232');
  m.box(hx, y + 1.5, hz, 3.2, 0.5, 9, tint, rot);
  const [bx, bz] = P(0, 6);
  m.box(bx, y + 1.3, bz, 1.6, 1.7, 3, '#5a3a22', rot);
  const [sx, sz] = P(0, -5.5);
  m.box(sx, y + 2.1, sz, 3.0, 2.6, 2.2, '#7a5232', rot);
  // Mast and a big lateen (triangular) sail.
  const [mx, mz] = P(0, 0.6);
  m.cylinder(mx, y + 1.5, mz, 0.18, 0.12, 11, 5, '#4a3320');
  const top: [number, number, number] = [mx, y + 12.2, mz];
  const bow: [number, number, number] = [P(0, 5.4)[0], y + 3.2, P(0, 5.4)[1]];
  const stern: [number, number, number] = [P(0, -4.6)[0], y + 3.4, P(0, -4.6)[1]];
  m.tri(top, bow, stern, '#f4ead2');
  m.tri(top, stern, bow, '#f4ead2');
  // Stern lantern: a little warm light you can see across the bay.
  m.box(sx, y + 4.1, sz, 0.5, 0.6, 0.5, '#ffd27a');
  beacons.push({ x: sx + ox, y: y + 4.2, z: sz + oz, color: [1, 0.78, 0.4], size: 4.5, kind: 'lantern' });
}

export function buildHarbour(ctx: KitContext): KitResult {
  const m = new Mesher(ctx.light);
  const beacons: Beacon[] = [];
  const st = ctx.chapter.structureStyle;
  const T = ctx.terrain;
  const water = T.params.waterLevel;
  const rng = new Prng(hashInts(ctx.cx, ctx.cz, T.params.seed, 0x68617262));
  const ox = ctx.cx * CHUNK;
  const oz = ctx.cz * CHUNK;
  let maxY = 0;
  const detail = ctx.detail;

  // Wooden piers reaching out from the shore, with a lantern post at the end.
  for (let i = 0; i < (detail >= 1 ? 6 : 0); i++) {
    const x = ox + rng.range(6, CHUNK - 6);
    const z = oz + rng.range(6, CHUNK - 6);
    const hh = h(T, x, z);
    if (hh < water - 0.2 || hh > water + 2.2) continue;
    let dir = -1;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      if (h(T, x + Math.cos(a) * 16, z + Math.sin(a) * 16) < water - 2.5) {
        dir = a;
        break;
      }
    }
    if (dir < 0 || rng.next() > 0.6) continue;
    const len = 16;
    const rot = Math.PI / 2 - dir;
    const cx2 = x + Math.cos(dir) * (len / 2 - 2);
    const cz2 = z + Math.sin(dir) * (len / 2 - 2);
    m.box(cx2 - ox, water + 0.7, cz2 - oz, 2.6, 0.35, len, '#7a5a38', rot, '#8a6a42');
    for (let k = 0; k <= 4; k++) {
      const px = x + Math.cos(dir) * (-2 + k * 3.8);
      const pz = z + Math.sin(dir) * (-2 + k * 3.8);
      for (const s of [-1, 1]) m.cylinder(px - Math.sin(dir) * s * 1.2 - ox, water - 2.5, pz + Math.cos(dir) * s * 1.2 - oz, 0.22, 0.22, 3.4, 5, '#4a3320');
    }
    const ex = x + Math.cos(dir) * (len - 3);
    const ez = z + Math.sin(dir) * (len - 3);
    m.cylinder(ex - ox, water + 0.8, ez - oz, 0.12, 0.12, 3.2, 4, '#2b1d14');
    m.box(ex - ox, water + 4.2, ez - oz, 0.7, 0.8, 0.7, '#ffd27a');
    beacons.push({ x: ex, y: water + 4.3, z: ez, color: [1, 0.8, 0.45], size: 4, kind: 'lantern' });
    m.box(x + Math.cos(dir) * 3 - ox, water + 1.4, z + Math.sin(dir) * 3 - oz, 1.4, 1.2, 1.4, st.shade, rng.range(0, 3));
    maxY = Math.max(maxY, water + 5);
  }

  // Dhows anchored in deeper water.
  const tints = ['#3a6a8a', '#8a3a3a', '#d9b04a', '#3a8a6a'];
  for (let i = 0; i < (detail >= 1 ? 2 : 0); i++) {
    const x = ox + rng.range(8, CHUNK - 8);
    const z = oz + rng.range(8, CHUNK - 8);
    if (rng.next() > 0.35) continue;
    if (h(T, x, z) > water - 3.2 || h(T, x + 8, z) > water - 2 || h(T, x - 8, z) > water - 2 || h(T, x, z + 8) > water - 2 || h(T, x, z - 8) > water - 2) continue;
    dhow(m, x, z, water - 0.2, rng.range(0, 6.28), tints[rng.int(0, 4)]!, beacons, ox, oz);
    maxY = Math.max(maxY, water + 13);
  }
  return { mesher: m, beacons, maxY };
}

export function kitFor(id: string): ((ctx: KitContext) => KitResult) | null {
  if (id === 'rose-tombs') return buildTombs;
  if (id === 'moonlit-harbour') return buildHarbour;
  return null;
}
