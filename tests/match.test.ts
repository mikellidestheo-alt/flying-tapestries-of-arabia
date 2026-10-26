import { describe, expect, it } from 'vitest';
import { CHAPTERS } from '../src/data/chapters';
import castleData from '../src/data/castles.json';
import matchData from '../src/data/match.json';
import { matchSetupFromChapter } from '../src/data/matchSetup';
import { BRANCHES, MAX_TIER, TIERS, archerDps, castleStats, damageCastle, nextUpgrade } from '../src/sim/castles';
import { SPELLS } from '../src/sim/combat';
import { factionShare, incomeMultiplier } from '../src/sim/match';
import { ACTION_DEPOSIT, ACTION_SPELL, ACTION_UPGRADE, Sim, type PlayerInput } from '../src/sim/sim';
import { buildingTopAt } from '../src/sim/terrain';

const input = (steer = 0, throttle = 0, actions = 0, branch = 0): PlayerInput => ({ steer, throttle, actions, branch });
const make = (chapter = 0, difficulty: 'easy' | 'normal' | 'hard' = 'normal') => {
  const c = CHAPTERS[chapter]!;
  return new Sim({ terrain: c.terrain, creatureTypes: c.creatureSet, match: matchSetupFromChapter(c, ['fire'], difficulty) });
};
const hold = (s: Sim, ticks: number, f?: (i: number) => PlayerInput) => {
  for (let i = 0; i < ticks; i++) s.step([f ? f(i) : input(0, -1)]);
};
/** Park the human on top of their castle so upgrades/archers can be tested. */
const atCastle = (s: Sim) => {
  const c = s.castles[0]!;
  const p = s.players[0]!;
  p.x = c.x;
  p.z = c.z + 10;
  p.y = c.y + 30;
  p.speed = 9;
  return { c, p };
};

describe('match setup', () => {
  it.each([0, 1].map((i) => [CHAPTERS[i]!.id, i] as const))('%s: castles on dry flat land, spaced apart, one per faction', (_id, i) => {
    const s = make(i);
    expect(s.castles.length).toBe(CHAPTERS[i]!.rivals.length + 1);
    expect(s.factions.length).toBe(s.castles.length);
    for (const c of s.castles) {
      expect(c.y).toBeGreaterThan(CHAPTERS[i]!.terrain.waterLevel + 2);
      // Building pad: terrain under the castle equals the pad height.
      expect(s.terrain.heightAt(c.x, c.z)).toBeCloseTo(c.y, 1);
      expect(buildingTopAt(CHAPTERS[i]!.terrain, c.x, c.z)).toBe(0);
    }
    for (let a = 0; a < s.castles.length; a++) {
      for (let b = a + 1; b < s.castles.length; b++) {
        const dx = s.castles[a]!.x - s.castles[b]!.x;
        const dz = s.castles[a]!.z - s.castles[b]!.z;
        expect(Math.hypot(dx, dz)).toBeGreaterThan(400);
      }
    }
    expect(s.players.length).toBe(1 + CHAPTERS[i]!.rivals.length);
    expect(s.structures.length).toBeGreaterThan(0);
    expect(s.orbs.length).toBe(matchData.starterOrbs);
  });

  it('rivals use elements the human did not choose', () => {
    const c = CHAPTERS[4]!;
    const setup = matchSetupFromChapter(c, ['fire'], 'normal');
    expect(setup.rivals.map((r) => r.element)).toEqual(['water', 'earth', 'air']);
    expect(matchSetupFromChapter(c, ['fire', 'water'], 'normal').rivals.map((r) => r.element)).toEqual(['earth', 'air', 'earth']);
  });
});

