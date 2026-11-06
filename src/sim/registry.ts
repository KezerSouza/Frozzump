// The tracks the game knows. To add one: drop a text file in ./tracks (see grid.ts for the format),
// parse it here and add it to TRACKS. The oval stays as the original analytic track.

import { TrackError, fnv1a, parseTrack } from "./grid";
import { OVAL_1, type TrackDef } from "./track";
import { BOOT } from "./tracks/boot";
import { BOTTLENECK } from "./tracks/bottleneck";

/** The drawings, as [id, text]. The id is what rooms and saved records use, so don't rename it later. */
const DRAWINGS: [string, string][] = [
  ["bottleneck", BOTTLENECK],
  ["boot", BOOT],
];

export const TRACKS: TrackDef[] = [OVAL_1];

/**
 * Drawings that don't pass the checks (a half-finished edit, say). They never crash the game: they
 * are left out of TRACKS and listed here with the reason, so the picker can show them as invalid.
 */
export const BROKEN_TRACKS: { id: string; error: string }[] = [];

for (const [id, text] of DRAWINGS) {
  try {
    TRACKS.push(parseTrack(id, text));
  } catch (e) {
    if (!(e instanceof TrackError)) throw e; // a real bug, not a bad drawing
    BROKEN_TRACKS.push({ id, error: e.message });
  }
}

export const DEFAULT_TRACK_ID = OVAL_1.id;

export function getTrack(id: string): TrackDef | undefined {
  return TRACKS.find((t) => t.id === id);
}

/** Fingerprint of a track: peers in a room compare it so they all race on exactly the same one. */
export function trackHash(t: TrackDef): number {
  return t.kind === "grid" ? t.hash : fnv1a(JSON.stringify(t));
}
