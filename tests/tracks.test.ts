import { describe, expect, it } from "vitest";
import { BROKEN_TRACKS, DEFAULT_TRACK_ID, OVAL_1, TRACKS, getTrack, trackHash, verifyReplay, type GridTrack } from "../src/sim";
import { centerLine, drive } from "./autopilot";

describe("track registry", () => {
  it("has unique ids, a default and the original oval first", () => {
    expect(new Set(TRACKS.map((t) => t.id)).size).toBe(TRACKS.length);
    expect(TRACKS[0]).toBe(OVAL_1);
    expect(getTrack(DEFAULT_TRACK_ID)).toBe(OVAL_1);
    expect(getTrack("nope")).toBeUndefined();
  });

  it("every drawing in src/sim/tracks is valid (a broken one is left out of the game, so this catches it)", () => {
    expect(BROKEN_TRACKS).toEqual([]);
  });

  it("gives every track its own fingerprint", () => {
    expect(new Set(TRACKS.map(trackHash)).size).toBe(TRACKS.length);
  });

  // Narrowest road allowed, per track (cell-center measure, see below). Bottleneck is NAMED after its narrow:
  // 2 cells = 2 m of road for a 1.44 m car, on purpose, so it is allowed down to 1 here.
  const MIN_WIDTH: Record<string, number> = { bottleneck: 1 };

  for (const track of TRACKS.filter((t): t is GridTrack => t.kind === "grid")) {
    it(`${track.id}: an autopilot completes ${track.laps} laps, and the host verifies the replay`, () => {
      const line = centerLine(track);
      // The road must leave room for the car (1.44 m wide) to turn, so a too-narrow drawing is flagged.
      // (minWidth is measured from cell centers, so it can read up to ~1 m less than the real width:
      // 2.5 here means "at least about 3 m".)
      expect(line.minWidth, "narrowest point of the road along its center line, in m (cell-center measure)").toBeGreaterThanOrEqual(MIN_WIDTH[track.id] ?? 2.5);
      const { state: s, inputs } = drive(track, line);
      expect(s.finished, "the autopilot should finish the race").toBe(true);
      const v = verifyReplay(track, inputs);
      expect(v.finished).toBe(true);
      expect(v.lapSubticks).toHaveLength(track.laps);
      expect(v.finishSubticks).toBe(s.finishSubticks);
    });
  }
});
