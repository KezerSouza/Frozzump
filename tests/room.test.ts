import { afterEach, describe, expect, it, vi } from "vitest";
import {
  IN_LEFT, IN_RIGHT, TOTAL_LAPS, createState, encodeReplay, getTrack, step, toBase64, type TrackDef,
} from "../src/sim";
import type { GameState, LeaderEntry } from "../src/net/protocol";
import { Room, type RoomEvents } from "../src/net/room";
import { flush } from "./fakepeer";

vi.mock("peerjs", async () => {
  const m = await import("./fakepeer");
  return { Peer: m.FakePeer };
});

const oval = getTrack("oval-1")!;
const serp = getTrack("serpentina")!;

// ── a driver that completes a race on a grid track, and the replay of it ──
const CENTER: [number, number][] = [[10, 10], [24, 10], [34, 20], [46, 20], [56, 10], [66, 10], [66, 40], [52, 40], [42, 32], [30, 32], [20, 40], [10, 40]];
function serpentinaReplay(): { b64: string; time: number } {
  const s = createState(serp);
  const inputs: number[] = [];
  let target = 1;
  while (!s.finished && inputs.length < 120 * 400) {
    const [tx, ty] = CENTER[target];
    if (Math.hypot(tx - s.x, ty - s.y) < 6) target = (target + 1) % CENTER.length;
    const cross = s.hx * (ty - s.y) - s.hy * (tx - s.x);
    const input = cross > 0.05 ? IN_RIGHT : cross < -0.05 ? IN_LEFT : 0;
    inputs.push(input);
    step(s, serp, input);
  }
  expect(s.laps).toBe(TOTAL_LAPS);
  return { b64: toBase64(encodeReplay(inputs)), time: s.finishSubticks };
}

interface Seen {
  games: GameState[];
  boards: LeaderEntry[][];
  errors: string[];
  statuses: string[];
}
function events(): RoomEvents & { seen: Seen } {
  const seen: Seen = { games: [], boards: [], errors: [], statuses: [] };
  return {
    seen,
    onGame: (g) => seen.games.push(g),
    onLeaderboard: (b) => seen.boards.push(structuredClone(b)),
    onError: (m) => seen.errors.push(m),
    onStatus: (s) => seen.statuses.push(s),
  };
}

const rooms: Room[] = [];
let n = 0;
async function open(track: TrackDef, clientTrack: TrackDef = oval) {
  const code = `T${++n}`;
  const he = events(), ce = events();
  const host = Room.host(code, "Host", he, track);
  rooms.push(host);
  await flush();
  const client = Room.join(code, "Guest", ce, clientTrack);
  rooms.push(client);
  await flush();
  return { host, client, he, ce, code };
}
afterEach(() => {
  while (rooms.length) rooms.pop()!.destroy();
});

describe("Room: the host's track", () => {
  it("a client learns the room's track from the welcome message, whatever it had before", async () => {
    const { ce } = await open(serp, oval);
    expect(ce.seen.errors).toEqual([]);
    const g = ce.seen.games[ce.seen.games.length - 1];
    expect(g.track).toBe("serpentina");
    expect(g.trackHash).toBe((serp as { hash: number }).hash);
  });

  it("when the host picks another track every peer is told, in free mode and in race mode", async () => {
    const { host, he, ce } = await open(serp);
    host.setTrack("circuito-grande");
    await flush();
    expect(he.seen.games.at(-1)!.track).toBe("circuito-grande");
    expect(ce.seen.games.at(-1)!.track).toBe("circuito-grande");

    host.setMode("race");
    await flush();
    const round = ce.seen.games.at(-1)!.round;
    host.setTrack("oval-1");
    await flush();
    const g = ce.seen.games.at(-1)!;
    expect(g.track).toBe("oval-1");
    expect(g.mode).toBe("race");
    expect(g.round).toBe(round + 1); // a new round on the new track
  });

  it("only the host can pick the track", async () => {
    const { client, ce, he } = await open(serp);
    const before = ce.seen.games.length;
    client.setTrack("oval-1");
    await flush();
    expect(ce.seen.games.length).toBe(before);
    expect(he.seen.games.at(-1)!.track).toBe("serpentina");
  });

  it("an unknown track id is ignored", async () => {
    const { host, he } = await open(serp);
    const before = he.seen.games.length;
    host.setTrack("does-not-exist");
    await flush();
    expect(he.seen.games.length).toBe(before);
  });
});

describe("Room: best times are per track", () => {
  it("each track has its own board, and switching back brings the old times back", async () => {
    const { host, he, ce } = await open(serp);
    const run = serpentinaReplay();
    host.sendFinish(run.b64, run.time, 0); // the host records its own time
    await flush();
    expect(he.seen.boards.at(-1)!.map((e) => e.time)).toEqual([run.time]);
    expect(ce.seen.boards.at(-1)!.map((e) => e.time)).toEqual([run.time]);

    host.setTrack("oval-1");
    await flush();
    expect(he.seen.boards.at(-1)).toEqual([]); // nothing on the oval yet
    expect(ce.seen.boards.at(-1)).toEqual([]);

    host.setTrack("serpentina");
    await flush();
    expect(ce.seen.boards.at(-1)!.map((e) => e.time)).toEqual([run.time]);
  });

  it("the host verifies a client's replay on ITS track: valid there, rejected on another", async () => {
    const { host, client, he } = await open(serp);
    const run = serpentinaReplay();
    client.sendFinish(run.b64, run.time, 0);
    await flush();
    expect(he.seen.boards.at(-1)!).toHaveLength(1);
    expect(he.seen.boards.at(-1)![0].time).toBe(run.time);

    host.setTrack("oval-1");
    await flush();
    client.sendFinish(run.b64, run.time, 0); // the same inputs drive nowhere useful on the oval
    await flush();
    expect(he.seen.boards.at(-1)).toEqual([]);
  });
});
