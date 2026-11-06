// A test driver that can race on ANY grid track, so new tracks are checked without writing anything
// by hand: it finds a center line (shortest path that keeps away from the walls) from just past the
// finish line around to just behind it, and follows it with a simple pure-pursuit steering.

import { IN_LEFT, IN_RIGHT, createState, step, type CarState, type GridTrack } from "../src/sim";

/** Even-odd test against the outline loops: is the point on the road? */
export function roadAt(t: GridTrack, x: number, y: number): boolean {
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

function wallDistance(t: GridTrack, x: number, y: number): number {
  let best = Infinity;
  for (let n = 0; n < t.segs.length; n += 4) {
    const [x0, y0, x1, y1] = t.segs.slice(n, n + 4);
    const ex = x1 - x0, ey = y1 - y0;
    const u = Math.max(0, Math.min(1, ((x - x0) * ex + (y - y0) * ey) / (ex * ex + ey * ey)));
    best = Math.min(best, Math.hypot(x - (x0 + u * ex), y - (y0 + u * ey)));
  }
  return best;
}

export interface CenterLine {
  /** points to aim at, in driving order (meters) */
  points: [number, number][];
  /** the narrowest the road gets along that line, in meters (2 x the clearance of the worst cell) */
  minWidth: number;
}

/** Shortest path from just past the finish line to just behind it, hugging the middle of the road. */
export function centerLine(t: GridTrack, every = 3): CenterLine {
  const cs = t.cell;
  const key = (c: number, r: number) => r * t.cols + c;
  const cl = new Map<number, number>(); // cell → clearance
  for (let r = 0; r < t.rows; r++) {
    for (let c = 0; c < t.cols; c++) {
      const x = (c + 0.5) * cs, y = (r + 0.5) * cs;
      if (roadAt(t, x, y)) cl.set(key(c, r), wallDistance(t, x, y));
    }
  }
  // cells that lie on the finish line are not crossable
  const g = t.gates[0];
  const onFinish = (c: number, r: number) => {
    const x = (c + 0.5) * cs, y = (r + 0.5) * cs;
    const ex = g.bx - g.ax, ey = g.by - g.ay;
    const u = ((x - g.ax) * ex + (y - g.ay) * ey) / (ex * ex + ey * ey);
    return u >= 0 && u <= 1 && Math.hypot(x - (g.ax + u * ex), y - (g.ay + u * ey)) <= cs * 0.51;
  };
  const mid = { x: (g.ax + g.bx) / 2, y: (g.ay + g.by) / 2 };
  const cellOf = (x: number, y: number): [number, number] => [Math.floor(x / cs), Math.floor(y / cs)];
  const src = cellOf(mid.x + g.dx * cs, mid.y + g.dy * cs);
  const dst = cellOf(mid.x - g.dx * cs, mid.y - g.dy * cs);

  const dist = new Map<number, number>([[key(...src), 0]]);
  const prev = new Map<number, number>();
  const open: [number, number][] = [[0, key(...src)]]; // tiny binary-less queue: fine for a few thousand cells
  while (open.length > 0) {
    open.sort((a, b) => a[0] - b[0]);
    const [d, u] = open.shift()!;
    if (u === key(...dst)) break;
    if (d > (dist.get(u) ?? Infinity)) continue;
    const c = u % t.cols, r = (u - c) / t.cols;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nc = c + dc, nr = r + dr;
      const k = key(nc, nr);
      if (!cl.has(k) || onFinish(nc, nr)) continue;
      const nd = d + Math.hypot(dc, dr) * (1 + 25 / (cl.get(k)! + 0.3) ** 2);
      if (nd < (dist.get(k) ?? Infinity)) {
        dist.set(k, nd);
        prev.set(k, u);
        open.push([nd, k]);
      }
    }
  }
  const path: number[] = [key(...dst)];
  while (path[path.length - 1] !== key(...src)) {
    const p = prev.get(path[path.length - 1]);
    if (p === undefined) throw new Error("autopilot: no way around the circuit from the finish line");
    path.push(p);
  }
  path.reverse();
  const at = (k: number): [number, number] => [((k % t.cols) + 0.5) * cs, (Math.floor(k / t.cols) + 0.5) * cs];
  const points = path.filter((_, i) => i % every === 0).map(at);
  points.push(at(path[path.length - 1]));
  return { points, minWidth: 2 * Math.min(...path.map((k) => cl.get(k)!)) };
}

export interface Drive {
  state: CarState;
  inputs: number[];
}

/** Drives the whole race along the center line (or until `maxTicks`). */
export function drive(t: GridTrack, line: CenterLine, maxTicks = 120 * 400, reach = 3): Drive {
  const s = createState(t);
  const inputs: number[] = [];
  let target = 1;
  while (!s.finished && inputs.length < maxTicks) {
    const [tx, ty] = line.points[target];
    if (Math.hypot(tx - s.x, ty - s.y) < reach) target = (target + 1) % line.points.length;
    const cross = s.hx * (ty - s.y) - s.hy * (tx - s.x); // > 0: the target is to the right on screen (y down)
    const input = cross > 0.05 ? IN_RIGHT : cross < -0.05 ? IN_LEFT : 0;
    inputs.push(input);
    step(s, t, input);
  }
  return { state: s, inputs };
}
