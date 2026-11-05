import {
  DT, OVAL_1, SIM_VERSION, SUBTICKS_PER_TICK, TICK_RATE, TOTAL_LAPS,
  createState, decodeReplay, encodeReplay, fromBase64, step, toBase64, type CarState,
} from "../sim";
import { Room, type RemoteInputBatch } from "../net/room";
import { FREE_GAME, type GameMode, type GameState, type LeaderEntry, type PlayerInfo } from "../net/protocol";
import { Keys } from "./input";
import { advanceRemote, pose } from "./remote";
import { mountLobby, mountRoomBar, type LobbyHandle } from "./net-ui";
import {
  draw, type LeaderRow, type Particle, type Pose, type RaceRow, type RaceView, type RankRow, type RemoteCar, type Scene,
} from "./render";

const track = OVAL_1;
const BEST_KEY = `snowgo:best:${track.id}:v${SIM_VERSION}`; // the physics version is part of the key
const GHOST_KEY = "snowgo:ghost-on";
const OTHERS_KEY = "snowgo:others-on";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const keys = new Keys();

type Phase = "countdown" | "racing" | "finished" | "waiting"; // waiting = race mode, joined mid-round
interface Best { time: number; replay: string } // time in subticks (= finishSubticks)

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
let acc = 0; // our own sim: wall-clock time not yet turned into ticks
let remoteAcc = 0; // same for the remote cars (they run on wall-clock time too, independent of our phase)
let last = performance.now();
// Tab in the background: rAF is paused there, so the sim is driven by a Worker ticker instead and
// our car drives with no input (see pump / startBackgroundTicker).
let away = document.hidden;
/** Longest stretch of wall-clock time simulated in one go (a laptop that slept, a debugger pause). */
const MAX_CATCHUP_S = 600;
/** Max input ticks per network message when flushing a long catch-up. */
const SEND_CHUNK = 1200;

// ── Multiplayer state ────────────────────────────────────────
let room: Room | null = null;
let self: PlayerInfo | null = null;
let roster: PlayerInfo[] = [];
let leaderboard: LeaderEntry[] = [];
let sentUpTo = 0; // how many of our input ticks we've already broadcast
let game: GameState = FREE_GAME; // host-authoritative mode / race round
let localRound = 0; // last race round we reacted to
let nextDeadline: number | null = null; // performance.now() at which the next race round starts
let leaving = false; // voluntary "Sair": don't reopen the lobby when the room closes

const inRace = () => room !== null && game.mode === "race";

/** A remote car we simulate locally by applying received input bytes. */
interface Remote {
  info: PlayerInfo;
  state: CarState;
  prev: Pose;
  queued: number[]; // inputs received but not yet applied (buffer)
  // false until we see this player's race from tick 0 (we joined mid-race):
  // applying a partial input stream from the start line would draw a wrong shadow
  synced: boolean;
}
const remotes = new Map<string, Remote>();

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
/** Display only (may round): subticks -> whole milliseconds */
function subticksToMs(sub: number): number {
  return Math.round((sub * 1000) / (TICK_RATE * SUBTICKS_PER_TICK));
}
function fmtMs(ms: number): string {
  const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000), r = ms % 1000;
  return `${m}:${String(s).padStart(2, "0")}.${String(r).padStart(3, "0")}`;
}
function fmtSubticks(sub: number): string {
  return fmtMs(subticksToMs(sub));
}
/** Splits = differences of the ROUNDED cumulative times, so the displayed splits add up to the displayed total. */
function fmtSplits(lapSubticks: number[]): string[] {
  return lapSubticks.map((t, i, a) => fmtMs(subticksToMs(t) - subticksToMs(a[i - 1] ?? 0)));
}

/** Restart our own race. `waiting` = race mode, sit at the start until the next round. */
function reset(next: "countdown" | "waiting" = "countdown") {
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
  phase = next;
  countdownEnd = performance.now() + 3000;
}

function onFinish() {
  phase = "finished";
  const replay = toBase64(encodeReplay(inputs));
  if (!best || car.finishSubticks < best.time) {
    best = { time: car.finishSubticks, replay };
    localStorage.setItem(BEST_KEY, JSON.stringify(best));
    newRecord = true;
  }
  // submit to the shared leaderboard (host verifies via verifyReplay); in race
  // mode the round number lets the host place us in this round's standings
  room?.sendFinish(replay, car.finishSubticks, inRace() ? localRound : 0);
}

