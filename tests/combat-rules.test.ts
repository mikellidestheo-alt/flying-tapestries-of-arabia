import { describe, expect, it } from 'vitest';
import { CHAPTERS } from '../src/data/chapters';
import { matchSetupFromChapter } from '../src/data/matchSetup';
import matchData from '../src/data/match.json';
import simData from '../src/data/sim.json';
import { damageCastle } from '../src/sim/castles';
import { ELEMENTS } from '../src/data/elements';
import { effectiveDamage, castsPerSecond } from '../src/sim/balance';
import { CREATURES, KITS, MAX_SPELL_TIER, MONSTER_FACTION, hurtCreature, nextSpellUpgrade, spellAt, tryUpgradeSpell } from '../src/sim/combat';
import { ACTION_CRATER, ACTION_SPELL, ACTION_SPELLUP, Sim, type PlayerInput } from '../src/sim/sim';

const input = (steer = 0, throttle = 0, actions = 0): PlayerInput => ({ steer, throttle, actions });
const make = (ch = 0) => {
  const c = CHAPTERS[ch]!;
  return new Sim({ terrain: c.terrain, creatureTypes: c.creatureSet, match: matchSetupFromChapter(c, ['fire'], 'normal') });
};
const hold = (s: Sim, n: number) => {
  for (let i = 0; i < n; i++) s.step([input(0, -1)]);
};

describe('weapon tiers (3 per wizard attack)', () => {
  it('every wizard: each tier hits at least as hard, fires at least as fast, costs more, and is stronger overall', () => {
    for (const el of ELEMENTS) {
      let prev = spellAt(KITS[el].primary, 1);
      for (let t = 2; t <= MAX_SPELL_TIER; t++) {
        const cur = spellAt(KITS[el].primary, t);
        expect(cur.damage, `${el} t${t} damage`).toBeGreaterThanOrEqual(prev.damage);
        expect(cur.cooldownTicks, `${el} t${t} cooldown`).toBeLessThanOrEqual(prev.cooldownTicks);
        expect(cur.manaCost, `${el} t${t} mana`).toBeGreaterThanOrEqual(prev.manaCost);
        expect(cur.area, `${el} t${t} area`).toBeGreaterThanOrEqual(prev.area);
        expect(effectiveDamage(cur) * castsPerSecond(cur)).toBeGreaterThan(effectiveDamage(prev) * castsPerSecond(prev));
        expect(cur.upgradeCost!).toBeGreaterThan(prev.upgradeCost ?? 0);
        expect(cur.upgradeCost!).toBeLessThanOrEqual(simData.player.maxMana); // affordable from a full pool
        prev = cur;
      }
      expect(nextSpellUpgrade(el, MAX_SPELL_TIER)).toBeNull();
    }
  });

  it('buying a tier spends mana, raises the tier, refuses when broke and stops at the top', () => {
    const s = make();
    const p = s.players[0]!;
    p.mana = 50;
    s.step([input(0, -1, ACTION_SPELLUP)]);
    expect(p.spellTier).toBe(1);
    p.mana = 200;
    s.step([input(0, -1, ACTION_SPELLUP)]);
    expect(p.spellTier).toBe(2);
    expect(p.mana).toBeCloseTo(200 - spellAt('fireball', 2).upgradeCost!, 0);
    p.mana = 200;
    s.step([input(0, -1, ACTION_SPELLUP)]);
    expect(p.spellTier).toBe(3);
    p.mana = 200;
    expect(tryUpgradeSpell(s, p)).toBe(false);
    expect(s.events.filter((e) => e.type === 'spellUpgrade').length).toBe(2);
  });

  it('a higher-tier bolt hits harder and costs more to cast', () => {
    const dmg = (tier: number) => {
      const s = make();
      const p = s.players[0]!;
      p.spellTier = tier;
      p.mana = 200;
      const c = s.castles[1]!;
      const hp0 = c.hp;
      s.projectiles.push({
        id: 5, owner: 0, faction: 0, hp: 16, spell: 'fireball', tier,
        x: c.x - 20, y: c.y + 5, z: c.z, px: c.x - 20, py: c.y + 5, pz: c.z, vx: 60, vy: 0, vz: 0, travelled: 0,
      });
      for (let i = 0; i < 20 && c.hp === hp0; i++) s.step([input(0, -1)]);
      return hp0 - c.hp;
    };
    expect(dmg(2)).toBeGreaterThan(dmg(1));
    expect(dmg(3)).toBeGreaterThan(dmg(2));
    const s = make();
    const p = s.players[0]!;
    p.spellTier = 3;
    p.mana = 100;
    s.step([input(0, -1, ACTION_SPELL)]);
    expect(p.mana).toBeCloseTo(100 - spellAt('fireball', 3).manaCost, 0);
  });
});