describe('castle tiers and upgrades', () => {
  it('has 5 tiers with rising cost, HP, income and archers; visuals grow', () => {
    expect(MAX_TIER).toBe(5);
    for (let i = 1; i < TIERS.length; i++) {
      const a = TIERS[i - 1]!;
      const b = TIERS[i]!;
      expect(b.cost).toBeGreaterThan(a.cost);
      expect(b.wallHp).toBeGreaterThan(a.wallHp);
      expect(b.income).toBeGreaterThan(a.income);
      expect(b.archers).toBeGreaterThanOrEqual(a.archers);
      expect(b.visual.keepHeight).toBeGreaterThan(a.visual.keepHeight);
      expect(b.visual.wallRadius).toBeGreaterThan(a.visual.wallRadius);
    }
  });

  it('archer DPS stays a support role: at most 60% of one wizard, with any branch picks', () => {
    const wizard = (SPELLS.fireball!.damage * 30) / SPELLS.fireball!.cooldownTicks;
    for (let tier = 1; tier <= MAX_TIER; tier++) {
      for (const branches of [[], ['archers'], ['archers', 'archers'], ['walls'], ['income', 'archers']]) {
        const picks = branches.slice(0, castleData.branchTiers.filter((t) => t <= tier).length);
        expect(archerDps(tier, picks), `tier ${tier} ${picks}`).toBeLessThanOrEqual(wizard * 0.6);
      }
    }
  });

  it('upgrades from the shared bank first, then the wizard pool; needs to be at the castle', () => {
    const s = make();
    const { c, p } = atCastle(s);
    c.bank = 30;
    p.mana = 60;
    s.step([input(0, -1, ACTION_UPGRADE)]);
    expect(c.tier).toBe(2);
    expect(c.bank).toBeLessThan(0.2); // bank emptied first (plus one tick of fresh income)
    expect(p.mana).toBeCloseTo(60 - (TIERS[1]!.cost - 30), 0);
    expect(c.hp).toBe(c.maxHp);
    expect(s.events.some((e) => e.type === 'upgrade')).toBe(true);
    // Too far away: refused.
    p.x += 200;
    p.mana = 200;
    s.step([input(0, -1, ACTION_UPGRADE)]);
    expect(c.tier).toBe(2);
  });

  it('refuses when broke, and branch tiers need a branch choice', () => {
    const s = make();
    const { c, p } = atCastle(s);
    p.mana = 10;
    s.step([input(0, -1, ACTION_UPGRADE)]);
    expect(c.tier).toBe(1);
    p.mana = 200;
    c.bank = 900;
    s.step([input(0, -1, ACTION_UPGRADE)]);
    expect(c.tier).toBe(2);
    c.bank = 900;
    s.step([input(0, -1, ACTION_UPGRADE)]); // tier 3 requires a branch
    expect(c.tier).toBe(2);
    expect(nextUpgrade(c)!.needsBranch).toBe(true);
    s.step([input(0, -1, ACTION_UPGRADE, 1)]); // archers
    expect(c.tier).toBe(3);
    expect(c.branches).toEqual(['archers']);
    expect(castleStats(3, c.branches).archers).toBe(TIERS[2]!.archers + BRANCHES.archers!.archers);
  });

  it('branches change stats: tougher walls and faster income', () => {
    const base = castleStats(3, []);
    expect(castleStats(3, ['walls']).wallHp).toBeGreaterThan(base.wallHp);
    expect(castleStats(3, ['income']).income).toBeGreaterThan(base.income);
    expect(castleStats(3, ['archers']).archers).toBe(base.archers + 1);
  });

  it('earns passive mana income into the bank, scaled by tier', () => {
    const s = make();
    hold(s, 300);
    const t1 = s.castles[0]!.bank;
    expect(t1).toBeGreaterThan(0);
    const s2 = make();
    s2.castles[0]!.tier = 4;
    hold(s2, 300);
    expect(s2.castles[0]!.bank).toBeGreaterThan(t1 * 2);
  });
});

describe('archers', () => {
  const stage = () => {
    const s = make();
    const { c, p } = atCastle(s);
    c.tier = 3;
    c.branches = ['archers'];
    p.y = c.y + 60;
    return { s, c, p };
  };

  it('shoot nearby creatures, never the player', () => {
    const { s, c, p } = stage();
    s.spawnCreature('dust-sprite', c.x + 30, c.z + 30);
    const id = s.creatures[0]!.id;
    const hp0 = s.creatures[0]!.hp;
    p.x = c.x;
    p.z = c.z;
    hold(s, 90);
    expect(s.events.some((e) => e.type === 'arrow')).toBe(true);
    const cr = s.creatures.find((q) => q.id === id);
    expect(!cr || cr.hp < hp0).toBe(true); // wounded or dead (by arrows or by your fire)
    expect(p.hp).toBeGreaterThan(0);
  });

  it('shoot down incoming rival projectiles', () => {
    const { s, c } = stage();
    s.projectiles.push({
      id: 999, owner: 1, faction: 1, hp: SPELLS.fireball!.interceptHp, spell: 'fireball',
      x: c.x + 60, y: c.y + 30, z: c.z, px: c.x + 60, py: c.y + 30, pz: c.z, vx: -10, vy: 0, vz: 0, travelled: 0,
    });
    for (let i = 0; i < 60 && s.projectiles.some((q) => q.id === 999); i++) s.step([input(0, -1)]);
    expect(s.projectiles.some((q) => q.id === 999)).toBe(false);
    expect(s.events.some((e) => e.type === 'arrow')).toBe(true);
  });

  it('do not shoot the player\'s own projectiles', () => {
    const { s, c, p } = stage();
    p.x = c.x - 400;
    s.projectiles.push({
      id: 998, owner: 0, faction: 0, hp: 16, spell: 'fireball',
      x: c.x + 40, y: c.y + 30, z: c.z, px: c.x + 40, py: c.y + 30, pz: c.z, vx: 0, vy: 0, vz: 0.01, travelled: 0,
    });
    s.step([input(0, -1)]);
    expect(s.projectiles.find((q) => q.id === 998)!.hp).toBe(16);
  });
});

