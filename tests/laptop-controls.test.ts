import { describe, expect, it } from 'vitest';
import { CHAPTERS } from '../src/data/chapters';
import flight from '../src/data/flight.json';
import { MouseLook } from '../src/input/mouseLook';
import { SPELL_SLOTS, cycleSlot, slotForKey } from '../src/input/spellbar';
import { decodeRuns, encodeRuns } from '../src/net/protocol';
import { ACTION_CRATER, ACTION_MOUND, ACTION_POSSESS, ACTION_SIGNATURE, ACTION_SPELL, Sim, type PlayerInput } from '../src/sim/sim';
import { matchSetupFromChapter } from '../src/data/matchSetup';
import utility from '../src/data/utility-spells.json';

const mk = () => new Sim({ terrain: CHAPTERS[0]!.terrain });
const fly = (s: Sim, n: number, input: PlayerInput) => { for (let i = 0; i < n; i++) s.step([input]); };

describe('mouse look', () => {
  it('horizontal movement steers, vertical tilts, and the pitch eases back to level when the mouse rests', () => {
    const m = new MouseLook();
    m.feed(20, 0);
    expect(m.sample().steer).toBeGreaterThan(0.5);
    expect(m.sample().steer).toBe(0); // consumed
    m.feed(0, -100); // mouse up
    expect(m.pitch).toBeGreaterThan(0.3);
    const up = m.pitch;
    for (let i = 0; i < 400; i++) m.sample();
    expect(m.pitch).toBeLessThan(up * 0.2);
    m.feed(0, 5000);
    expect(m.pitch).toBe(-1); // clamped
  });

  it('sensitivity scales the response', () => {
    const lo = new MouseLook();
    const hi = new MouseLook();
    lo.feed(10, 0, 'low');
    hi.feed(10, 0, 'high');
    expect(hi.sample('high').steer).toBeGreaterThan(lo.sample('low').steer);
  });
});

describe('spell bar', () => {
  it('number keys 1-6 pick the six spells and unknown keys do nothing', () => {
    expect(SPELL_SLOTS.map((s) => s.id)).toEqual(['fireball', 'crater', 'mound', 'possess', 'castle', 'signature']);
    expect([1, 2, 3, 4, 5, 6].map((n) => slotForKey(`Digit${n}`))).toEqual([0, 1, 2, 3, 4, 5]);
    expect(slotForKey('Digit7')).toBe(-1);
    expect(slotForKey('Digit0')).toBe(-1);
    expect(slotForKey('KeyA')).toBe(-1);
    expect(SPELL_SLOTS[0]!.action).toBe(ACTION_SPELL);
    expect(SPELL_SLOTS[1]!.action).toBe(ACTION_CRATER);
    expect(SPELL_SLOTS[2]!.action).toBe(ACTION_MOUND);
    expect(SPELL_SLOTS[3]!.action).toBe(ACTION_POSSESS);
    expect(SPELL_SLOTS[5]!.action).toBe(ACTION_SIGNATURE);
    expect(cycleSlot(5, 1)).toBe(0);
    expect(cycleSlot(0, -1)).toBe(5);
  });
});

describe('3D flight with the mouse', () => {
  it('pitching up climbs above the normal hover height, pitching down comes back, touch play never leaves the hover height', () => {
    const s = mk();
    const p = s.players[0]!;
    fly(s, 90, { steer: 0, throttle: 0.5, actions: 0 });
    const hover = p.y - s.terrain.surfaceAt(p.x, p.z);
    fly(s, 150, { steer: 0, throttle: 0.5, actions: 0, pitch: 1 });
    const high = p.y - s.terrain.surfaceAt(p.x, p.z);
    expect(high).toBeGreaterThan(hover + 15);
    expect(p.alt).toBeGreaterThan(15);
    fly(s, 300, { steer: 0, throttle: 0.5, actions: 0, pitch: -1 });
    expect(p.alt).toBeLessThan(1);
    // Touch play (pitch undefined) has no altitude bias.
    const t = mk();
    fly(t, 200, { steer: 0, throttle: 0.5, actions: 0 });
    expect(t.players[0]!.alt).toBe(0);
    expect(t.players[0]!.pitch).toBe(0);
  });

  it('the altitude bias is capped and holds while the pitch is level', () => {
    const s = mk();
    const p = s.players[0]!;
    fly(s, 2000, { steer: 0, throttle: 1, actions: 0, pitch: 1 });
    expect(p.alt).toBeLessThanOrEqual(flight.maxAltBias);
    const a = p.alt;
    fly(s, 60, { steer: 0, throttle: 1, actions: 0, pitch: 0 });
    expect(Math.abs(p.alt - a)).toBeLessThan(1); // free flight: stays where you left it
  });

  it('A/D slide sideways without turning', () => {
    const s = mk();
    const p = s.players[0]!;
    fly(s, 60, { steer: 0, throttle: 0, actions: 0, pitch: 0 });
    const h = p.heading;
    const sideways = (strafe: number) => {
      const q = mk();
      fly(q, 60, { steer: 0, throttle: 0, actions: 0, pitch: 0 });
      const x0 = q.players[0]!.x;
      const z0 = q.players[0]!.z;
      fly(q, 60, { steer: 0, throttle: 0, actions: 0, pitch: 0, strafe });
      const w = q.players[0]!;
      const fx = Math.sin(w.heading);
      const fz = Math.cos(w.heading);
      return { across: (w.x - x0) * -fz + (w.z - z0) * fx, heading: w.heading };
    };
    const right = sideways(1);
    const left = sideways(-1);
    expect(right.heading).toBeCloseTo(h, 5);
    // "right" is clockwise from above (see steering): the two directions are opposite and clearly sizeable.
    expect(Math.abs(right.across)).toBeGreaterThan(8);
    expect(Math.sign(right.across)).toBe(-Math.sign(left.across));
  });

  it('a fireball leaves along the view pitch', () => {
    const shoot = (pitch: number) => {
      const s = mk();
      for (const w of s.players.slice(1)) w.mana = 0;
      const p = s.players[0]!;
      p.mana = 200;
      fly(s, 40, { steer: 0, throttle: 0, actions: 0, pitch });
      s.step([{ steer: 0, throttle: 0, actions: ACTION_SPELL, pitch }]);
      return s.projectiles[0]!.vy;
    };
    expect(shoot(1)).toBeGreaterThan(shoot(0) + 10);
    expect(shoot(-1)).toBeLessThan(shoot(0) - 10);
  });

  it('pitch and strafe travel through the co-op input encoding, and touch inputs stay pitch-less', () => {
    const back = decodeRuns(encodeRuns([{ steer: 0.3, throttle: 1, actions: ACTION_POSSESS, pitch: -0.5, strafe: 1 }, { steer: 0, throttle: 0, actions: 0 }]));
    expect(back[0]!.pitch).toBeCloseTo(-0.5);
    expect(back[0]!.strafe).toBe(1);
    expect(back[0]!.actions).toBe(ACTION_POSSESS);
    expect(back[1]!.pitch).toBeUndefined();
  });
});

