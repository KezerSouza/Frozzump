import { TOTAL_LAPS, type CarState, type TrackDef } from "../sim";

export interface Pose { x: number; y: number; hx: number; hy: number }
export interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number }

export interface Scene {
  track: TrackDef;
  car: Pose;
  state: CarState;
  ghost: Pose | null;
  particles: Particle[];
  phase: "countdown" | "racing" | "finished";
  countdownText: string;
  timeText: string;
  bestText: string;
  splits: string[];
  newRecord: boolean;
  ghostOn: boolean;
}

const C = {
  bg: "#0c1624",
  infield: "#13263a",
  track: "#cfdee8",
  snow: "#fbfeff",
  snowDot: "#b9d3e3",
  wall: "#35546f",
  ramp: "#ff8a3d",
  rampDark: "#c4571a",
  car: "#e5412d",
  carDark: "#9c2417",
  glass: "#12202e",
  ghost: "rgba(130,205,255,0.6)",
  text: "#e8f1f7",
  muted: "#8aa3b8",
};
const CAR_SCALE = 1.2; // visual car size (must track CAR_RADIUS in the simulation)
const SANS = `"Avenir Next", "Segoe UI", system-ui, sans-serif`;
const MONO = `ui-monospace, "SF Mono", Menlo, Consolas, monospace`;

// snow speckles generated once (visual only => Math.random is fine)
const dots = Array.from({ length: 90 }, () => ({ x: Math.random(), y: Math.random(), r: 0.05 + Math.random() * 0.08 }));

function stadium(ctx: CanvasRenderingContext2D, L: number, r: number) {
  ctx.roundRect(-(L + r), -r, 2 * (L + r), 2 * r, r);
}

