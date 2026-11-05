import {
  DT, OVAL_1, SIM_VERSION, TICK_RATE, TOTAL_LAPS,
  createState, decodeReplay, encodeReplay, fromBase64, step, toBase64, type CarState,
} from "../sim";
import { Room, type RemoteInputBatch } from "../net/room";
import type { LeaderEntry, PlayerInfo } from "../net/protocol";
import { Keys } from "./input";
import { mountLobby, type LobbyHandle } from "./net-ui";
import { draw, type LeaderRow, type Particle, type Pose, type RankRow, type RemoteCar, type Scene } from "./render";

const track = OVAL_1;
const BEST_KEY = `snowgo:best:${track.id}:v${SIM_VERSION}`; // the physics version is part of the key
const GHOST_KEY = "snowgo:ghost-on";
const OTHERS_KEY = "snowgo:others-on";

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
let othersOn = localStorage.getItem(OTHERS_KEY) !== "0";
let acc = 0;
let last = performance.now();

// ── Multiplayer state ────────────────────────────────────────
let room: Room | null = null;
let self: PlayerInfo | null = null;
let roster: PlayerInfo[] = [];
let leaderboard: LeaderEntry[] = [];
let sentUpTo = 0; // how many of our input ticks we've already broadcast

/** A remote car we simulate locally by applying received input bytes. */
interface Remote {
  info: PlayerInfo;
  state: CarState;
  prev: Pose;
  queued: number[]; // inputs received but not yet applied (buffer)
}
const remotes = new Map<string, Remote>();

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
  sentUpTo = 0;
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
  // our own restart doesn't reset remote players; they run their own races
  room?.sendReset();
  phase = "countdown";
  countdownEnd = performance.now() + 3000;
}

function onFinish() {
  phase = "finished";
  const replay = toBase64(encodeReplay(inputs));
  if (!best || car.tick < best.ticks) {
    best = { ticks: car.tick, replay };
    localStorage.setItem(BEST_KEY, JSON.stringify(best));
    newRecord = true;
  }
  // submit to the shared leaderboard (host verifies via verifyReplay)
  room?.sendFinish(replay, car.tick);
}