keys.onRestart = () => {
  if (inRace()) {
    // races restart for everyone together; only the host can skip the wait
    if (room?.isHost && game.results.length > 0) room.restartRound();
    return;
  }
  reset();
};
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
      remotes.set(p.id, { info: p, state: st, prev: pose(st), queued: [], synced: false });
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
  if (!r.synced) {
    if (b.startTick !== 0) return; // mid-race stream: wait for their next reset
    r.synced = true;
  }
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
  r.synced = true; // their next input batch starts at tick 0
}

/** Mode / race round update from the host. */
function onGame(g: GameState) {
  const prevMode = game.mode;
  game = g;
  nextDeadline = g.nextInMs !== null ? performance.now() + g.nextInMs : null;
  if (g.mode === "free") {
    if (prevMode === "race") reset(); // back to free play: everyone restarts on their own
    return;
  }
  if (g.round !== localRound) {
    localRound = g.round;
    const racing = !!self && g.participants.includes(self.id);
    reset(racing ? "countdown" : "waiting");
  }
}

function isParticipant(id: string): boolean {
  return game.participants.includes(id);
}

function advanceRemotes() {
  for (const r of remotes.values()) advanceRemote(r, track);
}

// ── Rank + leaderboard views ─────────────────────────────────

function buildRank(): RankRow[] {
  const rows: { row: RankRow; key: number }[] = [];
  const selfId = self?.id;
  const push = (info: PlayerInfo, s: CarState, isSelf: boolean) => {
    // progress key: laps dominate, then gate index — higher is further ahead
    // finished cars rank above everyone, ordered by exact race time (subticks)
    const waiting = inRace() && !isParticipant(info.id);
    const key = waiting ? -1 : progressKey(s);
    rows.push({
      key,
      row: {
        name: info.name,
        color: info.color,
        lap: Math.min(s.laps + 1, TOTAL_LAPS),
        isSelf,
        finished: s.finished,
        waiting,
      },
    });
  };
  if (self) push(self, car, true);
  else push({ id: "me", name: "Você", color: "#e5412d", isHost: false }, car, true);
  for (const r of remotes.values()) push(r.info, r.state, r.info.id === selfId);
  rows.sort((a, b) => b.key - a.key);
  return rows.map((r) => r.row);
}

/** Progress key: laps dominate, then gate index; finished cars first, by exact race time. */
function progressKey(s: CarState): number {
  return s.finished ? 1e15 - s.finishSubticks : s.laps * 100 + s.nextGate;
}

/** Race-mode standings: host-verified finishers, then the rest by live progress. */
function buildRaceView(now: number): RaceView | null {
  if (!room || game.mode !== "race") return null;
  const selfId = self?.id;
  const rows: RaceRow[] = game.results.map((r, i) => ({
    pos: i + 1, name: r.name, color: r.color, status: fmtSubticks(r.time), isSelf: r.id === selfId, done: true,
  }));
  const confirmed = new Set(game.results.map((r) => r.id));
  const pending: { row: RaceRow; key: number }[] = [];
  for (const id of game.participants) {
    if (confirmed.has(id)) continue;
    const isSelf = id === selfId;
    const remote = remotes.get(id);
    const info = isSelf ? self : remote?.info;
    const st = isSelf ? car : remote?.synced ? remote.state : null;
    if (!info) continue;
    pending.push({
      key: st ? progressKey(st) : -1,
      row: {
        pos: 0, name: info.name, color: info.color, isSelf, done: false,
        // finished locally but not yet confirmed by the host → show the time already
        status: !st ? "correndo…" : st.finished ? fmtSubticks(st.finishSubticks) : `volta ${Math.min(st.laps + 1, TOTAL_LAPS)}`,
      },
    });
  }
  pending.sort((a, b) => b.key - a.key);
  pending.forEach((p, i) => { p.row.pos = rows.length + i + 1; });
  rows.push(...pending.map((p) => p.row));

  let nextText = "Aguardando o 1º colocado terminar…";
  if (nextDeadline !== null) {
    const s = Math.ceil((nextDeadline - now) / 1000);
    nextText = s > 0 ? `Próxima corrida em ${s}s` : "Começando…";
  }
  const first = game.results[0];
  return {
    round: game.round,
    rows,
    nextText,
    hostHint: room.isHost && game.results.length > 0 ? "R ou “Reiniciar corrida” para começar agora" : null,
    banner: first && (phase === "racing" || phase === "countdown") ? `${first.name} terminou! ${nextText}` : null,
    showPanel: phase === "finished" || phase === "waiting",
    waiting: phase === "waiting",
  };
}

