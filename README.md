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
  The next round starts 20 s after the first finisher, or right away when the host presses
  `R` / **Reiniciar corrida** (available once someone finished). Players who join mid-round
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

## Layout

```
src/sim/      deterministic core (NO DOM, NO Math.sin/cos/exp/pow, NO Math.random/Date)
  params.ts   physics constants + SIM_VERSION
  track.ts    track as data (JSON-friendly): geometry, snow, ramp, gates
  sim.ts      createState / step / hashState
  replay.ts   inputs <-> bytes (RLE + base64) and verifyReplay (what the host runs)
src/net/      P2P multiplayer (WebRTC via PeerJS)
  protocol.ts wire messages, game modes, color palette (15), room codes
  room.ts     star-topology room: host authority, presence, leaderboard
  round.ts    race-mode rounds (host): participants, standings, 20 s next-round timer
src/client/   browser: fixed-step loop, keyboard, Canvas 2D, ghost, lobby UI
tests/        vitest (includes a "golden" determinism hash)
tools/bot.ts  tuning bot
```

## Rules for `src/sim`

1. Only `+ - * /`, `Math.sqrt`, `min/max/abs/floor`, comparisons. No `Math.sin/cos/exp/pow`.
2. No `Math.random()` and no `Date.now()`.
3. The simulation steps in whole ticks (120 Hz); race and lap times are integers in subticks (1/65536 tick).
   Never trust time measured by the client: the server re-runs the replay.
4. Changed anything in `params.ts`/`sim.ts`/`track.ts`? Bump `SIM_VERSION` and update the test's GOLDEN.

## Contributors

Thanks to everyone who has contributed to this project!

<a href="https://github.com/KezerSouza/snowgo-prototype/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=KezerSouza/snowgo-prototype" alt="Contributors" />
</a>

<sub>Avatars are generated automatically by <a href="https://contrib.rocks">contrib.rocks</a> from the repository's contributor list.</sub>
