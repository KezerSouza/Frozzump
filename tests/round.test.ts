import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameState, PlayerInfo } from "../src/net/protocol";
import { RACE_NEXT_DELAY_MS, RoundHost } from "../src/net/round";

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
    expect(rh.canRestart()).toBe(true);
    expect(rh.restart()).toBe(true);
    expect(last().round).toBe(2);
    vi.advanceTimersByTime(RACE_NEXT_DELAY_MS); // the old timer was cancelled
    expect(last().round).toBe(2);
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
