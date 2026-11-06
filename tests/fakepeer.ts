// An in-memory stand-in for PeerJS, just enough for Room: peers find each other by id in a shared
// registry, and messages are delivered asynchronously (a microtask) like a real data channel.

type Fn = (...a: unknown[]) => void;

class Emitter {
  private listeners = new Map<string, Fn[]>();
  on(ev: string, fn: Fn) {
    this.listeners.set(ev, [...(this.listeners.get(ev) ?? []), fn]);
    return this;
  }
  protected emit(ev: string, ...args: unknown[]) {
    for (const fn of this.listeners.get(ev) ?? []) fn(...args);
  }
}

let nextId = 1;
const registry = new Map<string, FakePeer>();

export class FakeConn extends Emitter {
  open = false;
  readonly connectionId = `dc_${nextId++}`;
  remote!: FakeConn;
  send(msg: unknown) {
    if (!this.open) throw new Error("connection closed");
    const copy = structuredClone(msg); // like the wire: no shared references
    const to = this.remote;
    queueMicrotask(() => to.open && to.emit("data", copy));
  }
  close() {
    if (!this.open) return;
    this.open = false;
    this.remote.open = false;
    queueMicrotask(() => {
      this.emit("close");
      this.remote.emit("close");
    });
  }
  fire(ev: string, ...a: unknown[]) {
    this.emit(ev, ...a);
  }
}

export class FakePeer extends Emitter {
  readonly id: string;
  constructor(id?: string) {
    super();
    this.id = id ?? `peer_${nextId++}`;
    if (registry.has(this.id)) {
      queueMicrotask(() => this.emit("error", { type: "unavailable-id", message: "id taken" }));
      return;
    }
    registry.set(this.id, this);
    queueMicrotask(() => this.emit("open", this.id));
  }
  connect(otherId: string): FakeConn {
    const mine = new FakeConn();
    const theirs = new FakeConn();
    mine.remote = theirs;
    theirs.remote = mine;
    queueMicrotask(() => {
      const other = registry.get(otherId);
      if (!other) return this.emit("error", { type: "peer-unavailable" });
      other.emit("connection", theirs); // the host registers its handlers…
      mine.open = theirs.open = true;
      mine.fire("open"); //                …then both sides see the channel open
      theirs.fire("open");
    });
    return mine;
  }
  destroy() {
    registry.delete(this.id);
  }
  reconnect() {}
}

/** Let every pending microtask / timer-0 run (a few rounds, since messages trigger more messages). */
export async function flush(rounds = 6) {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 0));
}
