import { afterEach, describe, expect, it, vi } from "vitest";
import { getTrack, type GridTrack } from "../src/sim";
import { PALETTE, type LeaderEntry, type Look, type PlayerInfo } from "../src/net/protocol";
import { Room, type RoomEvents } from "../src/net/room";
import { encodeReplay, toBase64 } from "../src/sim";
import { centerLine, drive } from "./autopilot";
import { flush } from "./fakepeer";

vi.mock("peerjs", async () => {
  const m = await import("./fakepeer");
  return { Peer: m.FakePeer };
});

const bott = getTrack("bottleneck") as GridTrack; // the autopilot below only drives grid tracks

interface Peer {
  room: Room;
  rosters: PlayerInfo[][];
  boards: LeaderEntry[][];
  self: () => PlayerInfo;
}
function events(): RoomEvents & { rosters: PlayerInfo[][]; boards: LeaderEntry[][]; me: { v: PlayerInfo | null } } {
  const rosters: PlayerInfo[][] = [], boards: LeaderEntry[][] = [], me = { v: null as PlayerInfo | null };
  return {
    rosters, boards, me,
    onRoster: (p) => rosters.push(structuredClone(p)),
    onLeaderboard: (b) => boards.push(structuredClone(b)),
    onSelf: (s) => (me.v = structuredClone(s)),
  };
}

const rooms: Room[] = [];
let n = 0;
async function host(look: Look = {}): Promise<Peer & { code: string }> {
  const code = `L${++n}`;
  const ev = events();
  const room = Room.host(code, "Host", ev, bott, look);
  rooms.push(room);
  await flush();
  return { code, room, rosters: ev.rosters, boards: ev.boards, self: () => ev.me.v! };
}
async function join(code: string, name: string, look: Look = {}): Promise<Peer> {
  const ev = events();
  const room = Room.join(code, name, ev, bott, look);
  rooms.push(room);
  await flush();
  return { room, rosters: ev.rosters, boards: ev.boards, self: () => ev.me.v! };
}
const last = (p: Peer) => p.rosters.at(-1)!;
afterEach(() => {
  while (rooms.length) rooms.pop()!.destroy();
});

describe("Room: colors are exclusive", () => {
  it("each player gets the color they ask for when it is free", async () => {
    const h = await host({ color: PALETTE[3], car: "bobsled" });
    const c = await join(h.code, "Nina", { color: PALETTE[5], car: "snowmobile" });
    expect(h.self()).toMatchObject({ color: PALETTE[3], car: "bobsled" });
    expect(c.self()).toMatchObject({ color: PALETTE[5], car: "snowmobile" });
    expect(last(h).map((p) => p.color)).toEqual([PALETTE[3], PALETTE[5]]);
  });

  it("asking for a color someone already has gives the first free one instead", async () => {
    const h = await host({ color: PALETTE[0] });
    const c = await join(h.code, "Nina", { color: PALETTE[0] });
    expect(c.self().color).toBe(PALETTE[1]);
  });

  it("a color that is not in the palette is never granted", async () => {
    const h = await host({ color: "#123456" });
    expect(h.self().color).toBe(PALETTE[0]);
  });

  it("changing to a free color updates everyone's roster, and the player's best times", async () => {
    const h = await host();
    const c = await join(h.code, "Nina");
    const { state, inputs } = drive(bott, centerLine(bott));
    c.room.sendFinish(toBase64(encodeReplay(inputs)), state.finishSubticks, 0);
    await flush();
    expect(h.boards.at(-1)![0].color).toBe(c.self().color);

    c.room.setLook({ color: PALETTE[7] });
    await flush();
    expect(c.self().color).toBe(PALETTE[7]);
    expect(last(h).find((p) => p.name === "Nina")!.color).toBe(PALETTE[7]);
    expect(c.boards.at(-1)![0].color).toBe(PALETTE[7]);
  });

  it("a color another player has is refused (the roster does not change)", async () => {
    const h = await host();
    const c = await join(h.code, "Nina");
    const before = c.rosters.length;
    c.room.setLook({ color: h.self().color });
    await flush();
    expect(c.rosters.length).toBe(before);
    expect(c.self().color).not.toBe(h.self().color);
  });

  it("the host follows the same rule, and frees its old color for the others", async () => {
    const h = await host({ color: PALETTE[0] });
    const c = await join(h.code, "Nina", { color: PALETTE[1] });
    h.room.setLook({ color: PALETTE[1] }); // taken by Nina
    await flush();
    expect(h.self().color).toBe(PALETTE[0]);
    h.room.setLook({ color: PALETTE[2] });
    await flush();
    expect(h.self().color).toBe(PALETTE[2]);
    c.room.setLook({ color: PALETTE[0] }); // the host's old color is free now
    await flush();
    expect(c.self().color).toBe(PALETTE[0]);
  });
});

describe("Room: car models are free for everyone", () => {
  it("any number of players can drive the same model, and changes reach every peer", async () => {
    const h = await host({ car: "snowmobile" });
    const c = await join(h.code, "Nina", { car: "snowmobile" });
    expect(last(h).map((p) => p.car)).toEqual(["snowmobile", "snowmobile"]);
    c.room.setLook({ car: "bobsled" });
    await flush();
    expect(c.self().car).toBe("bobsled");
    expect(last(h).find((p) => p.name === "Nina")!.car).toBe("bobsled");
  });

  it("an unknown model falls back to the normal car (and a change to one is ignored)", async () => {
    const h = await host({ car: "kart" as never });
    expect(h.self().car).toBe("normal");
    const c = await join(h.code, "Nina", { car: "bobsled" });
    const before = c.rosters.length;
    c.room.setLook({ car: "kart" as never });
    await flush();
    expect(c.rosters.length).toBe(before);
    expect(c.self().car).toBe("bobsled");
  });
});
