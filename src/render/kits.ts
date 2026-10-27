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

/** Half-buried tower of the sunken sand city: sand drift at the foot, banded shaft, arched openings, broken crown. */
function ruinTower(m: Mesher, x: number, z: number, ground: number, r: number, height: number, style: ChapterConfig['structureStyle'], seed: number): void {
  const bands = 5;
  const wall = col(style.wall);
  const shade = col(style.shade);
  const c = new THREE.Color();
  const shaftTop = ground + height * 0.86;
  for (let i = 0; i < bands; i++) {
    const t0 = i / bands;
    const t1 = (i + 1) / bands;
    c.copy(wall).lerp(shade, i % 2 ? 0.4 : 0.05);
    m.cylinder(x, ground - 2 + t0 * (shaftTop - ground + 2), z, r * (1.1 - 0.22 * t0), r * (1.1 - 0.22 * t1), (shaftTop - ground + 2) / bands + 0.15, 8, c);
  }
  m.cylinder(x, ground - 1, z, r * 2.6, r * 1.15, 7, 8, style.roof); // sand drift swallowing the base
  // Broken crown: a jagged ring of stubs, the tallest reaching the landmark's full height.
  for (let k = 0; k < 4; k++) {
    const a = seed * 0.7 + (k / 4) * Math.PI * 2;
    const top = shaftTop + (k === 0 ? height * 0.14 : k === 2 ? height * 0.07 : 0.4);
    m.box(x + Math.cos(a) * r * 0.78, (shaftTop - 0.5 + top) / 2, z + Math.sin(a) * r * 0.78, 2.4, top - shaftTop + 1, 2.4, wall, -a, shade);
  }
  // Dark arched openings on two faces, a fallen block and a toppled drum.
  for (let k = 0; k < 2; k++) {
    const a = seed * 1.3 + k * 2.4;
    m.archWindow(x + Math.cos(a) * (r * 0.95), ground + height * (0.42 + 0.17 * k), z + Math.sin(a) * (r * 0.95), 2.2, 4.4, Math.PI / 2 - a, '#2a1a10');
  }
  m.box(x + r * 1.9, ground + 0.6, z - r * 1.2, 3.2, 1.8, 2.4, wall, seed, shade);
  m.cylinder(x - r * 1.6, ground + 0.2, z + r * 1.8, 1.1, 1.0, 4.2, 6, shade);
}

/** Slender gilded minaret on a sky island: white shaft, gold balconies (the collision radius), onion dome and finial. */
function spire(m: Mesher, x: number, z: number, ground: number, r: number, height: number, style: ChapterConfig['structureStyle']): void {
  const shaft = r * 0.6;
  m.cylinder(x, ground - 1, z, r * 0.95, shaft, height * 0.55, 10, style.wall);
  m.cylinder(x, ground + height * 0.55 - 1, z, shaft, shaft * 0.9, height * 0.38, 10, style.wall);
  for (const t of [0.33, 0.72]) {
    m.cylinder(x, ground + height * t, z, r * 0.95, r, 0.7, 12, style.trim); // balcony disc
    m.cylinder(x, ground + height * t + 0.7, z, r * 0.9, r * 0.9, 0.3, 12, style.shade);
  }
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2;
    m.archWindow(x + Math.cos(a) * shaft * 1.02, ground + height * 0.45, z + Math.sin(a) * shaft * 1.02, 1.0, 2.6, Math.PI / 2 - a, '#3a2a4a');
  }
  const topY = ground + height * 0.93;
  m.cylinder(x, topY - 0.4, z, shaft * 1.2, shaft * 1.2, 0.7, 10, style.trim);
  m.onion(x, topY + 0.3, z, shaft * 1.55, style.dome, 10);
  m.cylinder(x, topY + 0.3 + shaft * 1.55 * 1.9, z, 0.12, 0.05, 2.4, 4, style.trim); // finial
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
        else if (lm.kind === 'ruin-tower') ruinTower(local, lm.x - ox, lm.z - oz, lm.ground, lm.r, l.height, ctx.chapter.structureStyle, ix * 5 + iz * 3);
        else if (lm.kind === 'spire') spire(local, lm.x - ox, lm.z - oz, lm.ground, lm.r, l.height, ctx.chapter.structureStyle);
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

