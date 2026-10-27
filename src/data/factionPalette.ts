// Colour-blind-safe faction colours (Okabe-Ito based). Factions are also told apart by banner shape,
// so this only strengthens the colour cue. Applied in place before a match is built.
import castleData from './castles.json';

const ORIGINAL = castleData.factionStyles.map((f) => f.color);
const SAFE = ['#e69f00', '#0072b2', '#cc79a7', '#009e73'];

export function applyFactionPalette(colorBlind: boolean): void {
  castleData.factionStyles.forEach((f, i) => {
    f.color = colorBlind ? SAFE[i % SAFE.length]! : ORIGINAL[i]!;
  });
}

export const COLOR_BLIND_PALETTE = SAFE;
