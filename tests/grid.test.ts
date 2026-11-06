import { describe, expect, it } from "vitest";
import {
  CAR_RADIUS, IN_LEFT, IN_RIGHT, TOTAL_LAPS, TrackError, createState, parseTrack, step, inRects, type GridTrack,
} from "../src/sim";

/**
 * A rectangular ring, 20 x 12 cells, corridors 3-4 cells wide, driven counter-clockwise on screen:
 *   bottom →  right ↑  top ←  left ↓.   The finish is on the bottom corridor.
 * `tweak` can change the drawing before it is turned into text (used by the error tests).
 */
function ringText(tweak?: (g: string[][]) => void, header = "name: ring\nfinish: right"): string {
  const g: string[][] = Array.from({ length: 12 }, () => Array(20).fill("#"));
  const road = (r0: number, r1: number, c0: number, c1: number) => {
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) g[r][c] = ".";
  };
  road(1, 3, 1, 18); // top
  road(8, 10, 1, 18); // bottom
  road(1, 10, 1, 4); // left
  road(1, 10, 15, 18); // right
  for (let r = 8; r <= 10; r++) g[r][10] = "F"; //            finish: bottom corridor, vertical line
  for (let c = 15; c <= 18; c++) g[5][c] = "1"; //            1: right corridor
  for (let r = 1; r <= 3; r++) g[r][10] = "2"; //             2: top corridor
  for (let c = 1; c <= 4; c++) g[5][c] = "3"; //              3: left corridor
  g[9][7] = "S";
  tweak?.(g);
  return header + "\n\n" + g.map((row) => row.join("")).join("\n");
}
const ring = (tweak?: (g: string[][]) => void, header?: string): GridTrack => parseTrack("ring", ringText(tweak, header));

describe("parseTrack", () => {
  it("reads the header, the start and the bounds", () => {
    const t = ring();
    expect(t.kind).toBe("grid");
    expect(t.name).toBe("ring");
    expect(t.cell).toBe(1);
    expect(t.start).toEqual({ x: 7.5, y: 9.5, hx: 1, hy: 0 });
    expect(t.bounds).toEqual({ x0: 1, y0: 1, x1: 19, y1: 11 });
  });

  it("finds the gates and works out the direction of travel of every checkpoint", () => {
    const t = ring();
    expect(t.gates).toHaveLength(4);
    expect(t.gates[0]).toMatchObject({ ax: 10.5, ay: 8, bx: 10.5, by: 11, dx: 1, dy: 0 }); // finish, → (header)
    expect(t.gates[1]).toMatchObject({ dx: 0, dy: -1 }); // right corridor, going up
    expect(t.gates[2]).toMatchObject({ dx: -1, dy: 0 }); // top corridor, going left
    expect(t.gates[3]).toMatchObject({ dx: 0, dy: 1 }); //  left corridor, going down
  });

  it("is independent of the cell size: only meters change", () => {
    const t = ring(undefined, "name: ring\nfinish: right\ncell: 2");
    expect(t.start.x).toBe(15);
    expect(t.bounds).toEqual({ x0: 2, y0: 2, x1: 38, y1: 22 });
  });

  it("makes closed outlines with the road always on the (dy, -dx) side", () => {
    const t = ring();
    expect(t.loops).toHaveLength(2); // the outer wall and the infield
    for (let n = 0; n < t.segs.length; n += 4) {
      const [x0, y0, x1, y1] = t.segs.slice(n, n + 4);
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      const len = Math.hypot(x1 - x0, y1 - y0);
      const px = mx + ((y1 - y0) / len) * 0.3, py = my - ((x1 - x0) / len) * 0.3; // a bit toward the road
      expect(t.gates.length).toBeGreaterThan(0);
      expect(roadAt(t, px, py)).toBe(true);
      const qx = mx - ((y1 - y0) / len) * 0.3, qy = my + ((x1 - x0) / len) * 0.3; // …and away from it
      expect(roadAt(t, qx, qy)).toBe(false);
    }
  });

  it("merges snow and ramp cells into rectangles", () => {
    const t = ring((g) => {
      for (let r = 8; r <= 10; r++) for (let c = 12; c <= 14; c++) g[r][c] = "~"; // 3x3 block
      g[7][16] = "^";
      g[7][17] = "^";
    });
    expect(t.snow).toEqual([{ x0: 12, y0: 8, x1: 15, y1: 11 }]);
    // the ramp is on the right corridor, where the race goes up the screen
    expect(t.ramps).toEqual([{ x0: 16, y0: 7, x1: 18, y1: 8, dx: 0, dy: -1 }]);
  });

  it("two parses of the same text are identical (and the hash tells texts apart)", () => {
    expect(ring()).toEqual(ring());
    expect(ring().hash).toBe(ring().hash);
    expect(ring((g) => { g[9][12] = "~"; }).hash).not.toBe(ring().hash);
  });
});

