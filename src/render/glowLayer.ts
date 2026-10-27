// One additive Points object draws every glowing thing (mana orbs, bolts, sparks): a single
// draw call, no textures. This is the cheap "fake bloom" used on every quality preset.
import * as THREE from 'three';
import { TO_LINEAR_GLSL, linearOut } from './colorspace';

export class GlowLayer {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private geom = new THREE.BufferGeometry();
  private mat: THREE.ShaderMaterial;
  count = 0;

  constructor(readonly capacity: number) {
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 4);
    this.size = new Float32Array(capacity);
    const dyn = (a: THREE.BufferAttribute) => a.setUsage(THREE.DynamicDrawUsage);
    this.geom.setAttribute('position', dyn(new THREE.BufferAttribute(this.pos, 3)));
    this.geom.setAttribute('color4', dyn(new THREE.BufferAttribute(this.col, 4)));
    this.geom.setAttribute('size', dyn(new THREE.BufferAttribute(this.size, 1)));
    this.geom.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      uniforms: { pxScale: { value: 600 }, linearOut },
      vertexShader: /* glsl */ `
        attribute vec4 color4; attribute float size;
        uniform float pxScale; varying vec4 vColor;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(size * pxScale / max(-mv.z, 0.1), 3.0, 120.0);
          vColor = color4;
        }`,
      fragmentShader: /* glsl */ `
        precision mediump float; varying vec4 vColor;
        ${TO_LINEAR_GLSL}
        void main() {
          float r = length(gl_PointCoord - 0.5) * 2.0;
          if (r > 1.0) discard;
          float glow = (1.0 - r) * (1.0 - r);
          float core = smoothstep(0.4, 0.0, r);
          gl_FragColor = vec4(toLinearOut(vColor.rgb * (0.55 + core)), vColor.a * glow);
        }`,
    });
    this.points = new THREE.Points(this.geom, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  begin(): void {
    this.count = 0;
  }

  add(x: number, y: number, z: number, r: number, g: number, b: number, a: number, size: number): void {
    const i = this.count;
    if (i >= this.capacity) return;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.col[i * 4] = r;
    this.col[i * 4 + 1] = g;
    this.col[i * 4 + 2] = b;
    this.col[i * 4 + 3] = a;
    this.size[i] = size;
    this.count = i + 1;
  }

  end(pxScale: number): void {
    this.mat.uniforms.pxScale!.value = pxScale;
    this.geom.setDrawRange(0, this.count);
    (this.geom.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geom.getAttribute('color4') as THREE.BufferAttribute).needsUpdate = true;
    (this.geom.getAttribute('size') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.geom.dispose();
    this.mat.dispose();
  }
}
