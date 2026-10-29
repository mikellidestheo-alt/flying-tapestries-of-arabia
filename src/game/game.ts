// Game flow and loop: title -> chapter menu -> match -> end screen, with a fixed-timestep sim,
// interpolated rendering and the adaptive quality governor.
import simData from '../data/sim.json';
import castleData from '../data/castles.json';
import gameData from '../data/game.json';
import musicData from '../data/music.json';
import { CHAPTERS, getChapter, type ChapterConfig } from '../data/chapters';
import { ELEMENTS, assignRivalElements, type Element } from '../data/elements';
import { matchSetupFromChapter } from '../data/matchSetup';
import { applyFactionPalette } from '../data/factionPalette';
import { GameAudio } from '../audio/gameAudio';
import { IntensityFollower, threatTarget } from '../audio/intensity';
import { COMBOS } from '../sim/combos';
import { CoopController } from './coop';
import type { CoopReplica } from '../net/replica';
import { Controls } from '../input/controls';
import { enterFullscreen, releaseWakeLock, requestWakeLock, vibrate } from '../platform';
import { GameRenderer } from '../render/gameRenderer';
import { GOVERNOR, PRESETS, QualityGovernor, ThermalGuard, guessPreset } from '../render/quality';
import { hasSavedSettings, loadSave, writeSave, type SaveData, type Settings } from '../save';
import { tierDef } from '../sim/castles';
import { CREATURES, KITS, primaryDef, spellAt } from '../sim/combat';
import { CREATURE_CHASE } from '../sim/entities';
import { ACTION_SPELL, NEUTRAL_INPUT, SIM_DT, SIM_TICK_RATE, Sim } from '../sim/sim';
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
  private thermal = new ThermalGuard();
  private thermalToldAt = -Infinity;
  private debug: DebugOverlay;
  private panel: SettingsPanel;
  private menu: Menu;
  private tutorial: Tutorial | null = null;
  private intensity = new IntensityFollower();
  private coop: CoopController;
  /** Set during a co-op match: the sim is a client-side mirror driven by the server. */
  private replica: CoopReplica | null = null;
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
      const p = this.sim?.players[this.sim.localPlayer];
      if (bit === ACTION_SPELL && p && p.mana < primaryDef(p).manaCost) this.audio.denied();
    };
    this.wireDesktopControls(canvas);
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
    this.coop = new CoopController({
      chapterCount: () => this.menu.playableCount(),
      wizard: () => this.wizardElement(),
      difficulty: () => this.save.settings.difficulty,
      startMatch: (r, chapter) => this.startCoopMatch(r, chapter),
      back: () => this.openMenu(),
      lost: (text) => this.coopLost(text),
      toast: (text) => this.hud.showToast(text),
    });
    this.applySettings();
    this.bindUi();
    if (location.protocol === 'file:' || location.protocol === 'content:') $('#downloadLink').classList.add('hidden');
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

  // ------------------------------------------------------------ laptop controls and camera view
  private desktop = false;

  private wireDesktopControls(canvas: HTMLCanvasElement): void {
    this.controls.onSelect = (i) => this.hud.setSelectedSlot(i);
    this.hud.onSelectSlot = (i) => this.controls.select(i);
    this.controls.onToggleView = () => {
      if (this.phase === 'playing' || this.phase === 'paused') this.toggleView();
    };
    this.controls.onCastle = () => {
      if (this.phase === 'playing') this.hud.castleSpell();
    };
    this.controls.onDesktop = () => this.setDesktop(true);
    this.controls.onLockChange = (locked) => {
      this.ui.classList.toggle('locked', locked);
      if (!locked && this.phase === 'playing' && this.desktop) this.pause(); // Esc frees the mouse and pauses
    };
    canvas.addEventListener('click', () => {
      if (this.phase === 'playing' && this.desktop) this.controls.requestLock();
    });
    $('#viewBtn').addEventListener('click', () => this.toggleView());
    this.setDesktop(window.matchMedia?.('(pointer: fine)').matches ?? false);
  }

  private setDesktop(on: boolean): void {
    if (on === this.desktop) return;
    this.desktop = on;
    this.ui.classList.toggle('desk', on);
    this.applyView();
  }

  /** The camera actually used: the setting, or first person with a mouse and the chase camera on touch. */
  private effectiveView(): 'first' | 'third' {
    const v = this.save.settings.view;
    return v === 'auto' ? (this.desktop ? 'first' : 'third') : v;
  }

  private applyView(): void {
    const v = this.effectiveView();
    this.renderer.setView(v);
    this.ui.classList.toggle('fp', v === 'first');
  }

  private toggleView(): void {
    const next = this.effectiveView() === 'first' ? 'third' : 'first';
    this.changeSettings({ view: next });
    this.hud.showToast(next === 'first' ? 'First person view' : 'Third person view');
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
      const room = new URLSearchParams(location.search).get('room');
      if (room) this.coop.open(room); // opened from an invite link
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
    if (this.replica) {
      this.coop.leave(false);
      this.replica = null;
      this.sim = null;
    }
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
    $('#settingsArabic').textContent = fromMenu ? 'الإعدادات' : '';
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
    applyFactionPalette(this.save.settings.colorBlind);
    const human = this.wizardElement();
    const setup = matchSetupFromChapter(chapter, [human], this.save.settings.difficulty);
    const sim = new Sim({ terrain: chapter.terrain, creatureTypes: chapter.creatureSet, match: setup });
    this.sim = sim;
    this.replica = null;
    this.show('#restartBtn', true);
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
    this.intensity = new IntensityFollower();
    this.audio.start(chapter);
    this.audio.setVolumes(this.save.settings.musicVolume, this.save.settings.sfxVolume, this.save.settings.muted);
    void enterFullscreen();
    void requestWakeLock();
    this.phase = 'playing';
    this.last = performance.now();
    this.enterPlay();
    this.hud.update(sim);
  }

  /** Co-op: the server started the match. The replica's sim stands in for the local one. */
  private startCoopMatch(replica: CoopReplica, chapterIndex: number): void {
    const chapter = getChapter(chapterIndex);
    this.chapterIndex = chapterIndex;
    this.chapter = chapter;
    applyFactionPalette(this.save.settings.colorBlind);
    this.replica = replica;
    const sim = replica.sim;
    this.sim = sim;
    const elements = [...sim.players.slice(0, 2).map((p) => p.element), ...sim.players.slice(2).map((p) => p.element)];
    this.renderer.loadChapter(chapter, sim, elements, replica.slot);
    this.renderer.setReducedFlashing(this.save.settings.reducedFlashing);
    this.hud.startMatch(sim);
    this.lastSeq = 0;
    this.acc = 0;
    this.time = 0;
    this.endAt = -1;
    this.governor.reset();
    this.controls.releaseAll();
    this.tutorial = null;
    this.hud.setTutorial(null);
    this.show('#menuScreen', false);
    this.show('#coopScreen', false);
    this.show('#endScreen', false);
    this.show('#pauseScreen', false);
    this.show('#restartBtn', false);
    this.intensity = new IntensityFollower();
    this.audio.start(chapter);
    this.audio.setVolumes(this.save.settings.musicVolume, this.save.settings.sfxVolume, this.save.settings.muted);
    void enterFullscreen();
    void requestWakeLock();
    this.phase = 'playing';
    this.last = performance.now();
    this.hud.showToast('Connected: fly together! Pair different elements for combos.');
    this.enterPlay();
    this.hud.update(sim, sim.localPlayer);
  }

  /** Laptop: capture the mouse (needs a click, which Play provided) and explain the controls. */
  private enterPlay(): void {
    this.applyView();
    this.hud.setSelectedSlot(this.controls.selected);
    if (!this.desktop) return;
    this.controls.requestLock();
    this.hud.showToast('Mouse steers and aims · W/S speed · A/D slide · 1-6 spells · click casts · T view · Esc pauses. Click the game if the mouse is free.');
  }

  private coopLost(text: string): void {
    this.phase = 'ended';
    $('#endTitle').textContent = 'Co-op ended';
    $('#endArabic').textContent = '';
    $('#endReason').textContent = text;
    $('#endShares').replaceChildren();
    this.show('#endNext', false);
    this.show('#endRetry', false);
    this.show('#endScreen', true);
    this.audio.stopMusic();
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
    const prog = this.save.progress;
    if (!this.replica) prog.played++;
    if (won && !this.replica) {
      prog.wins++;
      const secs = Math.round(sim.tick / SIM_TICK_RATE);
      const best = prog.bestSeconds[this.chapterIndex] ?? 0;
      if (best === 0 || secs < best) prog.bestSeconds[this.chapterIndex] = secs;
      prog.cleared |= 1 << this.chapterIndex;
      prog.unlockedChapters = Math.max(prog.unlockedChapters, this.chapterIndex + 2);
      writeSave(this.save);
    }
    $('#endTitle').textContent = won ? 'Victory!' : 'Defeat';
    $('#endArabic').textContent = won ? 'النصر' : 'الهزيمة';
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
    const hasNext = won && this.chapterIndex + 1 < gameData.playableChapters && !this.replica;
    this.show('#endNext', hasNext);
    this.show('#endRetry', !this.replica);
    this.show('#endScreen', true);
    this.audio.stopMusic();
    void releaseWakeLock();
    if (this.replica) this.coop.leave(false); // the room is over: free the connection (the end screen stays)
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
    const root = document.documentElement;
    root.style.setProperty('--tz', String(s.textScale));
    root.classList.toggle('hc', s.highContrast);
    root.classList.toggle('rm', s.reducedMotion);
    this.renderer.setReducedMotion(s.reducedMotion);
    this.controls.mouseSensitivity = s.mouseSensitivity;
    this.applyView();
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
    this.controls.releaseLock();
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
    if (this.desktop) this.controls.requestLock(); // called from the Resume click, so the browser allows it
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
    const p = sim.players[sim.localPlayer]!;
    const listener = { index: sim.localPlayer, x: p.x, z: p.z, heading: p.heading };
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
          if (e.x2 === sim.localPlayer) this.hud.showToast(`Bounty! +${Math.round(e.v)} mana`);
          break;
        case 'spellUpgrade':
          if (e.x2 === sim.localPlayer) this.hud.showToast(`Weapon upgraded: ${spellAt(KITS[p.element].primary, e.v).name}!`);
          break;
        case 'combo': this.hud.showToast(`Combo: ${COMBOS[e.v]?.name ?? 'Team combo'}!`); break;
        case 'nestDestroyed': this.hud.showToast('Nest destroyed: mana released!'); break;
        default: break;
      }
    }
  }

  // ------------------------------------------------------------ heat
  /** Long sessions warm the phone: ease the heaviest visual effects in stages and say so once. */
  private updateThermal(dt: number): void {
    const before = this.thermal.stage;
    const stage = this.thermal.update(dt, this.phase === 'playing');
    if (stage === before) return;
    this.renderer.setThermalStage(stage);
    if (stage > before && this.time - this.thermalToldAt > 600) {
      this.thermalToldAt = this.time;
      this.hud.showToast('Long session: some glow effects were eased to keep your phone cooler. Battery saver in Settings cuts heat further.');
    }
  }

  // ------------------------------------------------------------ adaptive music
  /** Estimate how dangerous the moment is for the local player and steer the music's combat layers. */
  private updateMusicIntensity(sim: Sim, dt: number): void {
    const p = sim.players[sim.localPlayer]!;
    const T = musicData.combat.threat;
    let hostileNear = 0;
    for (const c of sim.creatures) {
      if (c.state !== CREATURE_CHASE || !CREATURES[c.type]!.hostile) continue;
      if ((c.x - p.x) ** 2 + (c.z - p.z) ** 2 < T.creatureRange * T.creatureRange) hostileNear++;
    }
    let rivalsNear = 0;
    for (const w of sim.players) {
      if (w === p || !w.active || w.faction === p.faction) continue;
      if ((w.x - p.x) ** 2 + (w.z - p.z) ** 2 < T.rivalRange * T.rivalRange) rivalsNear++;
    }
    let boltsNear = 0;
    for (const b of sim.projectiles) {
      if (b.faction === p.faction) continue;
      if ((b.x - p.x) ** 2 + (b.z - p.z) ** 2 < T.boltRange * T.boltRange) boltsNear++;
    }
    const castle = sim.castles.find((c) => c.faction === p.faction);
    const target = threatTarget({
      hostileNear, rivalsNear, boltsNear,
      secondsSinceCastleHit: castle ? (sim.tick - castle.lastHit) / SIM_TICK_RATE : Infinity,
      hpFrac: p.hp / sim.maxHpFor(p),
    });
    this.audio.setIntensity(this.intensity.update(target, dt));
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
    const coopPaused = this.replica !== null && this.phase === 'paused'; // the shared world does not stop for one player's pause
    if (this.phase !== 'playing' && this.phase !== 'ended' && !coopPaused) {
      // Behind the title/menu/pause screens the scene is static: redraw only twice a second (and the phone cools down).
      this.updateThermal(Math.min(1, frameMs / 1000));
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
    this.updateThermal(dt);

    this.acc += dt;
    let steps = 0;
    while (this.acc >= SIM_DT && steps < simData.maxFrameSteps) {
      this.controls.hold = this.hud.pickerOpen; // the path picker suspends the wizard in place
      if (this.replica) {
        const input = this.phase === 'playing' ? this.controls.sample() : NEUTRAL_INPUT;
        this.replica.tick(input, performance.now());
        this.coop.queueInput(input);
      } else sim.step([this.controls.sample()]);
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
      this.hud.update(sim, sim.localPlayer);
      this.updateMusicIntensity(sim, 0.1);
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
      pingMs: this.replica ? Math.round(this.coop.rttMs) : null,
      deltaCount: sim.terrain.deltas.list.length,
    });
  }
}
