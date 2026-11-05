import {
  AIR_TICKS, BOOST_SPEED, CAR_RADIUS, DRAG_SNOW, DRAG_TRACK, DT, IN_LEFT, IN_RIGHT,
  LAT_KEEP_AIR, LAT_KEEP_SNOW, LAT_KEEP_TRACK, MAX_YAW, STEER_AIR_SCALE, STEER_RATE,
  THRUST, TOTAL_LAPS, V_REF, WALL_BOUNCE, WALL_IMPACT, WALL_KEEP, WALL_MIN_KEEP,
} from "./params";
import { crossedGate, inRects, type TrackDef } from "./track";

export interface CarState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  hx: number; // heading (unit vector) — no angles, no trigonometry
  hy: number;
  steer: number; // -1..1, smoothed steering
  airTicks: number; // > 0 => airborne (jumped off the ramp)
  onPad: boolean; // was on the ramp on the previous tick
  nextGate: number;
  laps: number;
  tick: number;
  finished: boolean;
  lapTicks: number[]; // tick at which each lap was completed
}

export function createState(track: TrackDef): CarState {
  return {
    x: track.start.x, y: track.start.y, vx: 0, vy: 0,
    hx: track.start.hx, hy: track.start.hy,
    steer: 0, airTicks: 0, onPad: false,
    nextGate: 1, laps: 0, tick: 0, finished: false, lapTicks: [],
  };
}

/** Advances 1 tick (1/120 s). Deterministic: only + - * / sqrt and comparisons. */
export function step(s: CarState, track: TrackDef, input: number): void {
  if (s.finished) return;
  s.tick++;

  const left = (input & IN_LEFT) !== 0;
  const right = (input & IN_RIGHT) !== 0;

  const air = s.airTicks > 0;

  // 1) Smoothed steering (keyboard is digital)
  const target = (right ? 1 : 0) - (left ? 1 : 0);
  const maxDelta = STEER_RATE * DT;
  let d = target - s.steer;
  if (d > maxDelta) d = maxDelta;
  else if (d < -maxDelta) d = -maxDelta;
  s.steer += d;

  // 2) Rotate the heading. Yaw depends on speed (no turning when stopped; reversed when going backwards)
  const fwd0 = s.vx * s.hx + s.vy * s.hy;
  let sf = fwd0 / V_REF;
  if (sf > 1) sf = 1;
  else if (sf < -1) sf = -1;
  const theta = s.steer * MAX_YAW * sf * (air ? STEER_AIR_SCALE : 1) * DT;
  const t2 = theta * theta;
  const c = 1 - t2 / 2 + (t2 * t2) / 24; // cos(θ) via series (θ is small)
  const sn = theta - (theta * t2) / 6 + (theta * t2 * t2) / 120; // sin(θ)
  let nhx = s.hx * c - s.hy * sn;
  let nhy = s.hx * sn + s.hy * c;
  const inv = 1 / Math.sqrt(nhx * nhx + nhy * nhy); // renormalize (sqrt is exact in IEEE-754)
  nhx *= inv;
  nhy *= inv;
  s.hx = nhx;
  s.hy = nhy;

  // 3) Decompose the velocity (which did NOT rotate along) into the new frame => drifting
  let fwd = s.vx * s.hx + s.vy * s.hy;
  let lat = -s.vx * s.hy + s.vy * s.hx;

  const onSnow = !air && inRects(s.x, s.y, track.snow);
  const drag = onSnow ? DRAG_SNOW : DRAG_TRACK;
  const keep = air ? LAT_KEEP_AIR : onSnow ? LAT_KEEP_SNOW : LAT_KEEP_TRACK;

  // 4) Longitudinal: accelerates on its own; snow only increases drag (lowers v_max)
  fwd += (THRUST - drag * fwd) * DT;
  lat *= keep;

  s.vx = s.hx * fwd - s.hy * lat;
  s.vy = s.hy * fwd + s.hx * lat;

  // 5) Integrate position
  const px = s.x;
  const py = s.y;
  s.x += s.vx * DT;
  s.y += s.vy * DT;

  // 6) Ramp: triggers on ENTERING the zone
  const padNow = inRects(s.x, s.y, track.ramps);
  if (padNow && !s.onPad && s.airTicks === 0 && fwd > 2) {
    s.airTicks = AIR_TICKS;
    if (fwd < BOOST_SPEED) {
      s.vx = s.hx * BOOST_SPEED - s.hy * lat;
      s.vy = s.hy * BOOST_SPEED + s.hx * lat;
    }
  }
  s.onPad = padNow;
  if (s.airTicks > 0) s.airTicks--;

  // 7) Walls
  resolveWalls(s, track);

  // 8) Gates / laps
  for (let i = 0; i < track.gates.length; i++) {
    if (i === s.nextGate && crossedGate(track.gates[i], px, py, s.x, s.y)) {
      if (i === 0) {
        s.laps++;
        s.lapTicks.push(s.tick);
        if (s.laps >= TOTAL_LAPS) s.finished = true;
      }
      s.nextGate = (i + 1) % track.gates.length;
      break;
    }
  }
}

function resolveWalls(s: CarState, track: TrackDef): void {
  const L = track.halfStraight;
  const px = s.x < -L ? -L : s.x > L ? L : s.x; // closest point on the axis
  const dx = s.x - px;
  const dy = s.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  const rMin = track.centerRadius - track.halfWidth + CAR_RADIUS;
  const rMax = track.centerRadius + track.halfWidth - CAR_RADIUS;
  if (dist <= rMax && dist >= rMin) return;

  let nx = 0;
  let ny = -1;
  if (dist > 1e-9) {
    nx = dx / dist;
    ny = dy / dist;
  }
  const outer = dist > rMax;
  const r = outer ? rMax : rMin;
  s.x = px + nx * r;
  s.y = ny * r;

  const vn = s.vx * nx + s.vy * ny;
  if (outer ? vn > 0 : vn < 0) {
    const k = (1 + WALL_BOUNCE) * vn;
    // the more "head-on" the impact, the more speed is lost; scraping costs a little too
    let hit = 1 - WALL_IMPACT * (vn < 0 ? -vn : vn);
    if (hit < WALL_MIN_KEEP) hit = WALL_MIN_KEEP;
    const f = WALL_KEEP * hit;
    s.vx = (s.vx - k * nx) * f;
    s.vy = (s.vy - k * ny) * f;
  }
}

/** FNV-1a hash of the state: used by the determinism tests and by verification. */
const view = new DataView(new ArrayBuffer(8));
export function hashState(s: CarState): number {
  let h = 0x811c9dc5;
  const nums = [s.x, s.y, s.vx, s.vy, s.hx, s.hy, s.steer, s.airTicks, s.nextGate, s.laps, s.tick];
  for (const n of nums) {
    view.setFloat64(0, n);
    for (let i = 0; i < 8; i++) {
      h ^= view.getUint8(i);
      h = Math.imul(h, 0x01000193);
    }
  }
  return h >>> 0;
}
