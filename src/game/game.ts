// Game loop: fixed-timestep sim + interpolated rendering + quality governor.
import { getChapter, type ChapterConfig } from '../data/chapters';
import { ELEMENTS, type Element } from '../data/elements';
import { Controls } from '../input/controls';
import { enterFullscreen, releaseWakeLock, requestWakeLock, vibrate } from '../platform';
import { GameRenderer } from '../render/gameRenderer';
import { GOVERNOR, PRESETS, QualityGovernor, guessPreset } from '../render/quality';
import { hasSavedSettings, loadSave, writeSave, type SaveData, type Settings } from '../save';
import { ACTION_SPELL, SIM_DT, Sim } from '../sim/sim';
import { GameAudio } from '../audio/gameAudio';
import { Hud } from '../ui/hud';
import { SPELLS, spellFor } from '../sim/combat';
import { DebugOverlay } from '../ui/debugOverlay';
import { SettingsPanel } from '../ui/settingsPanel';
import simData from '../data/sim.json';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

export class Game {
  private save: SaveData = loadSave();
  /** Exposed for dev tooling only. */
  sim: Sim;
  private chapter: ChapterConfig;
  private audio = new GameAudio();
  private hud!: Hud;
  private lastSeq = 0;
  private hudAt = 0;
  private renderer!: GameRenderer;
  private controls: Controls;
  private governor = new QualityGovernor(GOVERNOR.targetFps);
  private debug: DebugOverlay;
  private panel!: SettingsPanel;
  private ui = $('#ui');
  private running = false;
  private started = false;
  private paused = true;
  private last = 0;
  private lastRender = 0;
  private acc = 0;
  private time = 0;
  private idleDraw = 0;
  private cpuAvg = 0;

