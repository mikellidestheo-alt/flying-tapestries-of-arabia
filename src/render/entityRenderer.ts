// Draws sim entities (orbs, bolts, creatures, wells) and spell/impact VFX.
// Reads sim state and events; never mutates the sim.
import * as THREE from 'three';
import simData from '../data/sim.json';
import { PRESETS } from './quality';
import type { QualityPreset } from '../save';
import type { SimEvent } from '../sim/entities';
import type { Element } from '../data/elements';
import type { Sim } from '../sim/sim';
import { GlowLayer } from './glowLayer';
import { MergeBuilder } from './mergeBuilder';
import { Particles } from './particles';
import type { ChapterConfig } from '../data/chapters';
import { StructureRenderer } from './structureRenderer';
import { CREATURES } from '../sim/combat';
import type { Beacon } from './kits';

const MANA = [0.35, 0.85, 1.0] as const;
const FIRE = [1.0, 0.55, 0.18] as const;
const EMBER = [1.0, 0.82, 0.4] as const;
const DUST = [0.85, 0.7, 0.45] as const;
const GOLD = [1.0, 0.85, 0.4] as const;
const RED = [1.0, 0.25, 0.2] as const;
const WHITE_HOT = [1.0, 0.85, 0.5] as const;
const ICE = [0.55, 0.88, 1.0] as const;
const FROST_WHITE = [0.9, 0.98, 1.0] as const;
const ROCK = [0.62, 0.45, 0.28] as const;
const SPARK = [0.85, 0.9, 1.0] as const;
const ELEMENT_RGB: Record<string, readonly [number, number, number]> = { fire: FIRE, water: ICE, earth: ROCK, air: SPARK };
const CURSE = [0.65, 0.25, 0.95] as const;

/** Monster bolt looks: outer glow, hot core, trail particle. */
const MONSTER_BOLTS: Record<string, { glow: readonly [number, number, number]; core: readonly [number, number, number]; trail: readonly [number, number, number] }> = {
  'genie-bolt': { glow: [0.7, 0.25, 1], core: [1, 0.8, 1], trail: [0.6, 0.2, 0.95] },
  'wraith-bolt': { glow: [1, 0.45, 0.3], core: [1, 0.9, 0.7], trail: [0.9, 0.35, 0.3] },
  'tide-bolt': { glow: [0.2, 0.9, 0.85], core: [0.85, 1, 1], trail: [0.2, 0.75, 0.8] },
  'sand-bolt': { glow: [1, 0.78, 0.35], core: [1, 0.97, 0.75], trail: [0.85, 0.65, 0.35] },
  'guardian-bolt': { glow: [1, 0.85, 0.3], core: [1, 1, 0.85], trail: [1, 0.7, 0.25] },
};

/** How each creature type moves on screen. */
type Motion = 'sprite' | 'caster' | 'walker' | 'flier' | 'golem' | 'serpent';
const MOTION: Record<string, { motion: Motion; scale: number; eye?: readonly [number, number, number]; eyeY?: number; smoke?: readonly [number, number, number] }> = {
  'dust-sprite': { motion: 'sprite', scale: 1 },
  'evil-genie': { motion: 'caster', scale: 1.15, eye: [1, 0.2, 0.15], eyeY: 3.9, smoke: [0.35, 0.25, 0.6] },
  'tide-djinn': { motion: 'caster', scale: 1.15, eye: [0.4, 1, 0.95], eyeY: 3.9, smoke: [0.2, 0.55, 0.6] },
  'canyon-wraith': { motion: 'caster', scale: 1.2, eye: [1, 0.65, 0.2], eyeY: 4.3, smoke: [0.5, 0.3, 0.4] },
  'sand-wraith': { motion: 'caster', scale: 1.2, eye: [0.45, 1, 0.9], eyeY: 4.3, smoke: [0.8, 0.65, 0.4] },
  'ruin-golem': { motion: 'golem', scale: 1.5, eye: [1, 0.75, 0.25], eyeY: 3.5, smoke: [0.75, 0.6, 0.4] },
  'palace-guardian': { motion: 'caster', scale: 1.2, eye: [1, 0.9, 0.4], eyeY: 4.1, smoke: [1, 0.8, 0.35] },
  'cloud-serpent': { motion: 'serpent', scale: 1.4 },
  gazelle: { motion: 'walker', scale: 1.35 },
  dove: { motion: 'flier', scale: 1.5 },
  oryx: { motion: 'walker', scale: 1.5 },
  ibex: { motion: 'walker', scale: 1.4 },
  'stone-bat': { motion: 'flier', scale: 1.3 },
  'night-gull': { motion: 'flier', scale: 1.6 },
};

function makeBeamTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 64, 0, 0);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 64);
  return new THREE.CanvasTexture(c);
}

function dustSpriteGeometry(): THREE.BufferGeometry {
  const b = new MergeBuilder();
  b.add(new THREE.ConeGeometry(1.5, 3.2, 9), '#d9b177', [0, 0, 0], [Math.PI, 0, 0]);
  b.add(new THREE.ConeGeometry(0.95, 2.6, 7), '#a67c42', [0, -0.2, 0], [Math.PI, 0.4, 0]);
  b.add(new THREE.TorusGeometry(1.75, 0.16, 5, 14), '#f0d9a2', [0, 0.55, 0], [Math.PI / 2, 0, 0]);
  for (const sx of [-1, 1]) b.add(new THREE.SphereGeometry(0.26, 6, 5), '#fff1a8', [sx * 0.5, 0.75, 1.15]);
  return b.build();
}

function oryxGeometry(): THREE.BufferGeometry {
  const b = new MergeBuilder();
  const cream = '#f1e3c4';
  const dark = '#3b2a22';
  b.add(new THREE.BoxGeometry(1.25, 1.25, 2.9), cream, [0, 1.8, 0]);
  b.add(new THREE.BoxGeometry(0.9, 0.5, 2.3), '#d9c39a', [0, 1.1, 0]); // belly shade
  for (const [x, z] of [[-0.42, 1.0], [0.42, 1.0], [-0.42, -1.0], [0.42, -1.0]] as const) b.add(new THREE.BoxGeometry(0.3, 1.5, 0.3), cream, [x, 0.75, z]);
  b.add(new THREE.BoxGeometry(0.6, 1.3, 0.7), cream, [0, 2.5, 1.5], [0.55, 0, 0]); // neck
  b.add(new THREE.BoxGeometry(0.62, 0.62, 1.1), cream, [0, 3.1, 2.1]); // head
  b.add(new THREE.BoxGeometry(0.64, 0.2, 0.7), dark, [0, 2.95, 2.45]); // face stripe
  for (const sx of [-1, 1]) b.add(new THREE.BoxGeometry(0.1, 0.1, 2.0), dark, [sx * 0.22, 3.7, 1.5], [0.9, 0, sx * 0.08]); // long horns
  b.add(new THREE.BoxGeometry(0.2, 0.2, 0.9), dark, [0, 2.4, -1.7], [-0.7, 0, 0]); // tail
  return b.build();
}

interface GeniePalette {
  smoke: string;
  wisp: string;
  skin: string;
  hand: string;
  sash: string;
  band: string;
  dome: string;
  gem: string;
  eye: string;
  horns: string;
}

