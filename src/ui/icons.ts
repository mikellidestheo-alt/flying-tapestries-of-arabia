// Element icons. Each wizard has a distinct SHAPE for its attack and signature, so the four
// are never told apart by colour alone (colour-blind safe).
import type { Element } from '../data/elements';

const svg = (size: number, body: string) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}">${body}</svg>`;

const PRIMARY: Record<Element, string> = {
  // Flame
  fire: '<path d="M12 1.5c1.2 4.2 6.3 6.2 6.3 12.2a6.3 6.3 0 0 1-12.6 0c0-3.1 1.9-5.1 3.2-7 .2 1.9 1 3 2.2 3.4 1.3-2.7.2-5.2.9-8.6z" fill="currentColor"/>',
  // Droplet
  water: '<path d="M12 2.5C8 8 5.5 11 5.5 14.5a6.5 6.5 0 0 0 13 0C18.5 11 16 8 12 2.5z" fill="currentColor"/>',
  // Boulder (faceted rock)
  earth: '<path d="M3 15 7 6l6-2.5 5.5 3.5L21 14l-4 6H8z" fill="currentColor"/><path d="M7 6l3 7 3-9.5M10 13l-2 7M10 13l7 .5" fill="none" stroke="#000" stroke-opacity=".35" stroke-width="1.2"/>',
  // Lightning bolt
  air: '<path d="M13.5 1.5 5 13.5h5.5L9 22.5l9.5-13h-5.8z" fill="currentColor"/>',
};

const SIGNATURE: Record<Element, string> = {
  // Falling embers
  fire: '<path d="M5 3l1.5 3.5L5 10l-1.5-3.5zM12 2l1.8 4.2L12 11 10.2 6.2zM19 4l1.4 3.2L19 11l-1.4-3.8z" fill="currentColor"/><path d="M3 15h18M5 19h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  // Snowflake
  water: '<path d="M12 2v20M3.5 7l17 10M3.5 17l17-10M9 3.5 12 6l3-2.5M9 20.5 12 18l3 2.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  // Brick wall
  earth: '<path d="M2.5 6h19v12h-19zM2.5 12h19M8.5 6v6M15.5 12v6M12 6v0" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  // Wind swirl
  air: '<path d="M3 8h11a3 3 0 1 0-3-3M3 13h16a3 3 0 1 1-3 3M3 18h8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
};

export function primaryIcon(e: Element, size = 44): string {
  return svg(size, PRIMARY[e]);
}

export function signatureIcon(e: Element, size = 32): string {
  return svg(size, SIGNATURE[e]);
}

/** Weapon-upgrade button icon: the attack's own shape plus an up arrow. */
export function weaponIcon(e: Element, size = 26): string {
  return svg(size, `${PRIMARY[e]}<path d="M19 20v-6m-3 3 3-3 3 3" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`);
}
