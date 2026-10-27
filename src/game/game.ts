// Game flow and loop: title -> chapter menu -> match -> end screen, with a fixed-timestep sim,
// interpolated rendering and the adaptive quality governor.
import simData from '../data/sim.json';
import castleData from '../data/castles.json';
import gameData from '../data/game.json';
import { CHAPTERS, getChapter, type ChapterConfig } from '../data/chapters';
import { ELEMENTS, assignRivalElements, type Element } from '../data/elements';
import { matchSetupFromChapter } from '../data/matchSetup';
import { GameAudio } from '../audio/gameAudio';
import { Controls } from '../input/controls';
import { enterFullscreen, releaseWakeLock, requestWakeLock, vibrate } from '../platform';
import { GameRenderer } from '../render/gameRenderer';
import { GOVERNOR, PRESETS, QualityGovernor, guessPreset } from '../render/quality';
import { hasSavedSettings, loadSave, writeSave, type SaveData, type Settings } from '../save';
import { tierDef } from '../sim/castles';
import { KITS, primaryDef, spellAt } from '../sim/combat';
import { ACTION_SPELL, SIM_DT, Sim } from '../sim/sim';
import { DebugOverlay } from '../ui/debugOverlay';
import { Hud } from '../ui/hud';
import { Menu } from '../ui/menu';
import { SettingsPanel } from '../ui/settingsPanel';
import { Tutorial } from './tutorial';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

type Phase = 'title' | 'menu' | 'playing' | 'paused' | 'ended';

export class Game {
  private save: SaveData = loadSave();
  /** Exposed for dev tooling only. */
  sim: Sim | null = null;
  private chapter: ChapterConfig = getChapter(0);
  private chapterIndex = 0;
  private audio = new GameAudio();
  private hud: Hud;
  private renderer: GameRenderer;
  private controls: Controls;
  private governor = new QualityGovernor(GOVERNOR.targetFps);
  private debug: DebugOverlay;
  private panel: SettingsPanel;
  private menu: Menu;
  private tutorial: Tutorial | null = null;
  private ui = $('#ui');
  private phase: Phase = 'title';
  private settingsFromMenu = false;
  private running = true;
  private lastSeq = 0;
  private hudAt = 0;
  private last = 0;
  private lastRender = 0;
  private acc = 0;
  private time = 0;
  private idleDraw = 0;
  private cpuAvg = 0;
  private endAt = -1;

