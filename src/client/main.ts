import {
  DT, OVAL_1, SIM_VERSION, TICK_RATE,
  createState, decodeReplay, encodeReplay, fromBase64, step, toBase64, type CarState,
} from "../sim";
import { Keys } from "./input";
import { draw, type Particle, type Pose, type Scene } from "./render";

const track = OVAL_1;
const BEST_KEY = `snowgo:best:${track.id}:v${SIM_VERSION}`; // the physics version is part of the key
const GHOST_KEY = "snowgo:ghost-on";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const keys = new Keys();

type Phase = "countdown" | "racing" | "finished";
interface Best { ticks: number; replay: string }

let phase: Phase = "countdown";
let countdownEnd = 0;
let car: CarState = createState(track);
let ghost: CarState | null = null;
let ghostInputs: Uint8Array | null = null;
let prev: Pose = pose(car);
let prevGhost: Pose | null = null;
let inputs: number[] = [];
let particles: Particle[] = [];
let best: Best | null = loadBest();
let newRecord = false;
let ghostOn = localStorage.getItem(GHOST_KEY) !== "0";
let acc = 0;
let last = performance.now();

function pose(s: CarState): Pose {
  return { x: s.x, y: s.y, hx: s.hx, hy: s.hy };
}
function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const hx = a.hx + (b.hx - a.hx) * t, hy = a.hy + (b.hy - a.hy) * t;
  const n = Math.hypot(hx, hy) || 1;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, hx: hx / n, hy: hy / n };
}
function loadBest(): Best | null {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    return raw ? (JSON.parse(raw) as Best) : null;
  } catch {
    return null;
  }
}
function fmt(ticks: number): string {
  const ms = Math.round((ticks * 1000) / TICK_RATE);
  const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000), r = ms % 1000;
  return `${m}:${String(s).padStart(2, "0")}.${String(r).padStart(3, "0")}`;
}

function reset() {
  car = createState(track);
  prev = pose(car);
  inputs = [];
  particles = [];
  newRecord = false;
  acc = 0;
  best = loadBest();
  ghost = null; ghostInputs = null; prevGhost = null;
  if (best) {
    ghostInputs = decodeReplay(fromBase64(best.replay));
    ghost = createState(track);
    prevGhost = pose(ghost);
  }
  phase = "countdown";
  countdownEnd = performance.now() + 3000;
}

function onFinish() {
  phase = "finished";
  if (!best || car.tick < best.ticks) {
    best = { ticks: car.tick, replay: toBase64(encodeReplay(inputs)) };
    localStorage.setItem(BEST_KEY, JSON.stringify(best));
    newRecord = true;
  }
}

keys.onRestart = reset;
keys.onToggleGhost = () => {
  ghostOn = !ghostOn;
  localStorage.setItem(GHOST_KEY, ghostOn ? "1" : "0");
};

function spawnSnow(s: CarState) {
  const speed = Math.hypot(s.vx, s.vy);
  if (speed < 2 || particles.length > 220) return;
  const n = 1 + (speed > 9 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    particles.push({
      x: s.x - s.hx * 0.85, y: s.y - s.hy * 0.85,
      vx: -s.vx * 0.15 + (Math.random() - 0.5) * 1.6, vy: -s.vy * 0.15 + (Math.random() - 0.5) * 1.6,
      life: 0.5, max: 0.5, size: 0.06 + Math.random() * 0.09,
    });
  }
}

function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (phase === "countdown" && now >= countdownEnd) phase = "racing";

  if (phase === "racing") {
    acc += dt;
    while (acc >= DT && phase === "racing") {
      prev = pose(car);
      if (ghost) prevGhost = pose(ghost);

      const mask = keys.read();
      inputs.push(mask);
      if (ghost && ghostInputs && ghost.tick < ghostInputs.length) step(ghost, track, ghostInputs[ghost.tick]);
      step(car, track, mask);
      acc -= DT;
      if (car.finished) onFinish();
    }
    spawnSnow(car);
  }

  for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
  particles = particles.filter((p) => p.life > 0);

  const alpha = phase === "racing" ? acc / DT : 1;
  const cur = phase === "racing" ? lerpPose(prev, pose(car), alpha) : pose(car);
  const g = ghost && prevGhost ? (phase === "racing" ? lerpPose(prevGhost, pose(ghost), alpha) : pose(ghost)) : null;

  const secondsLeft = Math.ceil((countdownEnd - now) / 1000);
  const scene: Scene = {
    track, car: cur, state: car, ghost: g, particles, phase,
    countdownText: phase === "countdown" ? String(Math.max(1, secondsLeft)) : "",
    timeText: fmt(car.tick),
    bestText: best ? fmt(best.ticks) : "—",
    splits: car.lapTicks.map((t, i, a) => fmt(t - (a[i - 1] ?? 0))),
    newRecord, ghostOn,
  };

  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth, h = window.innerHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  draw(ctx, w, h, dpr, scene);
  requestAnimationFrame(frame);
}

reset();
requestAnimationFrame(frame);
