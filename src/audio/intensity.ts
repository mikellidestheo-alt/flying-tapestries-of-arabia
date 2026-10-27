// Combat intensity for the adaptive music: a pure threat estimate plus a follower that rises
// quickly when danger appears and fades slowly when it passes. No Web Audio in here, so it is testable.
import music from '../data/music.json';

export interface ThreatInput {
  /** Hostile creatures chasing within the creature range. */
  hostileNear: number;
  /** Enemy wizards within the rival range. */
  rivalsNear: number;
  /** Enemy bolts within the bolt range. */
  boltsNear: number;
  /** Seconds since the player's castle last took damage (Infinity if never). */
  secondsSinceCastleHit: number;
  hpFrac: number;
}

const T = music.combat.threat;

/** Target intensity 0..1 for a threat snapshot. */
export function threatTarget(t: ThreatInput): number {
  let v = 0;
  v += Math.min(3, t.hostileNear) * T.creatureWeight;
  v += Math.min(2, t.rivalsNear) * T.rivalWeight;
  v += Math.min(3, t.boltsNear) * T.boltWeight;
  if (t.secondsSinceCastleHit < T.castleHitSeconds) v += T.castleHitWeight;
  if (t.hpFrac < T.lowHpBelow) v += T.lowHpWeight;
  return Math.min(1, v);
}

export class IntensityFollower {
  value = 0;

  /** Move towards the target: fast up, slow down. `dt` in seconds. */
  update(target: number, dt: number): number {
    const c = music.combat;
    if (target > this.value) this.value = Math.min(target, this.value + c.attackPerSecond * dt);
    else this.value = Math.max(target, this.value - c.releasePerSecond * dt);
    return this.value;
  }
}
