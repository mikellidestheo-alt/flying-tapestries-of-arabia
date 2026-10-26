// The player's flying tapestry: a woven cloth (procedural canvas texture, no files) with a
// simple wizard, a glow, and a blob shadow.
import * as THREE from 'three';
import type { Element } from '../data/elements';
import { wizardLook } from '../data/wizardLooks';
import { buildWizard } from './wizardModel';

function makeWeave(base = '#7a1730', accent = '#16706b'): THREE.CanvasTexture {
  const w = 256;
  const h = 160;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  // Gold border bands with a diamond repeat.
  g.fillStyle = '#e9b44c';
  g.fillRect(0, 0, w, 10);
  g.fillRect(0, h - 10, w, 10);
  g.fillRect(0, 0, 10, h);
  g.fillRect(w - 10, 0, 10, h);
  g.fillStyle = accent;
  for (let x = 14; x < w - 14; x += 16) {
    g.beginPath();
    g.moveTo(x + 8, 14);
    g.lineTo(x + 14, 22);
    g.lineTo(x + 8, 30);
    g.lineTo(x + 2, 22);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(x + 8, h - 14);
    g.lineTo(x + 14, h - 22);
    g.lineTo(x + 8, h - 30);
    g.lineTo(x + 2, h - 22);
    g.closePath();
    g.fill();
  }
  // Central medallion: eight-pointed star.
  g.translate(w / 2, h / 2);
  g.fillStyle = accent;
  g.beginPath();
  g.arc(0, 0, 44, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#f3d27a';
  for (let k = 0; k < 2; k++) {
    g.save();
    g.rotate((k * Math.PI) / 4);
    g.fillRect(-30, -30, 60, 60);
    g.restore();
  }
  g.fillStyle = base;
  g.beginPath();
  g.arc(0, 0, 14, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#e9b44c';
  g.beginPath();
  g.arc(0, 0, 6, 0, Math.PI * 2);
  g.fill();
  g.setTransform(1, 0, 0, 1, 0, 0);
  // Woven thread lines.
  g.globalAlpha = 0.12;
  g.fillStyle = '#000';
  for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1);
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 1;
  return tex;
}

function makeGlowTexture(inner: string, outer: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const SEG_X = 10;
const SEG_Z = 6;

export class TapestryModel {
  readonly root = new THREE.Group();
  /** Everything that banks/pitches with the flight. */
  private body = new THREE.Group();
  private cloth: THREE.Mesh;
  private clothPos: THREE.BufferAttribute;
  private baseX: Float32Array;
  private baseZ: Float32Array;
  readonly shadow: THREE.Mesh;
  private glow: THREE.Mesh;
  private disposables: { dispose(): void }[] = [];

  private wizardMesh: THREE.Mesh | null = null;

  constructor(wizard: Element = 'fire', clothBase = '#7a1730', clothAccent = '#16706b') {
    const geom = new THREE.PlaneGeometry(4.4, 2.8, SEG_X, SEG_Z);
    geom.rotateX(-Math.PI / 2);
    this.clothPos = geom.getAttribute('position') as THREE.BufferAttribute;
    this.baseX = new Float32Array(this.clothPos.count);
    this.baseZ = new Float32Array(this.clothPos.count);
    for (let i = 0; i < this.clothPos.count; i++) {
      this.baseX[i] = this.clothPos.getX(i);
      this.baseZ[i] = this.clothPos.getZ(i);
    }
    const tex = makeWeave(clothBase, clothAccent);
    const clothMat = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
    this.cloth = new THREE.Mesh(geom, clothMat);
    this.body.add(this.cloth);
    this.disposables.push(geom, clothMat, tex);

    this.setWizard(wizard);
    this.root.add(this.body);

    // Soft additive glow under the cloth (cheap fake bloom).
    const glowTex = makeGlowTexture('rgba(255,210,120,0.55)', 'rgba(255,210,120,0)');
    const glowMat = new THREE.MeshBasicMaterial({
      map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    const glowGeom = new THREE.PlaneGeometry(1, 1);
    glowGeom.rotateX(-Math.PI / 2);
    this.glow = new THREE.Mesh(glowGeom, glowMat);
    this.glow.scale.set(7.5, 1, 6);
    this.glow.position.y = -0.25;
    this.body.add(this.glow);
    this.disposables.push(glowTex, glowMat, glowGeom);

    // Blob shadow (no shadow maps).
    const shTex = makeGlowTexture('rgba(0,0,0,0.5)', 'rgba(0,0,0,0)');
    const shMat = new THREE.MeshBasicMaterial({
      map: shTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const shGeom = new THREE.PlaneGeometry(1, 1);
    shGeom.rotateX(-Math.PI / 2);
    this.shadow = new THREE.Mesh(shGeom, shMat);
    this.shadow.renderOrder = 2;
    this.disposables.push(shTex, shMat, shGeom);
  }

  /** Swap the rider (turbaned man or headscarfed woman, per element). */
  setWizard(element: Element): void {
    if (this.wizardMesh) {
      this.body.remove(this.wizardMesh);
      this.wizardMesh.geometry.dispose();
      (this.wizardMesh.material as THREE.Material).dispose();
    }
    this.wizardMesh = buildWizard(wizardLook(element));
    this.wizardMesh.position.set(0, 0.05, 0.1);
    this.wizardMesh.scale.setScalar(1.25);
    this.body.add(this.wizardMesh);
  }

  /** `time` in seconds drives the cloth ripple; `flutter` grows with speed. */
  update(time: number, flutter: number, roll: number, pitch: number): void {
    const amp = 0.08 + 0.12 * flutter;
    for (let i = 0; i < this.clothPos.count; i++) {
      const x = this.baseX[i]!;
      const z = this.baseZ[i]!;
      const edge = Math.abs(z) / 1.4;
      const y = Math.sin(time * 6 + x * 1.5 + z * 0.6) * amp * (0.35 + edge) + x * 0.02 * Math.sin(time * 3);
      this.clothPos.setY(i, y);
    }
    this.clothPos.needsUpdate = true;
    this.body.rotation.z = roll;
    this.body.rotation.x = pitch;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    if (this.wizardMesh) {
      this.wizardMesh.geometry.dispose();
      (this.wizardMesh.material as THREE.Material).dispose();
    }
  }
}
