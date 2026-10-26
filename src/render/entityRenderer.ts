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

const MANA = [0.35, 0.85, 1.0] as const;
const FIRE = [1.0, 0.55, 0.18] as const;
const EMBER = [1.0, 0.82, 0.4] as const;
const DUST = [0.85, 0.7, 0.45] as const;
const GOLD = [1.0, 0.85, 0.4] as const;
const RED = [1.0, 0.25, 0.2] as const;

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
  private creatures!: THREE.InstancedMesh;
  private creatureGeom = dustSpriteGeometry();
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

  constructor(quality: QualityPreset) {
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
    this.group.remove(this.glow.points, this.creatures);
    this.glow.dispose();
    this.creatures.dispose();
    this.build();
  }

  private build(): void {
    const caps = PRESETS[this.quality].caps;
    this.glow = new GlowLayer(caps.orbs + caps.projectiles + caps.particles + 64);
    this.particles = new Particles(caps.particles);
    this.creatures = new THREE.InstancedMesh(this.creatureGeom, this.creatureMat, Math.min(caps.creatures, simData.caps.creatures));
    this.creatures.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.creatures.frustumCulled = false;
    this.creatures.count = 0;
    this.group.add(this.glow.points, this.creatures);
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
      glow.add(x, y, z, FIRE[0], FIRE[1], FIRE[2], 1, 4.2);
      glow.add(x, y, z, 1, 0.95, 0.7, 1, 1.9);
      this.particles.spawn(x, y, z, (this.rnd() - 0.5) * 3, this.rnd() * 2, (this.rnd() - 0.5) * 3, 0.32, 2.0 * this.flashScale, FIRE[0], FIRE[1], FIRE[2], 0);
    }

    // Creatures (instanced).
    const cs = sim.creatures;
    const cn = Math.min(cs.length, this.creatures.instanceMatrix.count);
    for (let i = 0; i < cn; i++) {
      const c = cs[i]!;
      const x = lerp(c.px, c.x);
      const y = lerp(c.py, c.y);
      const z = lerp(c.pz, c.z);
      this.dummy.position.set(x, y, z);
      const heading = Math.atan2(c.vx, c.vz);
      this.dummy.rotation.set(0, heading + Math.sin(time * 3 + c.id) * 0.4, Math.sin(time * 5 + c.id) * 0.08);
      this.dummy.scale.setScalar(1);
      this.dummy.updateMatrix();
      this.creatures.setMatrixAt(i, this.dummy.matrix);
      if (c.burnTicks > 0) this.tint.setRGB(1.8, 0.8, 0.45);
      else this.tint.setRGB(1, 1, 1);
      this.creatures.setColorAt(i, this.tint);
      if (c.burnTicks > 0 && this.rnd() < 0.5) this.particles.spawn(x, y + 1, z, 0, 3, 0, 0.5, 1.6 * this.flashScale, FIRE[0], FIRE[1], FIRE[2]);
    }
    this.creatures.count = cn;
    this.creatures.instanceMatrix.needsUpdate = true;
    if (this.creatures.instanceColor) this.creatures.instanceColor.needsUpdate = true;

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

    this.particles.update(dt, glow);
    glow.end(pxScale);
  }

  get particleCount(): number {
    return this.particles.count;
  }

  dispose(): void {
    this.glow.dispose();
    this.creatures.dispose();
    this.creatureGeom.dispose();
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
