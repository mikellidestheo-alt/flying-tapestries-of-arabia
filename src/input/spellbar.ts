// The laptop spell bar: number keys 1-6 pick a spell, the left mouse button casts it.
// Touch players keep their own buttons; this is the same set of spells.
import { ACTION_CRATER, ACTION_MOUND, ACTION_POSSESS, ACTION_SIGNATURE, ACTION_SPELL } from '../sim/sim';

export type SpellSlotId = 'fireball' | 'crater' | 'mound' | 'possess' | 'castle' | 'signature';

export interface SpellSlot {
  id: SpellSlotId;
  /** Action bit sent to the sim (0 = handled by the UI: the Castle spell opens the castle upgrade). */
  action: number;
  name: string;
}

export const SPELL_SLOTS: readonly SpellSlot[] = [
  { id: 'fireball', action: ACTION_SPELL, name: 'Fireball' },
  { id: 'crater', action: ACTION_CRATER, name: 'Crater' },
  { id: 'mound', action: ACTION_MOUND, name: 'Mound' },
  { id: 'possess', action: ACTION_POSSESS, name: 'Possess' },
  { id: 'castle', action: 0, name: 'Castle' },
  { id: 'signature', action: ACTION_SIGNATURE, name: 'Signature' },
];

/** Slot index for a key code like "Digit3" or "Numpad3", or -1. */
export function slotForKey(code: string): number {
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(code);
  if (!m) return -1;
  const i = Number(m[1]) - 1;
  return i < SPELL_SLOTS.length ? i : -1;
}

/** Mouse wheel / bracket cycling. */
export function cycleSlot(current: number, step: number): number {
  const n = SPELL_SLOTS.length;
  return (((current + step) % n) + n) % n;
}
