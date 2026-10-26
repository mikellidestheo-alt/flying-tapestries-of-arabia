// Chapter select, difficulty and wizard choice.
import { CHAPTERS } from '../data/chapters';
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
      const note = i >= gameData.playableChapters ? 'Coming soon' : locked ? 'Win the previous chapter to unlock' : `${c.rivals.length} rival${c.rivals.length > 1 ? 's' : ''} · ${cleared ? 'Cleared ✓' : c.tagline}`;
      b.innerHTML = `${c.number}. ${c.name}<small>${note}</small>`;
      b.disabled = locked;
      if (i === this.selected) b.classList.add('sel');
      b.addEventListener('click', () => {
        this.selected = i;
        this.render();
      });
      list.appendChild(b);
    });

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
