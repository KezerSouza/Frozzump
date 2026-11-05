# Snow Go — prototype

Browser game inspired on the Snow Go minigame from Mario Party 9: an oval track, 5 laps,
deep snow that slows you down, and a ramp that jumps you over it.
Controls: just ← → (or A/D). The car accelerates on its own.

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
  replay.ts   inputs <-> bytes (RLE + base64) and verifyReplay (what the server will do)
src/client/   browser: fixed-step loop, keyboard, Canvas 2D, ghost
tests/        vitest (includes a "golden" determinism hash)
tools/bot.ts  tuning bot
```

## Rules for `src/sim`

1. Only `+ - * /`, `Math.sqrt`, `min/max/abs`, comparisons. No `Math.sin/cos/exp/pow`.
2. No `Math.random()` and no `Date.now()`.
3. Time = an integer number of ticks (120 Hz). Never trust time measured by the client.
4. Changed anything in `params.ts`/`sim.ts`/`track.ts`? Bump `SIM_VERSION` and update the test's GOLDEN.
