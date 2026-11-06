# Snow Go — prototype

Browser game inspired on the Snow Go minigame from Mario Party 9: an oval track, 5 laps,
deep snow that slows you down, and a ramp that jumps you over it.
Controls: ← → (or A/D) to steer, `R` to restart, `G` toggles your personal ghost,
`O` toggles the other players' shadows, `M` opens the multiplayer lobby. The car accelerates on its own.

## Multiplayer (P2P, no server)

Up to 15 players share the same track over WebRTC (PeerJS for signaling — the site
stays 100% static). The game starts in **solo**; the **Multiplayer** button (top) or `M`
opens the lobby, where you pick a nickname (max 25 characters) and either:

- **Create room** → you become the host and get a room code to share.
- **Join** → type an existing room code.

Inside a room every car shows its owner's nickname (your personal best-time ghost never
does, and in multiplayer no player color is a light blue, so it can't be mistaken for it).
**Sair** returns to solo. The host picks the game mode in the top bar:

- **Livre** (free) — everyone races on their own and chases each other's best time.
- **Corrida** (race) — everyone starts a 5-lap race together and the standings are shown.
  The next round starts 20 s after the first finisher, or earlier when the host presses
  `R` / **Reiniciar corrida** (available 5 s after the first finisher, so everyone can see the
  results and the others can finish; the host enforces it). Players who join mid-round
  wait for the next one. Positions are by verified race time.

The host is the authority for color assignment, the live player rank (left) and the
shared best-times leaderboard (right). Finished runs are submitted as replays and
verified with `verifyReplay` before entering the leaderboard, so times can't be faked.
Every peer re-runs the deterministic sim locally from ~1 byte/tick of opponent input,
drawing each opponent as a light colored shadow.

## Running

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # simulation, replay, determinism
npm run bot      # bot that drives 5 laps and prints the times (for tuning)
```

## Tracks

The track picker (top bar) chooses where you race. In **solo** everybody picks their own track
(it is remembered) and the **best time and ghost are kept per track**. In a **room** only the host
picks: everybody switches to it (in race mode that starts a new round), and the shared leaderboard
is also per track. A client whose build has a different drawing of the host's track is refused
(it asks to refresh the page).

There are two kinds of track. The **oval** is analytic (two straights + two semicircles). Every other
track is **drawn as text**, so making a new one is just editing a file.

### Drawing a track

Create `src/sim/tracks/my-track.ts` (copy `boot.ts`), register it in `src/sim/registry.ts`
(`parseTrack("my-track", MY_TRACK)`) and reload. A track is a short header, a blank line and the drawing:

```
name: My track        ← shown in the picker
cell: 1               ← size of one character in meters (default 1; 0.5 = smoother walls, 4x the characters)
finish: right         ← direction of travel across the finish line (right | left | up | down)
start: right          ← direction the car faces at the start (optional, default = finish)
smooth: 3             ← rounds the walls, 0-4 (optional, default 0)
laps: 4               ← laps of a race on this track, 1-99 (optional, default 5)

##########
#S..F....#
##########
```

| char | meaning |
|---|---|
| `#` | wall (a space, or anything outside the drawing, is wall too) |
| `.` | road |
| `~` | deep snow (slows the car) |
| `^` | boost ramp (jumps over snow; the arrows follow the race direction) |
| `S` | start, exactly one, with free space around it (the car is 1.44 m wide) |
| `F` | finish line: a straight run of `F` from wall to wall |
| `1`…`9` | checkpoints: a straight run each, wall to wall, numbered in driving order (at least 2) |

Laps only count after crossing the checkpoints in order, then the finish. The loader checks all of
this and says where and why when something is wrong (`TrackError`): start glued to a wall, a line
that doesn't reach the walls, checkpoints out of order, a track that isn't a closed circuit,
unreachable pieces of road.

The walls are the outline of the drawing. Diagonals are already smooth, but curves show steps as big
as a cell: `smooth: 3` (or 4) averages them out into round arcs (a wall never moves more than about
half a cell, so thin walls and tight corners survive). A smaller `cell` also gives rounder walls, at
the price of a drawing 4x as big. A big track needs nothing else: the camera zooms
out to fit it. Editing a drawing starts fresh records for it (the hash of the drawing is part of the
key of the saved best time).

Rule of thumb for jumps: a ramp lets the car clear about 11 m, so keep the snow shorter than that
after the ramp. Put the ramp on a lane edge and the snow across the whole road if you want a choice
between the shortcut through the snow and the jump.

## Layout

```
src/sim/      deterministic core (NO DOM, NO Math.sin/cos/exp/pow, NO Math.random/Date)
  params.ts   physics constants + SIM_VERSION
  track.ts    track types (oval = StadiumTrack, drawn tracks = GridTrack) + the oval itself
  grid.ts     parseTrack(): turns a drawing in text into a track (walls, gates, snow, ramps) and validates it
  registry.ts the list of tracks the game knows (+ fingerprint of each)
  tracks/     the drawings (one file per track)
  sim.ts      createState / step / hashState
  replay.ts   inputs <-> bytes (RLE + base64) and verifyReplay (what the host runs)
src/net/      P2P multiplayer (WebRTC via PeerJS)
  protocol.ts wire messages, game modes, color palette (15), room codes
  room.ts     star-topology room: host authority, presence, leaderboard
  round.ts    race-mode rounds (host): participants, standings, 20 s next-round timer
src/client/   browser: fixed-step loop, keyboard, Canvas 2D, ghost, lobby UI
tests/        vitest (includes a "golden" determinism hash)
tools/bot.ts  tuning bot (oval only)
```

## Rules for `src/sim`

1. Only `+ - * /`, `Math.sqrt`, `min/max/abs/floor`, comparisons. No `Math.sin/cos/exp/pow`.
2. No `Math.random()` and no `Date.now()`.
3. The simulation steps in whole ticks (120 Hz); race and lap times are integers in subticks (1/65536 tick).
   Never trust time measured by the client: the server re-runs the replay.
4. Changed anything in `params.ts`/`sim.ts`/`track.ts`? Bump `SIM_VERSION` and update the test's GOLDEN.
   (Editing a drawing in `tracks/` needs no bump: its records restart on their own, because the hash
   of the drawing is part of the key. Rooms refuse peers whose drawing differs from the host's.)

## Contributors

Thanks to everyone who has contributed to this project!

<a href="https://github.com/KezerSouza/snowgo-prototype/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=KezerSouza/snowgo-prototype" alt="Contributors" />
</a>

<sub>Avatars are generated automatically by <a href="https://contrib.rocks">contrib.rocks</a> from the repository's contributor list.</sub>