  constructor(canvas: HTMLCanvasElement) {
    if (!hasSavedSettings()) this.save.settings.quality = guessPreset();
    this.renderer = new GameRenderer(canvas, this.save.settings.quality);
    this.controls = new Controls(this.ui);
    this.hud = new Hud();
    this.hud.onUpgrade = (branch) => this.controls.requestUpgrade(branch);
    this.controls.onPress = (bit) => {
      if (this.save.settings.haptics) vibrate(12);
      const p = this.sim?.players[0];
      if (bit === ACTION_SPELL && p && p.mana < primaryDef(p).manaCost) this.audio.denied();
    };
    this.debug = new DebugOverlay($('#debug'));
    this.panel = new SettingsPanel($('#settings'), () => this.save.settings, (p, r) => this.changeSettings(p, r), {
      get: () => this.wizardElement(),
      set: (e) => this.setWizard(e),
    });
    this.menu = new Menu({
      settings: () => this.save.settings,
      progress: () => this.save.progress,
      setDifficulty: (d) => this.changeSettings({ difficulty: d }),
      setWizard: (e) => this.setWizard(e),
      play: (i) => this.startMatch(i),
      openSettings: () => this.openSettings(true),
    });
    this.applySettings();
    this.bindUi();
    $('#startInfo').textContent = `Quality: ${PRESETS[this.save.settings.quality].label}${this.save.settings.qualityAuto ? ' (auto)' : ''}`;
    window.addEventListener('resize', () => this.renderer.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.renderer.resize(), 200));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause();
      else if (this.phase === 'playing') void requestWakeLock();
    });
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.fatal('The graphics context was lost. Please reload.');
    });
    if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = this; // dev/testing hook
    requestAnimationFrame((t) => this.loop(t));
  }

  // ------------------------------------------------------------ setup helpers
  private wizardElement(): Element {
    const w = this.save.progress.wizard;
    return (ELEMENTS as readonly string[]).includes(w) ? (w as Element) : 'fire';
  }

  private setWizard(e: Element): void {
    this.save.progress.wizard = e;
    writeSave(this.save);
  }

  private show(sel: string, on: boolean): void {
    $(sel).classList.toggle('hidden', !on);
  }

  private bindUi(): void {
    $('#startBtn').addEventListener('click', () => {
      void enterFullscreen();
      this.audio.engine.unlock();
      this.show('#startScreen', false);
      this.openMenu();
    });
    $('#pauseBtn').addEventListener('click', () => this.pause());
    $('#resumeBtn').addEventListener('click', () => {
      void enterFullscreen();
      this.resume();
    });
    $('#restartBtn').addEventListener('click', () => this.startMatch(this.chapterIndex));
    $('#quitBtn').addEventListener('click', () => this.quitToMenu());
    $('#closeSettingsBtn').addEventListener('click', () => this.closeSettings());
    $('#tutorialSkip').addEventListener('click', () => this.finishTutorial());
    $('#endNext').addEventListener('click', () => this.startMatch(this.chapterIndex + 1));
    $('#endRetry').addEventListener('click', () => this.startMatch(this.chapterIndex));
    $('#endMenu').addEventListener('click', () => this.quitToMenu());
  }

  private openMenu(): void {
    this.phase = 'menu';
    this.menu.select(this.chapterIndex);
    this.menu.render();
    this.show('#menuScreen', true);
    this.show('#endScreen', false);
    this.show('#pauseScreen', false);
  }

  private quitToMenu(): void {
    this.audio.stopMusic();
    this.hud.closePicker();
    this.show('#pauseScreen', false);
    this.show('#endScreen', false);
    this.show('#tutorial', false);
    void releaseWakeLock();
    this.openMenu();
  }

  private openSettings(fromMenu: boolean): void {
    this.settingsFromMenu = fromMenu;
    this.panel.refresh();
    $('#settingsTitle').textContent = fromMenu ? 'Settings' : 'Paused';
    this.show('#pauseActions', !fromMenu);
    this.show('#closeSettingsBtn', fromMenu);
    this.show('#menuScreen', false);
    this.show('#pauseScreen', true);
  }

  private closeSettings(): void {
    this.show('#pauseScreen', false);
    if (this.settingsFromMenu) {
      this.show('#menuScreen', true);
      this.menu.render();
    }
  }

  // ------------------------------------------------------------ match lifecycle
  startMatch(index: number): void {
    const idx = Math.max(0, Math.min(CHAPTERS.length - 1, index));
    this.chapterIndex = idx;
    const chapter = getChapter(idx);
    this.chapter = chapter;
    const human = this.wizardElement();
    const setup = matchSetupFromChapter(chapter, [human], this.save.settings.difficulty);
    const sim = new Sim({ terrain: chapter.terrain, creatureTypes: chapter.creatureSet, match: setup });
    this.sim = sim;
    const rivalElements = assignRivalElements([human], chapter.rivals.length);
    this.renderer.loadChapter(chapter, sim, [human, ...rivalElements], 0);
    this.renderer.setReducedFlashing(this.save.settings.reducedFlashing);
    this.hud.startMatch(sim);
    this.lastSeq = 0;
    this.acc = 0;
    this.time = 0;
    this.endAt = -1;
    this.governor.reset();
    this.controls.releaseAll();
    this.tutorial = idx === 0 && !this.save.progress.tutorialDone ? new Tutorial(sim) : null;
    this.hud.setTutorial(this.tutorial?.text ?? null);
    this.show('#menuScreen', false);
    this.show('#endScreen', false);
    this.show('#pauseScreen', false);
    this.audio.start(chapter);
    this.audio.setVolumes(this.save.settings.musicVolume, this.save.settings.sfxVolume, this.save.settings.muted);
    void enterFullscreen();
    void requestWakeLock();
    this.phase = 'playing';
    this.last = performance.now();
    this.hud.update(sim);
  }

  private finishTutorial(): void {
    if (!this.tutorial) return;
    this.tutorial.skip();
    this.tutorial = null;
    this.hud.setTutorial(null);
    this.save.progress.tutorialDone = true;
    writeSave(this.save);
  }

  private endMatch(): void {
    const sim = this.sim!;
    this.phase = 'ended';
    const won = sim.match.status === 'won';
    this.hud.setTutorial(null);
    this.tutorial = null;
    this.save.progress.tutorialDone = true;
    writeSave(this.save);
    if (won) {
      const prog = this.save.progress;
      prog.cleared |= 1 << this.chapterIndex;
      prog.unlockedChapters = Math.max(prog.unlockedChapters, this.chapterIndex + 2);
      writeSave(this.save);
    }
    $('#endTitle').textContent = won ? 'Victory!' : 'Defeat';
    $('#endReason').textContent = sim.match.reason;
    const shares = $('#endShares');
    shares.replaceChildren();
    for (const f of sim.factions) {
      const share = sim.match.shares[f.id] ?? 0;
      const row = document.createElement('div');
      row.className = 'r';
      const color = castleData.factionStyles[f.id % castleData.factionStyles.length]!.color;
      row.innerHTML = `<span>${f.name}${f.eliminated ? ' (fallen)' : ''}</span><div class="track"><i style="width:${share * 100}%;background:${color}"></i></div><b>${Math.round(share * 100)}%</b>`;
      shares.appendChild(row);
    }
    const hasNext = won && this.chapterIndex + 1 < gameData.playableChapters;
    this.show('#endNext', hasNext);
    this.show('#endScreen', true);
    this.audio.stopMusic();
    void releaseWakeLock();
  }

  // ------------------------------------------------------------ settings
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
    this.ui.classList.toggle('no-tt', !s.terrainTools);
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

  // ------------------------------------------------------------ pause / resume
  pause(): void {
    if (this.phase !== 'playing') return;
    this.phase = 'paused';
    this.controls.releaseAll();
    this.hud.closePicker();
    this.audio.pause();
    void releaseWakeLock();
    this.openSettings(false);
  }

  resume(): void {
    this.phase = 'playing';
    this.last = performance.now();
    this.acc = 0;
    this.governor.reset();
    this.controls.recalibrateTilt();
    this.show('#pauseScreen', false);
    this.audio.resume();
    void requestWakeLock();
  }

  private fatal(msg: string): void {
    this.running = false;
    $('#fatalMsg').textContent = msg;
    $('#fatal').classList.remove('hidden');
  }

  // ------------------------------------------------------------ events
  /** Fan new sim events out to VFX, audio and HUD (the sim keeps a bounded event log). */
  private dispatchEvents(sim: Sim): void {
    const ev = sim.events;
    let i = ev.length;
    while (i > 0 && ev[i - 1]!.seq > this.lastSeq) i--;
    const p = sim.players[0]!;
    const listener = { x: p.x, z: p.z, heading: p.heading };
    for (; i < ev.length; i++) {
      const e = ev[i]!;
      this.lastSeq = e.seq;
      this.renderer.handleEvent(e);
      this.audio.handle(e, listener, this.time, (o) => sim.players[o]?.element ?? 'fire');
      switch (e.type) {
        case 'wellSpawn': this.hud.showToast('A mana well appeared! Check the compass and hover beside it.'); break;
        case 'playerHit':
          this.hud.damageFlash();
          if (this.save.settings.haptics) vibrate(40);
          break;
        case 'respawn': if (e.v === 1) this.hud.showToast('You were knocked out. Some mana was lost.'); break;
        case 'upgrade':
          if (e.x === sim.castles[0]!.x) this.hud.showToast(`Castle upgraded: ${tierDef(e.v).name}!`);
          break;
        case 'castleDowngrade':
          this.hud.showToast(e.x === sim.castles[0]!.x ? 'Your castle was battered down a tier!' : 'An enemy castle lost a tier!');
          break;
        case 'castleRelease':
          if ((e.x - p.x) ** 2 + (e.z - p.z) ** 2 < 140 * 140) this.hud.showToast(e.x === sim.castles[0]!.x ? 'Your walls cracked: mana spilled out!' : `Castle cracked: ${Math.round(e.v)} mana released! Grab it!`);
          break;
        case 'castleDestroyed': this.hud.showToast('A castle has fallen!'); break;
        case 'bounty':
          if (e.x === p.x && e.z === p.z) this.hud.showToast(`Bounty! +${Math.round(e.v)} mana`);
          break;
        case 'spellUpgrade':
          if (e.x === p.x && e.z === p.z) this.hud.showToast(`Weapon upgraded: ${spellAt(KITS[p.element].primary, e.v).name}!`);
          break;
        case 'nestDestroyed': this.hud.showToast('Nest destroyed: mana released!'); break;
        default: break;
      }
    }
  }

  // ------------------------------------------------------------ main loop
  private loop(now: number): void {
    if (!this.running) return;
    requestAnimationFrame((t) => this.loop(t));
    const s = this.save.settings;
    const fps = s.batterySaver ? GOVERNOR.batteryFps : GOVERNOR.targetFps;
    // Frame limiter (60 fps, or 30 fps in battery saver); avoids burning a 120 Hz screen.
    if (now - this.lastRender < (1000 / fps) * 0.9) return;
    const frameMs = now - this.lastRender;
    this.lastRender = now;

    const sim = this.sim;
    if (this.phase !== 'playing' && this.phase !== 'ended') {
      // Behind the title/menu/pause screens the scene is static: redraw only twice a second.
      if (sim && now - this.idleDraw > 500) {
        this.idleDraw = now;
        this.renderer.render(1, 1 / 60, this.time);
      }
      return;
    }
    if (!sim) return;
    const cpuStart = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.time += dt;

    this.acc += dt;
    let steps = 0;
    while (this.acc >= SIM_DT && steps < simData.maxFrameSteps) {
      sim.step([this.controls.sample()]);
      this.acc -= SIM_DT;
      steps++;
    }
    if (steps === simData.maxFrameSteps) this.acc = 0; // spiral-of-death guard
    if (steps > 0) this.dispatchEvents(sim);

    this.renderer.render(this.acc / SIM_DT, dt, this.time);
    this.cpuAvg += (performance.now() - cpuStart - this.cpuAvg) * 0.05;

    if (this.governor.sample(frameMs)) this.renderer.setScales(this.governor.renderScale, this.governor.radiusScale);
    if (now - this.hudAt > 100) {
      this.hudAt = now;
      this.hud.update(sim);
      if (this.tutorial) {
        this.tutorial.update(sim, 0.1);
        if (this.tutorial.finished) this.finishTutorial();
        else this.hud.setTutorial(this.tutorial.text);
      }
    }
    if (this.phase === 'playing' && sim.match.status !== 'playing') {
      if (this.endAt < 0) this.endAt = now + gameData.endScreenDelayMs;
      else if (now >= this.endAt) this.endMatch();
    }
    this.debug.frame(now, frameMs, {
      stats: () => this.renderer.stats,
      cpuMs: this.cpuAvg,
      renderScale: this.governor.renderScale,
      radiusScale: this.governor.radiusScale,
      preset: s.qualityAuto ? `${s.quality} (auto)` : s.quality,
      pingMs: null,
      deltaCount: sim.terrain.deltas.list.length,
    });
  }
}