keys.onRestart = reset;
keys.onToggleGhost = () => {
  ghostOn = !ghostOn;
  localStorage.setItem(GHOST_KEY, ghostOn ? "1" : "0");
};
keys.onToggleOthers = () => {
  othersOn = !othersOn;
  localStorage.setItem(OTHERS_KEY, othersOn ? "1" : "0");
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

// ── Remote car bookkeeping ───────────────────────────────────

function syncRemotes() {
  // add cars for every roster member except ourselves
  const selfId = self?.id;
  const live = new Set<string>();
  for (const p of roster) {
    if (p.id === selfId) continue;
    live.add(p.id);
    if (!remotes.has(p.id)) {
      const st = createState(track);
      remotes.set(p.id, { info: p, state: st, prev: pose(st), queued: [] });
    } else {
      remotes.get(p.id)!.info = p; // name/color may change
    }
  }
  // drop cars for players who left
  for (const id of [...remotes.keys()]) {
    if (!live.has(id)) remotes.delete(id);
  }
}

function onRemoteInput(b: RemoteInputBatch) {
  const r = remotes.get(b.id);
  if (!r) return;
  // Inputs are a contiguous per-tick stream. We buffer and apply them in
  // lock-step with our own sim loop (1 tick each). startTick lets us ignore
  // stale/duplicate batches.
  const already = r.state.tick + r.queued.length;
  for (let i = 0; i < b.masks.length; i++) {
    const tick = b.startTick + i;
    if (tick < already) continue; // duplicate
    r.queued.push(b.masks[i]);
  }
}

function onRemoteReset(id: string) {
  const r = remotes.get(id);
  if (!r) return;
  const st = createState(track);
  r.state = st;
  r.prev = pose(st);
  r.queued = [];
}

function advanceRemotes() {
  for (const r of remotes.values()) {
    r.prev = pose(r.state);
    if (r.queued.length > 0 && !r.state.finished) {
      step(r.state, track, r.queued.shift()!);
    }
    // if starved of inputs, the car simply holds position (no extrapolation)
  }
}

// ── Rank + leaderboard views ─────────────────────────────────

function buildRank(): RankRow[] {
  const rows: { row: RankRow; key: number }[] = [];
  const selfId = self?.id;
  const push = (info: PlayerInfo, s: CarState, isSelf: boolean) => {
    // progress key: laps dominate, then gate index — higher is further ahead
    const key = s.finished ? 1e9 + (1e9 - s.tick) : s.laps * 100 + s.nextGate;
    rows.push({
      key,
      row: {
        name: info.name,
        color: info.color,
        lap: Math.min(s.laps + 1, TOTAL_LAPS),
        isSelf,
        finished: s.finished,
      },
    });
  };
  if (self) push(self, car, true);
  else push({ id: "me", name: "Você", color: "#e5412d", isHost: false }, car, true);
  for (const r of remotes.values()) push(r.info, r.state, r.info.id === selfId);
  rows.sort((a, b) => b.key - a.key);
  return rows.map((r) => r.row);
}

function buildLeaderboard(): LeaderRow[] {
  const selfId = self?.id;
  return leaderboard.map((e) => ({
    name: e.name,
    color: e.color,
    timeText: fmt(e.ticks),
    isSelf: e.id === selfId,
  }));
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
      advanceRemotes();
      acc -= DT;
      if (car.finished) onFinish();
    }
    spawnSnow(car);
    // broadcast newly produced input ticks in a batch
    if (room && inputs.length > sentUpTo) {
      room.sendInput(sentUpTo, inputs.slice(sentUpTo));
      sentUpTo = inputs.length;
    }
  } else {
    // keep remote cars moving even while we're in countdown/finished
    advanceRemotes();
  }

  for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
  particles = particles.filter((p) => p.life > 0);

  const alpha = phase === "racing" ? acc / DT : 1;
  const cur = phase === "racing" ? lerpPose(prev, pose(car), alpha) : pose(car);
  const g = ghost && prevGhost ? (phase === "racing" ? lerpPose(prevGhost, pose(ghost), alpha) : pose(ghost)) : null;

  const remoteCars: RemoteCar[] = [];
  for (const r of remotes.values()) {
    remoteCars.push({
      id: r.info.id,
      name: r.info.name,
      color: r.info.color,
      pose: lerpPose(r.prev, pose(r.state), alpha),
      air: r.state.airTicks,
    });
  }

  const secondsLeft = Math.ceil((countdownEnd - now) / 1000);
  const scene: Scene = {
    track, car: cur, state: car, ghost: g, particles, phase,
    countdownText: phase === "countdown" ? String(Math.max(1, secondsLeft)) : "",
    timeText: fmt(car.tick),
    bestText: best ? fmt(best.ticks) : "—",
    splits: car.lapTicks.map((t, i, a) => fmt(t - (a[i - 1] ?? 0))),
    newRecord, ghostOn,
    selfColor: self?.color ?? "#e5412d",
    othersOn,
    remotes: remoteCars,
    rank: room ? buildRank() : [],
    leaderboard: buildLeaderboard(),
    roomCode: room?.code ?? null,
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

// ── Lobby / connection wiring ────────────────────────────────

let lobby: LobbyHandle;

function connect(mode: "host" | "join", code: string, name: string) {
  const events = {
    onSelf: (info: PlayerInfo) => { self = info; },
    onRoster: (players: PlayerInfo[]) => { roster = players; syncRemotes(); },
    onLeaderboard: (entries: LeaderEntry[]) => { leaderboard = entries; },
    onRemoteInput,
    onRemoteReset,
    onRemoteLeave: (id: string) => { remotes.delete(id); },
    onError: (msg: string) => lobby.showError(msg),
    onStatus: (status: string) => {
      if (status === "open") {
        lobby.close();
        reset(); // fresh race once connected
      } else if (status === "closed" || status === "error") {
        room = null;
        self = null;
        roster = [];
        leaderboard = [];
        remotes.clear(); // drop every opponent car when the room ends
        lobby.reopen();
      }
    },
  };
  room = mode === "host" ? Room.host(code, name, events) : Room.join(code, name, events);
}

// Leave the room cleanly when the tab is closed/refreshed, so other players
// drop our car immediately instead of seeing a frozen shadow.
function leaveOnExit() {
  room?.leave();
}
window.addEventListener("beforeunload", leaveOnExit);
window.addEventListener("pagehide", leaveOnExit);

lobby = mountLobby(({ mode, code, name }) => connect(mode, code, name));

reset();
requestAnimationFrame(frame);