const EVIL_GENIE: GeniePalette = { smoke: '#4a3f9a', wisp: '#2f2872', skin: '#5a6fd0', hand: '#7a8be8', sash: '#e8b83a', band: '#1c1630', dome: '#2a2050', gem: '#ff4a3a', eye: '#ff3b2e', horns: '#e8e0d0' };
const TIDE_DJINN: GeniePalette = { smoke: '#1f8a8a', wisp: '#14566a', skin: '#3fb7b0', hand: '#7fe0d4', sash: '#f2f0e4', band: '#e8e4d4', dome: '#f6f3e8', gem: '#7ee8ff', eye: '#d8ffff', horns: '#f0e6c8' };

/** Genie: smoky tail, muscled torso with sash and armlets, turban, glowing eyes. Palette picks the species. */
function genieGeometry(c: GeniePalette): THREE.BufferGeometry {
  const b = new MergeBuilder();
  b.add(new THREE.ConeGeometry(1.3, 3.6, 9), c.smoke, [0, 0.6, 0], [Math.PI, 0, 0]); // wispy tail, tip down
  b.add(new THREE.ConeGeometry(0.8, 2.2, 7), c.wisp, [0.35, -0.5, 0.1], [Math.PI, 0.4, 0.3]); // curling wisp
  b.add(new THREE.CylinderGeometry(1.15, 0.9, 1.7, 9), c.skin, [0, 2.4, 0]); // torso
  b.add(new THREE.CylinderGeometry(1.2, 1.2, 0.35, 9), c.sash, [0, 1.8, 0]); // sash
  for (const sx of [-1, 1]) {
    b.add(new THREE.CylinderGeometry(0.32, 0.26, 1.7, 6), c.skin, [sx * 1.35, 2.4, 0.5], [-0.9, 0, sx * -0.35]); // arms forward
    b.add(new THREE.CylinderGeometry(0.4, 0.4, 0.3, 6), c.sash, [sx * 1.55, 2.0, 0.95], [-0.9, 0, sx * -0.35]); // armlets
    b.add(new THREE.SphereGeometry(0.4, 6, 5), c.hand, [sx * 1.7, 1.8, 1.4]); // hands
  }
  b.add(new THREE.SphereGeometry(0.78, 9, 7), c.skin, [0, 3.85, 0.1]); // head
  b.add(new THREE.ConeGeometry(0.2, 0.55, 4), '#2a1f1a', [0, 3.35, 0.7], [Math.PI, 0, 0]); // pointed goatee
  for (const sx of [-1, 1]) b.add(new THREE.SphereGeometry(0.17, 5, 4), c.eye, [sx * 0.3, 3.95, 0.8]); // glowing eyes
  b.add(new THREE.CylinderGeometry(0.85, 0.9, 0.6, 9), c.band, [0, 4.45, 0.05]); // turban band
  b.add(new THREE.SphereGeometry(0.85, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2), c.dome, [0, 4.7, 0.05]); // turban dome
  b.add(new THREE.OctahedronGeometry(0.25), c.gem, [0, 4.55, 0.85]); // turban jewel
  for (const sx of [-1, 1]) b.add(new THREE.ConeGeometry(0.22, 1.2, 5), c.horns, [sx * 0.7, 5.0, 0], [0, 0, sx * -0.45]); // horns
  return b.build();
}

interface WraithPalette {
  cloak: string;
  rags: string;
  shoulders: string;
  hoodIn: string;
  hood: string;
  eye: string;
}

const CANYON_WRAITH: WraithPalette = { cloak: '#7a4a5e', rags: '#4b2c3c', shoulders: '#8e5a70', hoodIn: '#2a1620', hood: '#6a3a50', eye: '#ffb040' };
const SAND_WRAITH: WraithPalette = { cloak: '#c9a566', rags: '#8a6a3a', shoulders: '#dcc088', hoodIn: '#2b2012', hood: '#b08a4a', eye: '#6affe0' };

/** Wraith: a hooded spectre in tattered rags, burning eyes, long clawed arms. Palette picks the species. */
function wraithGeometry(c: WraithPalette): THREE.BufferGeometry {
  const b = new MergeBuilder();
  b.add(new THREE.ConeGeometry(1.7, 4.2, 8), c.cloak, [0, 1.4, 0], [Math.PI, 0, 0]); // cloak, tip down
  b.add(new THREE.ConeGeometry(1.1, 2.6, 6), c.rags, [-0.6, -0.2, -0.2], [Math.PI, 0.5, 0.25]); // ragged tatters
  b.add(new THREE.ConeGeometry(0.9, 2.2, 6), c.rags, [0.7, -0.1, 0.1], [Math.PI, 1.1, -0.3]);
  b.add(new THREE.CylinderGeometry(0.9, 1.5, 1.8, 8), c.shoulders, [0, 3.0, 0]); // shoulders
  b.add(new THREE.SphereGeometry(0.85, 8, 6), c.hoodIn, [0, 4.2, 0.1]); // hood interior
  b.add(new THREE.ConeGeometry(1.0, 1.7, 7), c.hood, [0, 4.7, -0.15], [-0.25, 0, 0]); // peaked hood
  for (const sx of [-1, 1]) {
    b.add(new THREE.SphereGeometry(0.17, 5, 4), c.eye, [sx * 0.3, 4.3, 0.85]); // burning eyes
    b.add(new THREE.CylinderGeometry(0.2, 0.14, 2.6, 5), c.shoulders, [sx * 1.5, 2.8, 0.9], [-1.1, 0, sx * -0.2]); // long arms
    for (let k = -1; k <= 1; k++) b.add(new THREE.ConeGeometry(0.07, 0.8, 4), '#e8d8c0', [sx * 1.6 + k * 0.17, 2.0, 2.2], [-1.7, 0, k * 0.2]); // claws
  }
  return b.build();
}

/** Ruin golem: a floating sandstone giant of stacked blocks, glowing glyph eyes and heavy fists. */
function golemGeometry(): THREE.BufferGeometry {
  const b = new MergeBuilder();
  const stone = '#b9976a';
  const dark = '#7a5a3a';
  b.add(new THREE.BoxGeometry(2.6, 2.8, 1.8), stone, [0, 3.0, 0]); // chest
  b.add(new THREE.BoxGeometry(2.2, 1.0, 1.5), dark, [0, 1.3, 0]); // waist
  b.add(new THREE.ConeGeometry(0.9, 1.6, 5), dark, [0, 0.2, 0], [Math.PI, 0, 0]); // hovering base
  b.add(new THREE.BoxGeometry(1.4, 1.2, 1.3), stone, [0, 4.9, 0.1]); // head
  b.add(new THREE.BoxGeometry(1.7, 0.35, 1.5), dark, [0, 5.65, 0.1]); // brow slab
  for (const sx of [-1, 1]) {
    b.add(new THREE.BoxGeometry(0.3, 0.22, 0.12), '#ffc04a', [sx * 0.38, 4.95, 0.78]); // glowing glyph eyes
    b.add(new THREE.BoxGeometry(1.2, 1.2, 1.2), dark, [sx * 1.95, 3.9, 0.1]); // shoulder block
    b.add(new THREE.BoxGeometry(0.9, 2.0, 0.9), stone, [sx * 2.2, 2.4, 0.5], [-0.35, 0, sx * -0.1]); // arm
    b.add(new THREE.BoxGeometry(1.5, 1.5, 1.5), stone, [sx * 2.35, 1.2, 1.2], [0, 0.3 * sx, 0]); // fist
    b.add(new THREE.BoxGeometry(0.5, 0.5, 0.2), '#2aa09a', [sx * 0.8, 3.2, 0.95]); // inlaid turquoise tiles
  }
  return b.build();
}

