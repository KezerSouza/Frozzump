# Changelog

All notable changes to Frozzump. Versions follow [semantic versioning](https://semver.org); how to release one is in
the README ("Versions").

## [1.0.0] — 2026-11-13

First versioned release (the project was previously called "Snow Go").
`SIM_VERSION` restarts at 1 (same physics as the old 7; saved records carry over) and goes up from here.

- Racing on snowy tracks: oval plus grid tracks (Boot, Bottleneck, Serpentine, Zeta…), deep snow that slows you down,
  ramps, laps per track, personal ghost and record per track.
- Multiplayer P2P (PeerJS, no server): rooms by code, free mode and race mode, up to 15 players, other players' shadows.
- Pick your car and color (unique color per room).
- Phones and tablets: touch steering (left / right half of the screen), landscape + fullscreen, tap to race again,
  adaptive resolution, FPS counter (`F`, or tap the timer).
- Android app (Capacitor), published with the site at `<pages>/frozzump.apk`; plays in the same rooms as the web.
