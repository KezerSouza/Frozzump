import { describe, expect, it } from "vitest";
import {
  OVAL_1, SIM_VERSION, SUBTICKS_PER_TICK, TOTAL_LAPS, createState, decodeReplay, encodeReplay,
  fromBase64, gateCrossing, hashState, step, toBase64, verifyReplay, IN_LEFT, IN_RIGHT, type Gate,
} from "../src/sim";
import { runBot } from "../tools/bot";

describe("simulation", () => {
  it("accelerates on its own, gradually (does not reach v_max before ~3 s)", () => {
    const s = createState(OVAL_1);
    const speed = () => Math.hypot(s.vx, s.vy);
    for (let i = 0; i < 120; i++) step(s, OVAL_1, 0); // 1 s
    const v1 = speed();
    expect(v1).toBeGreaterThan(3);
    expect(v1).toBeLessThan(10);
  });

  it("does not turn by itself: with no input, the car goes straight until it hits a wall", () => {
    const s = createState(OVAL_1);
    for (let i = 0; i < 60; i++) step(s, OVAL_1, 0);
    expect(s.hx).toBe(1);
    expect(s.hy).toBe(0);
  });

  it("hitting the wall costs speed", () => {
    const s = createState(OVAL_1);
    s.x = -5.9; s.y = 7.0; s.vx = 12; s.vy = 0;
    for (let i = 0; i < 40; i++) step(s, OVAL_1, IN_RIGHT); // steer into the outer wall
    for (let i = 0; i < 20; i++) step(s, OVAL_1, 0);
    expect(Math.hypot(s.vx, s.vy)).toBeLessThan(12 * 0.5);
  });

  it("a head-on hit does not trap the car: steering pivots it away from the wall and it speeds up again", () => {
    for (const [hy, steer] of [[1, IN_LEFT], [1, IN_RIGHT], [-1, IN_LEFT], [-1, IN_RIGHT]] as const) {
      const s = createState(OVAL_1);
      // middle of the bottom straight, flat against the outer (hy=1) or inner (hy=-1) wall
      s.x = 0; s.y = 5.5; s.hx = 0; s.hy = hy; s.vx = 0; s.vy = 16 * hy;
      for (let i = 0; i < 60; i++) step(s, OVAL_1, 0); // hit it and come to a stop
      expect(Math.hypot(s.vx, s.vy)).toBeLessThan(1);
      let top = 0;
      for (let i = 0; i < 120 * 4; i++) {
        step(s, OVAL_1, steer);
        top = Math.max(top, Math.hypot(s.vx, s.vy));
      }
      expect(top).toBeGreaterThan(5); // before: stayed < 1 m/s forever
    }
  });

  it("never leaves the track, even when steering the wrong way all the time", () => {
    const s = createState(OVAL_1);
    for (let i = 0; i < 120 * 20; i++) {
      step(s, OVAL_1, (i >> 6) % 2 ? IN_LEFT : IN_RIGHT);
      const px = Math.min(Math.max(s.x, -OVAL_1.halfStraight), OVAL_1.halfStraight);
      const d = Math.hypot(s.x - px, s.y);
      expect(d).toBeGreaterThanOrEqual(OVAL_1.centerRadius - OVAL_1.halfWidth - 1e-6);
      expect(d).toBeLessThanOrEqual(OVAL_1.centerRadius + OVAL_1.halfWidth + 1e-6);
    }
  });

  it("the bot completes all 5 laps", () => {
    const r = runBot(true);
    expect(r.s.finished).toBe(true);
    expect(r.s.laps).toBe(TOTAL_LAPS);
  });
});

const S = SUBTICKS_PER_TICK;

describe("gateCrossing", () => {
  const g: Gate = { ax: 0, ay: -1, bx: 0, by: 1, dx: 1, dy: 0 }; // vertical line at x=0, counts left -> right

  it("returns the fraction of the step at which the line was crossed", () => {
    expect(gateCrossing(g, -0.6, 0.3, 0.2, 0.3)).toBeCloseTo(0.75, 12);
  });

  it("wrong direction => -1", () => {
    expect(gateCrossing(g, 0.2, 0.3, -0.6, 0.3)).toBe(-1);
  });

  it("a step that does not reach the line => -1", () => {
    expect(gateCrossing(g, -0.6, 0.3, -0.1, 0.3)).toBe(-1);
  });

  it("passing beside the gate (outside the segment) => -1", () => {
    expect(gateCrossing(g, -0.6, 1.5, 0.2, 1.5)).toBe(-1);
  });

  it("a step ending exactly on the line => t = 1, and the next step does not count again", () => {
    const path = [-0.6, 0, 0.8, 1.6];
    expect(gateCrossing(g, path[0], 0, path[1], 0)).toBe(1);
    expect(gateCrossing(g, path[1], 0, path[2], 0)).toBe(-1);
    let crossings = 0;
    for (let i = 1; i < path.length; i++) if (gateCrossing(g, path[i - 1], 0, path[i], 0) >= 0) crossings++;
    expect(crossings).toBe(1);
  });
});

