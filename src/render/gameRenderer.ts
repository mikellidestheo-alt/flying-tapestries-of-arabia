// Owns the Three.js scene. Reads sim state, never mutates it.
import * as THREE from 'three';
import simData from '../data/sim.json';
import flight from '../data/flight.json';
import type { ChapterConfig } from '../data/chapters';
import type { Element } from '../data/elements';
import type { QualityPreset } from '../save';
import { wrapAngle } from '../sim/dmath';
import type { Sim } from '../sim/sim';
import { GLOBAL_PIXEL_RATIO_CAP, PRESETS, type QualityPresetData } from './quality';
import { Sky } from './sky';
import { TapestryModel } from './tapestry';
import { TerrainRenderer } from './terrainRenderer';
import { Water } from './water';

const CHUNK = simData.chunkSize;

export interface RenderStats {
  drawCalls: number;
  triangles: number;
  chunks: number;
  deltas: number;
  pixelRatio: number;
}

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.5, 1000);
  private terrain: TerrainRenderer;
  private sky: Sky;
  private water: Water;
  private tapestry: TapestryModel;
  private fog: THREE.Fog;
  private preset: QualityPresetData;
  private renderScale = 1;
  private radiusScale = 1;
  private camPos = new THREE.Vector3();
  private camDesired = new THREE.Vector3();
  private camHeading = 0;
  private camReady = false;
  private roll = 0;
  private pitch = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private sim: Sim,
    private chapter: ChapterConfig,
    quality: QualityPreset,
    wizard: Element = 'fire',
  ) {
    this.preset = PRESETS[quality];
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: quality !== 'low',
      powerPreference: 'high-performance',
      stencil: false,
      alpha: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(new THREE.Color(chapter.palette.fog));
    this.fog = new THREE.Fog(chapter.palette.fog, 100, 400);
    this.scene.fog = this.fog;

    this.terrain = new TerrainRenderer(sim.terrain, chapter, this.preset);
    this.scene.add(this.terrain.group);
    this.sky = new Sky(chapter);
    this.scene.add(this.sky.mesh);
    this.water = new Water(chapter, this.preset.water as 'shader' | 'flat');
    this.scene.add(this.water.mesh);
    this.tapestry = new TapestryModel(wizard);
    this.scene.add(this.tapestry.root, this.tapestry.shadow);

    // Two lights, only for the tapestry and wizard (terrain lighting is baked).
    const sun = new THREE.DirectionalLight(chapter.palette.sunLight, 2.2);
    sun.position.set(...chapter.palette.sunDir);
    this.scene.add(sun, new THREE.HemisphereLight(chapter.palette.skyMid, chapter.palette.sand, 1.3));

    this.applyFog();
    this.resize();
    const p0 = sim.players[0]!;
    this.terrain.prime(p0.x, p0.z, this.radiusScale);
  }

  get viewDistance(): number {
    return this.preset.viewRadiusChunks * CHUNK * this.radiusScale;
  }

  private applyFog(): void {
    const d = this.viewDistance;
    this.fog.near = d * 0.3;
    this.fog.far = d * 0.97;
    this.camera.far = d * 1.4;
    this.camera.updateProjectionMatrix();
  }

  setQuality(q: QualityPreset): void {
    this.preset = PRESETS[q];
    this.terrain.setQuality(this.preset);
    this.water.setMode(this.preset.water as 'shader' | 'flat');
    this.applyFog();
    this.resize();
  }

  setWizard(e: Element): void {
    this.tapestry.setWizard(e);
  }

  setScales(renderScale: number, radiusScale: number): void {
    this.renderScale = renderScale;
    this.radiusScale = radiusScale;
    this.applyFog();
    this.resize();
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, GLOBAL_PIXEL_RATIO_CAP, this.preset.pixelRatioCap);
    this.renderer.setPixelRatio(dpr * this.renderScale);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  get stats(): RenderStats {
    const info = this.renderer.info;
    return {
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      chunks: this.terrain.chunkCount,
      deltas: this.sim.terrain.deltas.list.length,
      pixelRatio: this.renderer.getPixelRatio(),
    };
  }

  /** alpha = fraction between the previous and current sim tick; dt = frame time (s). */
  render(alpha: number, dt: number, time: number): void {
    const cur = this.sim.players[0]!;
    const prev = this.sim.prevPlayers[0] ?? cur;
    const x = prev.x + (cur.x - prev.x) * alpha;
    const y = prev.y + (cur.y - prev.y) * alpha;
    const z = prev.z + (cur.z - prev.z) * alpha;
    const heading = prev.heading + wrapAngle(cur.heading - prev.heading) * alpha;
    const speedFrac = Math.min(1, Math.max(0, (cur.speed - flight.cruiseSpeed) / (flight.maxSpeed - flight.cruiseSpeed)));

    // Stream terrain chunks around the player (budgeted per frame).
    this.terrain.update(x, z, this.radiusScale);

    // Tapestry pose: bank into turns, pitch with climb.
    const targetRoll = (cur.turnRate / flight.maxTurnRate) * flight.bankMax;
    const targetPitch = Math.max(-0.35, Math.min(0.35, -cur.vy * 0.03));
    const k = 1 - Math.exp(-8 * dt);
    this.roll += (targetRoll - this.roll) * k;
    this.pitch += (targetPitch - this.pitch) * k;
    this.tapestry.root.position.set(x, y, z);
    this.tapestry.root.rotation.y = heading; // model faces +z; heading 0 = +z
    this.tapestry.update(time, speedFrac, this.roll, this.pitch);

    // Blob shadow on the surface below.
    const surf = this.sim.terrain.surfaceAt(x, z);
    const alt = Math.max(0, y - surf);
    const sh = this.tapestry.shadow;
    sh.position.set(x, surf + 0.12, z);
    const s = 5.5 + alt * 0.25;
    sh.scale.set(s, 1, s * 0.8);
    sh.rotation.y = heading;
    (sh.material as THREE.MeshBasicMaterial).opacity = Math.max(0.15, 1 - alt / 70);

    // Chase camera: trails the heading with a lag, rises with speed.
    if (!this.camReady) {
      this.camHeading = heading;
      this.camReady = true;
      this.camPos.set(x - Math.sin(heading) * 14, y + 6, z - Math.cos(heading) * 14);
    }
    this.camHeading += wrapAngle(heading - this.camHeading) * (1 - Math.exp(-3.2 * dt));
    const back = 13 + speedFrac * 4;
    const up = 5.5 + speedFrac * 1.5;
    const desired = this.camDesired.set(x - Math.sin(this.camHeading) * back, y + up, z - Math.cos(this.camHeading) * back);
    const floor = this.sim.terrain.surfaceAt(desired.x, desired.z) + 2.5;
    if (desired.y < floor) desired.y = floor;
    this.camPos.lerp(desired, 1 - Math.exp(-7 * dt));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(x + Math.sin(this.camHeading) * 9, y + 1.2, z + Math.cos(this.camHeading) * 9);
    const fov = 62 + speedFrac * 9;
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-4 * dt));
      this.camera.updateProjectionMatrix();
    }

    this.sky.update(this.camera, this.camera.far * 0.9);
    this.water.update(this.camPos.x, this.camPos.z, this.camera.far * 2.5, time);
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.terrain.dispose();
    this.sky.dispose();
    this.water.dispose();
    this.tapestry.dispose();
    this.renderer.dispose();
  }
}
