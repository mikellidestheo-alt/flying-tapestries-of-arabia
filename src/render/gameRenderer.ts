// Owns the WebGL renderer and the per-chapter Three.js scene. Reads sim state, never mutates it.
import * as THREE from 'three';
import simData from '../data/sim.json';
import flight from '../data/flight.json';
import castleData from '../data/castles.json';
import type { ChapterConfig } from '../data/chapters';
import type { Element } from '../data/elements';
import type { QualityPreset } from '../save';
import type { SimEvent } from '../sim/entities';
import { wrapAngle } from '../sim/dmath';
import type { Sim } from '../sim/sim';
import { EntityRenderer } from './entityRenderer';
import { GLOBAL_PIXEL_RATIO_CAP, PRESETS, THERMAL, type QualityPresetData } from './quality';
import type { BloomPipeline } from './bloom';
import quality from '../data/quality.json';
import { linearOut } from './colorspace';
import { Sky } from './sky';
import { TapestryModel } from './tapestry';
import { TerrainRenderer } from './terrainRenderer';
import { Water } from './water';
import { SandLayer, gustAt } from './weather';

const CHUNK = simData.chunkSize;

export interface RenderStats {
  drawCalls: number;
  triangles: number;
  chunks: number;
  deltas: number;
  pixelRatio: number;
  particles: number;
}

interface WizardView {
  model: TapestryModel;
  roll: number;
  pitch: number;
}

