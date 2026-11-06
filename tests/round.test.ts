import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameState, PlayerInfo } from "../src/net/protocol";
import { RACE_MIN_RESTART_MS, RACE_NEXT_DELAY_MS, RoundHost, restartWaitMs } from "../src/net/round";

const P = (id: string): PlayerInfo => ({ id, name: id.toUpperCase(), color: "#fff", isHost: id === "host" });

function setup(ids = ["host", "a", "b"]) {
  const roster = [...ids];
  const states: GameState[] = [];
  const rh = new RoundHost(() => roster, (s) => states.push(s));
  return { rh, roster, states, last: () => states[states.length - 1] };
}

describe("RoundHost (race mode)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("switching to race starts round 1 with everyone in the room", () => {
    const { rh, last } = setup();
    rh.setMode("race");
    expect(last()).toMatchObject({ mode: "race", round: 1, participants: ["host", "a", "b"], results: [], nextInMs: null });
  });

  it("the first finish arms the 20 s timer, which starts the next round", () => {
    const { rh, last } = setup();
    rh.setMode("race");
    expect(rh.finish(P("a"), 1, 5000)).toBe(true);
    expect(last().nextInMs).toBe(RACE_NEXT_DELAY_MS);
    vi.advanceTimersByTime(5000);
    expect(rh.snapshot().nextInMs).toBe(RACE_NEXT_DELAY_MS - 5000); // fresh value for late joiners
    rh.finish(P("b"), 1, 4000); // a second finish does not re-arm the timer
    expect(last().nextInMs).toBe(RACE_NEXT_DELAY_MS - 5000);
    vi.advanceTimersByTime(RACE_NEXT_DELAY_MS - 5000 - 1);
    expect(last().round).toBe(1);
    vi.advanceTimersByTime(1);
    expect(last()).toMatchObject({ round: 2, results: [], nextInMs: null });
  });

  it("positions are ordered by race time, not by arrival", () => {
    const { rh, last } = setup();
    rh.setMode("race");
    rh.finish(P("a"), 1, 5000);
    rh.finish(P("b"), 1, 4000);
    expect(last().results.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("ignores finishes from another round, non-participants and duplicates", () => {
    const { rh, roster, last } = setup();
    rh.setMode("race");
    roster.push("late"); // joined mid-round: waits for the next one
    expect(rh.finish(P("a"), 0, 5000)).toBe(false);
    expect(rh.finish(P("late"), 1, 5000)).toBe(false);
    expect(rh.finish(P("a"), 1, 5000)).toBe(true);
    expect(rh.finish(P("a"), 1, 3000)).toBe(false);
    expect(last().results).toHaveLength(1);
    vi.advanceTimersByTime(RACE_MIN_RESTART_MS);
    rh.restart();
    expect(last().participants).toContain("late");
  });

  it("the host can restart only once someone has finished", () => {
    const { rh, last } = setup();
    rh.setMode("race");
    expect(rh.canRestart()).toBe(false);
    expect(rh.restart()).toBe(false);
    expect(last().round).toBe(1);
    rh.finish(P("host"), 1, 5000);
    vi.advanceTimersByTime(RACE_MIN_RESTART_MS);
    expect(rh.canRestart()).toBe(true);
    expect(rh.restart()).toBe(true);
    expect(last().round).toBe(2);
    vi.advanceTimersByTime(RACE_NEXT_DELAY_MS); // the old timer was cancelled
    expect(last().round).toBe(2);
  });

  it("the host must wait RACE_MIN_RESTART_MS after the FIRST finisher before restarting", () => {
    const { rh, last } = setup();
    rh.setMode("race");
    expect(rh.restartInMs()).toBeNull();
    rh.finish(P("host"), 1, 5000);
    expect(rh.restartInMs()).toBe(RACE_MIN_RESTART_MS);
    expect(rh.restart()).toBe(false); // too early: refused by the host itself
    expect(last().round).toBe(1);
    vi.advanceTimersByTime(3000);
    rh.finish(P("a"), 1, 6000); // a later finisher does NOT push the limit back
    expect(rh.restartInMs()).toBe(RACE_MIN_RESTART_MS - 3000);
    expect(rh.restart()).toBe(false);
    vi.advanceTimersByTime(RACE_MIN_RESTART_MS - 3000 - 1);
    expect(rh.canRestart()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(rh.canRestart()).toBe(true);
    expect(rh.restart()).toBe(true);
    expect(last().round).toBe(2);
    expect(rh.restartInMs()).toBeNull(); // new round: nobody has finished again
  });

  it("every snapshot says which track the room races on", () => {
    const { rh, last } = setup();
    rh.setMode("race");
    expect(last().track).toBe("oval-1");
    expect(last().trackHash).toBeTypeOf("number");
  });

  it("picking another track in race mode starts a new round on it, with no results", () => {
    const { rh, last } = setup();
    rh.setMode("race");
    rh.finish(P("host"), 1, 5000);
    expect(last().results).toHaveLength(1);
    rh.setTrack("serpentina", 123);
    expect(last().track).toBe("serpentina");
    expect(last().trackHash).toBe(123);
    expect(last().round).toBe(2);
    expect(last().results).toEqual([]);
    expect(last().participants).toEqual(["host", "a", "b"]);
    expect(rh.restartInMs()).toBeNull(); // the old 20 s timer is gone
    vi.advanceTimersByTime(RACE_NEXT_DELAY_MS * 2);
    expect(last().round).toBe(2);
  });

  it("picking another track in free mode announces it without starting a round; the same track is a no-op", () => {
    const { rh, states, last } = setup();
    rh.setTrack("serpentina", 123);
    expect(last()).toMatchObject({ mode: "free", round: 0, track: "serpentina", trackHash: 123 });
    const n = states.length;
    rh.setTrack("serpentina", 123);
    expect(states.length).toBe(n);
  });

  it("restartWaitMs derives the same wait from the timer a client receives", () => {
    expect(restartWaitMs(RACE_NEXT_DELAY_MS)).toBe(RACE_MIN_RESTART_MS);
    expect(restartWaitMs(RACE_NEXT_DELAY_MS - 2000)).toBe(RACE_MIN_RESTART_MS - 2000);
    expect(restartWaitMs(RACE_NEXT_DELAY_MS - RACE_MIN_RESTART_MS)).toBe(0);
    expect(restartWaitMs(1000)).toBe(0);
  });

  it("switching back to free cancels the timer", () => {
    const { rh, last } = setup();
    rh.setMode("race");
    rh.finish(P("a"), 1, 5000);
    rh.setMode("free");
    expect(last()).toMatchObject({ mode: "free", participants: [], results: [], nextInMs: null });
    vi.advanceTimersByTime(RACE_NEXT_DELAY_MS * 2);
    expect(last().mode).toBe("free");
    expect(rh.canRestart()).toBe(false);
  });

  it("a player who leaves is no longer a participant, but keeps a finished result", () => {
    const { rh, last } = setup();
    rh.setMode("race");
    rh.finish(P("a"), 1, 5000);
    rh.removePlayer("a");
    rh.removePlayer("b");
    expect(last().participants).toEqual(["host"]);
    expect(last().results.map((r) => r.id)).toEqual(["a"]);
  });
});
