// Quality presets (local and visual only; never affects the shared simulation) and the
// adaptive governor that trades render scale / view distance for steady frame time.
import q from '../data/quality.json';
import type { QualityPreset } from '../save';

export type QualityPresetData = (typeof q.presets)['high'];
export const PRESETS = q.presets as Record<QualityPreset, QualityPresetData>;
export const GOVERNOR = q.governor;
export const GLOBAL_PIXEL_RATIO_CAP = q.pixelRatioCap;

/** First-launch guess from cheap device hints. The governor refines it at runtime. */
export function guessPreset(): QualityPreset {
  const cores = navigator.hardwareConcurrency || 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  let gpu = '';
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    if (gl && ext) gpu = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)).toLowerCase();
  } catch {
    gpu = '';
  }
  const m = /adreno \(tm\) (\d{3})|adreno.*?(\d{3})/.exec(gpu);
  const adreno = m ? Number(m[1] ?? m[2]) : 0;
  if (/swiftshader|llvmpipe|software/.test(gpu)) return 'low';
  if (adreno >= 750 || /mali-g(7[1-9]|9\d)|immortalis/.test(gpu)) return 'high';
  if (adreno >= 610 || mem >= 6) return 'medium';
  if (cores <= 4 || mem <= 3 || (adreno > 0 && adreno < 610)) return 'low';
  return 'medium';
}

/**
 * Adaptive governor. Feed it the frame time (ms) every rendered frame. It lowers the render
 * scale first, then view distance, when frames run long, and creeps back up when there is
 * sustained headroom. It only reports changes; the caller applies them.
 */
export class QualityGovernor {
  renderScale = 1;
  radiusScale = 1;
  private sum = 0;
  private count = 0;
  private settle: number = GOVERNOR.settleFrames;
  private calmWindows = 0;
  private upHold: number = GOVERNOR.upHoldWindows;
  private windowsSinceUp = 1e9;

  constructor(public targetFps: number = GOVERNOR.targetFps) {}

  setTargetFps(fps: number): void {
    this.targetFps = fps;
    this.reset();
  }

  reset(): void {
    this.sum = 0;
    this.count = 0;
    this.calmWindows = 0;
    this.settle = GOVERNOR.settleFrames;
  }

  /** Returns true when renderScale or radiusScale changed. */
  sample(frameMs: number): boolean {
    if (this.settle > 0) {
      this.settle--;
      return false;
    }
    this.sum += frameMs;
    this.count++;
    if (this.count < GOVERNOR.windowFrames) return false;
    const avg = this.sum / this.count;
    this.sum = 0;
    this.count = 0;
    this.windowsSinceUp++;
    const budget = 1000 / this.targetFps;
    let changed = false;
    if (avg > budget * GOVERNOR.downThreshold) {
      this.calmWindows = 0;
      // Went down soon after coming up: back off so we do not oscillate.
      if (this.windowsSinceUp < 10) this.upHold = Math.min(GOVERNOR.maxUpHold, this.upHold * 2);
      if (this.renderScale > GOVERNOR.minRenderScale + 1e-6) {
        this.renderScale = Math.max(GOVERNOR.minRenderScale, this.renderScale - GOVERNOR.downStep);
        changed = true;
      } else if (this.radiusScale > GOVERNOR.minRadiusScale + 1e-6) {
        this.radiusScale = Math.max(GOVERNOR.minRadiusScale, this.radiusScale - GOVERNOR.radiusStep);
        changed = true;
      }
    } else if (avg < budget * GOVERNOR.calmThreshold) {
      this.calmWindows++;
      if (this.calmWindows >= this.upHold) {
        this.calmWindows = 0;
        if (this.radiusScale < 1 - 1e-6) {
          this.radiusScale = Math.min(1, this.radiusScale + GOVERNOR.radiusStep);
          changed = true;
        } else if (this.renderScale < 1 - 1e-6) {
          this.renderScale = Math.min(1, this.renderScale + GOVERNOR.upStep);
          changed = true;
        }
        if (changed) this.windowsSinceUp = 0;
      }
    } else {
      this.calmWindows = 0;
    }
    if (changed) this.settle = GOVERNOR.settleFrames;
    return changed;
  }
}