describe('archers and wild animals', () => {
  it('archers leave neutral animals alone', () => {
    const s = make();
    const c = s.castles[0]!;
    c.tier = 3;
    s.players[0]!.x = c.x + 200; // outside archer range, inside despawn range
    s.spawnCreature('oryx', c.x + 30, c.z + 30);
    const hp0 = s.creatures[0]!.hp;
    hold(s, 60);
    expect(s.events.some((e) => e.type === 'arrow')).toBe(false);
    expect(s.creatures.find((q) => q.type === 'oryx')!.hp).toBe(hp0);
  });
});

describe('castle damage', () => {
  it('drops a tier (restoring HP and keeping the castle) instead of vanishing', () => {
    const s = make();
    const c = s.castles[1]!;
    c.tier = 3;
    c.branches = ['walls'];
    c.maxHp = castleStats(3, c.branches).wallHp;
    c.hp = 5;
    damageCastle(s, c, 50);
    expect(c.tier).toBe(2);
    expect(c.ruined).toBe(false);
    expect(c.hp).toBe(c.maxHp);
    expect(c.invuln).toBeGreaterThan(0);
    expect(s.events.some((e) => e.type === 'castleDowngrade')).toBe(true);
    const hp = c.hp;
    damageCastle(s, c, 50); // invulnerable right after a downgrade
    expect(c.hp).toBe(hp);
  });

  it('a tier-1 castle is destroyed: faction eliminated, last castle standing wins', () => {
    const s = make();
    const rival = s.castles[1]!;
    rival.hp = 1;
    damageCastle(s, rival, 10);
    expect(rival.ruined).toBe(true);
    expect(s.factions[1]!.eliminated).toBe(true);
    expect(s.players[1]!.active).toBe(false);
    hold(s, 31);
    expect(s.match.status).toBe('won');
  });

  it('losing your own castle loses the match', () => {
    const s = make();
    const mine = s.castles[0]!;
    mine.hp = 1;
    damageCastle(s, mine, 10);
    hold(s, 31);
    expect(s.match.status).toBe('lost');
  });

  it('a fireball hitting a rival castle damages it', () => {
    const s = make();
    const rival = s.castles[1]!;
    const hp0 = rival.hp;
    s.projectiles.push({
      id: 777, owner: 0, faction: 0, hp: 16, spell: 'fireball',
      x: rival.x - 25, y: rival.y + 5, z: rival.z, px: rival.x - 25, py: rival.y + 5, pz: rival.z, vx: 60, vy: 0, vz: 0, travelled: 0,
    });
    for (let i = 0; i < 20 && rival.hp === hp0; i++) s.step([input(0, -1)]);
    expect(rival.hp).toBeLessThan(hp0);
    expect(s.events.some((e) => e.type === 'castleHit')).toBe(true);
  });
});

