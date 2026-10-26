// Pure music planning (no Web Audio): turns a chapter's scale, tempo, rhythm and motif into
// timed note events, bar by bar. Deterministic, so it can be unit-tested.
import music from '../data/music.json';
import { Prng, hashInts } from '../sim/prng';

export type Inst = 'dum' | 'tek' | 'ka' | 'oud' | 'ney';

export interface PlannedEvent {
  /** Eighth-note step within the bar (0-7). */
  step: number;
  inst: Inst;
  /** Frequency in Hz for pitched instruments. */
  freq?: number;
  /** Duration in steps for pitched instruments. */
  dur?: number;
  vel: number;
}

export interface MusicSpec {
  id: string;
  scale: string;
  rootMidi: number;
  tempoBpm: number;
  rhythm: string;
  motif: number[];
}

export const SCALES = music.scales as Record<string, number[]>;
export const RHYTHMS = music.rhythms as Record<string, { pattern: string; ghost: number[]; oudSteps: number[] }>;

export function stepSeconds(bpm: number): number {
  return 30 / bpm; // one eighth note
}

export function midiToHz(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

/** Frequency of a scale degree (0 = root, 7 = octave above, negative = below). */
export function degreeHz(spec: MusicSpec, degree: number): number {
  const scale = SCALES[spec.scale]!;
  const oct = Math.floor(degree / 7);
  const idx = ((degree % 7) + 7) % 7;
  return midiToHz(spec.rootMidi + scale[idx]! + 12 * oct);
}

export function parsePattern(rhythm: string): ('D' | 'T' | '-')[] {
  return RHYTHMS[rhythm]!.pattern.split(' ') as ('D' | 'T' | '-')[];
}

export class MusicPlanner {
  private rng: Prng;
  private motifPos = 0;

  constructor(private spec: MusicSpec) {
    this.rng = new Prng(hashInts(spec.tempoBpm, spec.rootMidi, spec.motif.length, spec.id.length));
  }

  /** Events for one bar (barIndex counts from 0). Pure function of the planner's seeded state. */
  planBar(barIndex: number): PlannedEvent[] {
    const spec = this.spec;
    const out: PlannedEvent[] = [];
    const rh = RHYTHMS[spec.rhythm]!;
    const pat = parsePattern(spec.rhythm);

    // Frame drum: dum on D, tek on T, quiet ka on ghost steps.
    for (let s = 0; s < 8; s++) {
      const c = pat[s]!;
      if (c === 'D') out.push({ step: s, inst: 'dum', vel: s === 0 ? 1 : 0.8 });
      else if (c === 'T') out.push({ step: s, inst: 'tek', vel: 0.7 });
      else if (rh.ghost.includes(s) && this.rng.next() < 0.7) out.push({ step: s, inst: 'ka', vel: 0.3 });
    }

    // Oud: the chapter motif, stepping through it across bars, ending phrases on the root.
    const phraseBar = barIndex % music.phraseBars;
    for (let i = 0; i < rh.oudSteps.length; i++) {
      const step = rh.oudSteps[i]!;
      let degree = spec.motif[this.motifPos % spec.motif.length]!;
      this.motifPos++;
      if (phraseBar === music.phraseBars - 1 && i === rh.oudSteps.length - 1) degree = 0; // resolve
      else if (this.rng.next() < 0.18) degree += this.rng.next() < 0.5 ? 1 : -1; // neighbour tone
      if (phraseBar === 2 && this.rng.next() < 0.25) degree += 7; // lift in the middle of the phrase
      out.push({ step, inst: 'oud', freq: degreeHz(spec, degree), dur: 1.5, vel: step === 0 ? 1 : 0.75 });
    }

    // Ney: a slow held line every other phrase.
    if (phraseBar === 1 && Math.floor(barIndex / music.phraseBars) % 2 === 0) {
      const d1 = spec.motif[(barIndex + 1) % spec.motif.length]! + 7;
      const d2 = spec.motif[(barIndex + 3) % spec.motif.length]! + 7;
      out.push({ step: 0, inst: 'ney', freq: degreeHz(spec, d1), dur: 4, vel: 0.9 });
      out.push({ step: 4, inst: 'ney', freq: degreeHz(spec, d2), dur: 4, vel: 0.8 });
    }
    return out;
  }
}