/** Cloud serpent: a coiling body of shrinking pearly segments, a crested head and gilded fins. */
function serpentGeometry(): THREE.BufferGeometry {
  const b = new MergeBuilder();
  const n = 9;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const r = 0.95 - 0.7 * t;
    const col = i % 2 ? '#f7ecf5' : '#e0b8d8';
    b.add(new THREE.SphereGeometry(r, 7, 5), col, [Math.sin(i * 0.9) * 0.45, 0.05 * i, -i * 1.05]);
  }
  b.add(new THREE.SphereGeometry(0.8, 8, 6), '#f4dff0', [0, 0.25, 1.0]); // head
  b.add(new THREE.ConeGeometry(0.45, 0.9, 6), '#e8c2dc', [0, 0.1, 1.7], [Math.PI / 2, 0, 0]); // snout
  b.add(new THREE.ConeGeometry(0.25, 1.1, 4), '#ffd060', [0, 1.1, 0.7], [-0.5, 0, 0]); // crest
  for (const sx of [-1, 1]) {
    b.add(new THREE.SphereGeometry(0.14, 5, 4), '#ffd060', [sx * 0.42, 0.5, 1.45]); // eyes
    b.add(new THREE.BoxGeometry(1.8, 0.06, 1.0), '#ffd8a0', [sx * 1.3, 0.2, -0.2], [0, sx * 0.2, sx * 0.25]); // fins
  }
  return b.build();
}

/** Palace guardian: a floating gilded suit of armour, plumed helm, no body beneath. */
function guardianGeometry(): THREE.BufferGeometry {
  const b = new MergeBuilder();
  const gold = '#e8b83a';
  const white = '#f6efe0';
  b.add(new THREE.ConeGeometry(1.2, 3.2, 8), '#c9962c', [0, 0.8, 0], [Math.PI, 0, 0]); // tapering skirt, tip down
  b.add(new THREE.CylinderGeometry(1.0, 1.4, 1.8, 8), gold, [0, 2.7, 0]); // breastplate
  b.add(new THREE.CylinderGeometry(1.45, 1.45, 0.3, 8), white, [0, 2.0, 0]); // belt
  b.add(new THREE.SphereGeometry(0.8, 8, 6), gold, [0, 4.0, 0.05]); // helm
  b.add(new THREE.ConeGeometry(0.3, 1.4, 5), '#d94a3a', [0, 5.1, -0.1]); // plume
  b.add(new THREE.BoxGeometry(0.9, 0.18, 0.2), '#241a14', [0, 3.95, 0.8]); // visor slit
  for (const sx of [-1, 1]) {
    b.add(new THREE.SphereGeometry(0.62, 7, 5), white, [sx * 1.55, 3.3, 0]); // pauldrons
    b.add(new THREE.CylinderGeometry(0.28, 0.22, 1.8, 6), gold, [sx * 1.7, 2.3, 0.6], [-0.9, 0, sx * -0.2]); // forearms
    b.add(new THREE.SphereGeometry(0.34, 6, 5), white, [sx * 1.8, 1.8, 1.3]); // gauntlets
  }
  b.add(new THREE.BoxGeometry(0.2, 3.2, 0.2), '#d9d9e8', [1.9, 2.6, 1.6], [0.2, 0, 0.1]); // scimitar blade
  b.add(new THREE.BoxGeometry(0.8, 0.15, 0.15), '#8a5a1c', [1.9, 1.0, 1.6]); // cross-guard
  return b.build();
}

/** Stone bat: a rounded, slate body with broad membrane wings and big pointed ears. */
function batGeometry(): THREE.BufferGeometry {
  const b = new MergeBuilder();
  b.add(new THREE.SphereGeometry(0.85, 7, 6), '#6a5a68', [0, 0, 0]);
  b.add(new THREE.SphereGeometry(0.55, 6, 5), '#7e6c7c', [0, 0.2, 0.9]); // head
  for (const sx of [-1, 1]) {
    b.add(new THREE.ConeGeometry(0.22, 0.8, 4), '#4a3c48', [sx * 0.28, 0.85, 0.95]); // ears
    b.add(new THREE.SphereGeometry(0.1, 4, 4), '#ff6a4a', [sx * 0.2, 0.3, 1.35]); // eyes
    b.add(new THREE.BoxGeometry(2.6, 0.08, 1.5), '#4f4150', [sx * 1.85, 0.15, -0.1], [0, sx * 0.25, sx * 0.3]); // wing membrane
    b.add(new THREE.BoxGeometry(2.7, 0.14, 0.14), '#2f2530', [sx * 1.85, 0.3, 0.55], [0, sx * 0.25, sx * 0.3]); // wing bone
  }
  return b.build();
}

/** Night gull: pale body and long slim wings, a yellow beak. */
function gullGeometry(): THREE.BufferGeometry {
  const b = new MergeBuilder();
  b.add(new THREE.SphereGeometry(0.6, 7, 5), '#e6ecf4', [0, 0, 0]);
  b.add(new THREE.SphereGeometry(0.34, 6, 5), '#f4f7fb', [0, 0.25, 0.75]); // head
  b.add(new THREE.ConeGeometry(0.1, 0.5, 4), '#f0b030', [0, 0.18, 1.2], [Math.PI / 2, 0, 0]); // beak
  b.add(new THREE.ConeGeometry(0.2, 0.8, 4), '#c8d2e0', [0, 0, -0.9], [-Math.PI / 2, 0, 0]); // tail
  for (const sx of [-1, 1]) b.add(new THREE.BoxGeometry(2.4, 0.07, 0.65), '#d0d9e6', [sx * 1.4, 0.1, 0], [0, sx * 0.2, sx * 0.22]); // wings
  return b.build();
}

interface WellView {
  group: THREE.Group;
  beam: THREE.Mesh;
  beamMat: THREE.MeshBasicMaterial;
  ring: THREE.Mesh;
  glow: THREE.Mesh;
  id: number;
}

export class EntityRenderer {
  readonly group = new THREE.Group();
  private glow!: GlowLayer;
  private particles!: Particles;
  private typeMeshes = new Map<string, THREE.InstancedMesh>();
  private typeGeoms = new Map<string, THREE.BufferGeometry>([
    ['dust-sprite', dustSpriteGeometry()],
    ['oryx', oryxGeometry()],
    ['evil-genie', genieGeometry(EVIL_GENIE)],
    ['tide-djinn', genieGeometry(TIDE_DJINN)],
    ['canyon-wraith', wraithGeometry(CANYON_WRAITH)],
    ['sand-wraith', wraithGeometry(SAND_WRAITH)],
    ['ruin-golem', golemGeometry()],
    ['cloud-serpent', serpentGeometry()],
    ['palace-guardian', guardianGeometry()],
    ['stone-bat', batGeometry()],
    ['ibex', oryxGeometry()], // same silhouette, rose tint from creatures.json
    ['gazelle', oryxGeometry()], // golden tint
    ['dove', gullGeometry()], // sunset-pink tint
    ['night-gull', gullGeometry()],
  ]);
  private creatureMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  private wellViews: WellView[] = [];
  private beamTex = makeBeamTexture();
  private dummy = new THREE.Object3D();
  private tint = new THREE.Color();
  private baseTint = new THREE.Color();
  private flashScale = 1;
  private nearest: number[] = [];
  private nearDist: number[] = [];
  private seed = 1234567;
  private quality: QualityPreset;
  private structures!: StructureRenderer;
  private sim: Sim | null = null;
  /** Supplies lit lighthouses/lanterns near the camera (set by the game renderer). */
  beaconSource: (() => Beacon[]) | null = null;
  private waterLevel = -1e9;
  /** Clouds do not mirror lanterns. */
  private cloudSea = false;

