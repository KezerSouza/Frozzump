// ─────────────────────────────────────────────────────────────
// P2P wire protocol (WebRTC DataChannel, via PeerJS).
//
// Topology: STAR. One peer is the HOST (room owner); every other peer
// is a CLIENT connected only to the host. The host is the authority for
// presence, color assignment, live rank and the lap-time leaderboard.
//
// The game is deterministic (see src/sim). We therefore send INPUT
// STREAMS (1 byte/tick), not poses: each peer re-runs step() locally for
// every other car. Traffic is tiny.
// ─────────────────────────────────────────────────────────────

import { DEFAULT_TRACK_ID, OVAL_1, SIM_VERSION, trackHash } from "../sim";

export const PROTOCOL_VERSION = 4;

/** Max nickname length (enforced by the lobby input and again by the host). */
export const MAX_NAME_LEN = 25;

/** A player id is the PeerJS connection id of a client (or "host" for the owner). */
export type PlayerId = string;

/** Car models a player can drive. Purely visual: every model has the same collision circle. */
export const CAR_MODELS = ["normal", "snowmobile", "bobsled"] as const;
export type CarModel = (typeof CAR_MODELS)[number];
export const DEFAULT_CAR: CarModel = "normal";

export function isCarModel(v: unknown): v is CarModel {
  return typeof v === "string" && (CAR_MODELS as readonly string[]).includes(v);
}

/** What a player looks like. Colors are exclusive inside a room; car models are not. */
export interface Look {
  color?: string; // one of PALETTE
  car?: CarModel;
}

export interface PlayerInfo {
  id: PlayerId;
  name: string;
  color: string; // one of PALETTE, never shared by two players of the same room
  car: CarModel;
  isHost: boolean;
}

/** One entry of the shared race-time leaderboard (host-verified). */
export interface LeaderEntry {
  id: PlayerId;
  name: string;
  color: string;
  time: number; // total race time in subticks = verifyReplay().finishSubticks (lower is better)
}

// ── Game modes (host-authoritative) ────────────────────────────

/**
 * "free": everyone races on their own and chases each other's best time.
 * "race": everyone starts together for a 5-lap race; positions are shown and
 *         the next round starts 20 s after the first finisher (or when the host
 *         restarts it).
 */
export type GameMode = "free" | "race";

/** One verified finisher of the current race round. */
export interface RoundResult {
  id: PlayerId;
  name: string;
  color: string;
  time: number; // race time in subticks (lower is better)
}

export interface GameState {
  mode: GameMode;
  round: number; // increments at every race start (never reset while the room lives)
  participants: PlayerId[]; // who started this round (late joiners wait for the next one)
  results: RoundResult[]; // finishers, sorted by race time
  nextInMs: number | null; // ms until the next round; null while nobody has finished
  track: string; //           id of the track everybody races on (chosen by the host)
  trackHash: number; //       fingerprint of that track: a client with a different drawing refuses to join
}

export const FREE_GAME: GameState = {
  mode: "free", round: 0, participants: [], results: [], nextInMs: null,
  track: DEFAULT_TRACK_ID, trackHash: trackHash(OVAL_1),
};

// ── Client → Host ──────────────────────────────────────────────

/** First message a client sends after the data channel opens. */
export interface HelloMsg {
  t: "hello";
  protocol: number;
  sim: number; // SIM_VERSION — must match the host's
  name: string;
  /** Preferred look: the host grants the color if nobody else has it, otherwise picks a free one. */
  color?: string;
  car?: CarModel;
}

/** Client asks to change its car model and/or color (a taken color is ignored by the host). */
export interface LookMsg {
  t: "look";
  color?: string;
  car?: CarModel;
}

/** A batch of input ticks produced by this client since the last batch. */
export interface InputMsg {
  t: "input";
  startTick: number; // tick index of the first byte in `masks`
  masks: number[]; // one input bitmask per tick
}

/** Client reached the finish line; sends its replay for host verification. */
export interface FinishMsg {
  t: "finish";
  replay: string; // base64 RLE replay (see src/sim/replay.ts)
  round: number; // race round this run belongs to (0 in free mode)
}

