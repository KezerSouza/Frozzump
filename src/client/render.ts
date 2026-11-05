import { TOTAL_LAPS, type CarState, type TrackDef } from "../sim";

export interface Pose { x: number; y: number; hx: number; hy: number }
export interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number }

/** A remote player's car, drawn as a light colored shadow. */
export interface RemoteCar {
  id: string;
  name: string;
  color: string;
  pose: Pose;
  air: number;
}

/** One row of the connected-players rank (left side). */
export interface RankRow {
  name: string;
  color: string;
  lap: number; // 1..TOTAL_LAPS
  isSelf: boolean;
  finished: boolean;
  waiting: boolean; // race mode: not in the current round (joined late)
}

/** One row of the shared lap-time leaderboard. */
export interface LeaderRow {
  name: string;
  color: string;
  timeText: string;
  isSelf: boolean;
}

/** One row of the race-mode standings. */
export interface RaceRow {
  pos: number;
  name: string;
  color: string;
  status: string; // finish time, or current lap while still racing
  isSelf: boolean;
  done: boolean;
}

/** Race-mode overlay (null in free mode). */
export interface RaceView {
  round: number;
  rows: RaceRow[];
  nextText: string; // "Próxima corrida em 14s" / "Aguardando o 1º colocado…"
  hostHint: string | null; // host only, once the round can be restarted
  banner: string | null; // shown while still racing after someone finished
  showPanel: boolean; // local player finished or is waiting for the next round
  waiting: boolean;
}

export interface Scene {
  track: TrackDef;
  car: Pose;
  state: CarState;
  ghost: Pose | null;
  particles: Particle[];
  phase: "countdown" | "racing" | "finished" | "waiting";
  countdownText: string;
  timeText: string;
  bestText: string;
  splits: string[];
  newRecord: boolean;
  ghostOn: boolean;
  // multiplayer
  selfColor: string;
  othersOn: boolean;
  remotes: RemoteCar[];
  rank: RankRow[];
  leaderboard: LeaderRow[];
  roomCode: string | null;
  selfName: string | null; // nick drawn above our car (only inside a room)
  modeText: string | null; // "modo livre" / "corrida 3" (only inside a room)
  restartKey: boolean; // whether R does something right now (footer hint)
  race: RaceView | null;
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
  const ox = w / 2, oy = h / 2 + 18; // screen position (CSS px) of the world origin
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);

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

  if (sc.ghost && sc.ghostOn) drawCar(ctx, sc.ghost, 0, { ghost: true });
  // remote players: light colored shadows of other connected cars
  if (sc.othersOn) {
    for (const r of sc.remotes) drawCar(ctx, r.pose, r.air, { remote: true, color: r.color });
  }
  drawCar(ctx, sc.car, sc.state.airTicks, { color: sc.selfColor });

  // nicknames above the cars (screen space so text stays crisp at any zoom).
  // The personal ghost never gets one: that is what tells it apart from other players.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const tag = (p: Pose, air: number, name: string, color: string, alpha: number) => {
    const sx = ox + p.x * scale;
    const sy = oy + (p.y - liftOf(air) * 0.5 - CAR_SCALE * 0.95) * scale;
    drawNameTag(ctx, sx, sy, name, color, alpha);
  };
  if (sc.othersOn) for (const r of sc.remotes) tag(r.pose, r.air, r.name, r.color, 0.65);
  if (sc.selfName) tag(sc.car, sc.state.airTicks, sc.selfName, sc.selfColor, 1);

  drawHud(ctx, w, h, dpr, sc);
}

interface CarStyle {
  ghost?: boolean; // the personal best-time replay
  remote?: boolean; // another connected player
  color?: string; // body color (self + remotes)
}

/** Visual jump height 0..1 (visual only, so Math.sin is fine here). */
function liftOf(air: number): number {
  return air > 0 ? Math.sin(Math.min(1, air / 66) * Math.PI) : 0;
}

function drawNameTag(ctx: CanvasRenderingContext2D, x: number, y: number, name: string, color: string, alpha: number) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `600 12px ${SANS}`;
  ctx.textAlign = "center"; ctx.textBaseline = "bottom";
  ctx.lineJoin = "round"; ctx.lineWidth = 1.5; ctx.strokeStyle = "#000"; // thin black outline
  ctx.strokeText(name, x, y);
  ctx.fillStyle = color;
  ctx.fillText(name, x, y);
  ctx.restore();
}

