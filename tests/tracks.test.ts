import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRACK_ID, IN_LEFT, IN_RIGHT, OVAL_1, TOTAL_LAPS, TRACKS, createState, getTrack, step, trackHash, verifyReplay,
} from "../src/sim";

// The center line each sample track was drawn along (in cells = meters, since cell = 1), in driving order.
const CENTER: Record<string, [number, number][]> = {
  serpentina: [[10, 10], [24, 10], [34, 20], [46, 20], [56, 10], [66, 10], [66, 40], [52, 40], [42, 32], [30, 32], [20, 40], [10, 40]],
  "circuito-grande": [[12, 12], [50, 12], [64, 28], [80, 28], [92, 12], [106, 12], [106, 56], [78, 56], [64, 44], [42, 44], [28, 56], [12, 56]],
};

describe("track registry", () => {
  it("has unique ids, a default and the original oval first", () => {
    expect(new Set(TRACKS.map((t) => t.id)).size).toBe(TRACKS.length);
    expect(TRACKS[0]).toBe(OVAL_1);
    expect(getTrack(DEFAULT_TRACK_ID)).toBe(OVAL_1);
    expect(getTrack("nope")).toBeUndefined();
  });

  it("gives every track its own fingerprint", () => {
    expect(new Set(TRACKS.map(trackHash)).size).toBe(TRACKS.length);
  });

  for (const track of TRACKS.filter((t) => t.kind === "grid")) {
    it(`${track.id}: a driver following its center line completes ${TOTAL_LAPS} laps, and the host verifies the replay`, () => {
      const way = CENTER[track.id];
      expect(way, `add the center line of ${track.id} to this test`).toBeDefined();
      const s = createState(track);
      const inputs: number[] = [];
      let target = 1;
      while (!s.finished && inputs.length < 120 * 400) {
        const [tx, ty] = way[target];
        if (Math.hypot(tx - s.x, ty - s.y) < 6) target = (target + 1) % way.length;
        const cross = s.hx * (ty - s.y) - s.hy * (tx - s.x);
        const input = cross > 0.05 ? IN_RIGHT : cross < -0.05 ? IN_LEFT : 0;
        inputs.push(input);
        step(s, track, input);
      }
      expect(s.finished, "the driver should finish").toBe(true);
      const v = verifyReplay(track, inputs);
      expect(v.finished).toBe(true);
      expect(v.lapSubticks).toHaveLength(TOTAL_LAPS);
      expect(v.finishSubticks).toBe(s.finishSubticks);
    });
  }
});
