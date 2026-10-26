// In-game HUD (DOM). Reads sim state ~10x per second; only touches the DOM when values change.
import castleData from '../data/castles.json';
import simData from '../data/sim.json';
import { BRANCHES, castleStats, nextUpgrade, tierDef } from '../sim/castles';
import { nextSpellUpgrade, spellAt, spellFor } from '../sim/combat';
import { wrapAngle } from '../sim/dmath';
import type { Sim } from '../sim/sim';

const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;

const ICON = {
  castle: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M3 21V9l3 1V6h2v3h2V6h2v3h2V6h2v4l3-1v12h-5v-5a3 3 0 0 0-6 0v5z" fill="currentColor"/></svg>',
  well: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 2 L21 12 L12 22 L3 12 Z" fill="currentColor"/></svg>',
  bow: '<svg viewBox="0 0 24 24" width="30" height="30"><path d="M6 3c8 3 8 15 0 18M6 12h14m-3-3 3 3-3 3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  walls: '<svg viewBox="0 0 24 24" width="30" height="30"><path d="M3 20V8h3V5h2v3h2V5h2v3h2V5h2v3h3v12z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/></svg>',
  coin: '<svg viewBox="0 0 24 24" width="30" height="30"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M12 7v10M9 10h4.5a1.7 1.7 0 0 1 0 3.4H9.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
};
const BRANCH_ICON: Record<string, string> = { archers: ICON.bow, walls: ICON.walls, income: ICON.coin };

interface Marker {
  el: HTMLElement;
  kind: string;
}

export class Hud {
  private hpFill = $<HTMLElement>('#hpFill');
  private manaFill = $<HTMLElement>('#manaFill');
  private manaText = $<HTMLElement>('#manaText');
  private spellBtn = $<HTMLElement>('#btnSpell');
  private spellCd = $<HTMLElement>('#spellCd');
  private spellCost = $<HTMLElement>('#spellCost');
  private toast = $<HTMLElement>('#toast');
  private vignette = $<HTMLElement>('#vignette');
  private shareBar = $<HTMLElement>('#shareBar');
  private shareText = $<HTMLElement>('#shareText');
  private timer = $<HTMLElement>('#timer');
  private compass = $<HTMLElement>('#compass');
  private castleInfo = $<HTMLElement>('#castleInfo');
  private foeInfo = $<HTMLElement>('#foeInfo');
  private foeName = $<HTMLElement>('#foeName');
  private foeFill = $<HTMLElement>('#foeFill');
  private upgrade = $<HTMLButtonElement>('#btnUpgrade');
  private upgradeCost = $<HTMLElement>('#upgradeCost');
  private deposit = $<HTMLElement>('#btnDeposit');
  private weapon = $<HTMLElement>('#btnWeapon');
  private weaponCost = $<HTMLElement>('#weaponCost');
  private palaceInfo = $<HTMLElement>('#palaceInfo');
  private branchPicker = $<HTMLElement>('#branchPicker');
  private branchOptions = $<HTMLElement>('#branchOptions');
  private branchTitle = $<HTMLElement>('#branchTitle');
  private tutorial = $<HTMLElement>('#tutorial');
  private tutorialText = $<HTMLElement>('#tutorialText');
  private segs: HTMLElement[] = [];
  private targetMark: HTMLElement | null = null;
  private markers: Marker[] = [];
  private toastTimer = 0;
  private vignetteTimer = 0;
  private last = { wtier: 0, wcan: false, palace: '', hp: -1, mana: -1, cd: -1, nomana: false, share: '', timer: '', castle: '', foe: '', up: '' };
  reducedFlashing = false;
  onUpgrade: (branch: number) => void = () => undefined;
  private pickerOpen = false;

  constructor() {
    this.spellCost.textContent = String(spellAt(spellFor(), 1).manaCost);
    this.upgrade.addEventListener('click', () => this.pressUpgrade());
    $('#branchCancel').addEventListener('click', () => this.closePicker());
  }

  private sim: Sim | null = null;

  /** Prepare for a new match (builds the share bar). */
  startMatch(sim: Sim): void {
    this.sim = sim;
    this.closePicker();
    this.shareBar.replaceChildren();
    this.segs = sim.factions.map((f) => {
      const seg = document.createElement('i');
      seg.style.background = castleData.factionStyles[f.id % castleData.factionStyles.length]!.color;
      this.shareBar.appendChild(seg);
      return seg;
    });
    this.targetMark = document.createElement('b');
    this.shareBar.appendChild(this.targetMark);
    this.compass.replaceChildren();
    const mid = document.createElement('div');
    mid.className = 'mid';
    this.compass.appendChild(mid);
    this.markers = [];
    this.last = { wtier: 0, wcan: false, palace: '', hp: -1, mana: -1, cd: -1, nomana: false, share: '', timer: '', castle: '', foe: '', up: '' };
    this.castleInfo.classList.add('hidden');
    this.foeInfo.classList.add('hidden');
    this.upgrade.classList.add('hidden');
    this.setTutorial(null);
  }

