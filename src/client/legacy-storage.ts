// The game used to be called "Snow Go": its saved data (records, ghosts, nickname, car, settings) lived under
// "snowgo:*" keys. Move them to "frozzump:*" once, before anything reads them, so nobody loses their records.
// Imported first in main.ts (ES modules run in import order).

const OLD = "snowgo:";
const NEW = "frozzump:";

try {
  for (const store of [localStorage, sessionStorage]) {
    const old: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k?.startsWith(OLD)) old.push(k);
    }
    for (const k of old) {
      const nk = NEW + k.slice(OLD.length);
      if (store.getItem(nk) === null) store.setItem(nk, store.getItem(k)!);
      store.removeItem(k);
    }
  }
} catch { /* private mode / storage blocked: nothing to move */ }

export {};