// --------------------------------------------------------------------------- sunken city (chapter 5)
/** Columns, arches and half-sunk domes poking out of the dunes, plus a few scattered blocks. Rare and cheap. */
export function buildRuins(ctx: KitContext): KitResult {
  const m = new Mesher(ctx.light);
  const st = ctx.chapter.structureStyle;
  const T = ctx.terrain;
  const water = T.params.waterLevel;
  const rng = new Prng(hashInts(ctx.cx, ctx.cz, T.params.seed, 0x72756e73));
  const ox = ctx.cx * CHUNK;
  const oz = ctx.cz * CHUNK;
  let maxY = 0;
  if (ctx.detail < 1) return { mesher: m, beacons: [], maxY };
  let placed = 0;
  for (let i = 0; i < 7 && placed < 2; i++) {
    const x = ox + rng.range(8, CHUNK - 8);
    const z = oz + rng.range(8, CHUNK - 8);
    const kind = rng.next();
    if (rng.next() > 0.55) continue;
    const y = h(T, x, z);
    if (y < water + 1.5) continue;
    const lx = x - ox;
    const lz = z - oz;
    if (kind < 0.4) {
      // Colonnade: a line of columns, some snapped short, sunk into the sand.
      const dir = rng.range(0, 3.14);
      const dx = Math.cos(dir) * 5.5;
      const dz = Math.sin(dir) * 5.5;
      for (let k = -1; k <= 1; k++) {
        const px = x + dx * k;
        const pz = z + dz * k;
        const py = h(T, px, pz);
        const tall = rng.range(2.5, 8.5);
        m.cylinder(px - ox, py - 1.2, pz - oz, 0.95, 0.8, tall + 1.2, 7, st.wall);
        m.box(px - ox, py - 1.2 + tall + 1.2 + 0.2, pz - oz, 2.1, 0.5, 2.1, st.trim, dir, st.shade);
      }
      maxY = Math.max(maxY, y + 9);
    } else if (kind < 0.65) {
      // Arch: two pillars with a pointed lintel, leaning in the dune.
      const dir = rng.range(0, 3.14);
      const cs = Math.cos(dir);
      const sn = Math.sin(dir);
      const span = 6.5;
      for (const s of [-1, 1]) m.box(lx + cs * span * 0.5 * s, y + 3.2, lz + sn * span * 0.5 * s, 1.6, 8.6, 1.6, st.wall, -dir, st.shade);
      m.box(lx, y + 7.6, lz, span + 1.8, 1.2, 1.7, st.wall, -dir + Math.PI / 2, st.trim);
      m.tri([lx - cs * span * 0.5, y + 8.2, lz - sn * span * 0.5], [lx + cs * span * 0.5, y + 8.2, lz + sn * span * 0.5], [lx, y + 10.6, lz], st.trim);
      m.tri([lx + cs * span * 0.5, y + 8.2, lz + sn * span * 0.5], [lx - cs * span * 0.5, y + 8.2, lz - sn * span * 0.5], [lx, y + 10.6, lz], st.trim);
      maxY = Math.max(maxY, y + 11);
    } else if (kind < 0.9) {
      // Dome of a drowned mosque, two thirds swallowed by the sand.
      const r = rng.range(4.5, 8);
      m.dome(lx, y - r * 0.55, lz, r, st.dome, 8, 3, 0.9);
      m.cylinder(lx, y - 1, lz, r * 1.05, r * 1.0, 1.8, 8, st.wall);
      m.cylinder(lx, y + r * 0.35, lz, 0.2, 0.05, r * 0.5, 4, st.trim);
      maxY = Math.max(maxY, y + r * 0.9);
    } else {
      for (let k = 0; k < 3; k++) m.box(lx + rng.range(-3, 3), y + 0.5, lz + rng.range(-3, 3), rng.range(1.4, 3), rng.range(0.9, 1.8), rng.range(1.4, 3), st.wall, rng.range(0, 3), st.shade);
      maxY = Math.max(maxY, y + 2.5);
    }
    placed++;
  }
  return { mesher: m, beacons: [], maxY };
}

