// Saved data from before Frozzump 1.0.0, moved once before anything reads it, so nobody loses their records:
// - the game used to be called "Snow Go": records, ghosts, nickname, car and settings lived under "snowgo:*" keys;
// - SIM_VERSION restarted at 1 (same physics as the old 7): records keyed ":v7" become ":v1", and records from older
//   physics (":v2"…":v6", and an old ":v1" that would now be mistaken for the current one) are dropped.
// Imported first in main.ts (ES modules run in import order).

const OLD = "snowgo:";
const NEW = "frozzump:";
const DONE_KEY = "frozzump:storage-migrated";
const BEST = /^frozzump:best:(.+):v(\d+)$/;

function keys(store: Storage): string[] {
  const out: string[] = [];
  for (let i = 0; i < store.length; i++) out.push(store.key(i)!);
  return out;
}

function migrate(store: Storage) {
  for (const k of keys(store)) {
    if (!k.startsWith(OLD)) continue;
    const nk = NEW + k.slice(OLD.length);
    if (store.getItem(nk) === null) store.setItem(nk, store.getItem(k)!);
    store.removeItem(k);
  }
  // drop the records from older physics first (an old ":v1" too), so they can't clobber the renamed ":v7" ones
  const best = keys(store).map((k) => BEST.exec(k)).filter((m) => m !== null);
  for (const m of best) if (m[2] !== "7") store.removeItem(m[0]);
  for (const m of best) {
    if (m[2] !== "7") continue;
    store.setItem(`frozzump:best:${m[1]}:v1`, store.getItem(m[0])!);
    store.removeItem(m[0]);
  }
}

try {
  if (localStorage.getItem(DONE_KEY) === null) {
    migrate(localStorage);
    migrate(sessionStorage);
    localStorage.setItem(DONE_KEY, "1");
  }
} catch { /* private mode / storage blocked: nothing to move */ }

export {};