describe("parseTrack: mistakes are reported with where and why", () => {
  const bad = (re: RegExp, tweak?: (g: string[][]) => void, header?: string) => {
    expect(() => ring(tweak, header)).toThrow(TrackError);
    expect(() => ring(tweak, header)).toThrow(re);
  };

  it("header", () => {
    bad(/Falta "finish/, undefined, "name: ring");
    bad(/não atravessa/, undefined, "finish: up");
    bad(/"cell"/, undefined, "finish: right\ncell: 0");
    bad(/desconhecida/, undefined, "finish: right\nfoo: 1");
    bad(/"start" inválido/, undefined, "finish: right\nstart: north");
  });

  it("start, finish and checkpoints", () => {
    bad(/exatamente uma largada/, (g) => { g[9][7] = "."; });
    bad(/exatamente uma largada/, (g) => { g[9][6] = "S"; });
    bad(/colada na parede/, (g) => { g[9][7] = "."; g[10][1] = "S"; });
    bad(/Falta a linha de chegada/, (g) => { for (let r = 8; r <= 10; r++) g[r][10] = "."; });
    bad(/de parede a parede/, (g) => { g[8][10] = "."; });
    bad(/linha reta/, (g) => { g[9][10] = "."; g[9][11] = "F"; });
    bad(/em sequência/, (g) => { for (let c = 1; c <= 4; c++) g[5][c] = "4"; });
    bad(/pelo menos 2 checkpoints/, (g) => { for (let c = 1; c <= 4; c++) g[5][c] = "."; for (let r = 1; r <= 3; r++) g[r][10] = "."; });
  });

  it("order and shape of the circuit", () => {
    // swap checkpoints 1 and 2 (the numbers no longer follow the race direction)
    bad(/fora de ordem/, (g) => {
      for (let c = 15; c <= 18; c++) g[5][c] = "2";
      for (let r = 1; r <= 3; r++) g[r][10] = "1";
    });
    // a wall across the left corridor: the track is no longer a circuit
    bad(/aberta ou desconectada/, (g) => { for (let r = 6; r <= 10; r++) for (let c = 1; c <= 4; c++) g[r][c] = "#"; });
    // an island of road that nobody can reach
    bad(/aberta ou desconectada/, (g) => { g[5][8] = "."; g[5][9] = "."; });
  });
});

describe("walls of a grid track", () => {
  const t = ring();

  it("the car never gets closer than its radius to a wall, nor leaves the road, whatever the steering", () => {
    const s = createState(t);
    let seed = 12345;
    const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    let input = 0;
    for (let i = 0; i < 120 * 40; i++) {
      if (i % 20 === 0) input = [0, IN_LEFT, IN_RIGHT][Math.floor(rnd() * 3)];
      step(s, t, input);
      expect(roadAt(t, s.x, s.y)).toBe(true);
      expect(minWallDistance(t, s.x, s.y)).toBeGreaterThanOrEqual(CAR_RADIUS - 1e-6);
    }
  });

  it("a head-on hit costs speed and leaves the car at its radius from the wall", () => {
    const s = createState(t);
    s.x = 7.5; s.y = 9.5; s.hx = 0; s.hy = 1; s.vx = 0; s.vy = 14; // straight into the bottom wall
    for (let i = 0; i < 60; i++) step(s, t, 0);
    expect(Math.hypot(s.vx, s.vy)).toBeLessThan(1);
    expect(s.y).toBeCloseTo(11 - CAR_RADIUS, 1);
    expect(s.onWall).toBe(true);
  });

  it("scraping along a straight wall made of one long segment is smooth (no catching)", () => {
    const s = createState(t);
    s.x = 4; s.y = 10.2; s.hx = 1; s.hy = 0.0; s.vx = 14; s.vy = 0; // along the bottom wall, slightly inside
    let minSpeed = Infinity;
    for (let i = 0; i < 60; i++) {
      step(s, t, 0);
      minSpeed = Math.min(minSpeed, Math.hypot(s.vx, s.vy));
    }
    expect(minSpeed).toBeGreaterThan(10);
  });
});

describe("laps: the number of laps is part of the track", () => {
  it("defaults to TOTAL_LAPS and is read from the header", () => {
    expect(ring().laps).toBe(TOTAL_LAPS);
    expect(ring(undefined, "name: ring\nfinish: right\nlaps: 4").laps).toBe(4);
  });

  it("must be a whole number from 1 to 99", () => {
    for (const bad of ["0", "-1", "2.5", "abc", "100"]) {
      expect(() => ring(undefined, `name: ring\nfinish: right\nlaps: ${bad}`), bad).toThrow(TrackError);
    }
  });
});

describe("smooth: rounded walls", () => {
  const corners = (t: GridTrack) => {
    // sharpest turn (degrees) at any vertex of any loop
    let worst = 0;
    for (const lp of t.loops) {
      const n = lp.length / 2;
      for (let i = 0; i < n; i++) {
        const a = [lp[((i + n - 1) % n) * 2], lp[((i + n - 1) % n) * 2 + 1]], b = [lp[i * 2], lp[i * 2 + 1]], c = [lp[((i + 1) % n) * 2], lp[((i + 1) % n) * 2 + 1]];
        const ang = Math.abs(Math.atan2((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]), (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1])));
        worst = Math.max(worst, (ang * 180) / Math.PI);
      }
    }
    return worst;
  };
  // a ring with a diagonal bite out of it, so there are curves to round
  const bumpy = (smooth: number) =>
    ring((g) => { for (let r = 1; r <= 3; r++) for (let c = 16; c <= 18; c++) if (r + (18 - c) < 4) g[r][c] = "#"; }, `name: ring\nfinish: right\nsmooth: ${smooth}`);

  it("rounds the corners: the sharpest turn of the outline gets much gentler", () => {
    const hard = corners(bumpy(0)), soft = corners(bumpy(3));
    expect(hard).toBeGreaterThan(44); // a 90 degree corner of the drawing is already cut into two 45 degree turns
    // (a small, tight corner is only rounded as far as the cap allows: 45 degrees -> about 29 here;
    //  long gentle curves get much further, see the Boot track)
    expect(soft).toBeLessThan(hard * 0.75);
  });

  it("is off by default, and the same text gives the same walls every time", () => {
    expect(ring().segs).toEqual(ring(undefined, "name: ring\nfinish: right\nsmooth: 0").segs);
    expect(bumpy(3).segs).toEqual(bumpy(3).segs);
    expect(bumpy(3).segs.length).toBeGreaterThan(bumpy(0).segs.length);
  });

  it("only accepts 0 to 4", () => {
    expect(() => bumpy(5)).toThrow(/smooth/);
    expect(() => ring(undefined, "name: ring\nfinish: right\nsmooth: x")).toThrow(/smooth/);
  });

  it("the car still never gets closer than its radius to a smoothed wall, nor leaves the road", () => {
    const t = bumpy(3);
    const s = createState(t);
    let seed = 777;
    const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    let input = 0;
    for (let i = 0; i < 120 * 40; i++) {
      if (i % 20 === 0) input = [0, IN_LEFT, IN_RIGHT][Math.floor(rnd() * 3)];
      step(s, t, input);
      expect(roadAt(t, s.x, s.y)).toBe(true);
      expect(minWallDistance(t, s.x, s.y)).toBeGreaterThanOrEqual(CAR_RADIUS - 1e-6);
    }
  });
});