  constructor(quality: QualityPreset, private chapter: ChapterConfig) {
    this.quality = quality;
    this.waterLevel = chapter.terrain.waterLevel;
    this.cloudSea = !!chapter.palette.cloudSea;
    this.build();
    for (let i = 0; i < simData.caps.wells; i++) this.wellViews.push(this.makeWell());
  }

  /** Visual-only randomness (not the sim PRNG). */
  private rnd = (): number => {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  };

  setReducedFlashing(on: boolean): void {
    this.flashScale = on ? 0.5 : 1;
  }

  setQuality(q: QualityPreset): void {
    this.quality = q;
    this.group.remove(this.glow.points, ...this.typeMeshes.values(), this.structures.group);
    this.glow.dispose();
    for (const m of this.typeMeshes.values()) m.dispose();
    this.typeMeshes.clear();
    this.structures.dispose();
    this.build();
  }

  private build(): void {
    const caps = PRESETS[this.quality].caps;
    this.glow = new GlowLayer(caps.orbs + caps.projectiles * 8 + caps.particles + 64);
    this.particles = new Particles(caps.particles);
    for (const [type, geom] of this.typeGeoms) {
      const mesh = new THREE.InstancedMesh(geom, this.creatureMat, Math.min(caps.creatures, simData.caps.creatures));
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.typeMeshes.set(type, mesh);
    }
    this.structures = new StructureRenderer(this.chapter, caps.archers);
    this.group.add(this.glow.points, ...this.typeMeshes.values(), this.structures.group);
  }

