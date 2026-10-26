// FPS / frame time / entity counts / network latency readout (toggle in settings).
import type { RenderStats } from '../render/gameRenderer';

export class DebugOverlay {
  private frames = 0;
  private acc = 0;
  private worst = 0;
  private fps = 0;
  private avgMs = 0;
  private worstMs = 0;
  private windowStart = 0;
  visible = false;

  constructor(private el: HTMLElement) {}

  setVisible(v: boolean): void {
    this.visible = v;
    this.el.classList.toggle('hidden', !v);
  }

  /** Call once per rendered frame with the frame interval in ms. */
  frame(now: number, frameMs: number, extra: { stats: RenderStats; renderScale: number; radiusScale: number; preset: string; pingMs: number | null; deltaCount: number }): void {
    this.frames++;
    this.acc += frameMs;
    if (frameMs > this.worst) this.worst = frameMs;
    if (now - this.windowStart < 500) return;
    this.fps = (this.frames * 1000) / (now - this.windowStart);
    this.avgMs = this.acc / this.frames;
    this.worstMs = this.worst;
    this.frames = 0;
    this.acc = 0;
    this.worst = 0;
    this.windowStart = now;
    if (!this.visible) return;
    const s = extra.stats;
    this.el.textContent =
      `${this.fps.toFixed(0)} fps  ${this.avgMs.toFixed(1)} ms  worst ${this.worstMs.toFixed(0)} ms\n` +
      `calls ${s.drawCalls}  tris ${(s.triangles / 1000).toFixed(0)}k  chunks ${s.chunks}  deltas ${s.deltas}\n` +
      `${extra.preset}  scale ${extra.renderScale.toFixed(2)}  view ${extra.radiusScale.toFixed(2)}  dpr ${s.pixelRatio.toFixed(2)}\n` +
      `ping ${extra.pingMs === null ? 'n/a (solo)' : `${extra.pingMs.toFixed(0)} ms`}`;
  }
}