describe("sub-tick lap time (regression: ±1 tick alternation between identical laps)", () => {
  const gate = OVAL_1.gates[0]; // x = 0, y in [R-W, R+W]
  const Y = OVAL_1.centerRadius;
  const V = 13.37; // m/s, constant
  const X0 = -10; // the line is crossed at t* = 10 / V s = 89.75... ticks (non-integer on purpose)
  const exactSub = (-X0 / V) * 120 * S;

  /** Samples the path at t_k = (k + phase) ticks; returns the sub-tick instant and the naive (integer) tick. */
  function measure(phase: number) {
    const xAt = (ticks: number) => X0 + (V * ticks) / 120;
    for (let k = 1; ; k++) {
      const t = gateCrossing(gate, xAt(k - 1 + phase), Y, xAt(k + phase), Y);
      if (t >= 0) return { sub: (k - 1 + phase) * S + Math.floor(t * S), naiveTick: k };
    }
  }

  it("the sub-tick instant does not depend on the sampling phase; the naive tick does", () => {
    const phases = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
    const m = phases.map(measure);
    for (const r of m) expect(Math.abs(r.sub - exactSub)).toBeLessThanOrEqual(2);
    const naive = m.map((r) => r.naiveTick); // what the old code stored (lapTicks.push(s.tick))
    expect(Math.max(...naive) - Math.min(...naive)).toBeGreaterThanOrEqual(1);
  });
});

describe("lap times in the bot race", () => {
  const { inputs } = runBot(true);

  it("each lap time lies inside its detection tick, and the interpolated point is on the finish line", () => {
    const s = createState(OVAL_1);
    let checked = 0;
    for (let i = 0; i < inputs.length && !s.finished; i++) {
      const px = s.x, py = s.y, laps = s.laps;
      step(s, OVAL_1, inputs[i]);
      if (s.laps === laps) continue;
      const sub = s.lapSubticks[s.lapSubticks.length - 1];
      expect(Number.isInteger(sub)).toBe(true);
      expect(sub).toBeGreaterThanOrEqual((s.tick - 1) * S);
      expect(sub).toBeLessThanOrEqual(s.tick * S);
      const f = (sub - (s.tick - 1) * S) / S;
      expect(Math.abs(px + (s.x - px) * f)).toBeLessThan(1e-4); // gate 0 is at x = 0
      const y = py + (s.y - py) * f;
      expect(y).toBeGreaterThanOrEqual(OVAL_1.gates[0].ay);
      expect(y).toBeLessThanOrEqual(OVAL_1.gates[0].by);
      checked++;
    }
    expect(checked).toBe(TOTAL_LAPS);
  });

  it("the splits add up exactly to the total", () => {
    const v = verifyReplay(OVAL_1, inputs);
    const splits = v.lapSubticks.map((t, i, a) => t - (a[i - 1] ?? 0));
    expect(splits.length).toBe(TOTAL_LAPS);
    expect(splits.reduce((a, b) => a + b, 0)).toBe(v.finishSubticks);
    expect(v.finishSubticks).toBeGreaterThan(0);
  });
});

describe("replay and determinism", () => {
  const { s: live, inputs } = runBot(true);

  it("encode/decode (RLE + base64) is lossless", () => {
    const bytes = encodeReplay(inputs);
    expect(bytes.length).toBeLessThan(inputs.length / 2); // the bot flips input every tick (worst case); a human compresses much better
    const back = decodeReplay(fromBase64(toBase64(bytes)));
    expect(Array.from(back)).toEqual(inputs);
  });

  it("the verifier reproduces the exact final state of the live race", () => {
    const v = verifyReplay(OVAL_1, decodeReplay(encodeReplay(inputs)));
    expect(v.finished).toBe(true);
    expect(v.ticks).toBe(live.tick);
    expect(v.finishSubticks).toBe(live.finishSubticks);
    expect(v.lapSubticks).toEqual(live.lapSubticks);
    expect(v.hash).toBe(hashState(live));
  });

  it("two runs of the same replay give the same hash", () => {
    const a = verifyReplay(OVAL_1, inputs);
    const b = verifyReplay(OVAL_1, inputs);
    expect(a.hash).toBe(b.hash);
  });

  // Golden: if this test breaks without you touching the physics, something stopped being
  // deterministic. If you changed it on purpose: bump SIM_VERSION and update the value.
  it(`golden hash (SIM_VERSION=${SIM_VERSION})`, () => {
    const v = verifyReplay(OVAL_1, inputs);
    expect({ ticks: v.ticks, finishSubticks: v.finishSubticks, hash: v.hash }).toEqual(GOLDEN);
  });
});

// SIM_VERSION=7: DRAG_SNOW 2.0 -> 2.5 (slower in the snow): 2837 -> 2840 ticks, finish at 186067473 subticks.
// SIM_VERSION=6 (wall pivot: only changes runs that touch a wall; this golden run doesn't, so the values are the same as v5).
// SIM_VERSION=5: times in subticks (1/65536 tick). Same 2837 ticks as v4 (stop criterion unchanged);
// the finish is at 185871260 subticks ≈ 2836.18 ticks ≈ 23.635 s.
const GOLDEN = { ticks: 2840, finishSubticks: 186067473, hash: 2393277937 };
