import { createState, hashState, step } from "./sim";
import type { TrackDef } from "./track";

// Compact format: pairs of (input mask, run length as a varint).
// A 30 s replay is usually just a few dozen bytes.

export function encodeReplay(inputs: ArrayLike<number>): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < inputs.length) {
    const mask = inputs[i];
    let run = 1;
    while (i + run < inputs.length && inputs[i + run] === mask) run++;
    out.push(mask);
    let n = run;
    while (n >= 0x80) {
      out.push((n & 0x7f) | 0x80);
      n >>>= 7;
    }
    out.push(n);
    i += run;
  }
  return Uint8Array.from(out);
}

export function decodeReplay(bytes: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < bytes.length) {
    const mask = bytes[i++];
    let run = 0;
    let shift = 0;
    for (;;) {
      const b = bytes[i++];
      run |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
    }
    for (let k = 0; k < run; k++) out.push(mask);
  }
  return Uint8Array.from(out);
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** What the server-side verifier does: re-runs the inputs and checks the result. */
export function verifyReplay(track: TrackDef, inputs: ArrayLike<number>) {
  const s = createState(track);
  for (let i = 0; i < inputs.length && !s.finished; i++) step(s, track, inputs[i]);
  return {
    finished: s.finished,
    ticks: s.tick,
    finishSubticks: s.finishSubticks,
    lapSubticks: s.lapSubticks.slice(),
    hash: hashState(s),
  };
}