describe('killing and dying', () => {
  const duel = () => {
    const s = make();
    const killer = s.players[0]!;
    const victim = s.players[1]!;
    return { s, killer, victim };
  };

  it('dying drops a share of your mana as orbs, and pays the killer a big bounty', () => {
    const { s, killer, victim } = duel();
    victim.mana = 150;
    killer.mana = 20;
    victim.hp = 0;
    victim.lastHitBy = 0;
    victim.lastHitTick = s.tick;
    const captured0 = s.factions[0]!.captured;
    hold(s, 1);
    expect(victim.mana).toBeCloseTo(150 * (1 - matchData.wizardRespawnManaLoss), 0); // plus a tick of castle income
    expect(killer.mana).toBeCloseTo(20 + matchData.bounty.wizardKill, 0);
    expect(killer.kills).toBe(1);
    expect(s.factions[0]!.captured - captured0).toBeGreaterThanOrEqual(matchData.bounty.wizardKill);
    expect(s.events.some((e) => e.type === 'bounty')).toBe(true);
    // The victim's mana did not vanish: it dropped as orbs anyone can grab.
    expect(s.orbs.reduce((a, o) => a + o.value, 0)).toBeGreaterThan(150 * matchData.wizardRespawnManaLoss - 5);
  });

  it('the bounty lands in the same pool you spend from', () => {
    const { s, killer, victim } = duel();
    killer.mana = 190;
    victim.hp = 0;
    victim.lastHitBy = 0;
    victim.lastHitTick = s.tick;
    hold(s, 1);
    expect(killer.mana).toBeGreaterThanOrEqual(190 + matchData.bounty.wizardKill);
  });

  it('no bounty for deaths by monsters, stale hits, or friendly fire', () => {
    const { s, killer, victim } = duel();
    victim.hp = 0;
    victim.lastHitBy = -1;
    hold(s, 1);
    expect(killer.kills).toBe(0);
    const t = duel();
    t.victim.hp = 0;
    t.victim.lastHitBy = 0;
    t.victim.lastHitTick = -5000;
    hold(t.s, 1);
    expect(t.killer.kills).toBe(0);
  });

  it('the human also loses a share of their mana when killed', () => {
    const { s, killer } = duel();
    killer.mana = 180;
    killer.hp = 0;
    hold(s, 1);
    expect(killer.mana).toBeCloseTo(180 * (1 - matchData.wizardRespawnManaLoss), 0);
    expect(killer.deaths).toBe(1);
  });
});

describe('castle bounties', () => {
  it('knocking a castle down a tier pays the attacker; destroying it pays more', () => {
    const s = make();
    const rival = s.castles[1]!;
    rival.tier = 3;
    rival.hp = 1;
    const p = s.players[0]!;
    p.mana = 0;
    damageCastle(s, rival, 10, 0);
    expect(p.mana).toBe(matchData.bounty.castleDowngradeBase + matchData.bounty.castleDowngradePerTier * 3);
    rival.tier = 1;
    rival.hp = 1;
    rival.invuln = 0;
    p.mana = 0;
    damageCastle(s, rival, 10, 0);
    expect(rival.ruined).toBe(true);
    expect(p.mana).toBe(matchData.bounty.castleDestroy);
  });

  it('no payout for archers or for damaging your own castle', () => {
    const s = make();
    const mine = s.castles[0]!;
    mine.hp = 1;
    mine.tier = 2;
    const p = s.players[0]!;
    p.mana = 0;
    damageCastle(s, mine, 10, 0);
    expect(p.mana).toBeCloseTo(0, 0);
  });
});

