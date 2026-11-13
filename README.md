# Frozzump

**Play:** https://kezersouza.github.io/Frozzump/ · **Android app:** [download the APK](https://github.com/KezerSouza/Frozzump/releases/latest/download/frozzump.apk)
([all versions](https://github.com/KezerSouza/Frozzump/releases))

Browser game inspired on the "Snow Go" minigame from Mario Party 9: an oval track, 5 laps,
deep snow that slows you down, and a ramp that jumps you over it.
Controls: ← → (or A/D) to steer, `R` to restart, `G` toggles your personal ghost,
`O` toggles the other players' shadows, `C` picks your car and color, `M` opens the multiplayer lobby,
`F` toggles the FPS counter (bottom left; on a phone, tap the timer).
The car accelerates on its own.

## Phones and tablets

On a touch screen, **touch the left half of the screen to steer left and the right half to steer right**
(both at once = both keys held). Two arrows in the bottom corners light up while a finger holds that side.
There is no keyboard, so a **↻** button in the top bar restarts your run (solo / free mode; races are restarted by
the host as on desktop).

The game is played in landscape:

- **Mobile browser**: the first tap goes fullscreen and locks the screen to landscape (Chrome on Android). Where
  the browser can't (iPhone Safari), a "Gire o celular" notice is shown while the phone is upright; it can be
  dismissed to play upright anyway. Added to the home screen, the web manifest opens it fullscreen in landscape.
- **Android app**: always landscape and fullscreen, and the screen stays on.

Web (desktop or phone) and the Android app are the same game and the same protocol: they play together in the same
room, and any of them can create the room or join someone else's.

## Android app (APK)

**Download**, in two places:

- **GitHub Releases**: every version tag (`v1.0.0`, …) publishes a release with its APK and its CHANGELOG notes
  (`.github/workflows/release.yml`). The newest one is always at
  `https://github.com/<user>/<repo>/releases/latest/download/frozzump.apk`.
- **Next to the site**: every deploy to GitHub Pages also builds the app and publishes it at
  `https://<user>.github.io/<repo>/frozzump.apk` (the multiplayer lobby shows a "Baixar o app para Android" link to it on
  Android browsers). It is always the same version as the site, so the app and the web play in the same rooms.

Both workflows build it the same way (`.github/actions/build-apk`).

The published APK is signed with the project's key, kept in the repository secrets: only an APK signed with the same
key installs over the previous one. Settings → Secrets and variables → Actions → New repository secret:

| secret | value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | the keystore (`.jks`) in base64: `base64 -w0 release.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore password |
| `ANDROID_KEY_ALIAS` | the key alias |
| `ANDROID_KEY_PASSWORD` | the key password |

Without them the workflow publishes the debug APK instead (with a warning): it works, but its signature changes on every
build, so updating means uninstalling the previous one first. Keep a backup of the keystore: lose it and the app can't be
updated anymore, only uninstalled and installed again. Never commit it.

**Building it yourself**:

The `android/` folder is a [Capacitor](https://capacitorjs.com) project: the web build (`dist/`) inside a WebView,
locked to landscape (`AndroidManifest.xml`) and fullscreen (`MainActivity.java`). Needs the Android SDK and Java 21:

```bash
export ANDROID_HOME=~/Android/Sdk
npm run apk      # build + cap sync + gradle → android/app/build/outputs/apk/debug/app-debug.apk
```

Copy the APK to the phone and open it (Android asks to allow installing from that source). The app carries its own
copy of the game: after a change to the protocol, the sim or a track, build a new APK, or the host refuses it
("Versão incompatível com o host" / "A pista da sala é diferente").

## Versions

The project follows [semantic versioning](https://semver.org) (`MAJOR.MINOR.PATCH`), starting at **1.0.0**.
`package.json` is the single source of truth: the multiplayer lobby shows it (`v1.0.0`) and the APK uses it as its
`versionName`. The APK's internal `versionCode` is the number of commits, so the same commit gets the same code on
Pages and in the Release, and every newer APK installs over an older one. Changes per version: [CHANGELOG.md](CHANGELOG.md).

To release a version:

```bash
npm version minor --no-git-tag-version   # or patch (fixes) / major; updates package.json + package-lock.json
# add the version to CHANGELOG.md, commit, open the PR and merge it into main (the deploy publishes site + APK)
git checkout main && git pull
git tag v1.1.0 && git push origin v1.1.0    # tag the merged commit → GitHub Release with the APK
```

The release workflow refuses a tag that doesn't match `package.json` (`v1.1.0` ↔ `"version": "1.1.0"`).
Instead of the terminal, the tag can be created on GitHub: Releases → "Draft a new release" → type the tag (`v1.1.0`)
→ "Create new tag on publish", target `main` → Publish. The workflow then attaches the APK (and fills the notes from
CHANGELOG.md if they were left empty).

- **patch** (1.0.1): bug fixes. **minor** (1.1.0): new features (tracks, cars, modes…). **major** (2.0.0): big changes.
- Players on different versions can still share a room as long as the protocol, the sim and the track are the same
  (`PROTOCOL_VERSION` / `SIM_VERSION` / track hash, checked by the host); the app version itself isn't checked.

## Car and color

The **Carro** button (top bar) or `C` opens the garage: three car models (Normal, Snowmobile, Bobsled)
and the 15 colors as squares. The choice is remembered. The models are purely visual: all of them
have the same collision circle, so nothing changes in the simulation (or in replays and times).

Inside a room any number of players can drive the same model, but a **color belongs to one player**:
a color someone already has is crossed out (✕) and can't be picked. You enter a room asking for your
saved color; if it is taken the host gives you the first free one. Changing color also recolors your
entries in the best-times board.

## Multiplayer (P2P, no server)

Up to 15 players share the same track over WebRTC (PeerJS for signaling — the site
stays 100% static). The game starts in **solo**; the **Multiplayer** button (top) or `M`
opens the lobby, where you pick a nickname (max 25 characters) and either:

- **Create room** → you become the host and get a room code to share.
- **Join** → type an existing room code.

Inside a room every car shows its owner's nickname. Your personal best-time ghost never
does: it is a light shadow of your own car and color, and no other player can have your color.
**Sair** returns to solo. The host picks the game mode in the top bar:

- **Livre** (free) — everyone races on their own and chases each other's best time.
- **Corrida** (race) — everyone starts a 5-lap race together and the standings are shown.
  The next round starts 20 s after the first finisher, or earlier when the host presses
  `R` / **Reiniciar corrida** (available 5 s after the first finisher, so everyone can see the
  results and the others can finish; the host enforces it). Players who join mid-round
  wait for the next one. Positions are by verified race time.

The host is the authority for color assignment (it refuses a color that is already taken), the live player rank (left) and the
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
src/client/   browser: fixed-step loop, keyboard + touch, Canvas 2D, ghost, lobby UI
  mobile.ts   phones: landscape / fullscreen, "rotate your phone" notice, keep the screen awake
android/      Android app (Capacitor) — `npm run apk`
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

<a href="https://github.com/KezerSouza/Frozzump/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=KezerSouza/Frozzump" alt="Contributors" />
</a>

<sub>Avatars are generated automatically by <a href="https://contrib.rocks">contrib.rocks</a> from the repository's contributor list.</sub>
