import { describe, expect, it } from 'vitest';
import { CHAPTERS } from '../src/data/chapters';
import type { Element } from '../src/data/elements';
import { matchSetupFromChapter } from '../src/data/matchSetup';
import flight from '../src/data/flight.json';
import { KITS, signatureDef, spellAt } from '../src/sim/combat';
import { ACTION_SIGNATURE, ACTION_SPELL, Sim, type PlayerInput } from '../src/sim/sim';

const input = (steer = 0, throttle = 0, actions = 0): PlayerInput => ({ steer, throttle, actions });

/** A quiet arena: one human wizard of the given element, rivals parked out of the way. */
function arena(element: Element, tier = 1) {
  const c = CHAPTERS[0]!;
  const s = new Sim({ terrain: c.terrain, creatureTypes: ['evil-genie'], match: matchSetupFromChapter(c, [element], 'normal') });
  s.players.forEach((w, i) => { if (i > 0) w.active = false; });
  const p = s.players[0]!;
  p.x = 0; p.z = 0; p.vx = p.vz = 0; p.heading = 0; p.speed = 9; p.mana = 200; p.spellTier = tier; p.invuln = 99999;
  p.y = s.terrain.surfaceAt(0, 0) + 9;
  return { s, p };
}

/** A creature that stays where it is put. */
function dummy(s: Sim, x: number, z: number, hp = 1000) {
  s.spawnCreature('dust-sprite', x, z);
  const c = s.creatures[s.creatures.length - 1]!;
  c.hp = hp; c.state = 0; c.wanderUntil = 1e9; c.wx = x; c.wz = z; c.homeX = x; c.homeZ = z;
  return c;
}
const keep = (c: { x: number; z: number; y: number }, x: number, y: number, z: number) => { c.x = x; c.z = z; c.y = y; };

describe('elements and kits', () => {
  it('human and rivals get their own elements (rivals take the three the human did not pick)', () => {
    const c = CHAPTERS[0]!;
    const s = new Sim({ terrain: c.terrain, creatureTypes: c.creatureSet, match: matchSetupFromChapter(c, ['water'], 'normal') });
    expect(s.players.map((p) => p.element).sort()).toEqual(['air', 'earth', 'fire', 'water']);
    expect(s.players[0]!.element).toBe('water');
  });

  it('each wizard casts its own primary spell', () => {
    for (const el of ['fire', 'water', 'earth', 'air'] as const) {
      const { s, p } = arena(el);
      s.step([input(0, -1, ACTION_SPELL)]);
      expect(s.projectiles[0]!.spell).toBe(KITS[el].primary);
      expect(p.mana).toBeCloseTo(200 - spellAt(KITS[el].primary, 1).manaCost, 0);
    }
  });
});

describe('water: Frost Chain slows, chains and (tier 3) freezes', () => {
  it('chains from the target to others nearby with falling damage and slows them all', () => {
    const { s } = arena('water', 2);
    const a = dummy(s, 0, 70);
    const b = dummy(s, 14, 78);
    const c = dummy(s, 26, 86);
    const far = dummy(s, 0, 160);
    const hp0 = [a.hp, b.hp, c.hp, far.hp];
    s.step([input(0, -1, ACTION_SPELL)]);
    for (let i = 0; i < 60; i++) {
      keep(a, 0, a.y, 70); keep(b, 14, b.y, 78); keep(c, 26, c.y, 86); keep(far, 0, far.y, 160);
      s.step([input(0, -1)]);
    }
    const lost = [hp0[0]! - a.hp, hp0[1]! - b.hp, hp0[2]! - c.hp, hp0[3]! - far.hp];
    expect(lost[0]).toBeGreaterThan(0);
    expect(lost[1]).toBeGreaterThan(0); // chained
    expect(lost[2]).toBeGreaterThan(0);
    expect(lost[0]).toBeGreaterThan(lost[1]!); // each jump hits weaker
    expect(lost[1]).toBeGreaterThan(lost[2]!);
    expect(lost[3]).toBe(0);
    expect(s.events.filter((e) => e.type === 'chain').length).toBeGreaterThanOrEqual(2);
    expect(a.slowTicks + b.slowTicks + c.slowTicks).toBeGreaterThan(0);
  });

  it('slows a wizard (speed capped well below cruise) and tier 3 freezes it in place', () => {
    const { s } = arena('water', 3);
    const victim = s.players[1]!;
    victim.active = true;
    victim.invuln = 0;
    victim.x = 0; victim.z = 90; victim.y = s.terrain.surfaceAt(0, 90) + 9; victim.speed = flight.cruiseSpeed; victim.mana = 0;
    s.step([input(0, -1, ACTION_SPELL)]);
    let frozeAt = -1;
    for (let i = 0; i < 90; i++) {
      s.step([input(0, -1)]);
      if (victim.freezeTicks > 0 && frozeAt < 0) frozeAt = i;
    }
    expect(frozeAt).toBeGreaterThanOrEqual(0);
    expect(victim.slowMult).toBeLessThan(1);
  });

  it('a frozen wizard cannot steer, cast or use signatures', () => {
    const { s, p } = arena('water');
    p.freezeTicks = 60;
    const heading = p.heading;
    for (let i = 0; i < 10; i++) s.step([input(1, 0, ACTION_SPELL | ACTION_SIGNATURE)]);
    expect(p.heading).toBe(heading);
    expect(s.projectiles.length).toBe(0);
    expect(s.events.some((e) => e.type === 'nova')).toBe(false);
    expect(p.speed).toBeLessThan(9); // frozen flyers stop
  });

  it('Gale Dash is the one spell that works while frozen, and it breaks the freeze', () => {
    const { s, p } = arena('air');
    p.freezeTicks = 60;
    p.slowTicks = 60;
    p.slowMult = 0.4;
    const casts = p.casts;
    s.step([input(0, 0, ACTION_SPELL | ACTION_SIGNATURE)]);
    expect(p.freezeTicks).toBe(0);
    expect(p.slowTicks).toBe(0);
    expect(p.boostTicks).toBeGreaterThan(0);
    expect(p.casts).toBe(casts); // the bolt did not fire
  });
});

