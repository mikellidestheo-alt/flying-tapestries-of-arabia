// Touch (floating left stick + action buttons), keyboard (dev convenience) and optional tilt.
// Produces a PlayerInput per sim tick. Never touches gameplay state.
import { ACTION_CRATER, ACTION_MOUND, ACTION_DEPOSIT, ACTION_SIGNATURE, ACTION_SPELL, ACTION_SPELLUP, ACTION_UPGRADE, type PlayerInput } from '../sim/sim';

const DEADZONE = 0.12;
const STICK_RADIUS = 64; // px of thumb travel for full deflection

function shape(v: number): number {
  const a = Math.abs(v);
  return Math.sign(v) * (a * 0.55 + a * a * 0.45);
}

export class Controls {
  steerAxis = 0;
  throttleAxis = 0;
  private stickPointer = -1;
  private originX = 0;
  private originY = 0;
  private held = 0;
  private pressed = 0;
  private upgradeBranch = -1;
  private keys = new Set<string>();
  private tiltRaw = 0;
  private tiltNeutral: number | null = null;
  private tiltOn = false;
  private motionHandler = (e: DeviceMotionEvent) => this.onMotion(e);

  get tiltEnabled(): boolean {
    return this.tiltOn;
  }

  /** The motion listener only exists while tilt steering is on (it fires ~60 times a second). */
  set tiltEnabled(on: boolean) {
    if (on === this.tiltOn) return;
    this.tiltOn = on;
    if (on) window.addEventListener('devicemotion', this.motionHandler);
    else window.removeEventListener('devicemotion', this.motionHandler);
  }
  tiltInvert = false;
  onPress: ((bit: number) => void) | null = null;

  private stick: HTMLElement;
  private knob: HTMLElement;
  private hint: HTMLElement;

  constructor(private root: HTMLElement) {
    const zone = root.querySelector<HTMLElement>('#stickZone')!;
    this.stick = root.querySelector<HTMLElement>('#stick')!;
    this.knob = root.querySelector<HTMLElement>('#stickKnob')!;
    this.hint = root.querySelector<HTMLElement>('#stickHint')!;

    zone.addEventListener('pointerdown', (e) => {
      if (this.stickPointer !== -1) return;
      this.stickPointer = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      this.originX = e.clientX;
      this.originY = e.clientY;
      this.stick.style.left = `${e.clientX}px`;
      this.stick.style.top = `${e.clientY}px`;
      this.stick.classList.remove('hidden');
      this.hint.classList.add('hidden');
      this.moveKnob(0, 0);
      e.preventDefault();
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickPointer) return;
      let dx = e.clientX - this.originX;
      let dy = e.clientY - this.originY;
      const len = Math.hypot(dx, dy);
      if (len > STICK_RADIUS) {
        // Drag the origin along so the thumb never has to travel back across the stick.
        const over = len - STICK_RADIUS;
        this.originX += (dx / len) * over * 0.5;
        this.originY += (dy / len) * over * 0.5;
        this.stick.style.left = `${this.originX}px`;
        this.stick.style.top = `${this.originY}px`;
        dx = e.clientX - this.originX;
        dy = e.clientY - this.originY;
      }
      this.moveKnob(dx, dy);
      const nx = Math.max(-1, Math.min(1, dx / STICK_RADIUS));
      const ny = Math.max(-1, Math.min(1, dy / STICK_RADIUS));
      const mag = Math.hypot(nx, ny);
      if (mag < DEADZONE) {
        this.steerAxis = 0;
        this.throttleAxis = 0;
      } else {
        this.steerAxis = shape(nx);
        this.throttleAxis = shape(-ny); // push up = boost, pull down = brake
      }
      e.preventDefault();
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stickPointer) return;
      this.stickPointer = -1;
      this.steerAxis = 0;
      this.throttleAxis = 0;
      this.stick.classList.add('hidden');
      this.hint.classList.remove('hidden');
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);

