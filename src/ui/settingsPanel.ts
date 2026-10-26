import { ELEMENTS, type Element } from '../data/elements';
import { wizardLook } from '../data/wizardLooks';
import type { QualityPreset, Settings } from '../save';

type Change = (patch: Partial<Settings>, reapply?: 'quality' | 'auto') => void;

/** Builds the settings controls into `host`. Re-render by calling `refresh`. */
export class SettingsPanel {
  constructor(
    private host: HTMLElement,
    private get: () => Settings,
    private change: Change,
    private wizard: { get: () => Element; set: (e: Element) => void },
  ) {
    this.render();
  }

  refresh(): void {
    this.render();
  }

  private render(): void {
    const s = this.get();
    this.host.replaceChildren();
    this.segRow(
      'Wizard',
      'Look only for now: every wizard throws fireballs until the full spell kits arrive.',
      ELEMENTS.map((e) => [e, wizardLook(e).name] as [string, string]),
      this.wizard.get(),
      (v) => this.wizard.set(v as Element),
    );
    this.segRow('Graphics quality', 'Auto picks for your phone. The game also adapts on the fly.', [
      ['auto', 'Auto'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low'],
    ], s.qualityAuto ? 'auto' : s.quality, (v) => {
      if (v === 'auto') this.change({ qualityAuto: true }, 'auto');
      else this.change({ qualityAuto: false, quality: v as QualityPreset }, 'quality');
    });
    this.switchRow('Battery saver', 'Caps the game at 30 fps.', s.batterySaver, (v) => this.change({ batterySaver: v }));
    this.switchRow('Left-handed layout', 'Mirrors the stick and buttons.', s.leftHanded, (v) => this.change({ leftHanded: v }));
    this.switchRow('Tilt steering (experimental)', 'Tilt the phone to steer. Hold it comfortably, then turn this on.', s.tilt, (v) => this.change({ tilt: v }));
    this.switchRow('Vibration', 'Short haptic buzz on actions.', s.haptics, (v) => this.change({ haptics: v }));
    this.switchRow('Reduced flashing', 'Softens bright flashes (used by effects in later updates).', s.reducedFlashing, (v) => this.change({ reducedFlashing: v }));
    this.switchRow('Debug overlay', 'FPS, frame time, entity counts, latency.', s.debugOverlay, (v) => this.change({ debugOverlay: v }));
  }

  private row(label: string, hint: string): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'row';
    const l = document.createElement('label');
    l.textContent = label;
    const small = document.createElement('small');
    small.textContent = hint;
    l.appendChild(small);
    row.appendChild(l);
    this.host.appendChild(row);
    return row;
  }

  private switchRow(label: string, hint: string, on: boolean, set: (v: boolean) => void): void {
    const row = this.row(label, hint);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `switch${on ? ' on' : ''}`;
    b.setAttribute('role', 'switch');
    b.setAttribute('aria-checked', String(on));
    b.setAttribute('aria-label', label);
    b.addEventListener('click', () => {
      set(!on);
      this.render();
    });
    row.appendChild(b);
  }

  private segRow(label: string, hint: string, opts: [string, string][], value: string, set: (v: string) => void): void {
    const row = this.row(label, hint);
    const seg = document.createElement('div');
    seg.className = 'seg';
    for (const [v, text] of opts) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      if (v === value) b.className = 'on';
      b.addEventListener('click', () => {
        set(v);
        this.render();
      });
      seg.appendChild(b);
    }
    row.appendChild(seg);
  }
}
