// ─────────────────────────────────────────────────────────────
// Track loader: turns a track drawn as TEXT into a GridTrack (see track.ts).
//
//   name: Serpentina          ← header: "key: value" lines, then a blank line
//   cell: 1                     cell: size of one character, in meters (default 1)
//   finish: right               finish: direction of travel across the finish line
//   start: right                start:  direction the car faces at the start (default = finish)
//
//   ##########                ← the drawing
//   #S..F....#
//   ##########
//
// Characters:
//   #  wall (a space, or anything outside the drawing, is wall too)
//   .  road          ~  deep snow          ^  ramp
//   S  start (exactly one)
//   F  finish line: a straight run of F cells across the road, wall to wall
//   1..9  checkpoints, a straight run each, numbered in driving order (at least 2).
//         Laps only count after crossing them in order, so nobody can shortcut.
//
// Everything here is deterministic (only integers, + - * / and sqrt): every peer builds the
// exact same track from the same text.
// ─────────────────────────────────────────────────────────────

import { CAR_RADIUS } from "./params";
import type { Bounds, Gate, GridTrack, Ramp, Rect } from "./track";

/** The text of a track is wrong: the message says where and why (positions are 1-based, in the drawing). */
export class TrackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrackError";
  }
}

const DIRS: Record<string, [number, number]> = {
  right: [1, 0],
  left: [-1, 0],
  down: [0, 1], // y grows downwards, like the screen
  up: [0, -1],
};

const VALID_CHARS = new Set("# .~^SF123456789".split(""));

interface Cell {
  c: number;
  r: number;
}

