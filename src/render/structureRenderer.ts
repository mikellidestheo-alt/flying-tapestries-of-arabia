// Castles (rebuilt when their tier changes), instanced archers with distance LOD, and nests.
import * as THREE from 'three';
import type { ChapterConfig } from '../data/chapters';
import { archerSlots, castleStats } from '../sim/castles';
import type { Castle } from '../sim/entities';
import type { Sim } from '../sim/sim';
import { FACTION_STYLES, buildArcherGeometry, buildCastleGeometry, buildNestGeometry } from './castleModel';
import type { GlowLayer } from './glowLayer';
import { lightingFromPalette, type Lighting } from './mesher';

interface CastleView {
  mesh: THREE.Mesh;
  key: string;
}

const ARCHER_LOD_DISTANCE = 230;

export class StructureRenderer {
  readonly group = new THREE.Group();
  private light: Lighting;
  private material = new THREE.MeshBasicMaterial({ vertexColors: true });
  private castles = new Map<number, CastleView>();
  private nests: { mesh: THREE.Mesh; id: number }[] = [];
  private nestGeom: THREE.BufferGeometry;
  private archers: THREE.InstancedMesh;
  private archerGeom = buildArcherGeometry();
  private archerMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  private dummy = new THREE.Object3D();
  private tint = new THREE.Color();

  constructor(private chapter: ChapterConfig, archerCap: number) {
    const p = chapter.palette;
    this.light = lightingFromPalette(p.sunDir, p.sunLight, p.ambient);
    this.nestGeom = buildNestGeometry(this.light, chapter.nest.color, chapter.nest.glow);
    this.archers = new THREE.InstancedMesh(this.archerGeom, this.archerMat, archerCap);
    this.archers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.archers.frustumCulled = false;
    this.archers.count = 0;
    this.group.add(this.archers);
  }

  private castleView(c: Castle): CastleView {
    const key = `${c.tier}|${c.ruined ? 1 : 0}`;
    let view = this.castles.get(c.id);
    if (!view) {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
      mesh.position.set(c.x, c.y, c.z);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.group.add(mesh);
      view = { mesh, key: '' };
      this.castles.set(c.id, view);
    }
    if (view.key !== key) {
      view.mesh.geometry.dispose();
      view.mesh.geometry = buildCastleGeometry(c.tier, c.faction, this.chapter.structureStyle, this.light, c.ruined);
      view.key = key;
    }
    return view;
  }

  update(sim: Sim, camX: number, camZ: number, time: number, glow: GlowLayer): void {
    let archerCount = 0;
    const cap = this.archers.instanceMatrix.count;
    for (const c of sim.castles) {
      this.castleView(c);
      if (c.ruined) continue;
      const dx = c.x - camX;
      const dz = c.z - camZ;
      if (dx * dx + dz * dz > ARCHER_LOD_DISTANCE * ARCHER_LOD_DISTANCE) continue; // distant: silhouette only
      const stats = castleStats(c.tier, c.branches);
      const slots = archerSlots(c.tier, stats.archers);
      const fs = FACTION_STYLES[c.faction % FACTION_STYLES.length]!;
      this.tint.set(fs.color).lerp(new THREE.Color('#ffffff'), 0.45);
      for (let i = 0; i < slots.length && archerCount < cap; i++) {
        const s = slots[i]!;
        this.dummy.position.set(c.x + s.x, c.y + s.y, c.z + s.z);
        this.dummy.rotation.set(0, Math.atan2(s.x, s.z), 0);
        this.dummy.updateMatrix();
        this.archers.setMatrixAt(archerCount, this.dummy.matrix);
        this.archers.setColorAt(archerCount, this.tint);
        archerCount++;
      }
    }
    this.archers.count = archerCount;
    this.archers.instanceMatrix.needsUpdate = true;
    if (this.archers.instanceColor) this.archers.instanceColor.needsUpdate = true;

    // Nests.
    while (this.nests.length < sim.structures.length) {
      const mesh = new THREE.Mesh(this.nestGeom, this.material);
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
      this.nests.push({ mesh, id: 0 });
    }
    for (let i = 0; i < sim.structures.length; i++) {
      const s = sim.structures[i]!;
      const v = this.nests[i]!;
      if (v.id !== s.id) {
        v.id = s.id;
        v.mesh.position.set(s.x, s.y, s.z);
        v.mesh.updateMatrix();
      }
      v.mesh.visible = s.alive;
      if (s.alive) {
        const pulse = 0.65 + 0.35 * Math.sin(time * 3 + s.id);
        const g = new THREE.Color(this.chapter.nest.glow);
        glow.add(s.x, s.y + 10.5, s.z, g.r, g.g, g.b, pulse, 6);
      }
    }
  }

  dispose(): void {
    for (const v of this.castles.values()) v.mesh.geometry.dispose();
    this.nestGeom.dispose(); // nest meshes share it
    this.archers.dispose();
    this.archerGeom.dispose();
    this.archerMat.dispose();
    this.material.dispose();
  }
}
