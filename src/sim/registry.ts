// The tracks the game knows. To add one: drop a text file in ./tracks (see grid.ts for the format),
// parse it here and add it to TRACKS. The oval stays as the original analytic track.

import { fnv1a, parseTrack } from "./grid";
import { OVAL_1, type TrackDef } from "./track";
import { CIRCUITO_GRANDE } from "./tracks/grande";
import { SERPENTINA } from "./tracks/serpentina";

export const TRACKS: TrackDef[] = [
  OVAL_1,
  parseTrack("serpentina", SERPENTINA),
  parseTrack("circuito-grande", CIRCUITO_GRANDE),
];

export const DEFAULT_TRACK_ID = OVAL_1.id;

export function getTrack(id: string): TrackDef | undefined {
  return TRACKS.find((t) => t.id === id);
}

/** Fingerprint of a track: peers in a room compare it so they all race on exactly the same one. */
export function trackHash(t: TrackDef): number {
  return t.kind === "grid" ? t.hash : fnv1a(JSON.stringify(t));
}
