// Co-op lobby and session controller: the UI overlay, the network client, the reconnect logic, and the
// batching of inputs. The Game owns the match itself (renderer, HUD, loop) and gets told when to start.
import { CHAPTERS } from '../data/chapters';
import { ELEMENTS, type Element } from '../data/elements';
import gameData from '../data/game.json';
import { wizardLook } from '../data/wizardLooks';
import { NetClient } from '../net/client';
import { NET, encodeRuns, type LobbyState, type ServerMsg } from '../net/protocol';
import { CoopReplica } from '../net/replica';
import type { DifficultyId } from '../sim/match';
import type { PlayerInput } from '../sim/sim';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

export interface CoopHost {
  /** Chapters the player may pick (unlocked and playable). */
  chapterCount(): number;
  wizard(): Element;
  difficulty(): DifficultyId;
  /** The match is starting: the game should switch to this replica. */
  startMatch(replica: CoopReplica, chapter: number): void;
  /** Back to the chapter menu (lobby closed). */
  back(): void;
  /** The connection dropped for good during a match. */
  lost(text: string): void;
  toast(text: string): void;
}

const ERRORS: Record<string, string> = {
  offline: 'You seem to be offline. Co-op needs the internet (solo play works offline).',
  rate_limited: 'Too many rooms from your connection just now. Please wait a few minutes.',
  budget: 'The free daily limit for co-op has been reached. Please try again tomorrow.',
  no_such_room: 'That room does not exist (or has expired). Check the code.',
  room_full: 'That room is full or already playing.',
  bad_version: 'Your game version does not match the server. Please reload the page.',
  timeout: 'The room timed out.',
  not_ready: 'Waiting for your partner to connect.',
  match_lost: 'The match was interrupted. Please create a new room.',
};

export class CoopController {
  private net: NetClient | null = null;
  private lobby: LobbyState | null = null;
  replica: CoopReplica | null = null;
  private pending: PlayerInput[] = [];
  private sinceSend = 0;
  private reconnecting = false;
  private active = false;
  private chapter = 0;
  private difficulty: DifficultyId = 'normal';

  constructor(private host: CoopHost) {
    $('#coopBtn').addEventListener('click', () => this.open());
    $('#coopBack').addEventListener('click', () => this.leave(true));
    $('#coopCreate').addEventListener('click', () => void this.create());
    $('#coopJoin').addEventListener('click', () => void this.join(($('#coopCode') as HTMLInputElement).value));
    $('#coopShare').addEventListener('click', () => void this.share());
    $('#coopStart').addEventListener('click', () => this.net?.send({ t: 'start' }));
  }

  get rttMs(): number {
    return this.net?.rttMs ?? 0;
  }

  get inMatch(): boolean {
    return this.replica !== null;
  }

  open(code?: string): void {
    this.active = true;
    $('#menuScreen').classList.add('hidden');
    $('#coopScreen').classList.remove('hidden');
    this.showHome();
    $('#coopNote').textContent = 'Needs an internet connection. Create a room and send the code or link to a friend, or enter a code below.';
    if (code) {
      ($('#coopCode') as HTMLInputElement).value = code.toUpperCase();
      void this.join(code);
    }
  }

  private showHome(): void {
    $('#coopHome').classList.remove('hidden');
    $('#coopLobby').classList.add('hidden');
    this.setError('');
  }

  private setError(text: string): void {
    $('#coopError').textContent = text;
  }

  private errorText(code: string, fallback?: string): string {
    return ERRORS[code] ?? fallback ?? 'Something went wrong with the connection.';
  }

  private async create(): Promise<void> {
    this.setError('');
    ($('#coopCreate') as HTMLButtonElement).disabled = true;
    const res = await NetClient.createRoom();
    ($('#coopCreate') as HTMLButtonElement).disabled = false;
    if (!res.ok) return this.setError(this.errorText(res.error));
    await this.join(res.code);
  }

  private async join(raw: string): Promise<void> {
    const code = raw.trim().toUpperCase();
    if (!new RegExp(`^[${NET.roomCodeAlphabet}]{${NET.roomCodeLength}}$`).test(code)) return this.setError('Codes are 5 letters or digits.');
    this.setError('');
    this.net?.close();
    const net = new NetClient();
    this.net = net;
    net.onMessage = (m) => this.onMessage(m);
    net.onClose = (info) => this.onClose(info.clean);
    try {
      await net.connect(code, { name: 'Wizard', element: this.host.wizard() });
    } catch {
      this.net = null;
      this.setError(this.errorText('offline', 'Could not reach the co-op server.'));
    }
  }

  private onMessage(m: ServerMsg): void {
    switch (m.t) {
      case 'welcome':
      case 'lobby':
        this.lobby = m.lobby;
        this.chapter = m.lobby.chapter;
        this.difficulty = m.lobby.difficulty;
        $('#coopHome').classList.add('hidden');
        $('#coopLobby').classList.remove('hidden');
        this.renderLobby();
        break;
      case 'start': {
        if (this.replica && this.replica.slot === m.slot) break; // reconnected: the match view is still alive
        this.replica = new CoopReplica(m);
        this.pending = [];
        this.sinceSend = 0;
        $('#coopScreen').classList.add('hidden');
        this.host.startMatch(this.replica, m.chapter);
        break;
      }
      case 'snap':
        this.replica?.push(m.s, performance.now());
        break;
      case 'error':
        this.setError(this.errorText(m.code, m.text));
        if (this.replica) this.host.lost(this.errorText(m.code, m.text));
        break;
      case 'notice':
        this.host.toast(m.text);
        break;
      default:
        break;
    }
  }