  private makeWell(): WellView {
    const group = new THREE.Group();
    group.visible = false;
    const stone = new THREE.Mesh(new THREE.CylinderGeometry(5.4, 6.2, 0.9, 14), new THREE.MeshLambertMaterial({ color: '#d9c29a' }));
    stone.position.y = 0.3;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(4.2, 0.42, 6, 20), new THREE.MeshBasicMaterial({ color: '#7ee8ff' }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 1.1;
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(4.0, 20),
      new THREE.MeshBasicMaterial({ color: '#3fc8ff', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 1.0;
    const beamMat = new THREE.MeshBasicMaterial({
      map: this.beamTex, color: '#46d4ff', transparent: true, opacity: 0.6,
      depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.4, 110, 14, 1, true), beamMat);
    beam.position.y = 55;
    group.add(stone, ring, glow, beam);
    this.group.add(group);
    return { group, beam, beamMat, ring, glow, id: 0 };
  }

  private elementOf(owner: number): Element {
    return this.sim?.players[owner]?.element ?? 'fire';
  }

  private tierOf(owner: number): number {
    return this.sim?.players[owner]?.spellTier ?? 1;
  }

  /** A flat expanding ring of particles (shockwave). `alt` alternates a second colour. */
  private ring(x: number, y: number, z: number, r0: number, speed: number, count: number, rgb: readonly [number, number, number], alt: readonly [number, number, number] | null): void {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const c = alt && i % 2 ? alt : rgb;
      this.particles.spawn(x + Math.cos(a) * r0 * 0.3, y, z + Math.sin(a) * r0 * 0.3, Math.cos(a) * speed, 0.6, Math.sin(a) * speed, 0.5, 2.2 * this.flashScale, c[0], c[1], c[2]);
    }
  }

  /** Turn a sim event into particles. Audio/HUD consume the same events elsewhere. */
  handleEvent(e: SimEvent): void {
    const P = this.particles;
    const f = this.flashScale;
    const n = (c: number) => Math.max(1, Math.round(c * (f < 1 ? 0.6 : 1)));
    switch (e.type) {
      case 'cast': {
        const el = this.elementOf(e.v);
        const tier = this.tierOf(e.v);
        P.burst(this.rnd, n(10 + (tier - 1) * 8), e.x, e.y, e.z, el === 'air' ? 14 : 9, 0.35, (1.1 + (tier - 1) * 0.5) * f, ...ELEMENT_RGB[el]!);
        if (tier >= 2) this.ring(e.x, e.y, e.z, 3 + tier * 1.5, 8 + tier * 3, n(10 + tier * 4), ELEMENT_RGB[el]!, tier === 3 ? WHITE_HOT : null);
        break;
      }
      case 'impact': {
        if (e.v < 0) {
          P.burst(this.rnd, n(10), e.x, e.y + 0.5, e.z, 9, 0.5, 1.4 * f, ...CURSE, 4, 0.4);
          break;
        }
        const el = this.elementOf(e.v);
        const tier = this.tierOf(e.v);
        if (tier >= 2) {
          // Upgraded weapons land harder: an expanding shockwave ring in the element's colour, doubled at tier 3.
          this.ring(e.x, e.y + 0.4, e.z, 5 + tier * 2, 10 + tier * 5, n(14 + tier * 8), ELEMENT_RGB[el]!, tier === 3 ? WHITE_HOT : null);
          if (tier === 3) this.ring(e.x, e.y + 1.2, e.z, 3, 16, n(22), ELEMENT_RGB[el]!, null);
        }
        if (el === 'water') {
          P.burst(this.rnd, n(24), e.x, e.y + 0.5, e.z, 14, 0.7, 1.4 * f, ...ICE, 8, 0.5);
          P.burst(this.rnd, n(10), e.x, e.y + 0.5, e.z, 6, 0.9, 2.6, ...FROST_WHITE, 2, 0.8);
        } else if (el === 'earth') {
          P.burst(this.rnd, n(26), e.x, e.y + 0.5, e.z, 13, 1.0, 3.4, ...ROCK, 14, 0.6);
          P.burst(this.rnd, n(14), e.x, e.y + 0.5, e.z, 7, 1.4, 4.8, ...DUST, -1, 0.5);
        } else if (el === 'air') {
          P.burst(this.rnd, n(18), e.x, e.y + 0.5, e.z, 20, 0.35, 1.2 * f, ...SPARK, 0, 0.2);
          P.burst(this.rnd, n(6), e.x, e.y + 0.5, e.z, 6, 0.25, 3.2 * f, 1, 1, 1);
        } else {
          P.burst(this.rnd, n(26), e.x, e.y + 0.5, e.z, 17, 0.7, 1.5 * f, ...EMBER, 10, 0.5);
          P.burst(this.rnd, n(10), e.x, e.y + 0.5, e.z, 7, 1.0, 3.2, ...DUST, -1, 0.7);
          P.burst(this.rnd, n(8), e.x, e.y + 1, e.z, 12, 0.5, 2.4 * f, ...FIRE, 4, 0.2);
        }
        break;
      }
      case 'chain': {
        // A jagged arc between two targets in the caster's element colour.
        const rgb = ELEMENT_RGB[this.elementOf(e.v)]!;
        const steps = 12;
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const j = (i === 0 || i === steps ? 0 : 1) * 1.4;
          P.spawn(e.x + (e.x2 - e.x) * t + (this.rnd() - 0.5) * j, e.y + (e.y2 - e.y) * t + (this.rnd() - 0.5) * j, e.z + (e.z2 - e.z) * t + (this.rnd() - 0.5) * j, 0, 0, 0, 0.22 + 0.1 * this.rnd(), 1.5 * f, rgb[0], rgb[1], rgb[2]);
        }
        break;
      }
      case 'nova':
        for (let i = 0; i < n(56); i++) {
          const a = (i / n(56)) * Math.PI * 2;
          const c = i % 3 ? ICE : FROST_WHITE;
          P.spawn(e.x, e.y, e.z, Math.cos(a) * e.v * 1.7, 2 + this.rnd() * 3, Math.sin(a) * e.v * 1.7, 0.7, 2.4, c[0], c[1], c[2]);
        }
        break;
      case 'wallRaised':
        P.burst(this.rnd, n(40), e.x, e.y + 1, e.z, 12, 1.1, 4.2, ...DUST, -4, 0.8);
        P.burst(this.rnd, n(18), e.x, e.y + 2, e.z, 9, 1.0, 3.0, ...ROCK, 10, 1.0);
        break;
      case 'dash':
        P.burst(this.rnd, n(34), e.x, e.y, e.z, 26, 0.6, 1.8 * f, ...SPARK, 0, 0.2);
        break;
      case 'zoneStart':
        P.burst(this.rnd, n(40), e.x, e.y + 1, e.z, 18, 0.9, 2.4 * f, ...FIRE, -2, 0.9);
        break;
      case 'quake':
        for (let i = 0; i < n(36); i++) {
          const a = (i / n(36)) * Math.PI * 2;
          P.spawn(e.x, e.y + 0.5, e.z, Math.cos(a) * e.v * 1.6, 3 + this.rnd() * 3, Math.sin(a) * e.v * 1.6, 0.8, 3.6, ...DUST);
        }
        P.burst(this.rnd, n(16), e.x, e.y + 1, e.z, 10, 1.0, 4.4, ...ROCK, 10, 0.9);
        break;
      case 'hit':
        P.burst(this.rnd, n(6), e.x, e.y, e.z, 9, 0.35, 1.1 * f, 1, 0.95, 0.8);
        break;
      case 'kill':
        P.burst(this.rnd, n(16), e.x, e.y, e.z, 9, 0.9, 2.8, ...DUST, -2, 0.3);
        P.burst(this.rnd, n(10), e.x, e.y, e.z, 12, 0.8, 1.5 * f, ...MANA);
        break;
      case 'orb':
        P.burst(this.rnd, n(5), e.x, e.y, e.z, 6, 0.35, 1.0, ...MANA);
        break;
      case 'playerHit':
        P.burst(this.rnd, n(10), e.x, e.y, e.z, 8, 0.45, 1.5 * f, ...RED);
        break;
      case 'respawn':
        P.burst(this.rnd, n(30), e.x, e.y, e.z, 16, 1.0, 1.8 * f, ...GOLD, -3, 0.5);
        break;
      case 'wellSpawn':
        P.burst(this.rnd, n(46), e.x, e.y + 2, e.z, 26, 1.2, 2.4 * f, ...MANA, 0, 1);
        break;
      case 'wellEnd':
        P.burst(this.rnd, n(30), e.x, e.y + 2, e.z, 14, 1.0, 2.0, ...MANA, -4, 0.6);
        break;
      case 'arrow': {
        // A short bright streak from the archer to its target.
        const steps = 7;
        for (let i = 0; i < steps; i++) {
          const t = i / (steps - 1);
          P.spawn(e.x + (e.x2 - e.x) * t, e.y + (e.y2 - e.y) * t, e.z + (e.z2 - e.z) * t, 0, 0, 0, 0.1 + 0.2 * t, 0.9, 1, 0.95, 0.75);
        }
        break;
      }
      case 'combo': {
        // 0 steam, 1 fire tornado, 2 earth channel (see COMBOS in combos.ts)
        if (e.v === 0) {
          P.burst(this.rnd, n(40), e.x, e.y + 1, e.z, 12, 1.4, 4.2, 0.92, 0.94, 0.97, 4, 0.8);
          P.burst(this.rnd, n(16), e.x, e.y + 1, e.z, 8, 1.0, 2.0 * f, ...ICE, 6, 0.5);
        } else if (e.v === 1) {
          P.burst(this.rnd, n(36), e.x, e.y + 1, e.z, 16, 1.0, 3.0 * f, ...FIRE, 10, 0.9);
          P.burst(this.rnd, n(20), e.x, e.y + 2, e.z, 10, 0.9, 2.4 * f, ...SPARK, 6, 0.6);
        } else {
          P.burst(this.rnd, n(26), e.x, e.y, e.z, 14, 0.8, 1.8 * f, ...ICE, 4, 0.4);
          P.burst(this.rnd, n(12), e.x, e.y, e.z, 8, 0.8, 2.6, ...ROCK, 6, 0.5);
        }
        break;
      }
      case 'castleRelease':
        P.burst(this.rnd, n(30), e.x, e.y, e.z, 18, 1.2, 2.2 * f, ...MANA, 8, 0.8);
        P.burst(this.rnd, n(16), e.x, e.y, e.z, 14, 1.0, 3.4, ...DUST, 4, 0.4);
        break;
      case 'castleHit':
        P.burst(this.rnd, n(8), e.x, e.y, e.z, 10, 0.5, 2.0 * f, ...DUST, 6, 0.4);
        break;
      case 'upgrade':
        P.burst(this.rnd, n(50), e.x, e.y + 8, e.z, 22, 1.4, 2.6 * f, ...GOLD, -2, 0.8);
        P.burst(this.rnd, n(24), e.x, e.y + 4, e.z, 14, 1.2, 3.0, ...MANA, 0, 0.5);
        break;
      case 'castleDowngrade':
        P.burst(this.rnd, n(40), e.x, e.y, e.z, 20, 1.4, 4.5, ...DUST, -2, 0.4);
        P.burst(this.rnd, n(20), e.x, e.y, e.z, 18, 0.9, 2.4 * f, ...FIRE, 6, 0.5);
        break;
      case 'castleDestroyed':
        P.burst(this.rnd, n(70), e.x, e.y, e.z, 26, 1.8, 5.0, ...DUST, -2, 0.5);
        P.burst(this.rnd, n(50), e.x, e.y, e.z, 24, 1.2, 2.8 * f, ...FIRE, 6, 0.6);
        break;
      case 'nestDestroyed':
        P.burst(this.rnd, n(30), e.x, e.y, e.z, 16, 1.0, 3.0, ...DUST, -2, 0.4);
        P.burst(this.rnd, n(18), e.x, e.y, e.z, 14, 1.0, 2.0 * f, ...GOLD, -2, 0.7);
        break;
      case 'monsterFire':
        P.burst(this.rnd, n(6), e.x, e.y, e.z, 7, 0.35, 1.4 * f, ...CURSE);
        break;
      case 'bounty':
        P.burst(this.rnd, n(40), e.x, e.y + 2, e.z, 20, 1.3, 2.4 * f, ...GOLD, -2, 0.9);
        break;
      case 'spellUpgrade':
        P.burst(this.rnd, n(36), e.x, e.y + 1, e.z, 18, 1.1, 2.2 * f, ...FIRE, -2, 0.7);
        P.burst(this.rnd, n(16), e.x, e.y + 1, e.z, 12, 1.0, 1.6 * f, ...WHITE_HOT, 0, 0.5);
        break;
      case 'wizardDown':
        P.burst(this.rnd, n(24), e.x, e.y, e.z, 12, 0.9, 2.6, ...DUST, -2, 0.2);
        break;
      default:
        break;
    }
  }

  /** Draw everything for this frame. */
  update(sim: Sim, alpha: number, dt: number, time: number, pxScale: number, camX: number, camZ: number): void {
    this.sim = sim;
    const caps = PRESETS[this.quality].caps;
    const glow = this.glow;
    glow.begin();
    const lerp = (a: number, b: number) => a + (b - a) * alpha;

    // Mana orbs (nearest first when over the preset's draw cap).
    const orbs = sim.orbs;
    const drawOrb = (i: number) => {
      const o = orbs[i]!;
      const bob = Math.sin(time * 2.2 + o.id) * 0.35;
      const pulse = 0.85 + 0.15 * Math.sin(time * 4 + o.id * 1.7);
      glow.add(lerp(o.px, o.x), lerp(o.py, o.y) + bob, lerp(o.pz, o.z), MANA[0], MANA[1], MANA[2], 0.95 * pulse, 2.6);
    };
    if (orbs.length <= caps.orbs) for (let i = 0; i < orbs.length; i++) drawOrb(i);
    else {
      this.nearest.length = 0;
      this.nearDist.length = 0;
      for (let i = 0; i < orbs.length; i++) {
        this.nearest.push(i);
        const dx = orbs[i]!.x - camX;
        const dz = orbs[i]!.z - camZ;
        this.nearDist[i] = dx * dx + dz * dz;
      }
      this.nearest.sort((a, b) => this.nearDist[a]! - this.nearDist[b]!);
      for (let k = 0; k < caps.orbs; k++) drawOrb(this.nearest[k]!);
    }

    // Projectiles: hot core plus a particle trail.
    const projs = sim.projectiles;
    for (let i = 0; i < Math.min(projs.length, caps.projectiles); i++) {
      const p = projs[i]!;
      const x = lerp(p.px, p.x);
      const y = lerp(p.py, p.y);
      const z = lerp(p.pz, p.z);
      const mb = MONSTER_BOLTS[p.spell];
      if (mb) {
        glow.add(x, y, z, mb.glow[0], mb.glow[1], mb.glow[2], 1, 3.4);
        glow.add(x, y, z, mb.core[0], mb.core[1], mb.core[2], 1, 1.5);
        this.particles.spawn(x, y, z, (this.rnd() - 0.5) * 2, this.rnd() * 2, (this.rnd() - 0.5) * 2, 0.3, 1.8 * this.flashScale, mb.trail[0], mb.trail[1], mb.trail[2], 0);
        continue;
      }
      const tier = p.tier ?? 1;
      const big = 1 + (tier - 1) * 0.45;
      const el = this.elementOf(p.owner);
      // Each tier has its own look: tier 2 adds orbiting satellites and a denser trail, tier 3 a
      // white-hot core, a wider satellite ring, a halo and a heavy trail.
      const ph = time * (5 + tier * 2) + p.id * 1.7;
      const sat = (count: number, radius: number, rgb: readonly [number, number, number], size: number, lift = 0) => {
        for (let k = 0; k < count; k++) {
          const a = ph + (k / count) * Math.PI * 2;
          glow.add(x + Math.cos(a) * radius, y + Math.sin(a * 1.3) * radius * 0.6 + lift, z + Math.sin(a) * radius, rgb[0], rgb[1], rgb[2], 0.9, size);
        }
      };
      const trailN = tier === 1 ? 1 : tier === 2 ? 2 : 4;
      if (el === 'water') {
        glow.add(x, y, z, ICE[0], ICE[1], ICE[2], 1, 3.8 * big);
        glow.add(x, y, z, 1, 1, 1, 1, 1.7 * big);
        // Crystal shards spiral round the bolt: 2 at tier 2, 5 at tier 3 (with a pale halo).
        if (tier >= 2) sat(tier === 2 ? 2 : 5, 1.6 + tier * 0.5, FROST_WHITE, 1.3);
        if (tier === 3) glow.add(x, y, z, 0.7, 0.95, 1, 0.5, 8);
        for (let k = 0; k < trailN; k++) this.particles.spawn(x, y, z, (this.rnd() - 0.5) * 3, this.rnd() * 2, (this.rnd() - 0.5) * 3, 0.4, 1.8 * big * this.flashScale, FROST_WHITE[0], FROST_WHITE[1], FROST_WHITE[2], 0);
      } else if (el === 'earth') {
        glow.add(x, y, z, ROCK[0], ROCK[1], ROCK[2], 1, 5.2 * big);
        glow.add(x, y, z, 0.9, 0.75, 0.5, 1, 2.6 * big);
        // Rock chips tumble around it (2 / 5) and tier 3 glows with molten seams.
        if (tier >= 2) sat(tier === 2 ? 2 : 5, 2.4 + tier * 0.7, ROCK, 1.8);
        if (tier === 3) glow.add(x, y, z, 1, 0.5, 0.2, 0.7, 7);
        for (let k = 0; k < trailN; k++) this.particles.spawn(x, y, z, (this.rnd() - 0.5) * 4, this.rnd() * 2, (this.rnd() - 0.5) * 4, 0.55, 3.0 * big, DUST[0], DUST[1], DUST[2], 4);
      } else if (el === 'air') {
        // A long streak: bright points along the path travelled since the last frame.
        const len = 6 + (tier - 1) * 3;
        for (let k = 0; k < len; k++) {
          const t = k / (len - 1);
          glow.add(x - p.vx * 0.03 * t * (1 + (tier - 1) * 0.5), y - p.vy * 0.03 * t * (1 + (tier - 1) * 0.5), z - p.vz * 0.03 * t * (1 + (tier - 1) * 0.5), 0.8, 0.9, 1, 1 - t * 0.6, 2.4 * big * (1 - t * 0.4));
        }
        // Forks: jittering side-arcs (tier 2), a double bolt with a flash halo (tier 3).
        if (tier >= 2) {
          const j = tier === 2 ? 1.6 : 2.4;
          for (let k = 0; k < tier + 1; k++) {
            const t = this.rnd();
            glow.add(x - p.vx * 0.03 * t * 3 + (this.rnd() - 0.5) * j * 2, y - p.vy * 0.03 * t * 3 + (this.rnd() - 0.5) * j * 2, z - p.vz * 0.03 * t * 3 + (this.rnd() - 0.5) * j * 2, 1, 1, 1, 0.9, 1.4);
          }
        }
        if (tier === 3) glow.add(x, y, z, 0.6, 0.75, 1, 0.55, 9);
        for (let k = 0; k < trailN; k++) this.particles.spawn(x, y, z, (this.rnd() - 0.5) * 2, (this.rnd() - 0.5) * 2, (this.rnd() - 0.5) * 2, 0.18, 1.4 * this.flashScale, SPARK[0], SPARK[1], SPARK[2], 0);
      } else {
        const hot = tier === 3 ? WHITE_HOT : FIRE;
        glow.add(x, y, z, hot[0], hot[1], hot[2], 1, 4.2 * big);
        glow.add(x, y, z, 1, 0.95, 0.7, 1, 1.9 * big);
        // Embers circle the fireball (2 / 4) and the inferno orb has a red halo and a flame tail.
        if (tier >= 2) sat(tier === 2 ? 2 : 4, 1.8 + tier * 0.6, EMBER, 1.6);
        if (tier === 3) glow.add(x, y, z, 1, 0.25, 0.1, 0.55, 10);
        for (let k = 0; k < trailN; k++) this.particles.spawn(x, y, z, (this.rnd() - 0.5) * 3, this.rnd() * 2, (this.rnd() - 0.5) * 3, 0.32 + 0.05 * tier, 2.0 * big * this.flashScale, FIRE[0], FIRE[1], FIRE[2], 0);
      }
    }

    // Lasting zones: Firestorm burns with rising flames; a pending aftershock pulses.
    for (const zn of sim.zones) {
      if (zn.combo === 'steam') {
        // A thick, slowly rising cloud of pale steam.
        for (let k = 0; k < 4 + Math.floor(zn.r / 5); k++) {
          const a = this.rnd() * Math.PI * 2;
          const rr = Math.sqrt(this.rnd()) * zn.r;
          this.particles.spawn(zn.x + Math.cos(a) * rr, zn.y + 1 + this.rnd() * 4, zn.z + Math.sin(a) * rr, 0, 2 + this.rnd() * 3, 0, 1.1, 5.5 * this.flashScale, 0.9, 0.93, 0.97, 0);
        }
        glow.add(zn.x, zn.y + 3, zn.z, 0.85, 0.9, 0.95, 0.35, zn.r * 0.8);
      } else if (zn.combo === 'firetornado') {
        // A whirling column of flame that leans along its drift.
        for (let k = 0; k < 8; k++) {
          const h = this.rnd() * 18;
          const a = time * 7 + h * 0.5 + k;
          const rr = 1.5 + h * 0.35;
          this.particles.spawn(zn.x + Math.cos(a) * rr, zn.y + h, zn.z + Math.sin(a) * rr, Math.cos(a + 1.57) * 6, 4, Math.sin(a + 1.57) * 6, 0.5, 2.8 * this.flashScale, FIRE[0], FIRE[1] * (0.6 + 0.5 * this.rnd()), FIRE[2], 0);
        }
        glow.add(zn.x, zn.y + 6, zn.z, FIRE[0], FIRE[1], FIRE[2], 0.55, zn.r * 1.2);
      } else if (zn.dps > 0) {
        const count = 3 + Math.floor(zn.r / 4);
        for (let k = 0; k < count; k++) {
          const a = this.rnd() * Math.PI * 2;
          const rr = Math.sqrt(this.rnd()) * zn.r;
          this.particles.spawn(zn.x + Math.cos(a) * rr, zn.y + 0.5, zn.z + Math.sin(a) * rr, 0, 7 + this.rnd() * 6, 0, 0.7 + this.rnd() * 0.4, 2.6 * this.flashScale, FIRE[0], FIRE[1] * (0.7 + 0.5 * this.rnd()), FIRE[2], 0);
        }
        glow.add(zn.x, zn.y + 1.5, zn.z, FIRE[0], FIRE[1], FIRE[2], 0.5, zn.r * 0.9);
      } else {
        const pulse = 0.4 + 0.4 * Math.sin(time * 18);
        glow.add(zn.x, zn.y + 1, zn.z, ROCK[0], ROCK[1], ROCK[2], pulse, zn.r * 0.5);
      }
    }

    // Status effects on wizards: burning, frozen, slowed, dashing.
    for (const w of sim.players) {
      if (!w.active) continue;
      if (w.burnTicks > 0 && this.rnd() < 0.7) this.particles.spawn(w.x, w.y + 1.5, w.z, 0, 4, 0, 0.5, 1.8 * this.flashScale, FIRE[0], FIRE[1], FIRE[2]);
      if (w.freezeTicks > 0) {
        glow.add(w.x, w.y + 1.5, w.z, ICE[0], ICE[1], ICE[2], 0.8, 7);
        if (this.rnd() < 0.5) this.particles.spawn(w.x + (this.rnd() - 0.5) * 3, w.y + 2, w.z + (this.rnd() - 0.5) * 3, 0, 1, 0, 0.6, 1.4, FROST_WHITE[0], FROST_WHITE[1], FROST_WHITE[2]);
      } else if (w.slowTicks > 0 && this.rnd() < 0.35) {
        this.particles.spawn(w.x + (this.rnd() - 0.5) * 3, w.y + 1, w.z + (this.rnd() - 0.5) * 3, 0, -1, 0, 0.5, 1.2, ICE[0], ICE[1], ICE[2]);
      }
      if (w.boostTicks > 0) {
        this.particles.spawn(w.x - w.vx * 0.04, w.y + 1, w.z - w.vz * 0.04, -w.vx * 0.2, 0, -w.vz * 0.2, 0.4, 2.2 * this.flashScale, SPARK[0], SPARK[1], SPARK[2]);
      }
    }

    // Creatures (instanced, one mesh per type).
    const cs = sim.creatures;
    const counts = new Map<string, number>();
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i]!;
      const mesh = this.typeMeshes.get(c.type);
      if (!mesh) continue;
      const idx = counts.get(c.type) ?? 0;
      if (idx >= mesh.instanceMatrix.count) continue;
      counts.set(c.type, idx + 1);
      const x = lerp(c.px, c.x);
      const y = lerp(c.py, c.y);
      const z = lerp(c.pz, c.z);
      this.dummy.position.set(x, y, z);
      const heading = Math.atan2(c.vx, c.vz);
      const look = MOTION[c.type] ?? { motion: 'walker' as Motion, scale: 1.5 };
      const scale = look.scale;
      if (look.motion === 'sprite') this.dummy.rotation.set(0, heading + Math.sin(time * 3 + c.id) * 0.4, Math.sin(time * 5 + c.id) * 0.08);
      else if (look.motion === 'caster') {
        // Faces the nearest wizard while circling; sways like smoke.
        let face = heading;
        let bd = Infinity;
        for (const p of sim.players) {
          const d = (p.x - x) ** 2 + (p.z - z) ** 2;
          if (p.active && d < bd) {
            bd = d;
            face = Math.atan2(p.x - x, p.z - z);
          }
        }
        this.dummy.rotation.set(0, face, Math.sin(time * 2.2 + c.id) * 0.1);
        this.dummy.position.y += Math.sin(time * 2.6 + c.id) * 0.5;
      } else if (look.motion === 'golem') {
        // Slow, heavy sway; floats a little and faces the nearest wizard.
        let face = heading;
        let bd = Infinity;
        for (const p of sim.players) {
          const d = (p.x - x) ** 2 + (p.z - z) ** 2;
          if (p.active && d < bd) {
            bd = d;
            face = Math.atan2(p.x - x, p.z - z);
          }
        }
        this.dummy.rotation.set(0, face, Math.sin(time * 1.3 + c.id) * 0.06);
        this.dummy.position.y += Math.sin(time * 1.8 + c.id) * 0.35;
        if (c.state === 1 && this.rnd() < 0.15) this.particles.spawn(x, y, z, (this.rnd() - 0.5) * 3, -0.5, (this.rnd() - 0.5) * 3, 0.8, 2, DUST[0], DUST[1], DUST[2]);
      } else if (look.motion === 'serpent') {
        // Slithers: the whole body weaves left and right along its heading.
        this.dummy.rotation.set(Math.sin(time * 2.2 + c.id) * 0.15, heading + Math.sin(time * 4 + c.id) * 0.35, Math.sin(time * 3 + c.id) * 0.25);
        this.dummy.position.y += Math.sin(time * 2.6 + c.id) * 0.6;
      } else if (look.motion === 'flier') {
        // Banks into turns and flaps (rolls) as it flies.
        this.dummy.rotation.set(Math.sin(time * 4 + c.id) * 0.1, heading, Math.sin(time * (c.type === 'stone-bat' ? 17 : 9) + c.id * 1.3) * 0.45);
        this.dummy.position.y += Math.sin(time * 3 + c.id) * 0.4;
      } else {
        this.dummy.rotation.set(0, heading, 0);
        this.dummy.position.y += Math.abs(Math.sin(time * 9 + c.id)) * (c.state === 1 ? 0.5 : 0.08); // gallop bounce
      }
      this.dummy.scale.setScalar(scale);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(idx, this.dummy.matrix);
      if (c.freezeTicks > 0) this.tint.setRGB(0.6, 1.0, 1.9);
      else if (c.burnTicks > 0) this.tint.setRGB(1.8, 0.8, 0.45);
      else if (c.slowTicks > 0) this.tint.setRGB(0.8, 1.0, 1.4);
      else this.tint.setRGB(1, 1, 1);
      const base = CREATURES[c.type]?.tint;
      if (base) this.tint.multiply(this.baseTint.setRGB(base[0], base[1], base[2]));
      mesh.setColorAt(idx, this.tint);
      if (look.eye) {
        // Menacing eye-glow and a trail of smoke.
        const e = look.eye;
        glow.add(x, y + (look.eyeY ?? 3.9) * scale, z, e[0], e[1], e[2], 0.7 + 0.3 * Math.sin(time * 6 + c.id), 2.4);
        const sm = look.smoke ?? [0.35, 0.25, 0.6];
        if (this.rnd() < 0.35) this.particles.spawn(x, y - 0.5, z, (this.rnd() - 0.5) * 2, -1, (this.rnd() - 0.5) * 2, 0.7, 2.4, sm[0], sm[1], sm[2]);
      }
      if (c.burnTicks > 0 && this.rnd() < 0.5) this.particles.spawn(x, y + 1, z, 0, 3, 0, 0.5, 1.6 * this.flashScale, FIRE[0], FIRE[1], FIRE[2]);
    }
    for (const [type, mesh] of this.typeMeshes) {
      mesh.count = counts.get(type) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    // Wells: beacon beam, spinning ring, and a stream of mana flowing to a drawing player.
    for (let i = 0; i < this.wellViews.length; i++) {
      const v = this.wellViews[i]!;
      const w = sim.wells[i];
      if (!w) {
        v.group.visible = false;
        continue;
      }
      v.group.visible = true;
      v.id = w.id;
      const life = w.fade > 0 ? w.fade / simData.wells.fadeTicks : 1;
      const fill = 0.25 + 0.75 * (w.reserve / w.max);
      v.group.position.set(w.x, w.y, w.z);
      v.group.scale.set(1, 1, 1).multiplyScalar(0.6 + 0.4 * life);
      v.beamMat.opacity = (0.5 + 0.2 * Math.sin(time * 2.4 + w.id)) * fill * life;
      v.beam.scale.set(0.8 + 0.2 * fill, 1, 0.8 + 0.2 * fill);
      v.ring.rotation.z = time * 0.8;
      if (this.rnd() < 0.6) {
        const a = this.rnd() * 6.2831853;
        this.particles.spawn(w.x + Math.cos(a) * 4.2, w.y + 1.2, w.z + Math.sin(a) * 4.2, 0, 6 + this.rnd() * 5, 0, 1.3, 1.6, MANA[0], MANA[1], MANA[2]);
      }
    }
    for (const p of sim.players) {
      if (!p.drawing) continue;
      const w = sim.wells.find((q) => q.id === p.drawing);
      if (!w) continue;
      for (let k = 0; k < 2; k++) {
        const t = this.rnd();
        const sx = w.x + (this.rnd() - 0.5) * 3;
        const sz = w.z + (this.rnd() - 0.5) * 3;
        const x = sx + (p.x - sx) * t;
        const z = sz + (p.z - sz) * t;
        const y = w.y + 2 + (p.y - w.y - 2) * t + Math.sin(t * 3.14159) * 3;
        this.particles.spawn(x, y, z, (p.x - x) * 1.2, (p.y - y) * 1.2, (p.z - z) * 1.2, 0.5, 2.2, MANA[0], MANA[1], MANA[2]);
      }
    }

    this.drawBeacons(glow, time, camX, camZ);
    this.structures.update(sim, camX, camZ, time, glow);
    this.particles.update(dt, glow);
    glow.end(pxScale);
  }