    this.bindButton('#btnCrater', ACTION_CRATER);
    this.bindButton('#btnMound', ACTION_MOUND);
    this.bindButton('#btnSpell', ACTION_SPELL);
    this.bindButton('#btnDeposit', ACTION_DEPOSIT);
    this.bindButton('#btnSig', ACTION_SIGNATURE);
    this.bindTap('#btnWeapon', ACTION_SPELLUP);

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyC') this.pressed |= ACTION_CRATER;
      if (e.code === 'KeyV') this.pressed |= ACTION_MOUND;
      if (e.code === 'Space' || e.code === 'KeyF') this.pressed |= ACTION_SPELL;
      if (e.code === 'KeyU') this.upgradeBranch = 1;
      if (e.code === 'KeyG') this.pressed |= ACTION_SPELLUP;
      if (e.code === 'KeyE') this.pressed |= ACTION_SIGNATURE;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.releaseAll());

  }

  private bindButton(sel: string, bit: number): void {
    const el = this.root.querySelector<HTMLElement>(sel)!;
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      this.held |= bit;
      this.pressed |= bit;
      el.classList.add('down');
      this.onPress?.(bit);
      e.preventDefault();
      e.stopPropagation();
    });
    const up = (e: PointerEvent) => {
      this.held &= ~bit;
      el.classList.remove('down');
      e.stopPropagation();
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  /** A button that fires once per tap (no auto-repeat while held). */
  private bindTap(sel: string, bit: number): void {
    const el = this.root.querySelector<HTMLElement>(sel)!;
    el.addEventListener('pointerdown', (e) => {
      this.pressed |= bit;
      this.onPress?.(bit);
      e.preventDefault();
      e.stopPropagation();
    });
  }

  private moveKnob(dx: number, dy: number): void {
    const len = Math.hypot(dx, dy);
    const k = len > STICK_RADIUS ? STICK_RADIUS / len : 1;
    this.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
  }

  /** Gravity component along the screen's right edge, relative to the neutral hold. */
  private onMotion(e: DeviceMotionEvent): void {
    const g = e.accelerationIncludingGravity;
    if (!g || g.x == null || g.y == null) return;
    const angle = screen.orientation?.angle ?? 0;
    let r: number;
    switch (angle) {
      case 90: r = g.y; break;
      case 180: r = g.x; break;
      case 270: r = -g.y; break;
      default: r = -g.x;
    }
    this.tiltRaw = r;
  }

  /** Ask the sim to upgrade the castle next tick (branch 1-3, or 0 when the tier has no choice). */
  requestUpgrade(branch: number): void {
    this.upgradeBranch = branch;
  }

  recalibrateTilt(): void {
    this.tiltNeutral = null;
  }

  releaseAll(): void {
    this.keys.clear();
    this.held = 0;
    this.pressed = 0;
    this.upgradeBranch = -1;
  }

  /** Sample once per sim tick. */
  sample(): PlayerInput {
    let steer = this.steerAxis;
    let throttle = this.throttleAxis;

    const k = this.keys;
    const kx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const ky = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    if (kx !== 0) steer = kx;
    if (ky !== 0) throttle = ky;

    if (this.tiltEnabled && kx === 0 && this.stickPointer === -1) {
      if (this.tiltNeutral === null) this.tiltNeutral = this.tiltRaw;
      const t = (this.tiltRaw - this.tiltNeutral) / 4.2; // ~25 degrees = full steer
      steer = Math.max(-1, Math.min(1, shape(Math.abs(t) < 0.06 ? 0 : t))) * (this.tiltInvert ? -1 : 1);
    }

    const actions = this.held | this.pressed | (k.has('KeyC') ? ACTION_CRATER : 0) | (k.has('KeyV') ? ACTION_MOUND : 0) | (k.has('Space') || k.has('KeyF') ? ACTION_SPELL : 0) | (k.has('KeyB') ? ACTION_DEPOSIT : 0) | (k.has('KeyE') ? ACTION_SIGNATURE : 0);
    this.pressed = 0;
    let branch = 0;
    let act = actions;
    if (this.upgradeBranch >= 0) {
      act |= ACTION_UPGRADE;
      branch = this.upgradeBranch;
      this.upgradeBranch = -1;
    }
    return { steer, throttle, actions: act, branch };
  }
}
