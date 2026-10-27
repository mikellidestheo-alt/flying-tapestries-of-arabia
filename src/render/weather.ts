// Weather (render only; never touches the sim). The sandstorm is two cheap things: gusts that pull
// the fog in and out, and one full-screen layer of drifting sand streaks (a single low-overdraw triangle).
import * as THREE from 'three';
import { TO_LINEAR_GLSL, linearOut } from './colorspace';
import type { ChapterConfig } from '../data/chapters';

/** Slow irregular gusts in 0..1 (sum of incommensurate sines, so it never visibly loops). */
export function gustAt(time: number): number {
  const g = 0.5 + 0.32 * Math.sin(time * 0.21) + 0.18 * Math.sin(time * 0.57 + 1.3);
  return Math.min(1, Math.max(0, g));
}

export class SandLayer {
  readonly mesh: THREE.Mesh;
  private uniforms: { time: { value: number }; strength: { value: number }; tint: { value: THREE.Color } };

  constructor(chapter: ChapterConfig) {
    this.uniforms = { time: { value: 0 }, strength: { value: 0 }, tint: { value: new THREE.Color(chapter.palette.fog).lerp(new THREE.Color(chapter.palette.horizon), 0.5) } };
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.mesh = new THREE.Mesh(
      geom,
      new THREE.ShaderMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
        fog: false,
        uniforms: { ...this.uniforms, linearOut },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = position.xy * 0.5 + 0.5;
            gl_Position = vec4(position.xy, 0.0, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          precision mediump float;
          ${TO_LINEAR_GLSL}
          uniform float time; uniform float strength; uniform vec3 tint;
          varying vec2 vUv;
          float streak(vec2 uv, float rows, float speed, float seed) {
            float row = floor(uv.y * rows);
            float r = fract(sin(row * 91.7 + seed) * 4375.5453);
            float x = fract(uv.x * (0.6 + r) * 1.4 - time * speed * (0.5 + r) + r * 7.0);
            return smoothstep(0.0, 0.12, x) * (1.0 - smoothstep(0.12, 0.55, x)) * (0.35 + 0.65 * r);
          }
          void main() {
            float s = streak(vUv, 46.0, 0.55, 1.0) * 0.8 + streak(vUv + vec2(0.31, 0.17), 21.0, 0.9, 7.0) * 0.6;
            float haze = 0.35 + 0.65 * smoothstep(0.0, 1.0, abs(vUv.y - 0.5) * 1.6);
            gl_FragColor = vec4(toLinearOut(tint), strength * (0.25 * haze + s * 0.75));
          }`,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 999;
  }

  /** `layer` = chapter peak opacity, `gust` = 0..1. */
  update(time: number, layer: number, gust: number): void {
    this.uniforms.time.value = time;
    this.uniforms.strength.value = layer * (0.45 + 0.55 * gust);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