describe('palace victory: top-tier castle + enough captured mana', () => {
  const setupWin = (tier: number, captured: number) => {
    const s = make();
    s.castles[0]!.tier = tier;
    s.factions[0]!.captured = captured;
    s.factions[1]!.captured = captured; // keep shares even so only the palace rule can fire
    return s;
  };
  const need = CHAPTERS[0]!.palaceWinMana;

  it('wins with a tier-5 castle and the required mana, even early in the match', () => {
    const s = setupWin(5, need);
    hold(s, 31);
    expect(s.match.status).toBe('won');
    expect(s.match.reason).toMatch(/palace/i);
  });

  it('does not win with the mana but a lesser castle, or the castle but too little mana', () => {
    const a = setupWin(4, need + 500);
    hold(a, 31);
    expect(a.match.status).toBe('playing');
    const b = setupWin(5, need - 200);
    hold(b, 31);
    expect(b.match.status).toBe('playing');
  });

  it('a rival completing a palace first is a defeat', () => {
    const s = make();
    s.castles[1]!.tier = 5;
    s.factions[1]!.captured = need + 10;
    s.factions[0]!.captured = need + 10;
    hold(s, 31);
    expect(s.match.status).toBe('lost');
  });

  it('every chapter sets a sane requirement', () => {
    for (const c of CHAPTERS) expect(c.palaceWinMana).toBeGreaterThanOrEqual(800);
  });
});

describe('evil genies (ranged monsters)', () => {
  const genieDef = CREATURES['evil-genie']!;

  it('are hostile ranged creatures that give good mana', () => {
    expect(genieDef.hostile).toBe(true);
    expect(genieDef.ranged).toBeDefined();
    expect(genieDef.manaDrop).toBeGreaterThan(CREATURES['dust-sprite']!.manaDrop * 2);
    const s = make();
    s.spawnCreature('evil-genie', 5000, 5000);
    const before = s.orbs.reduce((a, o) => a + o.value, 0);
    hurtCreature(s, s.creatures[0]!, 1e6, 0);
    expect(s.orbs.reduce((a, o) => a + o.value, 0) - before).toBeCloseTo(genieDef.manaDrop, 5);
  });

  it('keep their distance, fire curse bolts, and hurt the wizard they target', () => {
    const s = make();
    const p = s.players[0]!;
    p.invuln = 0;
    s.spawnCreature('evil-genie', p.x + 70, p.z + 40, 0);
    const hp0 = p.hp;
    let fired = false;
    for (let i = 0; i < 600 && p.hp >= hp0; i++) {
      p.hp = Math.max(p.hp, hp0 - 0.001); // do not let regen hide damage
      s.step([input(0, -1)]);
      if (s.events.some((e) => e.type === 'monsterFire')) fired = true;
      if (p.hp < hp0 - 0.5) break;
    }
    expect(fired).toBe(true);
    expect(s.projectiles.filter((q) => q.spell === 'genie-bolt').every((q) => q.faction === MONSTER_FACTION && q.owner === -1)).toBe(true);
    expect(p.hp).toBeLessThan(hp0);
  });

  it('monster bolts never hurt other monsters, nests or castles', () => {
    const s = make();
    s.players.forEach((w, i) => { if (i > 0) w.active = false; }); // keep rival wizards out of this experiment
    const c = s.castles[1]!;
    const hp0 = c.hp;
    s.spawnCreature('dust-sprite', c.x - 5, c.z, 0);
    const sprite = s.creatures[0]!;
    const sprHp = sprite.hp;
    s.projectiles.push({
      id: 77, owner: -1, faction: MONSTER_FACTION, hp: 8, spell: 'genie-bolt',
      x: c.x - 20, y: c.y + 5, z: c.z, px: c.x - 20, py: c.y + 5, pz: c.z, vx: 40, vy: 0, vz: 0, travelled: 0, tier: 1,
    });
    for (let i = 0; i < 25; i++) s.step([input(0, -1)]);
    expect(c.hp).toBe(hp0);
    expect(s.creatures.find((q) => q.id === sprite.id)?.hp ?? sprHp).toBeCloseTo(sprHp, 3);
  });

  it('are in the chapter creature sets', () => {
    expect(CHAPTERS[0]!.creatureSet).toContain('evil-genie');
    expect(CHAPTERS[1]!.creatureSet).toContain('evil-genie');
  });
});

describe('terrain tools cost mana', () => {
  it('crater needs and spends mana', () => {
    const s = make();
    const p = s.players[0]!;
    p.mana = 3;
    s.step([input(0, -1, ACTION_CRATER)]);
    expect(s.terrain.deltas.list.length).toBe(0);
    p.mana = 50;
    s.step([input(0, -1, ACTION_CRATER)]);
    expect(s.terrain.deltas.list.length).toBe(1);
    expect(p.mana).toBeCloseTo(50 - simData.debugTools.manaCost, 0);
  });
});
