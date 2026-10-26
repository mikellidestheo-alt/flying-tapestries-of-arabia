// Draws sim entities (orbs, bolts, creatures, wells) and spell/impact VFX.
// Reads sim state and events; never mutates the sim.
import * as THREE from 'three';
import simData from '../data/sim.json';
import { PRESETS } from './quality';
import type { QualityPreset } from '../save';
import type { SimEvent } from '../sim/entities';
import type { Sim } from '../sim/sim';
import { GlowLayer } from './glowLayer';
import { MergeBuilder } from './mergeBuilder';
import { Particles } from './particles';
import type { ChapterConfig } from '../data/chapters';
import { StructureRenderer } from './structureRenderer';

const MANA = [0.35, 0.85, 1.0] as const;
const FIRE = [1.0, 0.55, 0.18] as const;
const EMBER = [1.0, 0.82, 0.4] as const;
const DUST = [0.85, 0.7, 0.45] as const;
const GOLD = [1.0, 0.85, 0.4] as const;
const RED = [1.0, 0.25, 0.2] as const;
const WHITE_HOT = [1.0, 0.85, 0.5] as const;
const CURSE = [0.65, 0.25, 0.95] as const;

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

/** Evil genie: smoky tail, muscled torso with gold armlets, horned black turban, glowing red eyes. */
function genieGeometry(): THREE.BufferGeometry {
  const b = new MergeBuilder();
  const smoke = '#4a3f9a';
  const skin = '#5a6fd0';
  b.add(new THREE.ConeGeometry(1.3, 3.6, 9), smoke, [0, 0.6, 0], [Math.PI, 0, 0]); // wispy tail, tip down
  b.add(new THREE.ConeGeometry(0.8, 2.2, 7), '#2f2872', [0.35, -0.5, 0.1], [Math.PI, 0.4, 0.3]); // curling wisp
  b.add(new THREE.CylinderGeometry(1.15, 0.9, 1.7, 9), skin, [0, 2.4, 0]); // torso
  b.add(new THREE.CylinderGeometry(1.2, 1.2, 0.35, 9), '#e8b83a', [0, 1.8, 0]); // gold sash
  for (const sx of [-1, 1]) {
    b.add(new THREE.CylinderGeometry(0.32, 0.26, 1.7, 6), skin, [sx * 1.35, 2.4, 0.5], [-0.9, 0, sx * -0.35]); // arms forward
    b.add(new THREE.CylinderGeometry(0.4, 0.4, 0.3, 6), '#e8b83a', [sx * 1.55, 2.0, 0.95], [-0.9, 0, sx * -0.35]); // armlets
    b.add(new THREE.SphereGeometry(0.4, 6, 5), '#7a8be8', [sx * 1.7, 1.8, 1.4]); // hands
  }
  b.add(new THREE.SphereGeometry(0.78, 9, 7), skin, [0, 3.85, 0.1]); // head
  b.add(new THREE.ConeGeometry(0.2, 0.55, 4), '#2a1f1a', [0, 3.35, 0.7], [Math.PI, 0, 0]); // pointed goatee
  for (const sx of [-1, 1]) b.add(new THREE.SphereGeometry(0.17, 5, 4), '#ff3b2e', [sx * 0.3, 3.95, 0.8]); // glowing eyes
  b.add(new THREE.CylinderGeometry(0.85, 0.9, 0.6, 9), '#1c1630', [0, 4.45, 0.05]); // black turban band
  b.add(new THREE.SphereGeometry(0.85, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2), '#2a2050', [0, 4.7, 0.05]); // turban dome
  b.add(new THREE.OctahedronGeometry(0.25), '#ff4a3a', [0, 4.55, 0.85]); // ruby
  for (const sx of [-1, 1]) b.add(new THREE.ConeGeometry(0.22, 1.2, 5), '#e8e0d0', [sx * 0.7, 5.0, 0], [0, 0, sx * -0.45]); // horns
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
    ['evil-genie', genieGeometry()],
  ]);
  private creatureMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  private wellViews: WellView[] = [];
  private beamTex = makeBeamTexture();
  private dummy = new THREE.Object3D();
  private tint = new THREE.Color();
  private flashScale = 1;
  private nearest: number[] = [];
  private nearDist: number[] = [];
  private seed = 1234567;
  private quality: QualityPreset;
  private structures!: StructureRenderer;

  constructor(quality: QualityPreset, private chapter: ChapterConfig) {
    this.quality = quality;
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
    this.glow = new GlowLayer(caps.orbs + caps.projectiles + caps.particles + 64);
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

  /** Turn a sim event into particles. Audio/HUD consume the same events elsewhere. */
  handleEvent(e: SimEvent): void {
    const P = this.particles;
    const f = this.flashScale;
    const n = (c: number) => Math.max(1, Math.round(c * (f < 1 ? 0.6 : 1)));
    switch (e.type) {
      case 'cast':
        P.burst(this.rnd, n(10), e.x, e.y, e.z, 9, 0.35, 1.1 * f, ...FIRE);
        break;
      case 'impact':
        if (e.v < 0) {
          P.burst(this.rnd, n(10), e.x, e.y + 0.5, e.z, 9, 0.5, 1.4 * f, ...CURSE, 4, 0.4);
          break;
        }
        P.burst(this.rnd, n(26), e.x, e.y + 0.5, e.z, 17, 0.7, 1.5 * f, ...EMBER, 10, 0.5);
        P.burst(this.rnd, n(10), e.x, e.y + 0.5, e.z, 7, 1.0, 3.2, ...DUST, -1, 0.7);
        P.burst(this.rnd, n(8), e.x, e.y + 1, e.z, 12, 0.5, 2.4 * f, ...FIRE, 4, 0.2);
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
      if (p.spell === 'genie-bolt') {
        glow.add(x, y, z, 0.7, 0.25, 1, 1, 3.4);
        glow.add(x, y, z, 1, 0.8, 1, 1, 1.5);
        this.particles.spawn(x, y, z, (this.rnd() - 0.5) * 2, this.rnd() * 2, (this.rnd() - 0.5) * 2, 0.3, 1.8 * this.flashScale, 0.6, 0.2, 0.95, 0);
        continue;
      }
      const tier = p.tier ?? 1;
      const big = 1 + (tier - 1) * 0.45;
      const hot = tier === 3 ? WHITE_HOT : FIRE;
      glow.add(x, y, z, hot[0], hot[1], hot[2], 1, 4.2 * big);
      glow.add(x, y, z, 1, 0.95, 0.7, 1, 1.9 * big);
      this.particles.spawn(x, y, z, (this.rnd() - 0.5) * 3, this.rnd() * 2, (this.rnd() - 0.5) * 3, 0.32 + 0.05 * tier, 2.0 * big * this.flashScale, FIRE[0], FIRE[1], FIRE[2], 0);
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
      let scale = 1;
      if (c.type === 'dust-sprite') this.dummy.rotation.set(0, heading + Math.sin(time * 3 + c.id) * 0.4, Math.sin(time * 5 + c.id) * 0.08);
      else if (c.type === 'evil-genie') {
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
        scale = 1.15;
      } else {
        this.dummy.rotation.set(0, heading, 0);
        scale = 1.5;
        this.dummy.position.y += Math.abs(Math.sin(time * 9 + c.id)) * (c.state === 1 ? 0.5 : 0.08); // gallop bounce
      }
      this.dummy.scale.setScalar(scale);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(idx, this.dummy.matrix);
      if (c.burnTicks > 0) this.tint.setRGB(1.8, 0.8, 0.45);
      else this.tint.setRGB(1, 1, 1);
      mesh.setColorAt(idx, this.tint);
      if (c.type === 'evil-genie') {
        // Menacing red eye-glow and a trail of dark smoke.
        glow.add(x, y + 3.9 * scale, z, 1, 0.2, 0.15, 0.7 + 0.3 * Math.sin(time * 6 + c.id), 2.4);
        if (this.rnd() < 0.35) this.particles.spawn(x, y - 0.5, z, (this.rnd() - 0.5) * 2, -1, (this.rnd() - 0.5) * 2, 0.7, 2.4, 0.35, 0.25, 0.6);
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

    this.structures.update(sim, camX, camZ, time, glow);
    this.particles.update(dt, glow);
    glow.end(pxScale);
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
