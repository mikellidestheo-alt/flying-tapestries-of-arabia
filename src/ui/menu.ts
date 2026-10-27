// Chapter select, difficulty and wizard choice.
import { CHAPTERS } from '../data/chapters';
import creatureData from '../data/creatures.json';
import { ELEMENTS, type Element } from '../data/elements';
import gameData from '../data/game.json';
import { wizardLook } from '../data/wizardLooks';
import type { Progress, Settings } from '../save';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

export interface MenuHost {
  settings: () => Settings;
  progress: () => Progress;
  setDifficulty: (d: Settings['difficulty']) => void;
  setWizard: (e: Element) => void;
  play: (chapterIndex: number) => void;
  openSettings: () => void;
}

export class Menu {
  private selected = 0;

  constructor(private host: MenuHost) {
    $('#playBtn').addEventListener('click', () => this.host.play(this.selected));
    $('#menuSettingsBtn').addEventListener('click', () => this.host.openSettings());
  }

  select(i: number): void {
    this.selected = i;
  }

  /** Index of the last chapter the player can start. */
  playableCount(): number {
    return Math.min(gameData.playableChapters, this.host.progress().unlockedChapters);
  }

  render(): void {
    const prog = this.host.progress();
    const list = $('#chapterList');
    list.replaceChildren();
    const playable = this.playableCount();
    if (this.selected >= playable) this.selected = Math.max(0, playable - 1);
    CHAPTERS.forEach((c, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      const locked = i >= playable;
      const cleared = (prog.cleared >> i) & 1;
      const soon = i >= gameData.playableChapters;
      const p = c.palette;
      const art = `linear-gradient(180deg, ${p.skyTop} 0%, ${p.skyMid} 40%, ${p.horizon} 62%, ${p.sand} 62%, ${p.sandShade} 100%)`;
      const best = prog.bestSeconds[i] ?? 0;
      const status = soon ? 'Coming soon' : locked ? 'Win the previous chapter to unlock' : cleared ? `Cleared ✓${best > 0 ? ` · best ${fmtTime(best)}` : ''}` : c.tagline;
      b.innerHTML = `<span class="art" style="background:${art}"><i>${c.number}</i>${locked ? '<u aria-hidden="true">🔒</u>' : ''}</span><b>${c.name}</b><small>${status}</small>`;
      b.disabled = locked;
      b.setAttribute('aria-label', `Chapter ${c.number}: ${c.name}. ${status}`);
      if (i === this.selected) b.classList.add('sel');
      b.addEventListener('click', () => {
        this.selected = i;
        this.render();
      });
      list.appendChild(b);
    });

    const sel = CHAPTERS[this.selected]!;
    const names = (id: string) => (creatureData as Record<string, { name: string; hostile?: boolean }>)[id]?.name ?? id;
    const foes = sel.creatureSet.filter((t) => (creatureData as Record<string, { hostile?: boolean }>)[t]?.hostile !== false).map(names).join(', ');
    const wild = sel.creatureSet.filter((t) => (creatureData as Record<string, { hostile?: boolean }>)[t]?.hostile === false).map(names).join(', ');
    const density = sel.enemyDensity < 0.8 ? 'Calm' : sel.enemyDensity < 1.1 ? 'Busy' : 'Dangerous';
    $('#chapterDetail').innerHTML = `<b>${sel.tagline}</b><br><span>Rivals: ${sel.rivals.map((r) => `${r.name} (${r.personality})`).join(', ')}</span><br><span>Enemies (${density}): ${foes}${wild ? ` · Mana animals: ${wild}` : ''}</span>`;
    $('#hubStats').textContent = `Chapters cleared ${popcount(prog.cleared)}/${gameData.playableChapters} · Matches won ${prog.wins}/${prog.played}`;

    const s = this.host.settings();
    const dseg = $('#difficultySeg');
    dseg.replaceChildren();
    for (const d of ['easy', 'normal', 'hard'] as const) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = d[0]!.toUpperCase() + d.slice(1);
      if (s.difficulty === d) b.className = 'on';
      b.addEventListener('click', () => {
        this.host.setDifficulty(d);
        this.render();
      });
      dseg.appendChild(b);
    }
    const wseg = $('#wizardSeg');
    wseg.replaceChildren();
    for (const e of ELEMENTS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = wizardLook(e).name;
      if (prog.wizard === e) b.className = 'on';
      b.addEventListener('click', () => {
        this.host.setWizard(e);
        this.render();
      });
      wseg.appendChild(b);
    }
  }
}

function popcount(n: number): number {
  let c = 0;
  for (let x = n; x > 0; x >>= 1) c += x & 1;
  return c;
}

function fmtTime(secs: number): string {
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}
