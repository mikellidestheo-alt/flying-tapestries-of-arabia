// Procedural castle geometry per tier. The same tier table drives the sim and the visuals:
// more towers, domes, minarets and banners as the castle grows. Chapters restyle it by colours.
import * as THREE from 'three';
import castleData from '../data/castles.json';
import { archerSlots, tierDef, type TierDef } from '../sim/castles';
import { Mesher, type Lighting } from './mesher';

export interface CastleStyle {
  wall: string;
  shade: string;
  dome: string;
  trim: string;
  roof: string;
}

export const FACTION_STYLES = castleData.factionStyles;

function banner(m: Mesher, x: number, y: number, z: number, shape: string, color: string, trim: string, rot: number): void {
  // Pole.
  m.cylinder(x, y, z, 0.12, 0.12, 4.2, 5, trim);
  const cs = Math.cos(rot);
  const sn = Math.sin(rot);
  const P = (u: number, v: number): [number, number, number] => [x + u * cs, y + 4.2 + v, z - u * sn];
  switch (shape) {
    case 'pennant':
      m.tri(P(0, 0), P(2.6, -0.7), P(0, -1.5), color);
      m.tri(P(0, 0), P(0, -1.5), P(2.6, -0.7), color);
      break;
    case 'swallow':
      m.tri(P(0, 0), P(2.8, 0), P(1.8, -0.75), color);
      m.tri(P(0, 0), P(1.8, -0.75), P(2.8, -1.5), color);
      m.tri(P(0, 0), P(2.8, -1.5), P(0, -1.5), color);
      m.tri(P(0, 0), P(1.8, -0.75), P(2.8, 0), color);
      m.tri(P(0, 0), P(2.8, -1.5), P(1.8, -0.75), color);
      m.tri(P(0, 0), P(0, -1.5), P(2.8, -1.5), color);
      break;
    case 'disc': {
      for (let i = 0; i < 8; i++) {
        const a0 = (i / 8) * 6.2832;
        const a1 = ((i + 1) / 8) * 6.2832;
        const c: [number, number, number] = P(1.3, -0.75);
        const p0: [number, number, number] = P(1.3 + Math.cos(a0) * 0.85, -0.75 + Math.sin(a0) * 0.85);
        const p1: [number, number, number] = P(1.3 + Math.cos(a1) * 0.85, -0.75 + Math.sin(a1) * 0.85);
        m.tri(c, p0, p1, color);
        m.tri(c, p1, p0, color);
      }
      break;
    }
    default: // crescent: a banner with a gold crescent notch
      m.quad(P(0, 0), P(2.6, 0), P(2.6, -1.5), P(0, -1.5), color);
      m.quad(P(0, 0), P(0, -1.5), P(2.6, -1.5), P(2.6, 0), color);
      m.tri(P(0.9, -0.3), P(1.9, -0.3), P(1.4, -1.2), trim);
      m.tri(P(0.9, -0.3), P(1.4, -1.2), P(1.9, -0.3), trim);
  }
}

function towerRing(count: number, radius: number, offset: number): { x: number; z: number; a: number }[] {
  return Array.from({ length: count }, (_, i) => {
    const a = offset + (i / Math.max(1, count)) * Math.PI * 2;
    return { x: Math.cos(a) * radius, z: Math.sin(a) * radius, a };
  });
}

