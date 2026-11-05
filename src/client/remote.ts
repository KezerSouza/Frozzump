import { step, type CarState, type TrackDef } from "../sim";
import type { Pose } from "./render";

export function pose(s: CarState): Pose {
  return { x: s.x, y: s.y, hx: s.hx, hy: s.hy };
}

/** The part of a remote car that the stepping logic needs. */
export interface RemoteSim {
  state: CarState;
  prev: Pose;
  queued: number[]; // inputs received but not yet applied
}

/** Backlog (in ticks) tolerated before a remote car is sped up to catch up: ~0.4 s. */
export const REMOTE_SLACK = 48;
/** Backlog (in ticks) beyond which we skip ahead at once instead of racing through it: ~3 s. */
export const REMOTE_JUMP = 360;

/**
 * Advances a remote car by one wall-clock tick (1/120 s).
 *
 * Normally that is exactly one queued input. If the queue has built up (the other player's
 * tab was in the background and sent a burst, or a stall on our side), the car runs at 2x until
 * the backlog is back under REMOTE_SLACK, and a really big backlog is simulated at once.
 * Skipped ticks are not lost: every one of them is still simulated, just faster.
 * If the queue is empty the car holds position (no extrapolation).
 */
export function advanceRemote(r: RemoteSim, track: TrackDef): void {
  const q = r.queued.length;
  if (q === 0 || r.state.finished) {
    r.prev = pose(r.state);
    return;
  }
  const n = q > REMOTE_JUMP ? q - REMOTE_SLACK : q > REMOTE_SLACK ? 2 : 1;
  for (let i = 0; i < n - 1 && !r.state.finished; i++) step(r.state, track, r.queued.shift()!);
  r.prev = pose(r.state); // interpolate only across the last step, so a catch-up doesn't smear
  if (!r.state.finished) step(r.state, track, r.queued.shift()!);
}
