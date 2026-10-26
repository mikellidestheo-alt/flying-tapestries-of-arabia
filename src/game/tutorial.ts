// Chapter 1 tutorial: short, skippable prompts that advance by OBSERVING the sim (never mutating it).
import tutorial from '../data/tutorial.json';
import type { Sim } from '../sim/sim';

type Until = { moved?: number; manaGained?: number; casts?: number; castleTier?: number; seconds?: number };

export class Tutorial {
  private index = 0;
  private sx = 0;
  private sz = 0;
  private lastMana = 0;
  private gained = 0;
  private castBase = 0;
  private elapsed = 0;
  private stepElapsed = 0;
  finished = false;

  constructor(sim: Sim) {
    const p = sim.players[0]!;
    this.sx = p.x;
    this.sz = p.z;
    this.lastMana = p.mana;
    this.castBase = p.casts;
  }

  /** Current prompt text, or null when finished. */
  get text(): string | null {
    return this.finished ? null : tutorial.steps[this.index]!.text;
  }

  get stepId(): string | null {
    return this.finished ? null : tutorial.steps[this.index]!.id;
  }

  skip(): void {
    this.finished = true;
  }

  /** Call with the elapsed real seconds each frame. Returns true when the step changed. */
  update(sim: Sim, dt: number): boolean {
    if (this.finished) return false;
    const p = sim.players[0]!;
    this.elapsed += dt;
    this.stepElapsed += dt;
    if (p.mana > this.lastMana) this.gained += p.mana - this.lastMana;
    this.lastMana = p.mana;
    const until = tutorial.steps[this.index]!.until as Until;
    const castle = sim.castles[0];
    let done = false;
    if (until.moved !== undefined) done = Math.hypot(p.x - this.sx, p.z - this.sz) >= until.moved;
    else if (until.manaGained !== undefined) done = this.gained >= until.manaGained;
    else if (until.casts !== undefined) done = p.casts - this.castBase >= until.casts;
    else if (until.castleTier !== undefined) done = (castle?.tier ?? 1) >= until.castleTier;
    else if (until.seconds !== undefined) done = this.stepElapsed >= until.seconds;
    if (!done) return false;
    this.index++;
    this.stepElapsed = 0;
    this.gained = 0;
    this.castBase = p.casts;
    if (this.index >= tutorial.steps.length) this.finished = true;
    return true;
  }
}