describe('Possess', () => {
  const stage = () => {
    const s = mk();
    const p = s.players[0]!;
    p.mana = 50;
    p.heading = 0;
    s.orbs.length = 0;
    return { s, p };
  };
  const cast = (s: Sim) => s.step([{ steer: 0, throttle: -1, actions: ACTION_POSSESS, pitch: 0 }]);

  it('claims orbs in front of you from far away, and they fly to you', () => {
    const { s, p } = stage();
    s.spawnOrb(p.x + 3, p.y, p.z + 120, 10, 0, 0);
    s.spawnOrb(p.x - 2, p.y, p.z + 90, 10, 0, 0);
    s.spawnOrb(p.x, p.y, p.z - 80, 10, 0, 0); // behind: not claimed
    const mana0 = p.mana;
    cast(s);
    expect(s.orbs.filter((o) => o.claim === 1).length).toBe(2);
    expect(s.events.some((e) => e.type === 'possess')).toBe(true);
    expect(p.mana).toBeLessThan(mana0 - utility.possess.manaCost + 1);
    for (let t = 0; t < 120; t++) s.step([{ steer: 0, throttle: -1, actions: 0, pitch: 0 }]);
    expect(s.orbs.filter((o) => o.claim === 1).length).toBe(0); // arrived
    expect(p.mana).toBeGreaterThan(mana0 + 10);
  });

  it('claimed mana cannot be taken by anyone else', () => {
    const c = CHAPTERS[0]!;
    const s = new Sim({ terrain: c.terrain, creatureTypes: c.creatureSet, match: matchSetupFromChapter(c, ['fire'], 'normal') });
    const p = s.players[0]!;
    p.mana = 50;
    p.heading = 0;
    s.orbs.length = 0;
    const rival = s.players[1]!;
    s.spawnOrb(p.x, p.y, p.z + 100, 25, 0, 0);
    cast(s);
    const orb = s.orbs[0]!;
    rival.x = orb.x;
    rival.z = orb.z;
    rival.y = orb.y;
    const m0 = rival.mana;
    s.step([{ steer: 0, throttle: -1, actions: 0, pitch: 0 }]);
    expect(rival.mana).toBeCloseTo(m0, 0);
    expect(s.orbs.some((o) => o.claim === 1)).toBe(true); // still on its way to the caster
  });

  it('costs nothing when there is no mana in view, needs mana, and has a cooldown', () => {
    const { s, p } = stage();
    cast(s);
    expect(p.mana).toBeCloseTo(50, 0);
    expect(s.events.some((e) => e.type === 'possess')).toBe(false);
    s.spawnOrb(p.x, p.y, p.z + 80, 10, 0, 0);
    p.mana = 1;
    cast(s);
    expect(s.orbs[0]!.claim).toBeUndefined(); // not enough mana
    p.mana = 50;
    for (let t = 0; t < utility.possess.missCooldownTicks + 2; t++) s.step([{ steer: 0, throttle: -1, actions: 0, pitch: 0 }]);
    cast(s);
    expect(s.orbs[0]!.claim).toBe(1);
    s.spawnOrb(p.x, p.y, p.z + 60, 10, 0, 0);
    cast(s);
    expect(s.orbs[1]!.claim).toBeUndefined(); // cooling down
  });

  it('looks where you point: an orb above the view cone is ignored until you pitch up', () => {
    const { s, p } = stage();
    s.spawnOrb(p.x, p.y + 90, p.z + 60, 10, 0, 0); // steeply above
    cast(s);
    expect(s.orbs[0]!.claim).toBeUndefined();
    for (let t = 0; t < utility.possess.missCooldownTicks + 2; t++) s.step([{ steer: 0, throttle: -1, actions: 0, pitch: 1 }]);
    s.step([{ steer: 0, throttle: -1, actions: ACTION_POSSESS, pitch: 1 }]);
    expect(s.orbs[0]!.claim).toBe(1);
  });
});