  private marker(i: number, kind: string): Marker {
    let m = this.markers[i];
    if (!m) {
      const el = document.createElement('div');
      el.className = 'mk';
      this.compass.appendChild(el);
      m = { el, kind: '' };
      this.markers[i] = m;
    }
    if (m.kind !== kind) {
      m.kind = kind;
      m.el.innerHTML = kind.startsWith('well') ? ICON.well : ICON.castle;
    }
    return m;
  }

  update(sim: Sim, localIndex = 0): void {
    const p = sim.players[localIndex]!;
    const hp = Math.round((p.hp / sim.maxHpFor(p)) * 100);
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
    const def = spellAt(spellFor(), p.spellTier);
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

    // Weapon tier pips, spell cost, and the weapon-upgrade button.
    const up = nextSpellUpgrade(p.spellTier);
    const can = !!up && p.mana >= up.cost;
    if (p.spellTier !== this.last.wtier || can !== this.last.wcan) {
      this.last.wtier = p.spellTier;
      this.last.wcan = can;
      this.spellCost.textContent = `${def.manaCost}`;
      this.spellBtn.querySelector('em')!.textContent = ['', 'I', 'II', 'III'][p.spellTier] ?? '';
      this.weapon.classList.toggle('hidden', !up);
      this.weapon.classList.toggle('cant', !can);
      if (up) {
        this.weaponCost.textContent = String(up.cost);
        this.weapon.setAttribute('aria-label', `Upgrade weapon to ${up.name} for ${up.cost} mana`);
      }
    }
    this.updateShares(sim);
    this.updateCompass(sim, p);
    this.updateCastle(sim, p, p.mana);
  }

  private updateShares(sim: Sim): void {
    const m = sim.match;
    const key = m.shares.map((s) => s.toFixed(3)).join(',') + m.targetShare;
    if (key !== this.last.share) {
      this.last.share = key;
      this.segs.forEach((seg, i) => (seg.style.width = `${(m.shares[i] ?? 0) * 100}%`));
      if (this.targetMark) this.targetMark.style.left = `${m.targetShare * 100}%`;
      const mine = Math.round((m.shares[0] ?? 0) * 100);
      this.shareText.textContent = `You ${mine}% · goal ${Math.round(m.targetShare * 100)}%${m.suddenDeath ? ' · SUDDEN DEATH' : ''}`;
    }
    const mineCastle = sim.castles.find((c) => c.faction === 0);
    const need = sim.setup?.palaceWinMana ?? 0;
    const palace = `${mineCastle?.tier ?? 1}|${Math.floor((sim.factions[0]?.captured ?? 0) / 10)}`;
    if (palace !== this.last.palace) {
      this.last.palace = palace;
      const got = Math.floor(sim.factions[0]?.captured ?? 0);
      this.palaceInfo.textContent = `Palace win: tier 5 castle + ${need} mana · you: tier ${mineCastle?.tier ?? 1}, ${got}`;
    }
    const secs = Math.floor(sim.tick / simData.tickRate);
    const t = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    if (t !== this.last.timer) {
      this.last.timer = t;
      this.timer.textContent = t;
    }
  }

  private updateCompass(sim: Sim, p: { x: number; z: number; heading: number }): void {
    let n = 0;
    const place = (x: number, z: number, kind: string, color: string, label: string) => {
      const m = this.marker(n++, kind);
      const rel = wrapAngle(Math.atan2(x - p.x, z - p.z) - p.heading);
      const frac = Math.max(-1, Math.min(1, -rel / (Math.PI / 2)));
      const half = this.compass.clientWidth / 2 - 14;
      m.el.style.transform = `translateX(${Math.round(frac * half)}px)`;
      m.el.style.left = '50%';
      m.el.style.color = color;
      m.el.style.opacity = Math.abs(rel) > Math.PI / 2 ? '0.55' : '1';
      m.el.dataset.label = label;
      if (m.el.dataset.l !== label) {
        m.el.dataset.l = label;
        m.el.innerHTML = (kind.startsWith('well') ? ICON.well : ICON.castle) + (label ? `<span style="position:absolute;bottom:-3px;font-size:10px">${label}</span>` : '');
      }
    };
    for (const c of sim.castles) {
      if (c.ruined) continue;
      const fs = castleData.factionStyles[c.faction % castleData.factionStyles.length]!;
      place(c.x, c.z, c.faction === 0 ? 'castle-home' : 'castle-foe', c.faction === 0 ? '#ffe08a' : fs.color, c.faction === 0 ? '' : String(c.faction));
    }
    for (const w of sim.wells) if (w.fade === 0) place(w.x, w.z, 'well', '#5fd8ff', '');
    for (let i = n; i < this.markers.length; i++) this.markers[i]!.el.style.display = 'none';
    for (let i = 0; i < n; i++) this.markers[i]!.el.style.display = 'flex';
  }