describe("laps on a grid track", () => {
  it("a driver following the corridors completes the race: gates inferred from the drawing count the laps", () => {
    const t = ring();
    // waypoints on the middle of each corridor, in driving order (counter-clockwise on screen)
    const way: [number, number][] = [[16.5, 9.5], [16.5, 2.5], [2.5, 2.5], [2.5, 9.5]];
    const s = createState(t);
    let target = 0;
    let ticks = 0;
    while (!s.finished && ticks < 120 * 300) {
      const [tx, ty] = way[target];
      if (Math.hypot(tx - s.x, ty - s.y) < 3) target = (target + 1) % way.length;
      const cross = s.hx * (ty - s.y) - s.hy * (tx - s.x); // > 0: the target is to the right on screen (y down)
      step(s, t, cross > 0.05 ? IN_RIGHT : cross < -0.05 ? IN_LEFT : 0);
      ticks++;
    }
    expect(s.finished).toBe(true);
    expect(s.laps).toBe(TOTAL_LAPS);
    expect(s.lapSubticks).toHaveLength(TOTAL_LAPS);
  });

  it("driving the wrong way round never counts a lap", () => {
    const t = ring();
    const way: [number, number][] = [[2.5, 9.5], [2.5, 2.5], [16.5, 2.5], [16.5, 9.5]]; // clockwise
    const s = createState(t);
    s.hx = -1; s.hy = 0;
    let target = 0;
    for (let i = 0; i < 120 * 90; i++) {
      const [tx, ty] = way[target];
      if (Math.hypot(tx - s.x, ty - s.y) < 3) target = (target + 1) % way.length;
      const cross = s.hx * (ty - s.y) - s.hy * (tx - s.x);
      step(s, t, cross > 0.05 ? IN_RIGHT : cross < -0.05 ? IN_LEFT : 0);
    }
    expect(s.laps).toBe(0);
  });

  it("snow slows the car down on a grid track too", () => {
    const t = ring((g) => { for (let r = 8; r <= 10; r++) for (let c = 11; c <= 14; c++) g[r][c] = "~"; });
    expect(inRects(12, 9.5, t.snow)).toBe(true);
    const s = createState(t);
    s.x = 11.2; s.y = 9.5; s.vx = 14; s.vy = 0;
    for (let i = 0; i < 100; i++) step(s, t, 0);
    expect(Math.hypot(s.vx, s.vy)).toBeLessThan(8);
  });
});

// ── helpers ──────────────────────────────────────────────────

/** Even-odd test against the outline loops: is the point on the road? */
function roadAt(t: GridTrack, x: number, y: number): boolean {
  let inside = false;
  for (const lp of t.loops) {
    for (let n = 0; n < lp.length; n += 2) {
      const m = (n + 2) % lp.length;
      const [x0, y0, x1, y1] = [lp[n], lp[n + 1], lp[m], lp[m + 1]];
      if (y0 > y !== y1 > y && x < x0 + ((y - y0) / (y1 - y0)) * (x1 - x0)) inside = !inside;
    }
  }
  return inside;
}

function minWallDistance(t: GridTrack, x: number, y: number): number {
  let best = Infinity;
  for (let n = 0; n < t.segs.length; n += 4) {
    const [x0, y0, x1, y1] = t.segs.slice(n, n + 4);
    const ex = x1 - x0, ey = y1 - y0;
    const u = Math.max(0, Math.min(1, ((x - x0) * ex + (y - y0) * ey) / (ex * ex + ey * ey)));
    best = Math.min(best, Math.hypot(x - (x0 + u * ex), y - (y0 + u * ey)));
  }
  return best;
}
