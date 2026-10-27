// Sky dome: a gradient shader (no textures) with a soft sun glow, kept centred on the camera.
import * as THREE from 'three';
import { TO_LINEAR_GLSL, linearOut } from './colorspace';
import type { ChapterConfig } from '../data/chapters';

export class Sky {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  constructor(chapter: ChapterConfig) {
    const p = chapter.palette;
    const sunDir = new THREE.Vector3(...p.sunDir).normalize();
    this.material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(p.skyTop) },
        mid: { value: new THREE.Color(p.skyMid) },
        horizon: { value: new THREE.Color(p.horizon) },
        fogColor: { value: new THREE.Color(p.fog) },
        sunColor: { value: new THREE.Color(p.sun) },
        sunDir: { value: sunDir },
        time: { value: 0 },
        linearOut,
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      defines: { STARS: chapter.palette.stars ? 1 : 0, MOON: chapter.palette.moon ? 1 : 0 },
      fragmentShader: /* glsl */ `
        precision highp float;
        ${TO_LINEAR_GLSL}
        uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 fogColor;
        uniform vec3 sunColor; uniform vec3 sunDir; uniform float time;
        varying vec3 vDir;
        float hash3(vec3 p) {
          p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 c = mix(horizon, mid, smoothstep(0.0, 0.28, h));
          c = mix(c, top, smoothstep(0.2, 0.85, h));
          c = mix(fogColor, c, smoothstep(-0.02, 0.07, h));
          float s = max(dot(d, normalize(sunDir)), 0.0);
          float disk = smoothstep(0.9975, 0.9992, s);
          float glow = s * s * s * s * 0.55 + s * s * s * s * s * s * s * s * s * s * s * s * 0.5;
          #if MOON
          // Night: the light source is a pale moon with a soft halo and a few darker maria.
          float md = smoothstep(0.9962, 0.9972, s);
          vec3 moonCol = vec3(0.93, 0.95, 1.0) * (1.0 - 0.12 * smoothstep(0.6, 1.0, hash3(floor(d * 260.0)))); 
          c += sunColor * glow * 0.8 * smoothstep(-0.05, 0.12, h);
          c = mix(c, moonCol, md * smoothstep(-0.02, 0.05, h));
          #else
          c += sunColor * (glow * smoothstep(-0.05, 0.12, h) + disk);
          #endif
          #if STARS
          vec3 sp = d * 80.0;
          vec3 cell = floor(sp);
          vec3 local = fract(sp) - 0.5;
          float rr = hash3(cell);
          vec3 jit = vec3(hash3(cell + 3.1), hash3(cell + 7.7), hash3(cell + 1.3)) - 0.5;
          float st = smoothstep(0.16, 0.0, length(local - jit * 0.5)) * step(0.955, rr);
          float twinkle = 0.65 + 0.35 * sin(time * (1.5 + rr * 4.0) + rr * 60.0);
          c += vec3(0.9, 0.93, 1.0) * st * twinkle * smoothstep(0.08, 0.4, h) * (1.0 - md * 0.0);
          #endif
          gl_FragColor = vec4(toLinearOut(c), 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
  }

  update(camera: THREE.Camera, radius: number, time = 0): void {
    this.material.uniforms.time!.value = time;
    this.mesh.position.copy(camera.position);
    this.mesh.scale.setScalar(radius);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
