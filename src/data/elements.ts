export const ELEMENTS = ['fire', 'water', 'earth', 'air'] as const;
export type Element = (typeof ELEMENTS)[number];

/**
 * Rivals take elements the player(s) did NOT choose first. If there are more rivals than
 * unused elements (co-op, chapters 5-6) the extras duplicate an element, cycling through
 * the unused ones first (then the players' elements) in the fixed ELEMENTS order.
 */
export function assignRivalElements(playerElements: readonly Element[], rivalCount: number): Element[] {
  const unused = ELEMENTS.filter((e) => !playerElements.includes(e));
  const pool = unused.length > 0 ? unused : [...ELEMENTS];
  const out: Element[] = [];
  for (let i = 0; i < rivalCount; i++) out.push(pool[i % pool.length]!);
  return out;
}
