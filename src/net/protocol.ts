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

import { SIM_VERSION } from "../sim";

export const PROTOCOL_VERSION = 1;

/** A player id is the PeerJS connection id of a client (or "host" for the owner). */
export type PlayerId = string;

export interface PlayerInfo {
  id: PlayerId;
  name: string;
  color: string; // one of PALETTE
  isHost: boolean;
}

/** One entry of the shared lap-time leaderboard (host-verified ticks). */
export interface LeaderEntry {
  id: PlayerId;
  name: string;
  color: string;
  ticks: number; // total race time in ticks (lower is better)
}

// ── Client → Host ──────────────────────────────────────────────

/** First message a client sends after the data channel opens. */
export interface HelloMsg {
  t: "hello";
  protocol: number;
  sim: number; // SIM_VERSION — must match the host's
  name: string;
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
}

/** Client restarted its race (new countdown). */
export interface ResetMsg {
  t: "reset";
}

// ── Host → Client ──────────────────────────────────────────────

/** Host accepts the client, assigns color, and sends the current roster. */
export interface WelcomeMsg {
  t: "welcome";
  you: PlayerInfo;
  players: PlayerInfo[];
  leaderboard: LeaderEntry[];
}

/** Host rejects the client (room full or version mismatch). */
export interface RejectMsg {
  t: "reject";
  reason: "full" | "version" | "closed";
  detail?: string;
}

/** Roster changed (someone joined or left). */
export interface RosterMsg {
  t: "roster";
  players: PlayerInfo[];
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

export type ClientMsg = HelloMsg | InputMsg | FinishMsg | ResetMsg;
export type HostMsg =
  | WelcomeMsg
  | RejectMsg
  | RosterMsg
  | RelayInputMsg
  | RelayResetMsg
  | LeaderboardMsg;
export type NetMsg = ClientMsg | HostMsg;

/** 15 visually distinct car colors (max connections = 15). */
export const PALETTE: string[] = [
  "#e5412d", // red (classic single-player color)
  "#3da5ff", // blue
  "#45d483", // green
  "#ffd23d", // yellow
  "#c86bff", // purple
  "#ff8a3d", // orange
  "#2ee6d6", // teal
  "#ff5fa2", // pink
  "#9be34a", // lime
  "#6c7bff", // indigo
  "#ffac5f", // amber
  "#5fd0ff", // sky
  "#d98cff", // violet
  "#8fe0b8", // mint
  "#f0f0f0", // white
];

export const MAX_PLAYERS = PALETTE.length; // 15

/** PeerJS id namespace for room codes → avoids collisions on the public broker. */
export const ROOM_PREFIX = "snowgo-room-";

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
