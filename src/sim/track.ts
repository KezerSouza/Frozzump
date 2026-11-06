// Track definition as DATA (JSON-serializable; server and client use the same one).
// "Stadium" track: two straights joined by two semicircles.
// The track is the set of points whose distance to the axis (the horizontal segment
// from -halfStraight to +halfStraight) lies between R-W and R+W.

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Gate {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  dx: number; // direction in which crossing counts
  dy: number;
}

/** Axis-aligned box, in world meters (y grows downwards, like the screen). */
export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A boost ramp: a zone plus the direction of travel over it (only used to draw the arrows). */
export interface Ramp extends Rect {
  dx: number;
  dy: number;
}

/** What every track has, whatever its shape. */
export interface TrackBase {
  id: string;
  name: string;
  laps: number; //          laps of a race on this track
  snow: Rect[]; //          deep snow
  ramps: Ramp[]; //         boost ramps
  gates: Gate[]; //         gates[0] = start/finish line; the rest in race order
  start: { x: number; y: number; hx: number; hy: number };
  bounds: Bounds; //        box that contains the whole track (the camera fits it on screen)
}

/** The original oval: two straights joined by two semicircles (analytic walls). */
export interface StadiumTrack extends TrackBase {
  kind: "stadium";
  halfStraight: number; // half the length of the straight (L/2)
  centerRadius: number; //  R: radius of the center line in the turns
  halfWidth: number; //     W: half the track width
}

/**
 * A track drawn as text (see grid.ts). The walls are the outline of the drawing, as straight
 * segments; `loops` is that same outline as closed polygons (for drawing); `buckets` is a
 * spatial index (one list of segment indices per grid cell) so a car only tests nearby walls.
 * Everything is plain numbers/arrays, so it stays JSON-friendly.
 */
export interface GridTrack extends TrackBase {
  kind: "grid";
  cell: number; //          cell size in meters
  cols: number;
  rows: number;
  /** Wall segments, flattened [x0, y0, x1, y1, …]. Oriented so that the road is on the (dy, -dx) side. */
  segs: number[];
  /** Per cell (row * cols + col): indices of the segments within a car radius of that cell. */
  buckets: number[][];
  /** The outline as closed polygons, each flattened [x0, y0, x1, y1, …] (for drawing). */
  loops: number[][];
  /** FNV-1a hash of the source text: peers compare it to be sure they all run the same track. */
  hash: number;
}

export type TrackDef = StadiumTrack | GridTrack;

const R = 5.5;
const W = 3.5;
const L = 6;

export const OVAL_1: StadiumTrack = {
  kind: "stadium",
  id: "oval-1",
  name: "Oval",
  laps: 5,
  halfStraight: L,
  centerRadius: R,
  halfWidth: W,
  bounds: { x0: -(L + R + W), y0: -(R + W), x1: L + R + W, y1: R + W },
  // top straight (negative y = "up" on screen), halfway through the lap
  snow: [{ x0: -5, y0: -(R + W) - 1, x1: 5, y1: -(R - W) + 1 }],
  // narrow strip (2 m) on the inside, right before the snow
  ramps: [{ x0: 4.8, y0: -5, x1: 5.8, y1: -3, dx: -1, dy: 0 }],
  gates: [
    { ax: 0, ay: R - W, bx: 0, by: R + W, dx: 1, dy: 0 }, //                 0: start (bottom straight)
    { ax: L + R - W, ay: 0, bx: L + R + W, by: 0, dx: 0, dy: -1 }, //       1: right turn
    { ax: 0, ay: -(R + W), bx: 0, by: -(R - W), dx: -1, dy: 0 }, //         2: top straight
    { ax: -(L + R + W), ay: 0, bx: -(L + R - W), by: 0, dx: 0, dy: 1 }, //  3: left turn
  ],
  start: { x: -4, y: R, hx: 1, hy: 0 },
};

export function inRects(x: number, y: number, rects: Rect[]): boolean {
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) return true;
  }
  return false;
}

/**
 * Fraction t ∈ [0,1] of the move (p0 → p1) at which it crossed the gate in the valid direction,
 * or -1 if it did not cross (or crossed the wrong way). Uses only + - * / and comparisons.
 * A move that ends exactly on the line returns t = 1; the next move (starting on the line)
 * does not count again, because d0 = 0 is treated as "not > 0", like d1 here.
 */
export function gateCrossing(g: Gate, x0: number, y0: number, x1: number, y1: number): number {
  const mx = x1 - x0;
  const my = y1 - y0;
  if (mx * g.dx + my * g.dy <= 0) return -1; // wrong direction

  const gx = g.bx - g.ax;
  const gy = g.by - g.ay;
  // which side of the gate each end of the move is on
  const d0 = gx * (y0 - g.ay) - gy * (x0 - g.ax);
  const d1 = gx * (y1 - g.ay) - gy * (x1 - g.ax);
  if (d0 > 0 === d1 > 0) return -1;
  // which side of the move each end of the gate is on
  const e0 = mx * (g.ay - y0) - my * (g.ax - x0);
  const e1 = mx * (g.by - y0) - my * (g.bx - x0);
  if (e0 > 0 === e1 > 0) return -1;
  return d0 / (d0 - d1); // d0 and d1 are on opposite sides, so the denominator is never 0
}

/** Did the move (p0 → p1) cross the gate in the valid direction? */
export const crossedGate = (...a: Parameters<typeof gateCrossing>): boolean => gateCrossing(...a) >= 0;