/** Client restarted its race (new countdown). */
export interface ResetMsg {
  t: "reset";
}

/** Keep-alive so the host can detect a browser that closed/crashed abruptly. */
export interface PingMsg {
  t: "ping";
}

/** Explicit, clean "I'm leaving" (sent on tab close via beforeunload). */
export interface ByeMsg {
  t: "bye";
}

// ── Host → Client ──────────────────────────────────────────────

/** Host accepts the client, assigns color, and sends the current roster. */
export interface WelcomeMsg {
  t: "welcome";
  you: PlayerInfo;
  players: PlayerInfo[];
  leaderboard: LeaderEntry[];
  game: GameState;
}

/** Host rejects the client (room full or version mismatch). */
export interface RejectMsg {
  t: "reject";
  reason: "full" | "version" | "closed";
  detail?: string;
}

/** Roster changed (someone joined, left, or changed car / color). */
export interface RosterMsg {
  t: "roster";
  players: PlayerInfo[];
}

/** Host → clients keep-alive, and a signal the room is still alive. */
export interface HostPingMsg {
  t: "hping";
}

/** Host is shutting down the room (host closed the tab). */
export interface RoomClosedMsg {
  t: "closed";
}

/** A player's input batch, relayed by the host to everyone else. */
export interface RelayInputMsg {
  t: "rinput";
  id: PlayerId;
  startTick: number;
  masks: number[];
}

/** A player reset (relayed), so others can clear that car. */
export interface RelayResetMsg {
  t: "rreset";
  id: PlayerId;
}

/** Updated, sorted lap-time leaderboard (host is the source of truth). */
export interface LeaderboardMsg {
  t: "leaderboard";
  leaderboard: LeaderEntry[];
}

/** Game mode / race round changed (host is the source of truth). */
export interface GameMsg {
  t: "game";
  game: GameState;
}

export type ClientMsg = HelloMsg | LookMsg | InputMsg | FinishMsg | ResetMsg | PingMsg | ByeMsg;
export type HostMsg =
  | WelcomeMsg
  | RejectMsg
  | RosterMsg
  | RelayInputMsg
  | RelayResetMsg
  | LeaderboardMsg
  | GameMsg
  | HostPingMsg
  | RoomClosedMsg;
export type NetMsg = ClientMsg | HostMsg;

/** Heartbeat interval and the timeout after which a silent peer is dropped. */
export const HEARTBEAT_MS = 2000;
export const PEER_TIMEOUT_MS = 6000; // ~3 missed heartbeats

/** 15 visually distinct car colors (max connections = 15). */
// No light blues (the personal ghost used to be light blue; kept so the palette stays the same).
export const PALETTE: string[] = [
  "#e5412d", // red (classic single-player color)
  "#45d483", // green
  "#ffd23d", // yellow
  "#c86bff", // purple
  "#ff8a3d", // orange
  "#ff5fa2", // pink
  "#9be34a", // lime
  "#8b5a2b", // brown
  "#6c7bff", // indigo
  "#ffac5f", // amber
  "#3a4250", // graphite
  "#d98cff", // violet
  "#8fe0b8", // mint
  "#f0f0f0", // white
  "#2ee6d6", // teal
];

export const MAX_PLAYERS = PALETTE.length; // 15

/** PeerJS id namespace for room codes → avoids collisions on the public broker. */
export const ROOM_PREFIX = "frozzump-room-";

/** Human-friendly room code (what the user types) → full PeerJS id. */
export function codeToPeerId(code: string): string {
  return ROOM_PREFIX + code.trim().toUpperCase();
}

/** Generate a short, unambiguous room code (no 0/O/1/I). */
export function makeRoomCode(len = 4): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < len; i++) {
    s += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return s;
}

/** Sanity-check a decoded message is one of ours. */
export function isNetMsg(v: unknown): v is NetMsg {
  return !!v && typeof v === "object" && typeof (v as { t?: unknown }).t === "string";
}

export const LOCAL_SIM_VERSION = SIM_VERSION;