  /** Lighthouse sweeps and harbour lanterns, with a wobbling mirror image on the water. */
  private drawBeacons(glow: GlowLayer, time: number, camX: number, camZ: number): void {
    if (!this.beaconSource) return;
    const water = this.waterLevel;
    for (const b of this.beaconSource()) {
      const d2 = (b.x - camX) ** 2 + (b.z - camZ) ** 2;
      const far = b.kind === 'lighthouse' ? 520 : 240;
      if (d2 > far * far) continue;
      const flicker = b.kind === 'lighthouse' ? 0.85 + 0.15 * Math.sin(time * 2) : 0.75 + 0.25 * Math.sin(time * 7 + b.x * 0.3);
      glow.add(b.x, b.y, b.z, b.color[0], b.color[1], b.color[2], flicker, b.size);
      glow.add(b.x, b.y, b.z, 1, 1, 0.9, flicker, b.size * 0.4);
      if (b.kind === 'lighthouse') {
        // A slow sweeping beam: a line of fading points, seen best when it points at the camera.
        const a = time * 0.7;
        const dx = Math.cos(a);
        const dz = Math.sin(a);
        for (let k = 1; k <= 9; k++) glow.add(b.x + dx * k * 9, b.y - k * 0.25, b.z + dz * k * 9, b.color[0], b.color[1], b.color[2], 0.6 - k * 0.05, 7 - k * 0.4);
      }
      if (b.y > water + 1 && water > -1e8 && !this.cloudSea) {
        const my = 2 * water - b.y;
        const wob = Math.sin(time * 1.7 + b.x) * 0.8;
        glow.add(b.x + wob, my, b.z, b.color[0], b.color[1], b.color[2], flicker * 0.35, b.size * 1.1);
        glow.add(b.x - wob, my - 1.2, b.z, b.color[0], b.color[1], b.color[2], flicker * 0.18, b.size * 0.8);
      }
    }
  }

  get particleCount(): number {
    return this.particles.count;
  }

  dispose(): void {
    this.glow.dispose();
    for (const m of this.typeMeshes.values()) m.dispose();
    for (const g of this.typeGeoms.values()) g.dispose();
    this.structures.dispose();
    this.creatureMat.dispose();
    this.beamTex.dispose();
    for (const v of this.wellViews) {
      v.group.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        (m.material as THREE.Material | undefined)?.dispose();
      });
    }
  }
}
