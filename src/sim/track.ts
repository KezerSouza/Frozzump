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

export interface TrackDef {
  id: string;
  halfStraight: number; // half the length of the straight (L/2)
  centerRadius: number; //  R: radius of the center line in the turns
  halfWidth: number; //     W: half the track width
  snow: Rect[]; //          deep snow
  ramps: Rect[]; //         boost ramps
  gates: Gate[]; //         gates[0] = start/finish line; the rest in race order
  start: { x: number; y: number; hx: number; hy: number };
}

const R = 5.5;
const W = 3.5;
const L = 6;

export const OVAL_1: TrackDef = {
  id: "oval-1",
  halfStraight: L,
  centerRadius: R,
  halfWidth: W,
  // top straight (negative y = "up" on screen), halfway through the lap
  snow: [{ x0: -5, y0: -(R + W) - 1, x1: 5, y1: -(R - W) + 1 }],
  // narrow strip (2 m) on the inside, right before the snow
  ramps: [{ x0: 4.8, y0: -5, x1: 5.8, y1: -3 }],
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

/** Did the move (p0 → p1) cross the gate in the valid direction? Uses only + - * and comparisons. */
export function crossedGate(
  g: Gate,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  const mx = x1 - x0;
  const my = y1 - y0;
  if (mx * g.dx + my * g.dy <= 0) return false; // wrong direction

  const gx = g.bx - g.ax;
  const gy = g.by - g.ay;
  // which side of the gate each end of the move is on
  const d0 = gx * (y0 - g.ay) - gy * (x0 - g.ax);
  const d1 = gx * (y1 - g.ay) - gy * (x1 - g.ax);
  if (d0 > 0 === d1 > 0) return false;
  // which side of the move each end of the gate is on
  const e0 = mx * (g.ay - y0) - my * (g.ax - x0);
  const e1 = mx * (g.by - y0) - my * (g.bx - x0);
  return e0 > 0 !== e1 > 0;
}
