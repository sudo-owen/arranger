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
npm run vendor:engine  # copy the DOM-free engine into munch
npm run vendor:check   # fail if munch's copy has drifted
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

MIDI import and hand-editing the inferred chord progression live in the **Advanced**
drawer. `PLAN-battle-mode.md` tracks what is built and what is next.

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

**Shipping to the game.** `song.json` is a `SongSpec` — hook, genome, tempo, ~3 KB — and
`renderSong(spec, mood)` rebuilds the arrangement at any point in the mood square. munch
vendors the engine (`npm run vendor:engine`) and calls that directly, so the game ships a
few hundred bytes instead of a bank of stems, and hears exactly what was auditioned here.

Two inversions worth knowing. Harmony is **owned**, not inferred — it comes from a
chosen progression, and the melody is generated against it. And instruments constrain
generation while **tempo never enters it**: the critic checks the result against the
real BPM afterwards, and `GENERATION_REF_BPM` names the one assumption generation makes.

## Design

Five orchestral roles → five hues, reused across the legend, chord strip, piano-rolls
and cards, so colour encodes voice everywhere. Graphite-blue workstation surface;
Instrument Sans for display, DM Mono for data, Bodoni Moda for the wordmark.

## Not yet built

The two harmonic hard-rejects that need voice separation (§7.5); per-recurrence
variation chains (Phase 5); mapping real battle state onto the mood axes, and flipping
`MUSIC_DISABLED` so any of it is audible in game (Phase 6); IndexedDB persistence.
