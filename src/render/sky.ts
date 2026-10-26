// Sky dome: a gradient shader (no textures) with a soft sun glow, kept centred on the camera.
import * as THREE from 'three';
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
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        precision mediump float;
        uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 fogColor;
        uniform vec3 sunColor; uniform vec3 sunDir;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 c = mix(horizon, mid, smoothstep(0.0, 0.28, h));
          c = mix(c, top, smoothstep(0.2, 0.85, h));
          c = mix(fogColor, c, smoothstep(-0.02, 0.07, h));
          float s = max(dot(d, normalize(sunDir)), 0.0);
          float disk = smoothstep(0.9975, 0.9992, s);
          float glow = s * s * s * s * 0.55 + s * s * s * s * s * s * s * s * s * s * s * s * 0.5;
          c += sunColor * (glow * smoothstep(-0.05, 0.12, h) + disk);
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
  }

  update(camera: THREE.Camera, radius: number): void {
    this.mesh.position.copy(camera.position);
    this.mesh.scale.setScalar(radius);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