/** Build the geometry for one castle (centred on its origin, base at y = 0). */
export function buildCastleGeometry(tier: number, faction: number, style: CastleStyle, light: Lighting, ruined: boolean): THREE.BufferGeometry {
  const def: TierDef = tierDef(tier);
  const v = def.visual;
  const fs = FACTION_STYLES[faction % FACTION_STYLES.length]!;
  const m = new Mesher(light);

  // Platform.
  m.cylinder(0, -1.2, 0, v.wallRadius + 2.2, v.wallRadius + 1.6, 1.6, 16, style.shade, style.shade);

  if (ruined) {
    // Rubble: broken wall stubs and a toppled keep.
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const h = 0.8 + ((i * 37) % 7) * 0.45;
      m.box(Math.cos(a) * v.wallRadius, h / 2, Math.sin(a) * v.wallRadius, 2.6, h, 1.2, style.shade, -a);
    }
    m.box(0, 1.2, 0, v.keepSize, 2.4, v.keepSize, style.shade, 0.4);
    m.box(2, 3, -1, 2.4, 1.2, 2.4, style.wall, 0.9);
    return m.toGeometry();
  }

  // Curtain wall with battlements and a gate.
  const segs = 14;
  const seg = (2 * Math.PI * v.wallRadius) / segs;
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const x = Math.cos(a) * v.wallRadius;
    const z = Math.sin(a) * v.wallRadius;
    const isGate = i === 0;
    m.box(x, v.wallHeight / 2, z, seg * 1.04, v.wallHeight, 1.5, isGate ? style.shade : style.wall, -a - Math.PI / 2, style.roof);
    if (!isGate) m.box(x, v.wallHeight + 0.5, z, seg * 0.45, 1, 1.7, style.wall, -a - Math.PI / 2);
  }
  // Keep and its great dome.
  m.box(0, v.keepHeight / 2, 0, v.keepSize, v.keepHeight, v.keepSize, style.wall, 0.25, style.roof);
  m.box(0, v.keepHeight * 0.3, 0, v.keepSize * 1.08, 1, v.keepSize * 1.08, style.trim, 0.25);
  let domesLeft = v.domes;
  if (domesLeft > 0) {
    m.dome(0, v.keepHeight, 0, v.keepSize * 0.62, style.dome, 10, 4, 1.05);
    m.cylinder(0, v.keepHeight + v.keepSize * 0.62, 0, 0.3, 0.05, 2.6, 5, style.trim);
    domesLeft--;
  }
  // Corner towers topped with domes.
  const towers = towerRing(v.towers, v.wallRadius, 0.5);
  for (const t of towers) {
    m.cylinder(t.x, 0, t.z, 2.1, 1.9, v.towerHeight, 10, style.wall, style.roof);
    m.cylinder(t.x, v.towerHeight - 1.2, t.z, 2.5, 2.5, 0.7, 10, style.trim);
    if (domesLeft > 0) {
      m.dome(t.x, v.towerHeight, t.z, 2.1, style.dome, 8, 3, 1.1);
      domesLeft--;
    }
  }
  // Extra small domes on the keep roof.
  for (const t of towerRing(domesLeft, v.keepSize * 0.42, 0.9)) {
    m.cylinder(t.x, v.keepHeight, t.z, 1.1, 1.0, 0.8, 8, style.wall);
    m.dome(t.x, v.keepHeight + 0.8, t.z, 1.1, style.dome, 8, 3, 1.1);
  }
  // Minarets: slender spires beside the keep.
  for (const t of towerRing(v.minarets, v.keepSize * 0.9, 0.2)) {
    m.cylinder(t.x, 0, t.z, 0.8, 0.6, v.keepHeight + 8, 8, style.wall);
    m.cylinder(t.x, v.keepHeight + 4, t.z, 1.15, 1.15, 0.5, 8, style.trim);
    m.cylinder(t.x, v.keepHeight + 7.6, t.z, 1.1, 1.1, 0.5, 8, style.trim);
    m.dome(t.x, v.keepHeight + 8, t.z, 1.0, style.dome, 8, 3, 1.4);
    m.cylinder(t.x, v.keepHeight + 9.2, t.z, 0.12, 0.05, 1.6, 4, style.trim);
  }
  // Banners in the faction's colour AND shape.
  const poleSpots = towers.length > 0 ? towers.map((t) => ({ x: t.x, y: v.towerHeight + (v.domes > 0 ? 2.2 : 0), z: t.z })) : [];
  poleSpots.push({ x: 0, y: v.keepHeight + v.keepSize * 0.62 + 2, z: 0 });
  for (let i = 0; i < Math.min(v.banners, poleSpots.length); i++) {
    const s = poleSpots[poleSpots.length - 1 - i]!;
    banner(m, s.x, s.y, s.z, fs.shape, fs.color, style.trim, i * 0.9);
  }
  // Archer posts (small merlon blocks so the slots read even without figures).
  for (const s of archerSlots(tier, tierDef(tier).archers)) m.box(s.x, s.y - 0.2, s.z, 1.3, 0.4, 1.3, style.trim);
  return m.toGeometry();
}

/** Shared archer figure: turbaned bowman. Instanced and tinted per faction. */
export function buildArcherGeometry(): THREE.BufferGeometry {
  const m = new Mesher({ sunDir: new THREE.Vector3(0.3, 1, 0.2).normalize(), sun: new THREE.Color('#ffffff'), ambient: new THREE.Color('#ffffff') });
  m.cylinder(0, 0, 0, 0.55, 0.35, 1.2, 6, '#f4ead2');
  m.dome(0, 1.2, 0, 0.32, '#d9a47a', 6, 2, 1);
  m.cylinder(0, 1.45, 0, 0.36, 0.3, 0.3, 6, '#f7f0e0');
  m.dome(0, 1.7, 0, 0.3, '#f7f0e0', 6, 2, 1);
  // Bow.
  m.box(0.55, 1.0, 0.25, 0.1, 1.2, 0.1, '#6b4a2e');
  m.box(0.55, 1.0, 0.1, 0.03, 1.2, 0.03, '#e8e0cc');
  return m.toGeometry();
}

export function buildNestGeometry(light: Lighting, color: string, glow: string): THREE.BufferGeometry {
  const m = new Mesher(light);
  m.cylinder(0, 0, 0, 5.4, 4.4, 1.0, 8, '#8a7a5a');
  m.cylinder(0, 1.0, 0, 2.6, 1.1, 8.0, 4, color);
  m.cylinder(0, 9.0, 0, 1.1, 0.0, 2.0, 4, glow);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    m.box(Math.cos(a) * 4.2, 0.9, Math.sin(a) * 4.2, 1.2, 1.8, 1.2, '#6f6044', a);
  }
  return m.toGeometry();
}
