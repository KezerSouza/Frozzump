import { describe, expect, it } from "vitest";
import {
  OVAL_1, SIM_VERSION, TOTAL_LAPS, createState, decodeReplay, encodeReplay,
  fromBase64, hashState, step, toBase64, verifyReplay, IN_LEFT, IN_RIGHT,
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
    expect({ ticks: v.ticks, hash: v.hash }).toEqual(GOLDEN);
  });
});

const GOLDEN = { ticks: 2837, hash: 3229843131 };
