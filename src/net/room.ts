// ─────────────────────────────────────────────────────────────
// Room networking (PeerJS / WebRTC star topology).
//
// `Room` is the single API the client talks to. It hides whether this
// peer is the host or a client:
//   - Room.host(code, name)   → become the room owner
//   - Room.join(code, name)   → connect to an existing room
//
// The host owns presence, color assignment and the lap-time leaderboard.
// Everything travels over RTCDataChannels; the PeerJS public broker is
// only used for the initial signaling handshake.
// ─────────────────────────────────────────────────────────────

import { Peer, type DataConnection } from "peerjs";
import { TOTAL_LAPS, fromBase64, decodeReplay, verifyReplay, OVAL_1 } from "../sim";
import {
  LOCAL_SIM_VERSION,
  MAX_PLAYERS,
  PALETTE,
  PROTOCOL_VERSION,
  codeToPeerId,
  isNetMsg,
  type ClientMsg,
  type HostMsg,
  type LeaderEntry,
  type NetMsg,
  type PlayerId,
  type PlayerInfo,
} from "./protocol";

export interface RemoteInputBatch {
  id: PlayerId;
  startTick: number;
  masks: number[];
}

export interface RoomEvents {
  onRoster?: (players: PlayerInfo[]) => void;
  onLeaderboard?: (entries: LeaderEntry[]) => void;
  onRemoteInput?: (batch: RemoteInputBatch) => void;
  onRemoteReset?: (id: PlayerId) => void;
  onSelf?: (self: PlayerInfo) => void;
  onError?: (message: string) => void;
  onStatus?: (status: RoomStatus) => void;
}

export type RoomStatus = "connecting" | "open" | "closed" | "error";

export class Room {
  readonly code: string;
  readonly isHost: boolean;
  private peer: Peer;
  private events: RoomEvents;
  private self: PlayerInfo | null = null;

  // host-only state
  private conns = new Map<PlayerId, DataConnection>();
  private roster = new Map<PlayerId, PlayerInfo>();
  private leaderboard: LeaderEntry[] = [];

  // client-only state
  private toHost: DataConnection | null = null;

  private constructor(code: string, isHost: boolean, events: RoomEvents) {
    this.code = code;
    this.isHost = isHost;
    this.events = events;
    this.peer = isHost
      ? new Peer(codeToPeerId(code))
      : new Peer(); // clients get a random id from the broker
  }

  static host(code: string, name: string, events: RoomEvents): Room {
    const room = new Room(code, true, events);
    room.startAsHost(name);
    return room;
  }

  static join(code: string, name: string, events: RoomEvents): Room {
    const room = new Room(code, false, events);
    room.startAsClient(name);
    return room;
  }

  // ── Host ─────────────────────────────────────────────────────

  private startAsHost(name: string) {
    this.events.onStatus?.("connecting");
    this.peer.on("open", (id) => {
      this.self = {
        id: "host",
        name: name || "Host",
        color: PALETTE[0],
        isHost: true,
      };
      this.roster.set("host", this.self);
      this.events.onSelf?.(this.self);
      this.events.onRoster?.(this.rosterList());
      this.events.onStatus?.("open");
      void id;
    });

    this.peer.on("connection", (conn) => this.acceptClient(conn));
    this.peer.on("error", (err) => this.fail(err));
    this.peer.on("disconnected", () => this.peer.reconnect());
  }

  private acceptClient(conn: DataConnection) {
    conn.on("open", () => {
      // version + capacity checks happen when the client says hello
      conn.on("data", (raw) => this.onHostData(conn, raw));
    });
    conn.on("close", () => this.removeClient(conn.connectionId));
    conn.on("error", () => this.removeClient(conn.connectionId));
  }

  private onHostData(conn: DataConnection, raw: unknown) {
    if (!isNetMsg(raw)) return;
    const msg = raw as ClientMsg;
    const id = conn.connectionId;

    switch (msg.t) {
      case "hello": {
        if (msg.protocol !== PROTOCOL_VERSION || msg.sim !== LOCAL_SIM_VERSION) {
          this.sendTo(conn, { t: "reject", reason: "version" });
          setTimeout(() => conn.close(), 50);
          return;
        }
        if (this.roster.size >= MAX_PLAYERS) {
          this.sendTo(conn, { t: "reject", reason: "full" });
          setTimeout(() => conn.close(), 50);
          return;
        }
        const color = this.nextColor();
        const info: PlayerInfo = {
          id,
          name: (msg.name || "Player").slice(0, 16),
          color,
          isHost: false,
        };
        this.conns.set(id, conn);
        this.roster.set(id, info);
        this.sendTo(conn, {
          t: "welcome",
          you: info,
          players: this.rosterList(),
          leaderboard: this.leaderboard,
        });
        this.broadcast({ t: "roster", players: this.rosterList() }, id);
        this.events.onRoster?.(this.rosterList());
        break;
      }
      case "input": {
        // relay to every other client, and surface locally
        this.broadcast({ t: "rinput", id, startTick: msg.startTick, masks: msg.masks }, id);
        this.events.onRemoteInput?.({ id, startTick: msg.startTick, masks: msg.masks });
        break;
      }
      case "reset": {
        this.broadcast({ t: "rreset", id }, id);
        this.events.onRemoteReset?.(id);
        break;
      }
      case "finish": {
        this.ingestFinish(id, msg.replay);
        break;
      }
    }
  }

  private removeClient(id: PlayerId) {
    if (!this.conns.has(id) && !this.roster.has(id)) return;
    this.conns.delete(id);
    this.roster.delete(id);
    this.broadcast({ t: "roster", players: this.rosterList() });
    this.events.onRoster?.(this.rosterList());
    this.events.onRemoteReset?.(id);
  }

