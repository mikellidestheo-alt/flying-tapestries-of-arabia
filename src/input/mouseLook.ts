// Mouse look for laptops (Pointer Lock): horizontal movement steers (a turn-rate command, like the stick),
// vertical movement tilts the carpet up or down (it climbs or descends and your spells fly that way).
// Pure and deterministic so it can be unit-tested; Controls feeds it raw movementX/movementY.
import controls from '../data/controls.json';

export type Sensitivity = keyof typeof controls.sensitivity;

export class MouseLook {
  private dx = 0;
  private idle = 0;
  /** Wanted pitch, -1 (down) .. 1 (up). Persists, then eases back to level when the mouse rests. */
  pitch = 0;

  feed(dx: number, dy: number, sens: Sensitivity = 'normal'): void {
    const k = controls.sensitivity[sens];
    this.dx += dx;
    this.pitch = Math.max(-1, Math.min(1, this.pitch - dy * controls.mousePitch * k));
    if (dx !== 0 || dy !== 0) this.idle = 0;
  }

  /** Called once per sim tick: returns the steer command for the movement since the last tick. */
  sample(sens: Sensitivity = 'normal'): { steer: number; pitch: number } {
    const k = controls.sensitivity[sens];
    const steer = Math.max(-1, Math.min(1, this.dx * controls.mouseYaw * k));
    this.dx = 0;
    if (++this.idle > controls.pitchRecenterDelayTicks) this.pitch *= controls.pitchRecenter;
    if (Math.abs(this.pitch) < 0.002) this.pitch = 0;
    return { steer, pitch: this.pitch };
  }

  reset(): void {
    this.dx = 0;
    this.pitch = 0;
    this.idle = 0;
  }
}