// --------------------------------------------------------------------------- sky palace (chapter 6)
/** Gold-roofed pavilions on the islands and arched rope bridges across the cloud gaps. */
export function buildSkyPalace(ctx: KitContext): KitResult {
  const m = new Mesher(ctx.light);
  const beacons: Beacon[] = [];
  const st = ctx.chapter.structureStyle;
  const T = ctx.terrain;
  const water = T.params.waterLevel;
  const rng = new Prng(hashInts(ctx.cx, ctx.cz, T.params.seed, 0x736b7970));
  const ox = ctx.cx * CHUNK;
  const oz = ctx.cz * CHUNK;
  let maxY = 0;
  if (ctx.detail < 1) return { mesher: m, beacons, maxY };
  const isLand = (x: number, z: number) => h(T, x, z) > water + 8;
  const flat = (x: number, z: number, e: number) => {
    const y0 = h(T, x, z);
    return Math.abs(h(T, x + e, z) - y0) < 1.2 && Math.abs(h(T, x - e, z) - y0) < 1.2 && Math.abs(h(T, x, z + e) - y0) < 1.2 && Math.abs(h(T, x, z - e) - y0) < 1.2;
  };

  // One pavilion per lucky chunk: four pillars, a floor, a gilded onion roof.
  if (rng.next() < 0.28) {
    for (let i = 0; i < 5; i++) {
      const x = ox + rng.range(10, CHUNK - 10);
      const z = oz + rng.range(10, CHUNK - 10);
      if (!isLand(x, z) || !flat(x, z, 5)) continue;
      const y = h(T, x, z);
      const lx = x - ox;
      const lz = z - oz;
      m.cylinder(lx, y - 0.5, lz, 4.6, 4.2, 1.1, 8, st.wall, st.trim);
      for (let k = 0; k < 4; k++) {
        const a = Math.PI / 4 + (k / 4) * Math.PI * 2;
        m.cylinder(lx + Math.cos(a) * 3.3, y + 0.5, lz + Math.sin(a) * 3.3, 0.38, 0.32, 5.2, 5, st.wall);
      }
      m.cylinder(lx, y + 5.7, lz, 4.2, 4.2, 0.5, 8, st.trim);
      m.onion(lx, y + 6.2, lz, 2.6, st.dome, 8);
      m.cylinder(lx, y + 6.2 + 2.6 * 1.9, lz, 0.1, 0.04, 1.8, 4, st.trim);
      beacons.push({ x, y: y + 5.2, z, color: [1, 0.82, 0.45], size: 5, kind: 'lantern' });
      maxY = Math.max(maxY, y + 12);
      break;
    }
  }

  // One bridge per lucky chunk, always from this chunk eastward so neighbours never duplicate it.
  if (rng.next() < 0.5) {
    outer: for (let i = 0; i < 6; i++) {
      const ax = ox + rng.range(4, CHUNK - 4);
      const az = oz + rng.range(4, CHUNK - 4);
      if (!isLand(ax, az)) continue;
      for (const deg of [0, -25, 25, -50, 50]) {
        const a = (deg * Math.PI) / 180;
        for (const dist of [36, 48, 60, 72]) {
          const bx = ax + Math.cos(a) * dist;
          const bz = az + Math.sin(a) * dist;
          if (!isLand(bx, bz)) continue;
          const ya = h(T, ax, az);
          const yb = h(T, bx, bz);
          if (Math.abs(ya - yb) > 7) continue;
          let gap = false;
          let solid = true;
          for (let k = 1; k < 8; k++) {
            const hh = h(T, ax + (bx - ax) * (k / 8), az + (bz - az) * (k / 8));
            if (hh < water + 2) gap = true;
            if (hh > Math.max(ya, yb) + 4) solid = false; // a hill in the way
          }
          if (!gap || !solid) continue;
          const n = Math.max(6, Math.round(dist / 4.5));
          const rot = Math.PI / 2 - a;
          const len = dist / n + 0.25;
          for (let k = 0; k < n; k++) {
            const t = (k + 0.5) / n;
            const px = ax + (bx - ax) * t;
            const pz = az + (bz - az) * t;
            const py = ya + (yb - ya) * t + 0.4 + 1.6 * Math.sin(Math.PI * t);
            m.box(px - ox, py, pz - oz, 3.2, 0.45, len, st.wall, rot, st.trim);
            for (const s of [-1, 1]) m.box(px - ox + Math.sin(a) * -s * 1.5, py + 0.85, pz - oz + Math.cos(a) * s * 1.5, 0.18, 0.2, len, st.trim, rot);
          }
          for (const [qx, qz, qy] of [[ax, az, ya], [bx, bz, yb]] as const) {
            for (const s of [-1, 1]) {
              const lx = qx - ox + Math.sin(a) * -s * 1.5;
              const lz = qz - oz + Math.cos(a) * s * 1.5;
              m.cylinder(lx, qy - 0.5, lz, 0.35, 0.3, 4.2, 5, st.wall);
              m.onion(lx, qy + 3.6, lz, 0.55, st.dome, 6);
            }
            beacons.push({ x: qx, y: qy + 2.5, z: qz, color: [1, 0.8, 0.45], size: 4, kind: 'lantern' });
          }
          maxY = Math.max(maxY, Math.max(ya, yb) + 7);
          break outer;
        }
      }
    }
  }
  return { mesher: m, beacons, maxY };
}

export function kitFor(id: string): ((ctx: KitContext) => KitResult) | null {
  if (id === 'rose-tombs') return buildTombs;
  if (id === 'moonlit-harbour') return buildHarbour;
  if (id === 'buried-ruins') return buildRuins;
  if (id === 'sky-palace') return buildSkyPalace;
  return null;
}
