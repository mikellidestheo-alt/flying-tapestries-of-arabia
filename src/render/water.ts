// Water: a single large plane at the chapter's water level. 'shader' mode has gentle
// ripples and sun sparkle; 'flat' mode (Low preset) is a plain fogged colour.
import * as THREE from 'three';
import { TO_LINEAR_GLSL, linearOut } from './colorspace';
import type { ChapterConfig } from '../data/chapters';

export type WaterMode = 'shader' | 'flat';

export class Water {
  readonly mesh: THREE.Mesh;
  private shader: THREE.ShaderMaterial;
  private flat: THREE.MeshBasicMaterial;
  private timeUniform = { value: 0 };

  constructor(chapter: ChapterConfig, mode: WaterMode) {
    const p = chapter.palette;
    const sunDir = new THREE.Vector3(...p.sunDir).normalize();
    this.shader = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          shallow: { value: new THREE.Color(p.waterShallow) },
          deep: { value: new THREE.Color(p.waterDeep) },
          sunColor: { value: new THREE.Color(p.sun) },
          sunDir: { value: sunDir },
          time: this.timeUniform,
        },
      ]),
      vertexShader: /* glsl */ `
        #include <fog_pars_vertex>
        varying vec3 vWorld;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          vec4 mvPosition = viewMatrix * w;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        precision mediump float;
        ${TO_LINEAR_GLSL}
        uniform vec3 shallow; uniform vec3 deep; uniform vec3 sunColor; uniform vec3 sunDir;
        uniform float time;
        varying vec3 vWorld;
        #include <fog_pars_fragment>
        void main() {
          vec3 view = normalize(cameraPosition - vWorld);
          float r = sin(vWorld.x * 0.55 + time * 1.3) * sin(vWorld.z * 0.47 - time * 1.1)
                  + 0.5 * sin(vWorld.x * 1.3 - vWorld.z * 1.1 + time * 2.1);
          vec3 n = normalize(vec3(r * 0.12, 1.0, -r * 0.09));
          float fres = pow(1.0 - clamp(view.y, 0.0, 1.0), 2.5);
          vec3 c = mix(deep, shallow, 0.5 + 0.09 * r + 0.3 * (1.0 - fres));
          vec3 refl = reflect(-view, n);
          float spec = pow(max(dot(refl, normalize(sunDir)), 0.0), 60.0);
          c += sunColor * spec * 1.4;
          gl_FragColor = vec4(toLinearOut(c), 0.9);
          #include <fog_fragment>
        }`,
    });
    if (p.cloudSea) {
      this.shader.dispose();
      // Cloud sea: opaque billows from a few sine layers; shallow = sunlit tops, deep = shaded troughs.
      this.shader = new THREE.ShaderMaterial({
        fog: true,
        uniforms: THREE.UniformsUtils.merge([
          THREE.UniformsLib.fog,
          { shallow: { value: new THREE.Color(p.waterShallow) }, deep: { value: new THREE.Color(p.waterDeep) }, sunColor: { value: new THREE.Color(p.sun) }, time: this.timeUniform },
        ]),
        vertexShader: /* glsl */ `
          #include <fog_pars_vertex>
          varying vec3 vWorld;
          void main() {
            vec4 w = modelMatrix * vec4(position, 1.0);
            vWorld = w.xyz;
            vec4 mvPosition = viewMatrix * w;
            gl_Position = projectionMatrix * mvPosition;
            #include <fog_vertex>
          }`,
        fragmentShader: /* glsl */ `
          precision mediump float;
          ${TO_LINEAR_GLSL}
          uniform vec3 shallow; uniform vec3 deep; uniform vec3 sunColor; uniform float time;
          varying vec3 vWorld;
          #include <fog_pars_fragment>
          void main() {
            vec2 q = vWorld.xz;
            float a = sin(q.x * 0.021 + time * 0.07) * sin(q.y * 0.017 - time * 0.05);
            float b = sin(q.x * 0.047 - q.y * 0.039 + time * 0.11 + a * 2.0);
            float c = sin(q.x * 0.11 + q.y * 0.09 - time * 0.16 + b * 1.5);
            float billow = 0.5 + 0.28 * a + 0.16 * b + 0.06 * c;
            vec3 col = mix(deep, shallow, smoothstep(0.25, 0.8, billow));
            col += sunColor * 0.12 * smoothstep(0.65, 1.0, billow);
            gl_FragColor = vec4(toLinearOut(col), 1.0);
            #include <fog_fragment>
          }`,
      });
    }
    this.shader.uniforms.linearOut = linearOut; // merged uniforms are copies, so share the global one explicitly
    this.flat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(p.waterShallow).lerp(new THREE.Color(p.waterDeep), 0.45),
    });
    const geom = new THREE.PlaneGeometry(1, 1, 1, 1);
    geom.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geom, mode === 'shader' ? this.shader : this.flat);
    this.mesh.position.y = chapter.terrain.waterLevel;
    this.mesh.renderOrder = p.cloudSea ? 0 : 1;
    this.mesh.frustumCulled = false;
  }

  setMode(mode: WaterMode): void {
    this.mesh.material = mode === 'shader' ? this.shader : this.flat;
  }

  update(focusX: number, focusZ: number, size: number, time: number): void {
    this.mesh.position.x = focusX;
    this.mesh.position.z = focusZ;
    this.mesh.scale.set(size, 1, size);
    this.timeUniform.value = time;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.shader.dispose();
    this.flat.dispose();
  }
}