describe('fire: Firestorm and burn', () => {
  it('Firestorm burns hostiles inside for its duration and spares your own side', () => {
    const { s, p } = arena('fire');
    for (const c of s.castles) c.archerCd.fill(1e9); // castle archers (tier 1 has one now) would also shoot the dummies: keep them out of this test
    const sig = signatureDef(p);
    const inside = dummy(s, 0, 55);
    const outside = dummy(s, 90, 55);
    const hp0 = inside.hp;
    s.step([input(0, -1, ACTION_SIGNATURE)]);
    expect(s.zones.length).toBe(1);
    expect(p.mana).toBeCloseTo(200 - sig.manaCost, 0);
    expect(p.sigCd).toBeGreaterThanOrEqual(sig.cooldownTicks - 1); // cools down from the same tick
    for (let i = 0; i < sig.durationTicks! + 5; i++) {
      keep(inside, 0, inside.y, 55); keep(outside, 90, outside.y, 55);
      p.x = -80; p.z = 0; p.vx = p.vz = 0; // stay clear of our own storm
      s.step([input(0, -1)]);
    }
    const dmg = hp0 - inside.hp;
    expect(dmg).toBeGreaterThan(sig.dps! * (sig.durationTicks! / 30) * 0.7);
    expect(outside.hp).toBe(1000);
    expect(s.zones.length).toBe(0); // expired
  });

  it('cannot be recast during its cooldown or without mana', () => {
    const { s, p } = arena('fire');
    s.step([input(0, -1, ACTION_SIGNATURE)]);
    s.step([input(0, -1, ACTION_SIGNATURE)]);
    expect(s.zones.length).toBe(1);
    p.sigCd = 0;
    p.mana = 1;
    s.step([input(0, -1, ACTION_SIGNATURE)]);
    expect(s.zones.length).toBe(1);
  });

  it('burn damages a wizard over time and credits the attacker', () => {
    const { s } = arena('fire');
    const v = s.players[1]!;
    v.active = true; v.invuln = 0; v.x = 500; v.z = 500; v.y = s.terrain.surfaceAt(500, 500) + 9;
    v.burnTicks = 90; v.burnDps = 6; v.burnBy = 0;
    const hp0 = v.hp;
    for (let i = 0; i < 95; i++) s.step([input(0, -1)]);
    expect(hp0 - v.hp).toBeGreaterThan(12); // 18 burn damage minus the wizard's slow natural regeneration
    expect(v.lastHitBy).toBe(0);
  });
});

