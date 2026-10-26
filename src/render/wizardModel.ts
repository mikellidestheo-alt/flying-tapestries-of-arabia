// Low-poly Arabian wizards, merged into ONE mesh (vertex colours, one draw call).
// Men wear a wrapped turban with a jewel and a hanging tail; women wear a headscarf
// draped over the shoulders. The jewel's SHAPE differs per element (never colour alone).
// The model faces +z, height about 2.4 units, origin at the feet.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { WizardLook } from '../data/wizardLooks';

class Builder {
  private parts: THREE.BufferGeometry[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();

  add(g: THREE.BufferGeometry, color: string, pos: [number, number, number], rot: [number, number, number] = [0, 0, 0], scale: [number, number, number] = [1, 1, 1]): void {
    this.e.set(rot[0], rot[1], rot[2]);
    this.q.setFromEuler(this.e);
    this.m.compose(new THREE.Vector3(...pos), this.q, new THREE.Vector3(...scale));
    let geo = g.index ? g.toNonIndexed() : g.clone();
    g.dispose();
    geo.deleteAttribute('uv');
    geo.applyMatrix4(this.m);
    const c = new THREE.Color(color);
    const n = geo.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.parts.push(geo);
    geo = null as unknown as THREE.BufferGeometry;
  }

  build(): THREE.BufferGeometry {
    const merged = mergeGeometries(this.parts, false)!;
    for (const p of this.parts) p.dispose();
    this.parts = [];
    return merged;
  }
}

function gemGeometry(element: WizardLook['element'], size: number): THREE.BufferGeometry {
  switch (element) {
    case 'fire': return new THREE.ConeGeometry(size * 0.9, size * 2.6, 4); // flame
    case 'water': return new THREE.SphereGeometry(size, 6, 5); // droplet
    case 'earth': return new THREE.BoxGeometry(size * 1.6, size * 1.6, size * 1.6); // block
    case 'air': return new THREE.TorusGeometry(size, size * 0.38, 5, 8); // ring
  }
}

export function buildWizardGeometry(look: WizardLook): THREE.BufferGeometry {
  const b = new Builder();
  const woman = look.gender === 'woman';

  // Robe and sash.
  b.add(new THREE.CylinderGeometry(0.34, 0.66, 1.3, 10), look.robe, [0, 0.68, 0.05]);
  b.add(new THREE.TorusGeometry(0.46, 0.07, 5, 12), look.sash, [0, 0.95, 0.05], [Math.PI / 2, 0, 0]);
  b.add(new THREE.BoxGeometry(0.16, 0.5, 0.05), look.sash, [0.22, 0.7, 0.5], [0, 0, 0.12]); // sash tail
  // Arms reaching forward, with hands.
  for (const sx of [-1, 1]) {
    b.add(new THREE.CylinderGeometry(0.1, 0.14, 0.62, 6), look.robe, [sx * 0.42, 1.12, 0.3], [-0.95, 0, sx * -0.22]);
    b.add(new THREE.SphereGeometry(0.1, 6, 5), look.skin, [sx * 0.46, 1.0, 0.6]);
  }
  // Head.
  const headY = 1.62;
  b.add(new THREE.SphereGeometry(0.27, 10, 8), look.skin, [0, headY, 0.06]);

  if (!woman) {
    // Turban: stacked wrapped rings, a dome, a jewel at the front, a tail hanging behind.
    b.add(new THREE.TorusGeometry(0.31, 0.11, 6, 14), look.headwear, [0, headY + 0.2, 0.06], [Math.PI / 2, 0, 0]);
    b.add(new THREE.TorusGeometry(0.27, 0.11, 6, 14), look.trim, [0, headY + 0.33, 0.06], [Math.PI / 2 + 0.22, 0, 0.18]);
    b.add(new THREE.SphereGeometry(0.27, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), look.headwear, [0, headY + 0.38, 0.06], [0, 0, 0], [1, 1.05, 1]);
    b.add(gemGeometry(look.element, 0.055), look.gem, [0, headY + 0.3, 0.37]);
    b.add(new THREE.BoxGeometry(0.17, 0.62, 0.04), look.headwear, [0.2, headY - 0.15, -0.26], [0.18, 0, -0.12]);
    if (look.beard) b.add(new THREE.ConeGeometry(0.15, 0.34, 6), '#2b1a12', [0, headY - 0.26, 0.24], [Math.PI, 0, 0]);
  } else {
    // Headscarf: wraps the head, frames the face, drapes over the shoulders and down the back.
    b.add(new THREE.SphereGeometry(0.32, 10, 8), look.headwear, [0, headY + 0.03, -0.02], [0, 0, 0], [1, 1.1, 1.05]);
    b.add(new THREE.SphereGeometry(0.2, 8, 6), look.skin, [0, headY - 0.01, 0.22], [0, 0, 0], [1, 1.15, 0.55]);
    b.add(new THREE.ConeGeometry(0.62, 0.62, 10), look.headwear, [0, 1.3, 0]);
    b.add(new THREE.BoxGeometry(0.5, 0.95, 0.05), look.headwear, [0, 1.0, -0.36], [0.12, 0, 0]);
    b.add(new THREE.TorusGeometry(0.22, 0.03, 5, 12, Math.PI), look.trim, [0, headY + 0.17, 0.2], [0.35, 0, 0]);
    b.add(gemGeometry(look.element, 0.05), look.gem, [0, headY + 0.2, 0.3]);
  }
  return b.build();
}

export function buildWizard(look: WizardLook): THREE.Mesh {
  const geom = buildWizardGeometry(look);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  return new THREE.Mesh(geom, mat);
}
