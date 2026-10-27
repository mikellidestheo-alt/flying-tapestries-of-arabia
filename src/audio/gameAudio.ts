// Facade the game talks to: owns the engine, music and sfx, and turns sim events into sound.
import type { ChapterConfig } from '../data/chapters';
import type { Element } from '../data/elements';
import type { SimEvent } from '../sim/entities';
import { AmbientBed } from './ambient';
import { AudioEngine } from './engine';
import { MusicDirector } from './music';
import { degreeHz, type MusicSpec } from './musicPlanner';
import { Sfx } from './sfx';

export interface Listener {
  x: number;
  z: number;
  heading: number;
}

export function musicSpecFor(c: ChapterConfig): MusicSpec {
  return { id: c.id, scale: c.music.scale, rootMidi: c.music.rootMidi, tempoBpm: c.music.tempoBpm, rhythm: c.music.rhythm, motif: c.music.motif };
}

export class GameAudio {
  readonly engine = new AudioEngine();
  private music = new MusicDirector(this.engine);
  private sfx = new Sfx(this.engine);
  private ambient = new AmbientBed(this.engine);
  private spec: MusicSpec | null = null;
  private ladder = 0;
  private lastOrbAt = -10;
  private clock = 0;

  /** Must be called from a tap. Starts the context and the chapter music. */
  start(chapter: ChapterConfig): void {
    if (!this.engine.unlock()) return;
    this.spec = musicSpecFor(chapter);
    void this.music.play(this.spec, (chapter.music as { file?: string | null }).file ?? null);
    this.ambient.start(chapter.ambient.sound);
  }

  /** Combat intensity 0..1 from the game loop; drives the adaptive music layers. */
  setIntensity(i: number): void {
    this.music.setIntensity(i);
  }

  stopMusic(): void {
    this.music.stop();
    this.ambient.stop();
  }

  setVolumes(music: number, sfx: number, muted: boolean): void {
    this.engine.setVolumes(music, sfx, muted);
  }

  pause(): void {
    this.engine.suspend();
  }

  resume(): void {
    this.engine.resume();
  }

  /** Stereo pan and distance gain for a world-space sound, relative to the listener. */
  private place(e: SimEvent, l: Listener): { pan: number; gain: number } {
    const dx = e.x - l.x;
    const dz = e.z - l.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    // Listener's right vector for heading h (forward = (sin h, cos h)) is (-cos h, sin h).
    const right = d > 0.01 ? (dx * -Math.cos(l.heading) + dz * Math.sin(l.heading)) / d : 0;
    return { pan: right * 0.8, gain: Math.max(0, 1 - d / 260) };
  }

  /** Was this event produced at the listener's own position (their own bounty or upgrade)? */
  private isLocal(e: SimEvent, l: Listener): boolean {
    return Math.abs(e.x - l.x) < 0.01 && Math.abs(e.z - l.z) < 0.01;
  }

  handle(e: SimEvent, l: Listener, now: number, elementOf: (owner: number) => Element = () => 'fire'): void {
    if (!this.engine.ready || !this.spec) return;
    this.clock = now;
    const { pan, gain } = this.place(e, l);
    switch (e.type) {
      case 'cast': {
        const el = elementOf(e.v);
        if (el === 'water') this.sfx.castWater(pan, 0.7);
        else if (el === 'earth') this.sfx.castEarth(pan, 0.8);
        else if (el === 'air') this.sfx.castAir(pan, 0.6);
        else this.sfx.castFire(pan, 0.7);
        break;
      }
      case 'impact': {
        if (e.v < 0) break;
        const el = elementOf(e.v);
        if (el === 'water') this.sfx.impactWater(pan, gain);
        else if (el === 'earth') this.sfx.impactEarth(pan, gain);
        else if (el === 'air') this.sfx.impactAir(pan, gain);
        else this.sfx.impactFire(pan, gain);
        break;
      }
      case 'chain': this.sfx.chain(pan, gain, elementOf(e.v) === 'water'); break;
      case 'nova': this.sfx.nova(gain); break;
      case 'wallRaised': this.sfx.wall(pan, gain); break;
      case 'dash': this.sfx.dash(gain); break;
      case 'zoneStart': this.sfx.zoneStart(pan, gain); break;
      case 'quake': this.sfx.quake(pan, gain); break;
      case 'monsterFire': this.sfx.monsterFire(pan, gain); break;
      case 'bounty': if (this.isLocal(e, l)) this.sfx.bounty(degreeHz(this.spec, 0), 0.9); break;
      case 'castleRelease': this.sfx.bounty(degreeHz(this.spec, 4), 0.55 * gain); break;
      case 'spellUpgrade': if (this.isLocal(e, l)) this.sfx.weaponUp(0.9); break;
      case 'hit': this.sfx.hit(pan, gain * 0.8); break;
      case 'kill': this.sfx.kill(pan, gain); break;
      case 'orb': {
        if (now - this.lastOrbAt > 1.2) this.ladder = 0;
        this.lastOrbAt = now;
        this.sfx.orb(0, 0.7, degreeHz(this.spec, 7 + (this.ladder % 7)));
        this.ladder++;
        break;
      }
      case 'playerHit': this.sfx.playerHit(0.9); break;
      case 'respawn': this.sfx.respawn(0.8); break;
      case 'wellSpawn': this.sfx.wellSpawn(pan, Math.max(0.5, gain), degreeHz(this.spec, 7)); break;
      case 'wellEnd': this.sfx.wellEnd(pan, gain, degreeHz(this.spec, 7)); break;
      case 'matchEnd':
        this.music.stop();
        this.ambient.stop();
        this.sfx.sting(e.v === 1, degreeHz(this.spec, 0), 0.9);
        break;
      case 'wellDraw': this.sfx.wellDraw(0.6, degreeHz(this.spec, 14 + (Math.floor(this.clock * 3) % 3))); break;
      default: break;
    }
  }

  denied(): void {
    this.sfx.denied(0.8);
  }
}