  constructor(private canvas: HTMLCanvasElement) {
    // Chapter 1 is the only playable chapter in M1.
    const chapter = getChapter(0);
    this.chapter = chapter;
    this.sim = new Sim({ terrain: chapter.terrain, creatureTypes: chapter.creatureSet });
    if (!hasSavedSettings()) this.save.settings.quality = guessPreset();
    this.renderer = new GameRenderer(canvas, this.sim, chapter, this.save.settings.quality, this.wizardElement());
    this.controls = new Controls(this.ui);
    this.hud = new Hud();
    this.controls.onPress = (bit) => {
      if (this.save.settings.haptics) vibrate(12);
      if (bit === ACTION_SPELL) {
        const p = this.sim.players[0]!;
        if (p.mana < SPELLS[spellFor()]!.manaCost) this.audio.denied();
      }
    };
    this.debug = new DebugOverlay($('#debug'));
    this.panel = new SettingsPanel($('#settings'), () => this.save.settings, (p, r) => this.changeSettings(p, r), {
      get: () => this.wizardElement(),
      set: (e) => {
        this.save.progress.wizard = e;
        this.renderer.setWizard(e);
        writeSave(this.save);
      },
    });
    this.applySettings();
    this.bindUi();
    $('#startInfo').textContent = `Quality: ${PRESETS[this.save.settings.quality].label}${this.save.settings.qualityAuto ? ' (auto)' : ''}`;
    window.addEventListener('resize', () => this.renderer.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.renderer.resize(), 200));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause();
      else if (this.started && !this.paused) void requestWakeLock();
    });
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.fatal('The graphics context was lost. Please reload.');
    });
    if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = this; // dev/testing hook
    this.running = true;
    requestAnimationFrame((t) => this.loop(t));
  }

  private wizardElement(): Element {
    const w = this.save.progress.wizard;
    return (ELEMENTS as readonly string[]).includes(w) ? (w as Element) : 'fire';
  }

  private bindUi(): void {
    $('#startBtn').addEventListener('click', () => {
      void enterFullscreen();
      void requestWakeLock();
      this.audio.start(this.chapter);
      $('#startScreen').classList.add('hidden');
      this.started = true;
      this.resume();
    });
    $('#pauseBtn').addEventListener('click', () => this.pause());
    $('#resumeBtn').addEventListener('click', () => {
      void enterFullscreen();
      this.resume();
    });
  }

  private changeSettings(patch: Partial<Settings>, reapply?: 'quality' | 'auto'): void {
    Object.assign(this.save.settings, patch);
    if (reapply === 'auto') this.save.settings.quality = guessPreset();
    if (patch.tilt) this.controls.recalibrateTilt();
    this.applySettings(reapply !== undefined);
    writeSave(this.save);
  }

  private applySettings(qualityChanged = false): void {
    const s = this.save.settings;
    this.ui.classList.toggle('lefty', s.leftHanded);
    this.controls.tiltEnabled = s.tilt;
    this.debug.setVisible(s.debugOverlay);
    this.ui.classList.toggle('dev', s.debugOverlay);
    this.audio.setVolumes(s.musicVolume, s.sfxVolume, s.muted);
    this.renderer.setReducedFlashing(s.reducedFlashing);
    this.hud.reducedFlashing = s.reducedFlashing;
    this.governor.setTargetFps(s.batterySaver ? GOVERNOR.batteryFps : GOVERNOR.targetFps);
    if (qualityChanged) {
      this.governor.renderScale = 1;
      this.governor.radiusScale = 1;
      this.renderer.setQuality(s.quality);
      this.renderer.setScales(1, 1);
    }
  }

  pause(): void {
    if (!this.started || this.paused) return;
    this.paused = true;
    this.controls.releaseAll();
    this.audio.pause();
    void releaseWakeLock();
    this.panel.refresh();
    $('#pauseScreen').classList.remove('hidden');
  }

  resume(): void {
    this.paused = false;
    this.last = performance.now();
    this.acc = 0;
    this.governor.reset();
    this.controls.recalibrateTilt();
    $('#pauseScreen').classList.add('hidden');
    this.audio.resume();
    void requestWakeLock();
  }

  /** Fan new sim events out to VFX, audio and HUD (the sim keeps a bounded event log). */
  private dispatchEvents(): void {
    const ev = this.sim.events;
    let i = ev.length;
    while (i > 0 && ev[i - 1]!.seq > this.lastSeq) i--;
    const p = this.sim.players[0]!;
    const listener = { x: p.x, z: p.z, heading: p.heading };
    for (; i < ev.length; i++) {
      const e = ev[i]!;
      this.lastSeq = e.seq;
      this.renderer.handleEvent(e);
      this.audio.handle(e, listener, this.time);
      if (e.type === 'wellSpawn') this.hud.showToast('A mana well appeared! Follow the arrow and hover beside it.');
      else if (e.type === 'playerHit') {
        this.hud.damageFlash();
        if (this.save.settings.haptics) vibrate(40);
      } else if (e.type === 'respawn') this.hud.showToast('You were knocked out. Some mana was lost.');
    }
  }

  private fatal(msg: string): void {
    this.running = false;
    $('#fatalMsg').textContent = msg;
    $('#fatal').classList.remove('hidden');
  }

  private loop(now: number): void {
    if (!this.running) return;
    requestAnimationFrame((t) => this.loop(t));
    const s = this.save.settings;
    const fps = s.batterySaver ? GOVERNOR.batteryFps : GOVERNOR.targetFps;
    // Frame limiter (60 fps, or 30 fps in battery saver); avoids burning a 120 Hz screen.
    if (now - this.lastRender < (1000 / fps) * 0.9) return;
    const frameMs = now - this.lastRender;
    this.lastRender = now;

    if (this.paused) {
      // Behind the start/pause screens the scene is static: redraw only twice a second.
      if (!this.started && now - this.idleDraw > 500) {
        this.idleDraw = now;
        this.renderer.render(1, 1 / 60, 0);
      }
      return;
    }
    const cpuStart = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.time += dt;

    this.acc += dt;
    let steps = 0;
    while (this.acc >= SIM_DT && steps < simData.maxFrameSteps) {
      this.sim.step([this.controls.sample()]);
      this.acc -= SIM_DT;
      steps++;
    }
    if (steps === simData.maxFrameSteps) this.acc = 0; // spiral-of-death guard
    if (steps > 0) this.dispatchEvents();

    this.renderer.render(this.acc / SIM_DT, dt, this.time);
    if (now - this.hudAt > 100) {
      this.hudAt = now;
      this.hud.update(this.sim, this.sim.players[0]!.heading);
    }
    // JS time spent on the main thread this frame (sim + scene update + draw submission).
    this.cpuAvg += (performance.now() - cpuStart - this.cpuAvg) * 0.05;

    if (this.governor.sample(frameMs)) {
      this.renderer.setScales(this.governor.renderScale, this.governor.radiusScale);
    }
    this.debug.frame(now, frameMs, {
      stats: () => this.renderer.stats,
      cpuMs: this.cpuAvg,
      renderScale: this.governor.renderScale,
      radiusScale: this.governor.radiusScale,
      preset: s.qualityAuto ? `${s.quality} (auto)` : s.quality,
      pingMs: null,
      deltaCount: this.sim.terrain.deltas.list.length,
    });
  }
}
