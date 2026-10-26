// Tiny flat-shaded mesh builder: pushes triangles with baked sun lighting into plain arrays.
// Used for castles, nests and city buildings, which share the terrain's lighting model
// (vertex colours + MeshBasicMaterial, no lights, no textures, one draw call per mesh).
import * as THREE from 'three';

export interface Lighting {
  sunDir: THREE.Vector3;
  sun: THREE.Color;
  ambient: THREE.Color;
}

export type Vec3 = [number, number, number];

export class Mesher {
  pos: number[] = [];
  col: number[] = [];
  private c = new THREE.Color();
  private tmp = new THREE.Color();

  constructor(private light: Lighting) {}

  get triangleCount(): number {
    return this.pos.length / 9;
  }

  /** One triangle, lit by its geometric normal. */
  tri(a: Vec3, b: Vec3, c: Vec3, color: string | THREE.Color): void {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    const L = this.light.sunDir;
    const lam = Math.max(0, nx * L.x + ny * L.y + nz * L.z);
    const lit = Math.min(1, lam / 0.8);
    const s = lit * lit * (3 - 2 * lit);
    this.c.set(color as string);
    this.tmp.copy(this.light.ambient).multiplyScalar(0.8);
    const sr = this.light.sun.r * 0.95 * s;
    const sg = this.light.sun.g * 0.95 * s;
    const sb = this.light.sun.b * 0.95 * s;
    const r = Math.min(1, this.c.r * (this.tmp.r + sr) * 1.35);
    const g = Math.min(1, this.c.g * (this.tmp.g + sg) * 1.35);
    const bl = Math.min(1, this.c.b * (this.tmp.b + sb) * 1.35);
    for (const p of [a, b, c]) {
      this.pos.push(p[0], p[1], p[2]);
      this.col.push(r, g, bl);
    }
  }

  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, color: string | THREE.Color): void {
    this.tri(a, b, c, color);
    this.tri(a, c, d, color);
  }

  /** Axis-aligned (optionally Y-rotated) box centred at (cx, cy, cz). */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: string | THREE.Color, rotY = 0, topColor?: string | THREE.Color): void {
    const cs = Math.cos(rotY);
    const sn = Math.sin(rotY);
    const hx = sx / 2;
    const hy = sy / 2;
    const hz = sz / 2;
    const P = (x: number, y: number, z: number): Vec3 => [cx + x * cs + z * sn, cy + y, cz - x * sn + z * cs];
    const v = [P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(-hx, hy, -hz), P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz)] as const;
    this.quad(v[1], v[0], v[3], v[2], color); // -z
    this.quad(v[4], v[5], v[6], v[7], color); // +z
    this.quad(v[0], v[4], v[7], v[3], color); // -x
    this.quad(v[5], v[1], v[2], v[6], color); // +x
    this.quad(v[3], v[7], v[6], v[2], topColor ?? color); // top
  }

  /** Vertical frustum from y0 up by h (rTop = 0 gives a cone). */
  cylinder(cx: number, y0: number, cz: number, rBottom: number, rTop: number, h: number, segs: number, color: string | THREE.Color, topColor?: string | THREE.Color): void {
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      const b0: Vec3 = [cx + Math.cos(a0) * rBottom, y0, cz + Math.sin(a0) * rBottom];
      const b1: Vec3 = [cx + Math.cos(a1) * rBottom, y0, cz + Math.sin(a1) * rBottom];
      const t0: Vec3 = [cx + Math.cos(a0) * rTop, y0 + h, cz + Math.sin(a0) * rTop];
      const t1: Vec3 = [cx + Math.cos(a1) * rTop, y0 + h, cz + Math.sin(a1) * rTop];
      this.tri(b1, b0, t0, color);
      if (rTop > 0) this.tri(b1, t0, t1, color);
      if (topColor !== undefined && rTop > 0) this.tri([cx, y0 + h, cz], t1, t0, topColor);
    }
  }

  /** Upper hemisphere (a dome), optionally squashed vertically. */
  dome(cx: number, y0: number, cz: number, r: number, color: string | THREE.Color, segs = 8, rings = 3, squash = 1): void {
    for (let j = 0; j < rings; j++) {
      const p0 = (j / rings) * (Math.PI / 2);
      const p1 = ((j + 1) / rings) * (Math.PI / 2);
      const r0 = Math.cos(p0) * r;
      const r1 = Math.cos(p1) * r;
      const y_0 = y0 + Math.sin(p0) * r * squash;
      const y_1 = y0 + Math.sin(p1) * r * squash;
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * Math.PI * 2;
        const a1 = ((i + 1) / segs) * Math.PI * 2;
        const A: Vec3 = [cx + Math.cos(a0) * r0, y_0, cz + Math.sin(a0) * r0];
        const B: Vec3 = [cx + Math.cos(a1) * r0, y_0, cz + Math.sin(a1) * r0];
        const C: Vec3 = [cx + Math.cos(a1) * r1, y_1, cz + Math.sin(a1) * r1];
        const D: Vec3 = [cx + Math.cos(a0) * r1, y_1, cz + Math.sin(a0) * r1];
        this.tri(B, A, D, color);
        if (r1 > 0.001) this.tri(B, D, C, color);
      }
    }
  }

  /** Append another mesher's triangles translated by (dx, dy, dz). */
  append(other: Mesher, dx = 0, dy = 0, dz = 0): void {
    for (let i = 0; i < other.pos.length; i += 3) this.pos.push(other.pos[i]! + dx, other.pos[i + 1]! + dy, other.pos[i + 2]! + dz);
    for (let i = 0; i < other.col.length; i++) this.col.push(other.col[i]!);
  }

  toGeometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.col), 3));
    g.computeBoundingSphere();
    return g;
  }
}

export function lightingFromPalette(sunDir: [number, number, number], sunLight: string, ambient: string): Lighting {
  return { sunDir: new THREE.Vector3(...sunDir).normalize(), sun: new THREE.Color(sunLight), ambient: new THREE.Color(ambient) };
}