/** Everything that belongs to one loaded chapter. */
interface World {
  scene: THREE.Scene;
  sim: Sim;
  chapter: ChapterConfig;
  terrain: TerrainRenderer;
  sky: Sky;
  water: Water;
  entities: EntityRenderer;
  wizards: WizardView[];
  fog: THREE.Fog;
  sand: SandLayer | null;
}

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.5, 1000);
  private world: World | null = null;
  private preset: QualityPresetData;
  private renderScale = 1;
  private radiusScale = 1;
  private camPos = new THREE.Vector3();
  private camDesired = new THREE.Vector3();
  private camHeading = 0;
  private camReady = false;
  private reducedFlashing = false;
  private reducedMotion = false;
  /** 0 normal, 1 bloom off, 2 also a little less resolution and distance (see ThermalGuard). */
  private thermalStage = 0;
  private bloom: BloomPipeline | null = null;
  private bloomLoading = false;
  localIndex = 0;

  constructor(canvas: HTMLCanvasElement, private quality: QualityPreset) {
    this.preset = PRESETS[quality];
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      // High gets its anti-aliasing from the bloom target (one MSAA buffer instead of two); Low has none.
      antialias: quality === 'medium',
      powerPreference: 'high-performance',
      stencil: false,
      alpha: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.info.autoReset = false; // bloom renders several passes per frame: reset once per frame instead
    this.resize();
  }

  /** Build the scene for a chapter. `wizardElements[i]` styles sim.players[i]. */
  loadChapter(chapter: ChapterConfig, sim: Sim, wizardElements: Element[], localIndex = 0): void {
    this.unloadChapter();
    const scene = new THREE.Scene();
    const fog = new THREE.Fog(chapter.palette.fog, 100, 400);
    scene.fog = fog;
    this.renderer.setClearColor(new THREE.Color(chapter.palette.fog));

    const terrain = new TerrainRenderer(sim.terrain, chapter, this.preset);
    scene.add(terrain.group);
    const sky = new Sky(chapter);
    scene.add(sky.mesh);
    const water = new Water(chapter, this.preset.water as 'shader' | 'flat');
    scene.add(water.mesh);

    const wizards: WizardView[] = sim.players.map((p, i) => {
      const faction = castleData.factionStyles[p.faction % castleData.factionStyles.length]!;
      const model = i === localIndex && !p.isRival ? new TapestryModel(wizardElements[i] ?? 'fire') : new TapestryModel(wizardElements[i] ?? 'fire', shade(faction.color, 0.55), '#e9c26a');
      scene.add(model.root, model.shadow);
      return { model, roll: 0, pitch: 0 };
    });
    const entities = new EntityRenderer(this.quality, chapter);
    entities.setReducedFlashing(this.reducedFlashing);
    entities.beaconSource = () => terrain.beacons();
    scene.add(entities.group);

    // Two lights, only for the tapestries and wizards (terrain/castle lighting is baked).
    const sun = new THREE.DirectionalLight(chapter.palette.sunLight, 2.2);
    sun.position.set(...chapter.palette.sunDir);
    scene.add(sun, new THREE.HemisphereLight(chapter.palette.skyMid, chapter.palette.sand, 1.3));

    let sand: SandLayer | null = null;
    if (chapter.weather?.sandstorm && this.preset.weatherLayer && !this.reducedMotion) {
      sand = new SandLayer(chapter);
      scene.add(sand.mesh);
    }
    this.world = { scene, sim, chapter, terrain, sky, water, entities, wizards, fog, sand };
    this.bloom?.setScene(scene);
    this.ensureBloom();
    this.localIndex = localIndex;
    this.camReady = false;
    this.applyFog();
    const p0 = sim.players[localIndex]!;
    terrain.prime(p0.x, p0.z, this.radiusScale);
  }

  unloadChapter(): void {
    const w = this.world;
    if (!w) return;
    w.terrain.dispose();
    w.sky.dispose();
    w.sand?.dispose();
    w.water.dispose();
    w.entities.dispose();
    for (const v of w.wizards) v.model.dispose();
    this.world = null;
  }

  /** Bloom is High-only and lazy: the code is fetched the first time a High-quality chapter loads. */
  private ensureBloom(): void {
    if (!this.preset.bloom || this.bloom || this.bloomLoading) return;
    this.bloomLoading = true;
    void import('./bloom').then(({ BloomPipeline }) => {
      this.bloomLoading = false;
      if (!this.preset.bloom || !this.world || this.bloom) return;
      this.bloom = new BloomPipeline(this.renderer, this.world.scene, this.camera);
      this.bloom.resize(window.innerWidth, window.innerHeight);
    }).catch(() => {
      this.bloomLoading = false; // keep playing with the cheap glow
    });
  }

  /** Bloom runs only while the preset asks for it and the governor has not had to cut resolution. */
  private bloomActive(): boolean {
    return !!this.bloom && this.preset.bloom && this.thermalStage === 0 && this.renderScale >= quality.bloom.minRenderScale;
  }

  /** Add or remove the sand layer when the quality preset changes. */
  private setSandLayer(): void {
    const w = this.world;
    if (!w || !w.chapter.weather?.sandstorm) return;
    const want = this.preset.weatherLayer && !this.reducedMotion;
    if (want && !w.sand) {
      w.sand = new SandLayer(w.chapter);
      w.scene.add(w.sand.mesh);
    } else if (!want && w.sand) {
      w.scene.remove(w.sand.mesh);
      w.sand.dispose();
      w.sand = null;
    }
  }

  get viewDistance(): number {
    return this.preset.viewRadiusChunks * CHUNK * this.radiusScale * (this.thermalStage >= 2 ? THERMAL.stage2RadiusScale : 1);
  }

  /** Sandstorm gusts (0..1) tighten the fog by up to `fogTighten`. Everything else is calm. */
  private gust = 0;

  private applyFog(): void {
    const d = this.viewDistance;
    this.applyFogOnly();
    this.camera.far = d * 1.4;
    this.camera.updateProjectionMatrix();
  }

  /** Per-frame fog refresh for weather (no camera matrix work). */
  private applyFogOnly(): void {
    const w = this.world;
    if (!w) return;
    const d = this.viewDistance;
    const k = 1 - (w.chapter.weather?.sandstorm?.fogTighten ?? 0) * this.gust;
    w.fog.near = d * 0.3 * k;
    w.fog.far = d * 0.97 * k;
  }

  setQuality(q: QualityPreset): void {
    this.quality = q;
    this.preset = PRESETS[q];
    if (this.world) {
      this.setSandLayer();
      this.world.entities.setQuality(q);
      this.world.terrain.setQuality(this.preset);
      this.world.water.setMode(this.preset.water as 'shader' | 'flat');
    }
    if (!this.preset.bloom && this.bloom) {
      this.bloom.dispose();
      this.bloom = null;
    }
    this.ensureBloom();
    this.applyFog();
    this.resize();
  }

  handleEvent(e: SimEvent): void {
    this.world?.entities.handleEvent(e);
  }

  /** Called by the game when sustained play has warmed the phone up (see ThermalGuard). */
  setThermalStage(stage: number): void {
    if (stage === this.thermalStage) return;
    this.thermalStage = stage;
    this.applyFog();
    this.resize();
  }

  /** Steady camera: no boost zoom, calmer follow. Also drops the sand haze. */
  setReducedMotion(on: boolean): void {
    this.reducedMotion = on;
    this.setSandLayer();
  }

  setReducedFlashing(on: boolean): void {
    this.reducedFlashing = on;
    this.world?.entities.setReducedFlashing(on);
  }

  setWizard(index: number, e: Element): void {
    this.world?.wizards[index]?.model.setWizard(e);
  }

  get camHeadingValue(): number {
    return this.camHeading;
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
    this.renderer.setPixelRatio(dpr * this.renderScale * (this.thermalStage >= 2 ? THERMAL.stage2RenderScale : 1));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.bloom?.resize(w, h);
  }

  get stats(): RenderStats {
    const info = this.renderer.info;
    return {
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      chunks: this.world?.terrain.chunkCount ?? 0,
      deltas: this.world?.sim.terrain.deltas.list.length ?? 0,
      pixelRatio: this.renderer.getPixelRatio(),
      particles: this.world?.entities.particleCount ?? 0,
    };
  }

  /** alpha = fraction between the previous and current sim tick; dt = frame time (s). */
  render(alpha: number, dt: number, time: number): void {
    const w = this.world;
    if (!w) return;
    const sim = w.sim;

    // Place every wizard (interpolated between sim ticks; snap across teleports such as respawns).
    let lx = 0;
    let ly = 0;
    let lz = 0;
    let lheading = 0;
    let lspeedFrac = 0;
    for (let i = 0; i < sim.players.length; i++) {
      const cur = sim.players[i]!;
      const view = w.wizards[i]!;
      view.model.root.visible = cur.active;
      view.model.shadow.visible = cur.active;
      if (!cur.active) continue;
      const prev = sim.prevPlayers[i] ?? cur;
      const jump = Math.abs(cur.x - prev.x) + Math.abs(cur.z - prev.z) > 60;
      const a = jump ? 1 : alpha;
      const x = prev.x + (cur.x - prev.x) * a;
      const y = prev.y + (cur.y - prev.y) * a;
      const z = prev.z + (cur.z - prev.z) * a;
      const heading = prev.heading + wrapAngle(cur.heading - prev.heading) * a;
      const speedFrac = Math.min(1, Math.max(0, (cur.speed - flight.cruiseSpeed) / (flight.maxSpeed - flight.cruiseSpeed)));
      const targetRoll = (cur.turnRate / flight.maxTurnRate) * flight.bankMax;
      const targetPitch = Math.max(-0.35, Math.min(0.35, -cur.vy * 0.03));
      const k = 1 - Math.exp(-8 * dt);
      view.roll += (targetRoll - view.roll) * k;
      view.pitch += (targetPitch - view.pitch) * k;
      view.model.root.position.set(x, y, z);
      view.model.root.rotation.y = heading; // model faces +z; heading 0 = +z
      // Blink while invulnerable after a respawn.
      view.model.root.visible = cur.invuln === 0 || Math.floor(time * 12) % 2 === 0;
      view.model.update(time + i * 1.7, speedFrac, view.roll, view.pitch);
      const surf = sim.terrain.surfaceAt(x, z);
      const alt = Math.max(0, y - surf);
      const sh = view.model.shadow;
      sh.position.set(x, surf + 0.12, z);
      const s = 5.5 + alt * 0.25;
      sh.scale.set(s, 1, s * 0.8);
      sh.rotation.y = heading;
      (sh.material as THREE.MeshBasicMaterial).opacity = Math.max(0.15, 1 - alt / 70);
      if (i === this.localIndex) {
        lx = x;
        ly = y;
        lz = z;
        lheading = heading;
        lspeedFrac = speedFrac;
      }
    }

    // Stream terrain chunks around the local player (budgeted per frame).
    w.terrain.update(lx, lz, this.radiusScale);

    // Chase camera: trails the heading with a lag, rises with speed.
    if (!this.camReady) {
      this.camHeading = lheading;
      this.camReady = true;
      this.camPos.set(lx - Math.sin(lheading) * 14, ly + 6, lz - Math.cos(lheading) * 14);
    }
    this.camHeading += wrapAngle(lheading - this.camHeading) * (1 - Math.exp(-3.2 * dt));
    const back = 13 + lspeedFrac * 4;
    const up = 5.5 + lspeedFrac * 1.5;
    const desired = this.camDesired.set(lx - Math.sin(this.camHeading) * back, ly + up, lz - Math.cos(this.camHeading) * back);
    const floor = sim.terrain.surfaceAt(desired.x, desired.z) + 2.5;
    if (desired.y < floor) desired.y = floor;
    this.camPos.lerp(desired, 1 - Math.exp(-7 * dt));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(lx + Math.sin(this.camHeading) * 9, ly + 1.2, lz + Math.cos(this.camHeading) * 9);
    const fov = 62 + (this.reducedMotion ? 0 : lspeedFrac * 9);
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-4 * dt));
      this.camera.updateProjectionMatrix();
    }

    const pxScale = this.renderer.domElement.height / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    w.entities.update(sim, alpha, dt, time, pxScale, this.camPos.x, this.camPos.z);
    const storm = w.chapter.weather?.sandstorm;
    if (storm) {
      this.gust = gustAt(time);
      this.applyFogOnly();
      w.sand?.update(time, storm.layer, this.gust);
    }
    w.sky.update(this.camera, this.camera.far * 0.9, time);
    w.water.update(this.camPos.x, this.camPos.z, this.camera.far * 2.5, time);
    this.renderer.info.reset();
    if (this.bloomActive()) {
      linearOut.value = 1;
      this.bloom!.render(dt);
    } else {
      linearOut.value = 0;
      this.renderer.render(w.scene, this.camera);
    }
  }

  dispose(): void {
    this.bloom?.dispose();
    this.unloadChapter();
    this.renderer.dispose();
  }
}

/** Darken a hex colour (0..1 multiplier). */
function shade(hex: string, k: number): string {
  const c = new THREE.Color(hex).multiplyScalar(k);
  return `#${c.getHexString()}`;
}
