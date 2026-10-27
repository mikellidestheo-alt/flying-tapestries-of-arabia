// Real post-process bloom (High preset only). Loaded lazily so Low/Medium never download it.
// Bright things (glow points, sun, lit windows, magic) bleed softly; everything else is untouched.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import bloomData from '../data/quality.json';

export class BloomPipeline {
  private composer: EffectComposer;
  private renderPass: RenderPass;
  private bloom: UnrealBloomPass;

  constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: bloomData.bloom.msaaSamples });
    this.composer = new EffectComposer(renderer, target);
    this.renderPass = new RenderPass(scene, camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x * bloomData.bloom.resolutionScale, size.y * bloomData.bloom.resolutionScale), bloomData.bloom.strength, bloomData.bloom.radius, bloomData.bloom.threshold);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.setPixelRatio(renderer.getPixelRatio());
  }

  setScene(scene: THREE.Scene): void {
    this.renderPass.scene = scene;
  }

  /** Call after the renderer's size or pixel ratio changed. */
  resize(width: number, height: number): void {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(width, height);
    const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.bloom.resolution.set(s.x * bloomData.bloom.resolutionScale, s.y * bloomData.bloom.resolutionScale);
  }

  render(dt: number): void {
    this.composer.render(dt);
  }

  dispose(): void {
    this.composer.dispose();
    this.bloom.dispose();
  }
}