describe('win condition and comeback', () => {
  it('captures the target share of total mana to win', () => {
    const s = make();
    s.factions[0]!.captured = 700;
    s.factions[1]!.captured = 300;
    s.tick = matchData.winAfterMinutes * 60 * 30 - 1;
    hold(s, 31);
    expect(factionShare(s, 0)).toBeCloseTo(0.7, 2);
    expect(s.match.status).toBe('won');
  });

  it('a rival reaching the target share ends the match as a defeat', () => {
    const s = make();
    s.factions[0]!.captured = 200;
    s.factions[1]!.captured = 800;
    s.tick = matchData.winAfterMinutes * 60 * 30 - 1;
    hold(s, 31);
    expect(s.match.status).toBe('lost');
  });

  it('a lead early in the match does not end it: shares only count after the grace period', () => {
    const s = make();
    s.factions[0]!.captured = 900;
    s.factions[1]!.captured = 100;
    hold(s, 90);
    expect(s.match.status).toBe('playing');
  });

  it('does not end before the minimum total of mana has been captured', () => {
    const s = make();
    s.factions[0]!.captured = 100;
    s.factions[1]!.captured = 5;
    hold(s, 31);
    expect(s.match.status).toBe('playing');
  });

  it('sudden death lowers the target share and a hard end crowns the leader', () => {
    const s = make();
    const cb = CHAPTERS[0]!.comeback;
    s.factions[0]!.captured = 500;
    s.factions[1]!.captured = 700; // 41.7% vs 58.3%: below the 60% target
    s.tick = Math.floor(cb.suddenDeathMinute * 60 * 30) - 31;
    hold(s, 31);
    expect(s.match.suddenDeath).toBe(true);
    expect(s.match.targetShare).toBe(cb.suddenDeathShare);
    expect(s.match.status).toBe('lost'); // rival already over the lowered 40% bar
  });

  it('gives trailing factions an income bonus after the comeback minute', () => {
    const s = make();
    const cb = CHAPTERS[0]!.comeback;
    s.match.shares = [0.2, 0.8];
    expect(incomeMultiplier(s, 0)).toBeCloseTo(1, 5);
    s.tick = Math.ceil(cb.startMinute * 60 * 30) + 1;
    expect(incomeMultiplier(s, 0)).toBeCloseTo(1 + cb.trailingIncomeBonus, 5);
    expect(incomeMultiplier(s, 1)).toBeCloseTo(1, 5);
  });

  it('every chapter ends within its design window: target share is reachable and sudden death precedes the hard end', () => {
    for (const c of CHAPTERS) {
      expect(c.comeback.suddenDeathShare).toBeLessThan(c.targetShare);
      expect(c.comeback.startMinute).toBeLessThan(c.matchLengthMinutes);
      expect(c.comeback.suddenDeathMinute + matchData.hardEndAfterSuddenDeathMinutes).toBeLessThanOrEqual(19);
    }
  });
});

describe('difficulty', () => {
  it('scales enemy health, rival health and income', () => {
    const easy = make(0, 'easy');
    const hard = make(0, 'hard');
    easy.spawnCreature('dust-sprite', 0, 0);
    hard.spawnCreature('dust-sprite', 0, 0);
    expect(easy.creatures[0]!.hp).toBeLessThan(hard.creatures[0]!.hp);
    expect(easy.maxHpFor(easy.players[1]!)).toBeLessThan(hard.maxHpFor(hard.players[1]!));
    expect(incomeMultiplier(easy, 0)).toBeGreaterThan(incomeMultiplier(hard, 0));
    expect(incomeMultiplier(easy, 1)).toBeLessThan(incomeMultiplier(hard, 1));
  });
});

describe('rival AI and full matches', () => {
  it.each([0, 1].map((i) => [CHAPTERS[i]!.id, i] as const))('%s: rivals collect mana, upgrade and stay finite; the run is deterministic', (_id, i) => {
    const run = () => {
      const s = make(i);
      const p = s.players[0]!;
      for (let t = 0; t < 30 * 60 * 4; t++) {
        // The human idles safely over their castle so the rival's behaviour can be observed.
        const c = s.castles[0]!;
        p.x = c.x;
        p.z = c.z;
        p.y = c.y + 40;
        p.hp = 100;
        s.step([input(0, -1)]);
      }
      for (const w of s.players) for (const v of [w.x, w.y, w.z, w.mana, w.hp]) expect(Number.isFinite(v)).toBe(true);
      return s;
    };
    const a = run();
    const b = run();
    expect(JSON.stringify({ f: a.factions, c: a.castles, p: a.players })).toBe(JSON.stringify({ f: b.factions, c: b.castles, p: b.players }));
    expect(a.factions[1]!.captured).toBeGreaterThan(30); // the rival gathered mana on its own
    expect(a.castles[1]!.bank + a.castles[1]!.tier * 100).toBeGreaterThan(50);
  });

  it('rivals fight back: an aggressive rival hurts a player who sits in its range', () => {
    const c = CHAPTERS[2]!;
    const s = new Sim({ terrain: c.terrain, creatureTypes: c.creatureSet, match: matchSetupFromChapter(c, ['fire'], 'normal') });
    const rival = s.players[1]!;
    const p = s.players[0]!;
    rival.mana = 200;
    let damaged = false;
    for (let t = 0; t < 30 * 90 && !damaged; t++) {
      p.x = rival.x + 40;
      p.z = rival.z + 30;
      p.y = rival.y;
      rival.mana = 200;
      s.step([input(0, -1)]);
      damaged = s.events.some((e) => e.type === 'playerHit');
    }
    expect(damaged).toBe(true);
  });

  it('three rivals (chapter 5): everyone stays alive, finite and within caps over 3 minutes', () => {
    const s = make(4);
    for (let t = 0; t < 30 * 180; t++) s.step([input(Math.sin(t / 40), 0.5, t % 12 === 0 ? ACTION_SPELL : 0)]);
    expect(s.players.length).toBe(4);
    for (const w of s.players) expect(Number.isFinite(w.x + w.y + w.z)).toBe(true);
    expect(s.projectiles.length).toBeLessThanOrEqual(32);
  });
});