  private updateCastle(sim: Sim, p: { x: number; z: number }, mana: number): void {
    const mine = sim.castles.find((c) => c.faction === 0);
    if (mine) {
      const d = Math.hypot(p.x - mine.x, p.z - mine.z);
      const near = d < castleData.upgradeRadius + 10;
      const up = nextUpgrade(mine);
      const stats = castleStats(mine.tier, mine.branches);
      const infoKey = d < 110 ? `${mine.tier}|${Math.floor(mine.bank)}|${Math.round(mine.hp)}|${mine.branches.join()}|${Math.floor(mana)}` : '';
      if (infoKey !== this.last.castle) {
        this.last.castle = infoKey;
        this.castleInfo.classList.toggle('hidden', infoKey === '');
        if (infoKey) {
          this.castleInfo.innerHTML = `<b>${tierDef(mine.tier).name}</b> (tier ${mine.tier})<br>Archers ${stats.archers} · Walls ${Math.round(mine.hp)}/${mine.maxHp}<br>Income ${stats.income.toFixed(1)}/s · Bank ${Math.floor(mine.bank)}${up ? `<br>Next: ${up.cost} (bank + mana ${Math.floor(mine.bank + mana)})` : ''}`;
        }
      }
      const upKey = near && up ? `${up.cost}|${Math.floor(Math.min(mine.bank + mana, 9999))}` : '';
      if (upKey !== this.last.up) {
        this.last.up = upKey;
        this.upgrade.classList.toggle('hidden', !(near && up));
        this.deposit.classList.toggle('hidden', !(near && up));
        if (near && up) {
          const can = mine.bank + mana >= up.cost;
          this.upgrade.classList.toggle('cant', !can);
          this.upgradeCost.textContent = `Upgrade ${up.cost}`;
        }
      }
      if (!(near && up) && this.pickerOpen) this.closePicker();
    }
    // Nearest enemy castle within sight shows its health.
    let foe: { name: string; hp: number; max: number; tier: number } | null = null;
    let bd = 170 * 170;
    for (const c of sim.castles) {
      if (c.faction === 0 || c.ruined) continue;
      const d2 = (c.x - p.x) ** 2 + (c.z - p.z) ** 2;
      if (d2 < bd) {
        bd = d2;
        foe = { name: sim.factions[c.faction]!.name, hp: c.hp, max: c.maxHp, tier: c.tier };
      }
    }
    const foeKey = foe ? `${foe.name}|${foe.tier}|${Math.round(foe.hp)}` : '';
    if (foeKey !== this.last.foe) {
      this.last.foe = foeKey;
      this.foeInfo.classList.toggle('hidden', !foe);
      if (foe) {
        this.foeName.textContent = `${foe.name}'s castle · tier ${foe.tier}`;
        this.foeFill.style.transform = `scaleX(${Math.max(0, foe.hp / foe.max)})`;
      }
    }
  }

  private pressUpgrade(): void {
    const mine = this.sim?.castles.find((c) => c.faction === 0);
    if (!mine) return;
    const up = nextUpgrade(mine);
    if (!up) return;
    if (up.needsBranch) {
      this.openPicker(up.tier);
      return;
    }
    this.onUpgrade(0);
  }

  private openPicker(tier: number): void {
    this.pickerOpen = true;
    this.branchTitle.textContent = `Upgrade to ${tierDef(tier).name}: choose a path`;
    this.branchOptions.replaceChildren();
    castleData.branchOrder.forEach((id, i) => {
      const b = BRANCHES[id]!;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.innerHTML = `${BRANCH_ICON[id] ?? ''}${b.name}<small>${b.blurb}</small>`;
      btn.addEventListener('click', () => {
        this.closePicker();
        this.onUpgrade(i + 1);
      });
      this.branchOptions.appendChild(btn);
    });
    this.branchPicker.classList.remove('hidden');
  }

  closePicker(): void {
    this.pickerOpen = false;
    this.branchPicker.classList.add('hidden');
  }

  setTutorial(text: string | null): void {
    this.tutorial.classList.toggle('hidden', text === null);
    if (text !== null) this.tutorialText.textContent = text;
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
