# Arrange — generative battle music

Builds a loopable battle theme from a short hook: pick a motif, pick the arrangement
around it, grow it into a track, export MIDI. Aimed at a chiptune/orchestral hybrid at
140–185 BPM, for the turn-based game in `snack/munch`.

Everything is a (mostly) pure function of a ~40-byte genome, so the same genome always
yields the same notes.

## Run

```bash
npm install
npm run dev        # Vite dev server — open the printed URL
npm run build      # typecheck (both boundaries) + production bundle -> dist/
npm test           # unit / property / golden tests
npm run typecheck  # tsc over the pure packages, then the app layer
npm run ship       # validate themes, then publish engine + themes into munch
npm run ship:check # fail if munch has drifted from this repo
```

## The flow

Five stages, one choice each:

1. **Hook** — six short cells, each a battle rhythm plus a way of restating it
   (repeat, sequence up/down, call-and-answer, ostinato). Constrained to 3–5 distinct
   pitches, because a hook you can hum is a hook with few notes in it.
2. **Bed** — the same hook arranged six ways over six progressions. The melody seed is
   held constant, so you are judging orchestration, not comparing six different tunes.
3. **Mood** — a 2-D urgency × fortune pad. Drag it and the arrangement deforms live;
   the hook never moves. Reports whether the bed survives all four corners.
4. **Form** — grow the bed into a 30/60/90 s track with a real arc
   (`intro · A · A' · B · A" · tag`). Sections are whole phrases and the total is a
   multiple of the progression, so the loop joins cleanly.
5. **Vary** — how the hook differs on each return. Phase 5.

Importing a MIDI skips the generative half: the file is arranged over its own inferred
harmony and opens at the Mood pad, to hear how someone else's tune moves. Hand-editing the
inferred chords lives in the **Advanced** drawer. `PLAN-battle-mode.md` tracks what is built and what is next.

## Architecture

Two layers, enforced by two tsconfigs.

**Pure engine** (`tsconfig.json` — no DOM; `any`/`as` banned outside brand constructors):

- **`core`** — branded primitives (`Tick`/`Midi`/`PC`/`Degree`), the data model, pitch
  and meter math, the §7.1 metric-weight grid, the 7-operator algebra, the instrument
  table (ranges, articulation ceilings, voice classes, palettes), the shared **timbre
  table** both renderers read, and a seeded sfc32 RNG with label-based `fork`.
- **`theory`** — Krumhansl–Schmuckler key detection, Müllensiefen step-contour
  similarity, roman-numeral helpers, cadence classification, NCT reduction, 4-way voicing.
- **`generate`** — the **hook** generator, the **progression library**, HMM harmony
  inference (Viterbi + FFBS), the per-role generators, and `arrange()` wiring the
  per-role seed DAG.
- **`critic`** — hard-constraint checking (range, articulation, breath, contour floor)
  and MMR diversity selection.

**App layer** (`tsconfig.app.json` — adds DOM):

- **`midi`** — hand-rolled SMF reader and writer, zero deps. Export stamps each track
  with the GM program its timbre declares; that number is how munch recovers the voice.
- **`audio`** — the two-clock transport (`setInterval` scheduling ahead of the
  sample-accurate `AudioContext` clock) with two hot-swaps: `swapTo` (immediate) and
  `swapAtBoundary` (next bar line, ringing voices left alone), plus a synth that holds
  no tone decisions of its own — every number comes from `core/timbre.ts`.
- **`app`** — vanilla-TS UI: a single `Store`, the stage rail, a role-coloured canvas
  piano-roll, snapshot-based branching history, and a pin tray.

**Shipping to the game.** munch authors no music: it pulls a strict subset of this repo.
Themes live in `themes/` as `SongSpec` files — hook, genome, tempo, ~3 KB — and
`renderSong(spec, mood)` rebuilds the arrangement at any point in the mood square, so the
game ships a few hundred bytes instead of a bank of stems.

The loop is: export `song.json` from the app → drop it in `themes/` → `npm run ship`. That
validates every theme against the current engine (`src/themes.test.ts`), then copies the
engine and the themes into munch under a single hash, with an `index.json` naming them.
Engine and themes move together on purpose — they drift in opposite directions and both
breaks are silent, so `ship:check` fails if either half is stale.

Two inversions worth knowing. Harmony is **owned**, not inferred — it comes from a
chosen progression, and the melody is generated against it. And instruments constrain
generation while **tempo never enters it**: the critic checks the result against the
real BPM afterwards, and `GENERATION_REF_BPM` names the one assumption generation makes.

## Design

Six orchestral roles → six hues, reused across the legend, chord strip, piano-rolls
and cards, so colour encodes voice everywhere. Graphite-blue workstation surface;
Instrument Sans for display, DM Mono for data, Bodoni Moda for the wordmark.

## Not yet built

Multi-track MIDI import. `parseMidi` merges every track into one melody line and drops
program changes, so an imported file arrives as a tune rather than an arrangement — the
export side already stamps GM programs and `timbreForProgram` already reads them back, so
the round trip is half-built. Needs per-track notes out of the parser.

The two harmonic hard-rejects that need voice separation (§7.5); per-recurrence
variation chains (Phase 5); mapping real battle state onto the mood axes, and flipping
`MUSIC_DISABLED` so any of it is audible in game (Phase 6); IndexedDB persistence.