function buildLeaderboard(): LeaderRow[] {
  const selfId = self?.id;
  return leaderboard.map((e) => ({
    name: e.name,
    color: e.color,
    timeText: fmtSubticks(e.time),
    isSelf: e.id === selfId,
  }));
}

/**
 * Advances the whole simulation to wall-clock time `now`: our car, the ghost and every remote car.
 * Time is never lost: a frame that comes late (or a tab that was in the background) is simulated
 * in full, up to MAX_CATCHUP_S. Safe to call as often as you like (it only consumes elapsed time).
 * Returns the elapsed time in seconds.
 */
function pump(now: number): number {
  // a rAF timestamp can be slightly older than a performance.now() the ticker already consumed
  if (now < last) now = last;
  const dt = Math.min(MAX_CATCHUP_S, (now - last) / 1000);
  last = now;

  if (phase === "countdown" && now >= countdownEnd) {
    phase = "racing";
    acc = Math.min(MAX_CATCHUP_S, (now - countdownEnd) / 1000); // exact start, not "this frame"
  } else if (phase === "racing") {
    acc += dt;
  }

  if (phase === "racing") {
    while (acc >= DT && phase === "racing") {
      prev = pose(car);
      if (ghost) prevGhost = pose(ghost);

      // in the background we can't read the keyboard: drive with no input
      const mask = away ? 0 : keys.read();
      inputs.push(mask);
      if (ghost && ghostInputs && ghost.tick < ghostInputs.length) step(ghost, track, ghostInputs[ghost.tick]);
      step(car, track, mask);
      acc -= DT;
      if (car.finished) onFinish();
    }
    // broadcast newly produced input ticks in a batch (chunked: a long catch-up can be thousands of ticks)
    while (room && inputs.length > sentUpTo) {
      const end = Math.min(inputs.length, sentUpTo + SEND_CHUNK);
      room.sendInput(sentUpTo, inputs.slice(sentUpTo, end));
      sentUpTo = end;
    }
  }

  // remote cars advance on wall-clock time, whatever phase we are in
  remoteAcc += dt;
  while (remoteAcc >= DT) {
    advanceRemotes();
    remoteAcc -= DT;
  }
  return dt;
}

function frame(now: number) {
  const dt = Math.min(0.1, pump(now)); // (the clamp is only for the cosmetic particles below)

  if (phase === "racing") spawnSnow(car);

  for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
  particles = particles.filter((p) => p.life > 0);

  const alpha = phase === "racing" ? acc / DT : 1;
  const cur = phase === "racing" ? lerpPose(prev, pose(car), alpha) : pose(car);
  const g = ghost && prevGhost ? (phase === "racing" ? lerpPose(prevGhost, pose(ghost), alpha) : pose(ghost)) : null;

  const remoteAlpha = remoteAcc / DT;
  const remoteCars: RemoteCar[] = [];
  for (const r of remotes.values()) {
    // only draw shadows we can simulate correctly; in a race, only this round's racers
    if (!r.synced || (inRace() && !isParticipant(r.info.id))) continue;
    remoteCars.push({
      id: r.info.id,
      name: r.info.name,
      color: r.info.color,
      pose: lerpPose(r.prev, pose(r.state), remoteAlpha),
      air: r.state.airTicks,
    });
  }

  const race = inRace();
  const secondsLeft = Math.ceil((countdownEnd - now) / 1000);
  const scene: Scene = {
    // the personal ghost belongs to solo / free play, not to synchronized races
    track, car: cur, state: car, ghost: race ? null : g, particles, phase,
    countdownText: phase === "countdown" ? String(Math.max(1, secondsLeft)) : "",
    timeText: fmtSubticks(car.finished ? car.finishSubticks : car.tick * SUBTICKS_PER_TICK),
    bestText: best ? fmtSubticks(best.time) : "—",
    splits: fmtSplits(car.lapSubticks),
    newRecord, ghostOn,
    selfColor: self?.color ?? "#e5412d",
    othersOn,
    remotes: remoteCars,
    rank: room ? buildRank() : [],
    leaderboard: buildLeaderboard(),
    roomCode: room?.code ?? null,
    selfName: room && self ? self.name : null,
    modeText: room ? (race ? `corrida ${game.round}` : "modo livre") : null,
    restartKey: !race || (!!room?.isHost && game.results.length > 0),
    race: buildRaceView(now),
  };
  roomBar.update({
    inRoom: !!room && !!self,
    code: room?.code ?? "",
    isHost: !!room?.isHost,
    mode: game.mode,
    canRestart: race && game.results.length > 0,
  });

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
  if (room) leaveRoom(); // never keep two rooms (e.g. retry while still connecting)
  const ref: { room: Room | null } = { room: null };
  const events = roomEvents(ref);
  ref.room = mode === "host" ? Room.host(code, name, events) : Room.join(code, name, events);
  room = ref.room;
}