  /** Verify a submitted replay and fold it into the leaderboard (host authority). */
  private ingestFinish(id: PlayerId, replayB64: string) {
    const info = this.roster.get(id);
    if (!info) return;
    let ticks: number;
    try {
      const inputs = decodeReplay(fromBase64(replayB64));
      const res = verifyReplay(OVAL_1, inputs);
      if (!res.finished || res.laps.length < TOTAL_LAPS) return; // invalid run
      ticks = res.ticks;
    } catch {
      return; // malformed replay → ignore
    }
    this.recordTime(info, ticks);
  }

  /** The host records its OWN verified time (called from the client glue). */
  recordSelfTime(ticks: number) {
    if (!this.isHost || !this.self) return;
    this.recordTime(this.self, ticks);
  }

  private recordTime(info: PlayerInfo, ticks: number) {
    const prev = this.leaderboard.find((e) => e.id === info.id);
    if (prev) {
      if (ticks < prev.ticks) prev.ticks = ticks;
    } else {
      this.leaderboard.push({ id: info.id, name: info.name, color: info.color, ticks });
    }
    this.leaderboard.sort((a, b) => a.ticks - b.ticks);
    this.broadcast({ t: "leaderboard", leaderboard: this.leaderboard });
    this.events.onLeaderboard?.(this.leaderboard);
  }

  private nextColor(): string {
    const used = new Set(this.rosterList().map((p) => p.color));
    return PALETTE.find((c) => !used.has(c)) ?? PALETTE[PALETTE.length - 1];
  }

  // ── Client ───────────────────────────────────────────────────

  private startAsClient(name: string) {
    this.events.onStatus?.("connecting");
    this.peer.on("open", () => {
      const conn = this.peer.connect(codeToPeerId(this.code), { reliable: true });
      this.toHost = conn;
      conn.on("open", () => {
        this.sendTo(conn, {
          t: "hello",
          protocol: PROTOCOL_VERSION,
          sim: LOCAL_SIM_VERSION,
          name,
        });
      });
      conn.on("data", (raw) => this.onClientData(raw));
      conn.on("close", () => {
        this.events.onStatus?.("closed");
        this.events.onError?.("Conexão com o host encerrada.");
      });
      conn.on("error", (err) => this.fail(err));
    });
    this.peer.on("error", (err) => this.fail(err));
    this.peer.on("disconnected", () => this.peer.reconnect());
  }

  private onClientData(raw: unknown) {
    if (!isNetMsg(raw)) return;
    const msg = raw as HostMsg;
    switch (msg.t) {
      case "welcome": {
        this.self = msg.you;
        this.events.onSelf?.(msg.you);
        this.events.onRoster?.(msg.players);
        this.events.onLeaderboard?.(msg.leaderboard);
        this.events.onStatus?.("open");
        break;
      }
      case "reject": {
        const map = {
          full: "Sala cheia (máx. 15 jogadores).",
          version: "Versão incompatível com o host.",
          closed: "Sala fechada.",
        } as const;
        this.events.onError?.(map[msg.reason]);
        this.events.onStatus?.("error");
        break;
      }
      case "roster":
        this.events.onRoster?.(msg.players);
        break;
      case "leaderboard":
        this.events.onLeaderboard?.(msg.leaderboard);
        break;
      case "rinput":
        this.events.onRemoteInput?.({ id: msg.id, startTick: msg.startTick, masks: msg.masks });
        break;
      case "rreset":
        this.events.onRemoteReset?.(msg.id);
        break;
    }
  }

  // ── Outbound (same API for host and client) ──────────────────

  /** Send a batch of input ticks produced locally. */
  sendInput(startTick: number, masks: number[]) {
    if (masks.length === 0) return;
    if (this.isHost) {
      this.broadcast({ t: "rinput", id: "host", startTick, masks });
    } else if (this.toHost?.open) {
      this.sendTo(this.toHost, { t: "input", startTick, masks });
    }
  }

  /** Announce a local race restart. */
  sendReset() {
    if (this.isHost) {
      this.broadcast({ t: "rreset", id: "host" });
    } else if (this.toHost?.open) {
      this.sendTo(this.toHost, { t: "reset" });
    }
  }

  /** Submit a finished replay for verification / leaderboard. */
  sendFinish(replayB64: string, ticks: number) {
    if (this.isHost) {
      this.recordSelfTime(ticks);
    } else if (this.toHost?.open) {
      this.sendTo(this.toHost, { t: "finish", replay: replayB64 });
    }
  }

  getSelf(): PlayerInfo | null {
    return this.self;
  }

  destroy() {
    try {
      this.conns.forEach((c) => c.close());
      this.toHost?.close();
      this.peer.destroy();
    } catch {
      /* ignore */
    }
    this.events.onStatus?.("closed");
  }

  // ── helpers ──────────────────────────────────────────────────

  private rosterList(): PlayerInfo[] {
    // host first, then join order
    return [...this.roster.values()].sort((a, b) => (a.isHost ? -1 : b.isHost ? 1 : 0));
  }

  private broadcast(msg: HostMsg, exceptId?: PlayerId) {
    for (const [id, conn] of this.conns) {
      if (id === exceptId) continue;
      this.sendTo(conn, msg);
    }
  }

  private sendTo(conn: DataConnection, msg: NetMsg) {
    try {
      conn.send(msg);
    } catch {
      /* dropped */
    }
  }

  private fail(err: unknown) {
    const e = err as { type?: string; message?: string };
    let message = e?.message || "Erro de conexão.";
    if (e?.type === "unavailable-id") message = "Esse código de sala já está em uso. Tente outro.";
    if (e?.type === "peer-unavailable") message = "Sala não encontrada. Confira o código.";
    this.events.onError?.(message);
    this.events.onStatus?.("error");
  }
}