export function draw(ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number, sc: Scene) {
  const t = sc.track;
  const L = t.halfStraight, Ro = t.centerRadius + t.halfWidth, Ri = t.centerRadius - t.halfWidth;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, w, h);

  // fixed camera showing the whole track (as in the original minigame)
  const scale = Math.min(w / (2 * (L + Ro) + 4), h / (2 * Ro + 7));
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, (dpr * w) / 2, (dpr * (h / 2 + 18)));

  // track + infield
  ctx.beginPath(); stadium(ctx, L, Ro); ctx.fillStyle = C.track; ctx.fill();
  ctx.beginPath(); stadium(ctx, L, Ri); ctx.fillStyle = C.infield; ctx.fill();

  // deep snow and ramp (clipped to the track)
  ctx.save();
  ctx.beginPath(); stadium(ctx, L, Ro); stadium(ctx, L, Ri); ctx.clip("evenodd");
  for (const r of t.snow) {
    ctx.fillStyle = C.snow;
    ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    ctx.fillStyle = C.snowDot;
    for (const d of dots) {
      ctx.beginPath();
      ctx.arc(r.x0 + d.x * (r.x1 - r.x0), r.y0 + d.y * (r.y1 - r.y0), d.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  for (const r of t.ramps) {
    ctx.fillStyle = C.ramp;
    ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    ctx.strokeStyle = C.rampDark; ctx.lineWidth = 0.12; ctx.lineJoin = "round";
    const cy = (r.y0 + r.y1) / 2;
    for (let i = 0; i < 2; i++) { // chevrons pointing in the race direction (←)
      const cx = r.x1 - 0.3 - i * 0.35;
      ctx.beginPath(); ctx.moveTo(cx + 0.18, cy - 0.45); ctx.lineTo(cx - 0.12, cy); ctx.lineTo(cx + 0.18, cy + 0.45); ctx.stroke();
    }
  }
  // start/finish line (checkered)
  const g = t.gates[0];
  const sq = 0.5, n = Math.round((g.by - g.ay) / sq);
  for (let i = 0; i < n; i++) for (let j = 0; j < 2; j++) {
    ctx.fillStyle = (i + j) % 2 ? "#0c1624" : "#ffffff";
    ctx.fillRect(g.ax - sq + j * sq, g.ay + i * sq, sq, sq);
  }
  ctx.restore();

  // walls
  ctx.strokeStyle = C.wall; ctx.lineWidth = 0.3;
  ctx.beginPath(); stadium(ctx, L, Ro); ctx.stroke();
  ctx.beginPath(); stadium(ctx, L, Ri); ctx.stroke();

  // snow particles
  for (const p of sc.particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.max) * 0.8;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  if (sc.ghost && sc.ghostOn) drawCar(ctx, sc.ghost, 0, true);
  drawCar(ctx, sc.car, sc.state.airTicks, false);

  drawHud(ctx, w, h, dpr, sc);
}

function drawCar(ctx: CanvasRenderingContext2D, p: Pose, air: number, ghost: boolean) {
  const lift = air > 0 ? Math.sin(Math.min(1, air / 66) * Math.PI) : 0; // visual only
  ctx.save();
  if (!ghost) { // shadow
    ctx.fillStyle = "rgba(5,12,20,0.28)";
    ctx.beginPath();
    ctx.ellipse(p.x + 0.12 + lift * 0.5, p.y + 0.15 + lift * 0.7, 0.95 * CAR_SCALE, 0.55 * CAR_SCALE, Math.atan2(p.hy, p.hx), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.translate(p.x, p.y - lift * 0.5);
  ctx.rotate(Math.atan2(p.hy, p.hx));
  const s = CAR_SCALE * (1 + lift * 0.18);
  ctx.scale(s, s);
  ctx.fillStyle = ghost ? C.ghost : C.car;
  ctx.beginPath(); ctx.roundRect(-0.8, -0.45, 1.6, 0.9, 0.28); ctx.fill();
  if (!ghost) {
    ctx.fillStyle = C.carDark; ctx.fillRect(-0.8, -0.45, 0.35, 0.9); // rear
    ctx.fillStyle = C.glass; ctx.beginPath(); ctx.roundRect(0.05, -0.3, 0.5, 0.6, 0.12); ctx.fill();
  }
  ctx.restore();
}

function drawHud(ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number, sc: Scene) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const pad = Math.max(16, w * 0.02);

  ctx.textBaseline = "top"; ctx.textAlign = "left";
  ctx.fillStyle = C.text; ctx.font = `600 ${Math.round(Math.min(44, w * 0.04))}px ${MONO}`;
  ctx.fillText(sc.timeText, pad, pad);
  ctx.fillStyle = C.muted; ctx.font = `500 ${Math.round(Math.min(16, w * 0.016))}px ${SANS}`;
  const lap = Math.min(sc.state.laps + 1, TOTAL_LAPS);
  ctx.fillText(`Lap ${lap} of ${TOTAL_LAPS}`, pad, pad + Math.min(52, w * 0.05));

  ctx.textAlign = "right";
  ctx.fillText(`Best ${sc.bestText}`, w - pad, pad + 6);
  sc.splits.forEach((s, i) => ctx.fillText(`${i + 1}  ${s}`, w - pad, pad + 32 + i * 20));

  ctx.textAlign = "center"; ctx.textBaseline = "bottom"; ctx.fillStyle = C.muted;
  ctx.font = `500 ${Math.round(Math.min(15, w * 0.015))}px ${SANS}`;
  ctx.fillText(`← → steer   R restart   G ghost ${sc.ghostOn ? "on" : "off"}`, w / 2, h - pad * 0.8);

  if (sc.phase === "countdown" && sc.countdownText) {
    ctx.textBaseline = "middle"; ctx.fillStyle = C.text;
    ctx.font = `700 ${Math.round(Math.min(140, w * 0.14))}px ${SANS}`;
    ctx.fillText(sc.countdownText, w / 2, h * 0.42);
  }
  if (sc.phase === "finished") {
    const bw = Math.min(420, w - 32), bh = 170, bx = (w - bw) / 2, by = h * 0.3;
    ctx.fillStyle = "rgba(12,22,36,0.92)"; ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 14); ctx.fill();
    ctx.textBaseline = "top"; ctx.fillStyle = C.text;
    ctx.font = `600 54px ${MONO}`; ctx.fillText(sc.timeText, w / 2, by + 22);
    ctx.fillStyle = sc.newRecord ? C.ramp : C.muted; ctx.font = `600 18px ${SANS}`;
    ctx.fillText(sc.newRecord ? "New record!" : `Your best: ${sc.bestText}`, w / 2, by + 92);
    ctx.fillStyle = C.muted; ctx.font = `500 15px ${SANS}`;
    ctx.fillText("Press R to race again", w / 2, by + 126);
  }
}