export function parseTrack(id: string, source: string): GridTrack {
  const text = source.replace(/\r/g, "");
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++; // blank lines before the header

  // ── header ───────────────────────────────────────────────
  const header: Record<string, string> = {};
  for (; i < lines.length && lines[i].trim() !== ""; i++) {
    const m = /^\s*([a-z]+)\s*:\s*(.*?)\s*$/.exec(lines[i]);
    if (!m) throw new TrackError(`Cabeçalho inválido: "${lines[i]}" (esperado "chave: valor").`);
    if (!["name", "cell", "finish", "start"].includes(m[1])) {
      throw new TrackError(`Chave de cabeçalho desconhecida: "${m[1]}" (use name, cell, finish ou start).`);
    }
    header[m[1]] = m[2];
  }
  const cell = header.cell === undefined ? 1 : Number(header.cell);
  if (!(cell > 0) || !Number.isFinite(cell)) throw new TrackError(`"cell" precisa ser um número positivo (veio "${header.cell}").`);
  const finishName = header.finish;
  if (!finishName) throw new TrackError('Falta "finish: right|left|up|down" no cabeçalho (sentido de travessia da linha de chegada).');
  const finishDir = DIRS[finishName];
  if (!finishDir) throw new TrackError(`"finish" inválido: "${finishName}" (use right, left, up ou down).`);
  const startDir = header.start === undefined ? finishDir : DIRS[header.start];
  if (!startDir) throw new TrackError(`"start" inválido: "${header.start}" (use right, left, up ou down).`);

  // ── the drawing ──────────────────────────────────────────
  const grid = lines.slice(i);
  while (grid.length > 0 && grid[0].trim() === "") grid.shift();
  while (grid.length > 0 && grid[grid.length - 1].trim() === "") grid.pop();
  if (grid.length === 0) throw new TrackError("A pista não tem desenho (falta o grid depois da linha em branco do cabeçalho).");
  const rows = grid.length;
  const cols = Math.max(...grid.map((l) => l.length));

  const ch = (c: number, r: number): string => (r >= 0 && r < rows && c >= 0 && c < grid[r].length ? grid[r][c] : " ");
  const solid = (c: number, r: number): boolean => {
    const x = ch(c, r);
    return x === "#" || x === " ";
  };
  const at = (c: number, r: number) => `(coluna ${c + 1}, linha ${r + 1})`;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (!VALID_CHARS.has(grid[r][c])) throw new TrackError(`Caractere inválido "${grid[r][c]}" em ${at(c, r)}.`);
    }
  }

  // ── start, finish and checkpoints ────────────────────────
  const found = new Map<string, Cell[]>();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      const x = grid[r][c];
      if (x === "S" || x === "F" || (x >= "1" && x <= "9")) {
        if (!found.has(x)) found.set(x, []);
        found.get(x)!.push({ c, r });
      }
    }
  }

  const starts = found.get("S") ?? [];
  if (starts.length !== 1) throw new TrackError(`Precisa de exatamente uma largada "S" (achei ${starts.length}).`);
  const S = starts[0];
  const k = Math.ceil(CAR_RADIUS / cell);
  for (let dr = -k; dr <= k; dr++) {
    for (let dc = -k; dc <= k; dc++) {
      if (solid(S.c + dc, S.r + dr)) throw new TrackError(`A largada ${at(S.c, S.r)} está colada na parede: deixe espaço livre em volta dela.`);
    }
  }

  let nCheck = 0;
  while (found.has(String(nCheck + 1))) nCheck++;
  for (const key of found.keys()) {
    if (key >= "1" && key <= "9" && Number(key) > nCheck) {
      throw new TrackError(`Os checkpoints precisam ser numerados em sequência: achei o ${key}, mas falta o ${nCheck + 1}.`);
    }
  }
  if (nCheck < 2) throw new TrackError(`Precisa de pelo menos 2 checkpoints (1 e 2); achei ${nCheck}.`);

  /** A run of cells that is straight and goes from wall to wall: returns its geometry. */
  const lineOf = (label: string, cells: Cell[]) => {
    const sameCol = cells.every((p) => p.c === cells[0].c);
    const sameRow = cells.every((p) => p.r === cells[0].r);
    if (cells.length < 2 || (!sameCol && !sameRow)) {
      throw new TrackError(`${label}: precisa ser uma linha reta de pelo menos 2 células (ficou em ${cells.map((p) => at(p.c, p.r)).join(", ")}).`);
    }
    const vertical = sameCol;
    const sorted = [...cells].sort((a, b) => (vertical ? a.r - b.r : a.c - b.c));
    for (let n = 1; n < sorted.length; n++) {
      const gap = vertical ? sorted[n].r - sorted[n - 1].r : sorted[n].c - sorted[n - 1].c;
      if (gap !== 1) throw new TrackError(`${label}: a linha tem buraco entre ${at(sorted[n - 1].c, sorted[n - 1].r)} e ${at(sorted[n].c, sorted[n].r)}.`);
    }
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const before = vertical ? solid(first.c, first.r - 1) : solid(first.c - 1, first.r);
    const after = vertical ? solid(last.c, last.r + 1) : solid(last.c + 1, last.r);
    if (!before || !after) {
      throw new TrackError(`${label}: a linha não vai de parede a parede (as pontas ${at(first.c, first.r)} e ${at(last.c, last.r)} precisam encostar em "#").`);
    }
    const mid = sorted[Math.floor((sorted.length - 1) / 2)];
    return { vertical, first, last, mid };
  };

  const fCells = found.get("F") ?? [];
  if (fCells.length === 0) throw new TrackError('Falta a linha de chegada "F".');
  const fLine = lineOf("Chegada (F)", fCells);
  if (fLine.vertical ? finishDir[0] === 0 : finishDir[1] === 0) {
    throw new TrackError(`"finish: ${finishName}" não atravessa a linha de chegada (a linha é ${fLine.vertical ? "vertical, então use right ou left" : "horizontal, então use up ou down"}).`);
  }

  const gateOf = (line: ReturnType<typeof lineOf>, dx: number, dy: number): Gate =>
    line.vertical
      ? { ax: (line.first.c + 0.5) * cell, ay: line.first.r * cell, bx: (line.first.c + 0.5) * cell, by: (line.last.r + 1) * cell, dx, dy }
      : { ax: line.first.c * cell, ay: (line.first.r + 0.5) * cell, bx: (line.last.c + 1) * cell, by: (line.first.r + 0.5) * cell, dx, dy };

  // ── connectivity + order of the checkpoints (BFS from just past the finish line) ──
  // The finish line itself blocks the search, so the cells BEHIND it are only reached by going
  // all the way around: that is what proves the track is a circuit, and the BFS distance tells
  // the direction of travel at every point (it grows as you drive).
  const isF = (c: number, r: number) => ch(c, r) === "F";
  const dist = new Int32Array(rows * cols).fill(-1);
  const queue: number[] = [];
  for (const p of fCells) {
    const c = p.c + finishDir[0], r = p.r + finishDir[1];
    if (!solid(c, r) && !isF(c, r) && dist[r * cols + c] < 0) {
      dist[r * cols + c] = 0;
      queue.push(r * cols + c);
    }
  }
  if (queue.length === 0) throw new TrackError('Logo depois da linha de chegada (no sentido de "finish") só tem parede.');
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    const c = cur % cols, r = (cur - c) / cols;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows || solid(nc, nr) || isF(nc, nr) || dist[nr * cols + nc] >= 0) continue;
      dist[nr * cols + nc] = dist[cur] + 1;
      queue.push(nr * cols + nc);
    }
  }
  const dAt = (c: number, r: number) => (c < 0 || r < 0 || c >= cols || r >= rows ? -1 : dist[r * cols + c]);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (!solid(c, r) && !isF(c, r) && dAt(c, r) < 0) {
        throw new TrackError(`Pista aberta ou desconectada: a célula ${at(c, r)} não é alcançável dando a volta a partir da chegada (a pista precisa ser um circuito fechado).`);
      }
    }
  }

  const gates: Gate[] = [gateOf(fLine, finishDir[0], finishDir[1])];
  let prevD = 0;
  for (let n = 1; n <= nCheck; n++) {
    const label = `Checkpoint ${n}`;
    const line = lineOf(label, found.get(String(n))!);
    // direction of travel = toward the neighbor (across the line) that the BFS reaches LATER
    const [ax, ay] = line.vertical ? [1, 0] : [0, 1];
    const back = dAt(line.mid.c - ax, line.mid.r - ay);
    const fwd = dAt(line.mid.c + ax, line.mid.r + ay);
    if (back < 0 || fwd < 0 || back === fwd) throw new TrackError(`${label}: não consegui descobrir o sentido de travessia (confira se ele fica no meio da pista).`);
    const sign = fwd > back ? 1 : -1;
    const d = dAt(line.mid.c, line.mid.r);
    if (d <= prevD) throw new TrackError(`${label} está fora de ordem: precisa ser percorrido depois do ${n === 1 ? "início (chegada)" : `checkpoint ${n - 1}`}.`);
    prevD = d;
    gates.push(gateOf(line, sign * ax + 0, sign * ay + 0)); // (+ 0 turns -0 into 0)
  }
  const behind = dAt(fLine.mid.c - finishDir[0], fLine.mid.r - finishDir[1]);
  if (behind < 0 || behind <= prevD) {
    throw new TrackError(`O checkpoint ${nCheck} precisa vir antes de a pista voltar à chegada (a ordem 1…${nCheck} tem de seguir o sentido da corrida).`);
  }

  // ── snow and ramps as rectangles (runs of equal cells are merged) ──
  const zone = (symbol: string): Rect[] => {
    const rects: Rect[] = [];
    let open = new Map<string, Rect>(); // "c0-c1" → rectangle that can still grow downwards
    for (let r = 0; r < rows; r++) {
      const next = new Map<string, Rect>();
      for (let c = 0; c < cols; ) {
        if (ch(c, r) !== symbol) { c++; continue; }
        let c1 = c;
        while (ch(c1 + 1, r) === symbol) c1++;
        const key = `${c}-${c1}`;
        const prev = open.get(key);
        if (prev) {
          prev.y1 = (r + 1) * cell;
          next.set(key, prev);
        } else {
          const rect = { x0: c * cell, y0: r * cell, x1: (c1 + 1) * cell, y1: (r + 1) * cell };
          rects.push(rect);
          next.set(key, rect);
        }
        c = c1 + 1;
      }
      open = next;
    }
    return rects;
  };

  /**
   * Direction of travel over a ramp. The axis is the one with the longer free run around its middle
   * cell (a corridor runs along its long side; the BFS distance can't tell, it grows on both axes in
   * a wide corridor); the sign is the way the BFS distance grows along that axis.
   */
  const rampDirection = (z: Rect): Pick<Ramp, "dx" | "dy"> => {
    const mc = Math.floor((z.x0 / cell + z.x1 / cell - 1) / 2);
    const mr = Math.floor((z.y0 / cell + z.y1 / cell - 1) / 2);
    const run = (dc: number, dr: number) => {
      let n = 0;
      while (n < 64 && !solid(mc + dc * (n + 1), mr + dr * (n + 1))) n++;
      return n;
    };
    const along = (dc: number, dr: number) => {
      const here = dAt(mc, mr);
      const val = (c: number, r: number) => (dAt(c, r) < 0 ? here : dAt(c, r));
      return val(mc + dc, mr + dr) - val(mc - dc, mr - dr) < 0 ? -1 : 1;
    };
    const horizontal = run(1, 0) + run(-1, 0), vertical = run(0, 1) + run(0, -1);
    return horizontal >= vertical ? { dx: along(1, 0), dy: 0 } : { dx: 0, dy: along(0, 1) };
  };

  // ── walls: outline of the drawing (marching squares over cell centers) ──
  // Segment endpoints are integers in half-cells, so every coordinate is exact. Each segment is
  // oriented so that the road is on its (dy, -dx) side.
  const T: [number, number] = [2, 1], Rr: [number, number] = [3, 2], B: [number, number] = [2, 3], L: [number, number] = [1, 2];
  const TABLE: Record<number, [[number, number], [number, number]][]> = {
    1: [[T, L]], 2: [[Rr, T]], 3: [[Rr, L]], 4: [[B, Rr]], 5: [[T, Rr], [B, L]], 6: [[B, T]], 7: [[B, L]],
    8: [[L, B]], 9: [[T, B]], 10: [[L, T], [Rr, B]], 11: [[Rr, B]], 12: [[L, Rr]], 13: [[T, Rr]], 14: [[L, T]],
  };
  const pieces: { x0: number; y0: number; x1: number; y1: number }[] = [];
  for (let r = -1; r < rows; r++) {
    for (let c = -1; c < cols; c++) {
      const mask = (solid(c, r) ? 1 : 0) | (solid(c + 1, r) ? 2 : 0) | (solid(c + 1, r + 1) ? 4 : 0) | (solid(c, r + 1) ? 8 : 0);
      for (const [p, q] of TABLE[mask] ?? []) {
        pieces.push({ x0: 2 * c + p[0], y0: 2 * r + p[1], x1: 2 * c + q[0], y1: 2 * r + q[1] });
      }
    }
  }
  const byStart = new Map<string, number>();
  pieces.forEach((s, n) => {
    const key = `${s.x0},${s.y0}`;
    if (byStart.has(key)) throw new TrackError("Contorno ambíguo na pista (parede muito recortada).");
    byStart.set(key, n);
  });
  const used = new Array<boolean>(pieces.length).fill(false);
  const loopsHalf: [number, number][][] = [];
  for (let n = 0; n < pieces.length; n++) {
    if (used[n]) continue;
    const pts: [number, number][] = [];
    let cur = n;
    while (!used[cur]) {
      used[cur] = true;
      pts.push([pieces[cur].x0, pieces[cur].y0]);
      const next = byStart.get(`${pieces[cur].x1},${pieces[cur].y1}`);
      if (next === undefined) throw new TrackError("Contorno aberto na pista (bug do carregador).");
      cur = next;
    }
    loopsHalf.push(simplify(pts));
  }

  const half = cell / 2;
  const loops = loopsHalf.map((pts) => pts.flatMap(([x, y]) => [x * half, y * half]));
  const segs: number[] = [];
  for (const lp of loops) {
    for (let n = 0; n < lp.length; n += 2) {
      const m = (n + 2) % lp.length;
      segs.push(lp[n], lp[n + 1], lp[m], lp[m + 1]);
    }
  }

  // bounds of the whole outline
  const bounds: Bounds = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const lp of loops) {
    for (let n = 0; n < lp.length; n += 2) {
      bounds.x0 = Math.min(bounds.x0, lp[n]);
      bounds.x1 = Math.max(bounds.x1, lp[n]);
      bounds.y0 = Math.min(bounds.y0, lp[n + 1]);
      bounds.y1 = Math.max(bounds.y1, lp[n + 1]);
    }
  }

  // spatial index: for each cell, the segments that can touch a car standing anywhere in it
  const buckets: number[][] = Array.from({ length: rows * cols }, () => []);
  const reach = CAR_RADIUS + cell * 0.7072; // car radius + half the cell diagonal (center → corner)
  for (let n = 0; n < segs.length; n += 4) {
    const [x0, y0, x1, y1] = [segs[n], segs[n + 1], segs[n + 2], segs[n + 3]];
    const cMin = Math.max(0, Math.floor((Math.min(x0, x1) - reach) / cell));
    const cMax = Math.min(cols - 1, Math.floor((Math.max(x0, x1) + reach) / cell));
    const rMin = Math.max(0, Math.floor((Math.min(y0, y1) - reach) / cell));
    const rMax = Math.min(rows - 1, Math.floor((Math.max(y0, y1) + reach) / cell));
    for (let r = rMin; r <= rMax; r++) {
      for (let c = cMin; c <= cMax; c++) {
        if (distToSegment((c + 0.5) * cell, (r + 0.5) * cell, x0, y0, x1, y1) <= reach) buckets[r * cols + c].push(n / 4);
      }
    }
  }

  return {
    kind: "grid",
    id,
    name: header.name ?? id,
    cell,
    cols,
    rows,
    segs,
    buckets,
    loops,
    bounds,
    snow: zone("~"),
    ramps: zone("^").map((z) => ({ ...z, ...rampDirection(z) })),
    gates,
    start: { x: (S.c + 0.5) * cell, y: (S.r + 0.5) * cell, hx: startDir[0], hy: startDir[1] },
    hash: fnv1a(text),
  };
}

/** Drops the vertices that lie in the middle of a straight stretch (long walls become one segment). */
function simplify(pts: [number, number][]): [number, number][] {
  const n = pts.length;
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i + n - 1) % n], b = pts[i], c = pts[(i + 1) % n];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (cross !== 0) out.push(b);
  }
  return out;
}

function distToSegment(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const ex = x1 - x0, ey = y1 - y0;
  const len2 = ex * ex + ey * ey;
  let t = len2 > 0 ? ((px - x0) * ex + (py - y0) * ey) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = px - (x0 + t * ex), dy = py - (y0 + t * ey);
  return Math.sqrt(dx * dx + dy * dy);
}

export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