describe('rooftop flight in the Spice Bazaar', () => {
  it('buildings exist and the tapestry hovers above them without clipping', () => {
    const c = CHAPTERS[1]!;
    const s = make(1);
    let seen = 0;
    for (let x = -1500; x < 1500 && seen < 5; x += 8) if (buildingTopAt(c.terrain, x, 40) > 0) seen++;
    expect(seen).toBeGreaterThan(0);
    const p = s.players[0]!;
    for (let t = 0; t < 4000; t++) {
      s.step([input(Math.sin(t / 70) * 0.8, 0.8)]);
      expect(p.y).toBeGreaterThanOrEqual(s.terrain.surfaceAt(p.x, p.z) + 2.2 - 1e-6);
    }
  });
});

describe('depositing mana into the castle bank', () => {
  it('lets a capped (200) mana pool pay for the 300/520 upgrades', () => {
    const s = make();
    const { c, p } = atCastle(s);
    c.tier = 3;
    c.branches = ['archers'];
    c.bank = 0;
    p.mana = 200;
    s.step([input(0, -1, ACTION_UPGRADE, 1)]); // tier 4 costs 300: pool alone (200) is not enough
    expect(c.tier).toBe(3);
    for (let i = 0; i < 90; i++) {
      p.x = c.x; p.z = c.z + 10; p.y = c.y + 30; p.vx = p.vz = 0;
      s.step([input(0, -1, ACTION_DEPOSIT)]);
    }
    expect(c.bank).toBeGreaterThan(100);
    p.mana = 200; // gathered more orbs meanwhile
    s.step([input(0, -1, ACTION_UPGRADE)]);
    expect(c.tier).toBe(4);
  });

  it('only works near your own castle and never exceeds the bank cap', () => {
    const s = make();
    const { c, p } = atCastle(s);
    p.mana = 100;
    p.x += 300;
    s.step([input(0, -1, ACTION_DEPOSIT)]);
    expect(p.mana).toBe(100);
    p.x = c.x;
    p.z = c.z + 10;
    c.bank = castleData.bankCap - 1;
    for (let i = 0; i < 20; i++) {
      p.x = c.x; p.z = c.z + 10; p.vx = p.vz = 0;
      s.step([input(0, -1, ACTION_DEPOSIT)]);
    }
    expect(c.bank).toBeLessThanOrEqual(castleData.bankCap + 0.2); // plus a little passive income
  });
});

describe('guided aim', () => {
  const shoot = (offAngle: number, dist = 90) => {
    const s = make();
    const p = s.players[0]!;
    p.x = 0; p.z = 0; p.y = s.terrain.surfaceAt(0, 0) + 10; p.heading = 0; p.mana = 200; p.invuln = 9999; p.speed = 9; p.vx = p.vz = 0;
    s.spawnCreature('dust-sprite', Math.sin(offAngle) * dist, Math.cos(offAngle) * dist);
    const c = s.creatures[0]!;
    c.state = 0; c.wanderUntil = 1e9; c.wx = c.x; c.wz = c.z; c.homeX = c.x; c.homeZ = c.z;
    c.y = p.y;
    const hp0 = c.hp;
    s.step([input(0, -1, ACTION_SPELL)]);
    const tracked = s.projectiles[0]?.tk ?? 0;
    for (let i = 0; i < 90; i++) {
      c.x = Math.sin(offAngle) * dist; c.z = Math.cos(offAngle) * dist; c.y = p.y; // hold the target still
      s.step([input(0, -1)]);
    }
    return { hit: s.events.some((e) => e.type === 'hit' && Math.abs(e.x - c.x) < 6), tracked, hp0, hp: c.hp };
  };

  it('a target 20 degrees off the aim line is picked up and hit', () => {
    const r = shoot(0.35);
    expect(r.tracked).toBe(1);
    expect(r.hit).toBe(true);
  });

  it('a target 25 degrees off still gets hit thanks to the light homing', () => {
    expect(shoot(-0.44).hit).toBe(true);
  });

  it('a target far off to the side (60 degrees) is ignored, not magnetised', () => {
    const r = shoot(1.05);
    expect(r.tracked).toBe(0);
    expect(r.hit).toBe(false);
  });
});