function drawCar(ctx: CanvasRenderingContext2D, p: Pose, air: number, style: CarStyle) {
  const { ghost = false, remote = false } = style;
  const faded = ghost || remote;
  const lift = liftOf(air);
  ctx.save();
  if (!faded) { // ground shadow only for the solid local car
    ctx.fillStyle = "rgba(5,12,20,0.28)";
    ctx.beginPath();
    ctx.ellipse(p.x + 0.12 + lift * 0.5, p.y + 0.15 + lift * 0.7, 0.95 * CAR_SCALE, 0.55 * CAR_SCALE, Math.atan2(p.hy, p.hx), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.translate(p.x, p.y - lift * 0.5);
  ctx.rotate(Math.atan2(p.hy, p.hx));
  const s = CAR_SCALE * (1 + lift * 0.18);
  ctx.scale(s, s);
  // remote cars are a very light tint of their color; ghost uses the blue ghost color
  ctx.globalAlpha = remote ? 0.38 : 1;
  ctx.fillStyle = ghost ? C.ghost : (style.color ?? C.car);
  ctx.beginPath(); ctx.roundRect(-0.8, -0.45, 1.6, 0.9, 0.28); ctx.fill();
  if (!faded) {
    ctx.fillStyle = C.carDark; ctx.fillRect(-0.8, -0.45, 0.35, 0.9); // rear
    ctx.fillStyle = C.glass; ctx.beginPath(); ctx.roundRect(0.05, -0.3, 0.5, 0.6, 0.12); ctx.fill();
  }
  ctx.globalAlpha = 1;
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

  // shared lap-time leaderboard (top-right, below personal splits)
  drawLeaderboard(ctx, w, pad, sc);
  // connected-players rank (left side)
  drawRank(ctx, pad, sc);

  ctx.textAlign = "center"; ctx.textBaseline = "bottom"; ctx.fillStyle = C.muted;
  ctx.font = `500 ${Math.round(Math.min(15, w * 0.015))}px ${SANS}`;
  const room = sc.roomCode ? `   room ${sc.roomCode}${sc.modeText ? ` · ${sc.modeText}` : ""}` : "   M multiplayer";
  const restart = sc.restartKey ? "   R restart" : "";
  ctx.fillText(`← → steer${restart}   G ghost ${sc.ghostOn ? "on" : "off"}   O others ${sc.othersOn ? "on" : "off"}${room}`, w / 2, h - pad * 0.8);

  if (sc.phase === "countdown" && sc.countdownText) {
    ctx.textBaseline = "middle"; ctx.fillStyle = C.text;
    ctx.font = `700 ${Math.round(Math.min(140, w * 0.14))}px ${SANS}`;
    ctx.fillText(sc.countdownText, w / 2, h * 0.42);
  }
  if (sc.race) {
    if (sc.race.showPanel) drawRacePanel(ctx, w, h, sc.race);
    else if (sc.race.banner) drawBanner(ctx, w, h, sc.race.banner);
  } else if (sc.phase === "finished") {
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

/** Small notice under the top bar while still racing (someone already finished). */
function drawBanner(ctx: CanvasRenderingContext2D, w: number, h: number, text: string) {
  ctx.font = `600 15px ${SANS}`;
  const tw = ctx.measureText(text).width;
  const bw = Math.min(w - 32, tw + 32), bh = 32, bx = (w - bw) / 2, by = Math.max(56, h * 0.1);
  ctx.fillStyle = "rgba(12,22,36,0.85)"; ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 10); ctx.fill();
  ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = C.ramp;
  ctx.fillText(text, w / 2, by + bh / 2, bw - 16);
}

/** Race-mode standings: shown once we finished, or while waiting for the next round. */
function drawRacePanel(ctx: CanvasRenderingContext2D, w: number, h: number, r: RaceView) {
  const rowH = 24;
  const rows = r.rows.slice(0, 15);
  const bw = Math.min(440, w - 32);
  const bh = 64 + Math.max(1, rows.length) * rowH + 30 + (r.hostHint ? 22 : 0) + 12;
  const bx = (w - bw) / 2, by = Math.max(56, (h - bh) * 0.4);
  ctx.fillStyle = "rgba(12,22,36,0.92)"; ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 14); ctx.fill();

  ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillStyle = C.text;
  ctx.font = `700 20px ${SANS}`;
  ctx.fillText(r.waiting ? "Aguardando a próxima corrida…" : `Corrida ${r.round} — Resultado`, w / 2, by + 16, bw - 24);
  ctx.fillStyle = C.muted; ctx.font = `500 13px ${SANS}`;
  ctx.fillText(r.waiting ? `Corrida ${r.round} em andamento` : `${TOTAL_LAPS} voltas`, w / 2, by + 42);

  const top = by + 64, left = bx + 20, right = bx + bw - 20, sw = 11;
  ctx.textBaseline = "middle";
  if (rows.length === 0) {
    ctx.textAlign = "center"; ctx.fillStyle = C.muted; ctx.font = `500 14px ${SANS}`;
    ctx.fillText("—", w / 2, top + rowH / 2);
  }
  rows.forEach((row, i) => {
    const y = top + i * rowH + rowH / 2;
    if (row.isSelf) {
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.fillRect(left - 8, y - rowH / 2 + 1, right - left + 16, rowH - 2);
    }
    ctx.font = `600 14px ${MONO}`; ctx.textAlign = "right";
    ctx.fillStyle = row.done ? C.text : C.muted;
    ctx.fillText(row.done ? `${row.pos}º` : "·", left + 24, y);
    ctx.fillStyle = row.color; ctx.fillRect(left + 34, y - sw / 2, sw, sw);
    ctx.font = `${row.isSelf ? 700 : 500} 14px ${SANS}`; ctx.textAlign = "left";
    ctx.fillStyle = row.isSelf ? C.text : C.muted;
    const statusW = 96;
    ctx.fillText(row.name, left + 34 + sw + 8, y, right - statusW - (left + 34 + sw + 8) - 8);
    ctx.font = `500 14px ${MONO}`; ctx.textAlign = "right";
    ctx.fillStyle = row.done ? C.text : C.muted;
    ctx.fillText(row.status, right, y);
  });

  let y = top + Math.max(1, rows.length) * rowH + 12;
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  ctx.fillStyle = C.ramp; ctx.font = `600 15px ${SANS}`;
  ctx.fillText(r.nextText, w / 2, y);
  if (r.hostHint) {
    y += 22;
    ctx.fillStyle = C.muted; ctx.font = `500 13px ${SANS}`;
    ctx.fillText(r.hostHint, w / 2, y);
  }
}

/** Connected-players rank (1..15) on the left side. */
function drawRank(ctx: CanvasRenderingContext2D, pad: number, sc: Scene) {
  if (sc.rank.length === 0) return;
  const x = pad;
  const top = pad + 86;
  const rowH = 22;
  const sw = 11; // color swatch size

  ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.font = `600 12px ${SANS}`; ctx.fillStyle = C.muted;
  ctx.fillText(`PLAYERS ${sc.rank.length}/15`, x, top - 14);

  ctx.font = `500 13px ${SANS}`;
  sc.rank.forEach((row, i) => {
    const y = top + i * rowH + rowH / 2;
    ctx.fillStyle = C.muted; ctx.textAlign = "right";
    ctx.fillText(`${i + 1}`, x + 14, y);
    ctx.fillStyle = row.color;
    ctx.fillRect(x + 20, y - sw / 2, sw, sw);
    ctx.textAlign = "left";
    ctx.fillStyle = row.isSelf ? C.text : C.muted;
    const lapTxt = row.waiting ? "—" : row.finished ? "fin" : `L${row.lap}`;
    const name = row.name.length > 10 ? row.name.slice(0, 10) + "…" : row.name;
    ctx.fillText(`${name}  ${lapTxt}`, x + 20 + sw + 8, y);
  });
}

/** Shared lap-time leaderboard (best times), top-right under the splits. */
function drawLeaderboard(ctx: CanvasRenderingContext2D, w: number, pad: number, sc: Scene) {
  if (sc.leaderboard.length === 0) return;
  const x = w - pad;
  const top = pad + 32 + Math.max(sc.splits.length, 0) * 20 + 26;
  const rowH = 20;
  const sw = 10;

  ctx.textAlign = "right"; ctx.textBaseline = "middle";
  ctx.font = `600 12px ${SANS}`; ctx.fillStyle = C.muted;
  ctx.fillText("BEST TIMES", x, top - 14);

  ctx.font = `500 13px ${MONO}`;
  sc.leaderboard.slice(0, 8).forEach((row, i) => {
    const y = top + i * rowH + rowH / 2;
    ctx.textAlign = "right";
    ctx.fillStyle = row.isSelf ? C.text : C.muted;
    ctx.fillText(row.timeText, x, y);
    const name = row.name.length > 8 ? row.name.slice(0, 8) + "…" : row.name;
    const tw = ctx.measureText(row.timeText).width;
    ctx.fillText(name, x - tw - 10, y);
    // color swatch to the left of the name
    const nw = ctx.measureText(name).width;
    ctx.fillStyle = row.color;
    ctx.fillRect(x - tw - 10 - nw - 8 - sw, y - sw / 2, sw, sw);
  });
}