describe('earth: Boulder, aftershock and Stone Wall', () => {
  it('boulders wreck structures far faster than other elements', () => {
    const nestDamage = (el: Element) => {
      const { s } = arena(el);
      const nest = s.structures[0] ?? (s.structures.push({ id: 900, kind: 'nest', x: 0, y: s.terrain.heightAt(0, 70), z: 70, hp: 160, max: 160, alive: true, spawnCd: 99999, respawnAt: 0 }), s.structures[0]!);
      nest.x = 0; nest.z = 70; nest.y = s.terrain.heightAt(0, 70); nest.hp = nest.max = 400;
      s.step([input(0, -1, ACTION_SPELL)]);
      for (let i = 0; i < 80; i++) s.step([input(0, -1)]);
      return 400 - nest.hp;
    };
    expect(nestDamage('earth')).toBeGreaterThan(nestDamage('fire') * 1.8);
    expect(nestDamage('earth')).toBeGreaterThan(nestDamage('air') * 2.5);
  });

  it('tier 3 leaves an aftershock that hurts everything near the impact a moment later', () => {
    const { s } = arena('earth', 3);
    const near = dummy(s, 0, 80);
    const hp0 = near.hp;
    s.step([input(0, -1, ACTION_SPELL)]);
    let quake = false;
    for (let i = 0; i < 100; i++) {
      keep(near, 0, near.y, 80);
      s.step([input(0, -1)]);
      if (s.events.some((e) => e.type === 'quake')) quake = true;
    }
    expect(quake).toBe(true);
    expect(hp0 - near.hp).toBeGreaterThan(spellAt(KITS.earth.primary, 3).damage); // impact plus aftershock
  });

  it('Stone Wall raises a row of terrain ahead (synced as capped deltas) that blocks shots', () => {
    const { s, p } = arena('earth');
    const def = signatureDef(p);
    const wallZ = def.wall!.distance;
    const before = s.terrain.heightAt(0, wallZ);
    s.step([input(0, -1, ACTION_SIGNATURE)]);
    expect(s.terrain.deltas.list.length).toBe(def.wall!.segments);
    expect(s.terrain.heightAt(0, wallZ) - before).toBeGreaterThan(def.wall!.amount * 0.8);
    // A bolt fired along the ground from behind the wall bursts on it.
    s.projectiles.push({
      id: 800, owner: 1, faction: 1, hp: 16, spell: 'fireball', tier: 1,
      x: 0, y: s.terrain.heightAt(0, wallZ - 8) + 3, z: wallZ - 8, px: 0, py: 0, pz: wallZ - 8, vx: 0, vy: 0, vz: 60, travelled: 0,
    });
    for (let i = 0; i < 10; i++) s.step([input(0, -1)]);
    expect(s.projectiles.some((q) => q.id === 800)).toBe(false);
    expect(s.events.some((e) => e.type === 'impact' && e.z < wallZ + 6)).toBe(true);
  });
});

describe('air: Lightning and Gale Dash', () => {
  it('fast bolts never tunnel through a target they graze (sub-stepped collision)', () => {
    const { s } = arena('air');
    const t = dummy(s, 3.4, 100); // 3.4 off the line: inside hit radius (1.2 + 3.1) but a 6.3-unit tick would skip it
    const y = t.y;
    const hp0 = t.hp;
    s.projectiles.push({
      id: 801, owner: 0, faction: 0, hp: 6, spell: 'lightning', tier: 1,
      x: 0, y, z: 80, px: 0, py: y, pz: 80, vx: 0, vy: 0, vz: 190, travelled: 0,
    });
    for (let i = 0; i < 8; i++) {
      keep(t, 3.4, y, 100);
      s.step([input(0, -1)]);
    }
    expect(hp0 - t.hp).toBeGreaterThan(10);
  });

  it('lightning outranges every other bolt', () => {
    const range = (el: Element) => spellAt(KITS[el].primary, 1).maxRange;
    for (const el of ['fire', 'water', 'earth'] as const) expect(range('air')).toBeGreaterThan(range(el));
  });

  it('tier 3 arcs to a second target', () => {
    const { s } = arena('air', 3);
    const a = dummy(s, 0, 120);
    const b = dummy(s, 12, 130);
    s.step([input(0, -1, ACTION_SPELL)]);
    for (let i = 0; i < 30; i++) {
      keep(a, 0, a.y, 120); keep(b, 12, b.y, 130);
      s.step([input(0, -1)]);
    }
    expect(b.hp).toBeLessThan(1000);
    expect(s.events.some((e) => e.type === 'chain')).toBe(true);
  });

  it('Gale Dash blasts past top speed for its duration, then fades', () => {
    const { s, p } = arena('air');
    const d = signatureDef(p).dash!;
    s.step([input(0, -1, ACTION_SIGNATURE)]);
    for (let i = 0; i < 50; i++) s.step([input(0, -1)]);
    expect(p.speed).toBeGreaterThan(flight.maxSpeed * 1.5);
    for (let i = 0; i < d.durationTicks + 40; i++) s.step([input(0, -1)]);
    expect(p.speed).toBeLessThan(flight.maxSpeed);
    expect(p.boostTicks).toBe(0);
  });
});

describe('water: Frost Nova', () => {
  it('slows and damages everything hostile around you, nothing farther out', () => {
    const { s, p } = arena('water');
    const def = signatureDef(p);
    const close = dummy(s, 10, 12);
    const far = dummy(s, 0, def.radius! + 20);
    s.step([input(0, -1, ACTION_SIGNATURE)]);
    expect(close.hp).toBeLessThan(1000);
    expect(close.slowTicks).toBeGreaterThan(0);
    expect(far.hp).toBe(1000);
    expect(s.events.some((e) => e.type === 'nova')).toBe(true);
  });
});

describe('determinism with every element in play', () => {
  it('four-element matches replay identically', () => {
    const run = () => {
      const c = CHAPTERS[2]!;
      const s = new Sim({ terrain: c.terrain, creatureTypes: c.creatureSet, match: matchSetupFromChapter(c, ['earth'], 'hard'), autopilot: 'aggressive' });
      for (let i = 0; i < 30 * 120; i++) s.step([input()]);
      return JSON.stringify({ p: s.players, z: s.zones, f: s.factions, d: s.terrain.deltas.toArray(), c: s.castles });
    };
    expect(run()).toBe(run());
  });
});
