// Simple bot to tune the track and physics WITHOUT playing by hand.
// (Lives outside src/sim, so it may use Math.atan2 freely.)
import {
  OVAL_1, createState, step, DT, IN_LEFT, IN_RIGHT, SUBTICKS_PER_TICK, TICK_RATE, inRects,
} from "../src/sim";

const T = OVAL_1;
const L = T.halfStraight, R = T.centerRadius;
const P = 4 * L + 2 * Math.PI * R;

function pointAt(s: number, laneY: number | null) {
  s = ((s % P) + P) % P;
  if (s < 2 * L) return { x: -L + s, y: R };
  s -= 2 * L;
  if (s < Math.PI * R) { const a = Math.PI / 2 - s / R; return { x: L + R * Math.cos(a), y: R * Math.sin(a) }; }
  s -= Math.PI * R;
  if (s < 2 * L) return { x: L - s, y: laneY ?? -R };
  s -= 2 * L;
  const a = -Math.PI / 2 - s / R;
  return { x: -L + R * Math.cos(a), y: R * Math.sin(a) };
}

function progress(x: number, y: number) {
  if (x > L) { const a = Math.atan2(y, x - L); return 2 * L + R * (Math.PI / 2 - a); }
  if (x < -L) { let a = Math.atan2(y, x + L); if (a > -Math.PI / 2) a -= 2 * Math.PI; return 4 * L + Math.PI * R + R * (-Math.PI / 2 - a); }
  return y > 0 ? x + L : 2 * L + Math.PI * R + (L - x);
}

export function runBot(useRamp: boolean, look = 5) {
  const s = createState(T);
  let snowTicks = 0, airTicks = 0, maxV = 0, wallTicks = 0;
  const inputs: number[] = [];
  while (!s.finished && s.tick < 120 * 120) {
    const pr = progress(s.x, s.y);
    // with ramp: inner lane (y=-4). without ramp: outer lane (y=-8), avoiding the ramp
    const laneY = useRamp ? -4 : -8;
    const tp = pointAt(pr + look, laneY);
    if (s.x > L - 1 && s.y < 0) { tp.y = laneY; }
    const cross = s.hx * (tp.y - s.y) - s.hy * (tp.x - s.x);
    let m = 0;
    if (cross > 0.15) m |= IN_RIGHT; else if (cross < -0.15) m |= IN_LEFT;
    inputs.push(m);
    step(s, T, m);
    if (s.airTicks > 0) airTicks++; else if (inRects(s.x, s.y, T.snow)) snowTicks++;
    maxV = Math.max(maxV, Math.hypot(s.vx, s.vy));
    { const px = Math.max(-L, Math.min(L, s.x)); const d = Math.hypot(s.x - px, s.y);
      if (d >= R + T.halfWidth - 0.72 - 1e-6 || d <= R - T.halfWidth + 0.72 + 1e-6) wallTicks++; }
  }
  return { s, inputs, snowTicks, airTicks, maxV, wallTicks };
}

if (process.argv[1]?.endsWith("bot.ts")) {
  for (const useRamp of [false, true]) {
    const r = runBot(useRamp);
    const sec = (sub: number) => sub / (TICK_RATE * SUBTICKS_PER_TICK);
    const laps = r.s.lapSubticks.map((t, i, a) => sec(t - (a[i - 1] ?? 0)).toFixed(3));
    const total = r.s.finished ? sec(r.s.finishSubticks) : r.s.tick * DT;
    console.log(`ramp=${useRamp}  finished=${r.s.finished}  total=${total.toFixed(3)}s  laps=[${laps.join(", ")}]  ` +
      `wall=${(r.wallTicks * DT).toFixed(2)}s snow=${(r.snowTicks * DT).toFixed(2)}s  air=${(r.airTicks * DT).toFixed(2)}s  vmax=${r.maxV.toFixed(1)}m/s  done=${r.s.laps}/${T.laps}`);
  }
}
