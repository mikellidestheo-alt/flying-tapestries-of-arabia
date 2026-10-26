// In-game HUD (DOM). Reads sim state ~10x per second; only touches the DOM when values change.
import simData from '../data/sim.json';
import { SPELLS, spellFor } from '../sim/combat';
import { wrapAngle } from '../sim/dmath';
import type { Sim } from '../sim/sim';

const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;

export class Hud {
  private hpFill = $<HTMLElement>('#hpFill');
  private manaFill = $<HTMLElement>('#manaFill');
  private manaText = $<HTMLElement>('#manaText');
  private spellBtn = $<HTMLElement>('#btnSpell');
  private spellCd = $<HTMLElement>('#spellCd');
  private spellCost = $<HTMLElement>('#spellCost');
  private guide = $<HTMLElement>('#wellGuide');
  private arrow = $<SVGElement>('#wellArrow');
  private dist = $<HTMLElement>('#wellDist');
  private toast = $<HTMLElement>('#toast');
  private vignette = $<HTMLElement>('#vignette');
  private toastTimer = 0;
  private vignetteTimer = 0;
  private last = { hp: -1, mana: -1, cd: -1, nomana: false, guide: '', rot: 999, dist: -1 };
  reducedFlashing = false;

  constructor() {
    this.spellCost.textContent = String(SPELLS[spellFor()]!.manaCost);
  }

  update(sim: Sim, heading: number): void {
    const p = sim.players[0]!;
    const hp = Math.round((p.hp / simData.player.maxHp) * 100);
    if (hp !== this.last.hp) {
      this.last.hp = hp;
      this.hpFill.style.transform = `scaleX(${hp / 100})`;
    }
    const mana = Math.floor(p.mana);
    if (mana !== this.last.mana) {
      this.last.mana = mana;
      this.manaFill.style.transform = `scaleX(${p.mana / simData.player.maxMana})`;
      this.manaText.textContent = String(mana);
    }
    const def = SPELLS[spellFor()]!;
    const cd = Math.round((p.spellCd / def.cooldownTicks) * 100);
    if (cd !== this.last.cd) {
      this.last.cd = cd;
      this.spellCd.style.setProperty('--cd', `${cd}%`);
    }
    const nomana = p.mana < def.manaCost;
    if (nomana !== this.last.nomana) {
      this.last.nomana = nomana;
      this.spellBtn.classList.toggle('nomana', nomana);
    }

    // Point at the nearest live well.
    let best: { x: number; z: number } | null = null;
    let bd = Infinity;
    for (const w of sim.wells) {
      if (w.fade > 0) continue;
      const d = (w.x - p.x) ** 2 + (w.z - p.z) ** 2;
      if (d < bd) {
        bd = d;
        best = w;
      }
    }
    const meters = best ? Math.round(Math.sqrt(bd)) : -1;
    const show = best !== null && meters > 24;
    const key = show ? 'on' : 'off';
    if (key !== this.last.guide) {
      this.last.guide = key;
      this.guide.classList.toggle('hidden', !show);
    }
    if (show && best) {
      const rel = wrapAngle(Math.atan2(best.x - p.x, best.z - p.z) - heading);
      const deg = Math.round((-rel * 180) / Math.PI / 3) * 3;
      if (deg !== this.last.rot) {
        this.last.rot = deg;
        this.arrow.style.transform = `rotate(${deg}deg)`;
      }
      const d10 = Math.round(meters / 10) * 10;
      if (d10 !== this.last.dist) {
        this.last.dist = d10;
        this.dist.textContent = `Mana well ${d10} m`;
      }
    }
  }

  showToast(text: string, ms = 3200): void {
    this.toast.textContent = text;
    this.toast.classList.remove('hidden');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.add('hidden'), ms);
  }

  damageFlash(): void {
    if (this.reducedFlashing) return;
    this.vignette.classList.add('on');
    window.clearTimeout(this.vignetteTimer);
    this.vignetteTimer = window.setTimeout(() => this.vignette.classList.remove('on'), 90);
  }
}