function roomEvents(ref: { room: Room | null }) {
  // events from a room that is no longer the current one are ignored
  const live = () => ref.room !== null && room === ref.room;
  return {
    onSelf: (info: PlayerInfo) => { if (live()) self = info; },
    onRoster: (players: PlayerInfo[]) => { if (live()) { roster = players; syncRemotes(); } },
    onLeaderboard: (entries: LeaderEntry[]) => { if (live()) leaderboard = entries; },
    onGame: (g: GameState) => { if (live()) onGame(g); },
    onRemoteInput: (b: RemoteInputBatch) => { if (live()) onRemoteInput(b); },
    onRemoteReset: (id: string) => { if (live()) onRemoteReset(id); },
    onRemoteLeave: (id: string) => { if (live()) remotes.delete(id); },
    onError: (msg: string) => lobby.showError(msg),
    onStatus: (status: string) => {
      if (!live()) return;
      if (status === "open") {
        lobby.close();
        reset(); // fresh race once connected (race mode may switch us to "waiting" right after)
      } else if (status === "closed" || status === "error") {
        const r = ref.room!;
        room = null;
        self = null;
        roster = [];
        leaderboard = [];
        game = FREE_GAME;
        localRound = 0;
        nextDeadline = null;
        remotes.clear(); // drop every opponent car when the room ends
        r.destroy(); // release the PeerJS peer (re-emits "closed", ignored: no longer live)
        reset(); // back to solo
        if (!leaving) lobby.reopen(); // show why we dropped (host left, room not found, …)
      }
    },
  };
}

/** Voluntary exit ("Sair" / "Voltar ao solo" while connecting): back to solo, lobby stays closed. */
function leaveRoom() {
  if (!room) return;
  leaving = true;
  try {
    room.leave(); // destroy() → onStatus("closed") → state cleared synchronously
  } finally {
    leaving = false;
  }
}

function setMode(mode: GameMode) {
  room?.setMode(mode);
}

// ── Background tabs ──────────────────────────────────────────
// Browsers stop requestAnimationFrame in a hidden tab, which used to freeze our car for everyone
// else (we stopped producing/sending ticks) and froze the world for us. Now the sim is driven by
// wall-clock time and, while hidden, a ticker keeps it (and the input stream we send) running.

document.addEventListener("visibilitychange", () => {
  if (document.hidden === away) return;
  // Settle the time up to this instant under the OLD mode, so the gap is simulated as "away"
  // (no input) when we come back, and as "present" (keys) when we leave.
  pump(performance.now());
  away = document.hidden;
});

/**
 * Wakes pump() while the tab is hidden. Main-thread timers are throttled to ~1 Hz there, but timers
 * in a dedicated Worker are not, so the Worker only posts a "tick" message. No game logic runs in it.
 */
function startBackgroundTicker() {
  const wake = () => { if (away) pump(performance.now()); };
  const fallback = () => setInterval(wake, 1000); // still correct (time is caught up), just bursty
  try {
    const url = URL.createObjectURL(new Blob(["setInterval(() => postMessage(0), 50);"], { type: "text/javascript" }));
    const w = new Worker(url);
    w.onmessage = wake;
    w.onerror = () => { w.terminate(); fallback(); };
  } catch {
    fallback();
  }
}
startBackgroundTicker();

// Leave the room cleanly when the tab is closed/refreshed, so other players
// drop our car immediately instead of seeing a frozen shadow.
function leaveOnExit() {
  room?.leave();
}
window.addEventListener("beforeunload", leaveOnExit);
window.addEventListener("pagehide", leaveOnExit);

lobby = mountLobby(
  ({ mode, code, name }) => connect(mode, code, name),
  () => { leaveRoom(); lobby.close(); }, // "Voltar ao solo" (also cancels a pending connection)
);
const roomBar = mountRoomBar({
  onMultiplayer: () => lobby.reopen(),
  onLeave: leaveRoom,
  onMode: setMode,
  onRestart: () => room?.restartRound(),
});
keys.onOpenLobby = () => { if (!room) lobby.reopen(); };

reset();
requestAnimationFrame(frame);