  private onClose(clean: boolean): void {
    if (clean || !this.active) return;
    if (this.replica) void this.reconnect();
    else if (!$('#coopScreen').classList.contains('hidden')) this.setError('Disconnected from the room.');
  }

  /** The socket dropped mid-match: try again a few times with the saved seat token. */
  private async reconnect(): Promise<void> {
    if (this.reconnecting || !this.net) return;
    this.reconnecting = true;
    const net = this.net;
    for (const wait of [1000, 2000, 3000, 5000, 8000]) {
      this.host.toast('Connection lost. Reconnecting...');
      await new Promise((r) => setTimeout(r, wait));
      if (!this.active || this.net !== net) break;
      try {
        await net.connect(net.room, { name: 'Wizard' });
        this.reconnecting = false;
        this.host.toast('Reconnected.');
        return;
      } catch {
        /* try again */
      }
    }
    this.reconnecting = false;
    if (this.active) this.host.lost('The connection to your partner was lost.');
  }

  // ---------------------------------------------------------------- lobby UI
  private renderLobby(): void {
    const lb = this.lobby;
    if (!lb || !this.net) return;
    const me = this.net.slot;
    const isHost = lb.host === me;
    $('#coopCodeBig').textContent = this.net.room;
    const seats = $('#coopSeats');
    seats.replaceChildren();
    for (let i = 0; i < 2; i++) {
      const s = lb.seats[i];
      const d = document.createElement('div');
      d.className = `seat${s ? '' : ' empty'}`;
      d.innerHTML = s ? `<b>${i === me ? 'You' : 'Your partner'}${i === lb.host ? ' (host)' : ''}</b>${wizardLook(s.element).name} · ${s.connected ? 'connected' : 'reconnecting...'}` : '<b>Waiting...</b>Share the code or link';
      seats.appendChild(d);
    }
    // Wizard picker: elements the partner already took are disabled.
    const el = $('#coopElement');
    el.replaceChildren();
    const mine = lb.seats[me]?.element;
    for (const e of ELEMENTS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = wizardLook(e).name;
      const taken = lb.seats.some((s, i) => i !== me && s.element === e);
      b.disabled = taken;
      if (e === mine) b.className = 'on';
      b.addEventListener('click', () => this.net?.send({ t: 'pick', element: e }));
      el.appendChild(b);
    }
    // Host-only rows.
    $('#coopHostRows').classList.toggle('hidden', !isHost);
    if (isHost) {
      const ch = $('#coopChapter');
      ch.replaceChildren();
      const count = Math.max(1, Math.min(this.host.chapterCount(), gameData.playableChapters));
      for (let i = 0; i < count; i++) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = String(CHAPTERS[i]!.number);
        b.setAttribute('aria-label', CHAPTERS[i]!.name);
        if (i === lb.chapter) b.className = 'on';
        b.addEventListener('click', () => this.net?.send({ t: 'setup', chapter: i, difficulty: this.difficulty }));
        ch.appendChild(b);
      }
      const df = $('#coopDifficulty');
      df.replaceChildren();
      for (const d of ['easy', 'normal', 'hard'] as const) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = d[0]!.toUpperCase() + d.slice(1);
        if (d === lb.difficulty) b.className = 'on';
        b.addEventListener('click', () => this.net?.send({ t: 'setup', chapter: this.chapter, difficulty: d }));
        df.appendChild(b);
      }
    }
    const ready = lb.seats.length === 2 && lb.seats.every((s) => s.connected);
    ($('#coopStart') as HTMLButtonElement).classList.toggle('hidden', !isHost);
    ($('#coopStart') as HTMLButtonElement).disabled = !ready;
    $('#coopWait').textContent = isHost
      ? ready ? `${CHAPTERS[lb.chapter]!.name} - ready when you are.` : 'Waiting for your partner to join...'
      : ready ? `Waiting for the host to start: ${CHAPTERS[lb.chapter]!.name}.` : 'Connecting...';
  }

  private async share(): Promise<void> {
    if (!this.net) return;
    const url = `${location.origin}${location.pathname}?room=${this.net.room}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Flying Tapestries of Arabia', text: `Join my co-op room ${this.net.room}`, url });
      else {
        await navigator.clipboard.writeText(url);
        this.host.toast('Invite link copied.');
        this.setError('Invite link copied to the clipboard.');
      }
    } catch {
      this.setError(`Invite link: ${url}`);
    }
  }

  // ---------------------------------------------------------------- during the match
  /** Called by the game every local 30 Hz tick with the input just applied. Sends batches at ~7.5 Hz. */
  queueInput(input: PlayerInput): void {
    const net = this.net;
    const replica = this.replica;
    if (!net || !replica) return;
    this.pending.push(input);
    if (++this.sinceSend < NET.inputEveryTicks) return;
    this.sinceSend = 0;
    if (net.open) net.send({ t: 'in', seq: replica.seq, runs: encodeRuns(this.pending) });
    this.pending = [];
  }

  /** Leave the room (or close the lobby). `toMenu` returns to the chapter menu. */
  leave(toMenu: boolean): void {
    this.active = false;
    this.net?.close();
    this.net = null;
    this.replica = null;
    this.lobby = null;
    this.pending = [];
    $('#coopScreen').classList.add('hidden');
    if (toMenu) this.host.back();
  }
}
