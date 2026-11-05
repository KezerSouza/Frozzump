// ─────────────────────────────────────────────────────────────
// Race-round bookkeeping (host only). Pure logic, no PeerJS, so it is unit
// tested in isolation (tests/round.test.ts).
//
// Race mode: every connected player starts round N together. The first
// verified finisher arms a 20 s timer; when it fires the next round starts.
// Once someone has finished, the host may also restart early, but only after
// RACE_MIN_RESTART_MS: time to read the results and for the others to finish.
// ─────────────────────────────────────────────────────────────

import type { GameMode, GameState, PlayerId, PlayerInfo, RoundResult } from "./protocol";

/** Delay between the first finisher and the next round. */
export const RACE_NEXT_DELAY_MS = 20_000;

/** Minimum time after the first finisher before the host may restart the round. */
export const RACE_MIN_RESTART_MS = 5_000;

/**
 * Ms until the host may restart, given the ms left on the next-round timer (`nextInMs`, which counts
 * down from RACE_NEXT_DELAY_MS at the first finish). 0 = allowed now. Shared by host and UI.
 */
export function restartWaitMs(nextInMs: number): number {
  return Math.max(0, RACE_MIN_RESTART_MS - (RACE_NEXT_DELAY_MS - nextInMs));
}

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

// globals are looked up lazily, so vitest fake timers apply
const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export class RoundHost {
  private mode: GameMode = "free";
  private round = 0;
  private participants: PlayerId[] = [];
  private results: RoundResult[] = [];
  private deadline: number | null = null; // clock time at which the next round starts
  private timer: unknown = null;

  /**
   * @param roster   current player ids (participants of a new round)
   * @param onChange called with a fresh snapshot after every state change
   */
  constructor(
    private readonly roster: () => PlayerId[],
    private readonly onChange: (state: GameState) => void,
    private readonly clock: Clock = realClock,
  ) {}

  setMode(mode: GameMode) {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode === "race") {
      this.startRound();
      return;
    }
    this.clearTimer();
    this.participants = [];
    this.results = [];
    this.emit();
  }

  /** Start a new race round with everyone currently in the room. */
  startRound() {
    if (this.mode !== "race") return;
    this.clearTimer();
    this.round++;
    this.participants = [...this.roster()];
    this.results = [];
    this.emit();
  }

  /** Ms until the host may restart; null while nobody has finished (not allowed yet). */
  restartInMs(): number | null {
    if (this.mode !== "race" || this.results.length === 0 || this.deadline === null) return null;
    return restartWaitMs(this.deadline - this.clock.now());
  }

  /** The host may skip the wait RACE_MIN_RESTART_MS after the first player has finished. */
  canRestart(): boolean {
    return this.restartInMs() === 0;
  }

  restart(): boolean {
    if (!this.canRestart()) return false;
    this.startRound();
    return true;
  }

  /**
   * Record a VERIFIED finish. Ignored unless it belongs to the current round,
   * comes from a participant and is that player's first finish.
   */
  finish(info: PlayerInfo, round: number, time: number): boolean {
    if (this.mode !== "race" || round !== this.round) return false;
    if (!this.participants.includes(info.id)) return false;
    if (this.results.some((r) => r.id === info.id)) return false;
    this.results.push({ id: info.id, name: info.name, color: info.color, time });
    // positions by race time: start latency differs per peer, race time doesn't
    this.results.sort((a, b) => a.time - b.time);
    if (this.deadline === null) {
      this.deadline = this.clock.now() + RACE_NEXT_DELAY_MS;
      this.timer = this.clock.setTimeout(() => {
        this.timer = null;
        this.startRound();
      }, RACE_NEXT_DELAY_MS);
    }
    this.emit();
    return true;
  }

  /** A player left: they no longer count as racing (finished results are kept). */
  removePlayer(id: PlayerId) {
    const i = this.participants.indexOf(id);
    if (i < 0) return;
    this.participants.splice(i, 1);
    this.emit();
  }

  snapshot(): GameState {
    return {
      mode: this.mode,
      round: this.round,
      participants: [...this.participants],
      results: this.results.map((r) => ({ ...r })),
      nextInMs: this.deadline === null ? null : Math.max(0, this.deadline - this.clock.now()),
    };
  }

  dispose() {
    this.clearTimer();
  }

  private clearTimer() {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
    this.deadline = null;
  }

  private emit() {
    this.onChange(this.snapshot());
  }
}
