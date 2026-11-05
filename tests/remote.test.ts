import { describe, expect, it } from "vitest";
import { OVAL_1, createState, step, IN_RIGHT } from "../src/sim";
import { REMOTE_JUMP, REMOTE_SLACK, advanceRemote, pose, type RemoteSim } from "../src/client/remote";

const mk = (): RemoteSim => {
  const state = createState(OVAL_1);
  return { state, prev: pose(state), queued: [] };
};

describe("advanceRemote", () => {
  it("consumes exactly one input per tick when the queue is short", () => {
    const r = mk();
    r.queued = new Array(10).fill(0);
    advanceRemote(r, OVAL_1);
    expect(r.state.tick).toBe(1);
    expect(r.queued.length).toBe(9);
  });

  it("holds position when starved (no extrapolation)", () => {
    const r = mk();
    advanceRemote(r, OVAL_1);
    expect(r.state.tick).toBe(0);
    expect(pose(r.state)).toEqual(r.prev);
  });

  it("runs at 2x while the backlog is above the slack, then back to 1x", () => {
    const r = mk();
    r.queued = new Array(REMOTE_SLACK + 3).fill(0);
    advanceRemote(r, OVAL_1);
    expect(r.state.tick).toBe(2);
    advanceRemote(r, OVAL_1); // 49 left -> still above the slack
    expect(r.state.tick).toBe(4);
    advanceRemote(r, OVAL_1); // 47 left -> normal speed
    expect(r.state.tick).toBe(5);
  });

  it("skips a huge backlog at once and ends up exactly where a tick-by-tick run would", () => {
    const inputs = Array.from({ length: REMOTE_JUMP * 5 }, (_, i) => ((i >> 5) % 3 === 0 ? IN_RIGHT : 0));
    const ref = createState(OVAL_1);
    const r = mk();
    r.queued = [...inputs];
    let ticks = 0;
    while (r.queued.length > 0) {
      advanceRemote(r, OVAL_1);
      ticks++;
    }
    for (const m of inputs) step(ref, OVAL_1, m);
    expect(r.state.tick).toBe(inputs.length);
    expect(pose(r.state)).toEqual(pose(ref)); // same deterministic result
    expect(ticks).toBeLessThan(inputs.length / 2); // and it got there much faster than real time
  });

  it("interpolates only across the last step after a catch-up", () => {
    const r = mk();
    r.queued = new Array(REMOTE_JUMP + 100).fill(0);
    advanceRemote(r, OVAL_1);
    const before = createState(OVAL_1);
    for (let i = 0; i < r.state.tick - 1; i++) step(before, OVAL_1, 0);
    expect(r.prev).toEqual(pose(before));
  });
});
