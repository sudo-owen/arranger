# Arrange — generative arrangement engine

Implementation of the spec v1.0. Turns a melody into a full tonal arrangement —
bass, drums, woodwinds, brass, extended melody — over an **owned** chord
progression, as (mostly) pure functions of a ~40-byte genome. Ships with a native
WebAudio app so you can hear it, correct the harmony, and A/B candidates.

## Run

```bash
npm install
npm run dev        # Vite dev server — open the printed URL
npm run build      # typecheck (both boundaries) + production bundle -> dist/
npm test           # 64 unit/property/golden tests
npm run typecheck  # tsc over the pure packages, then the app layer
```

In the app: **Try a demo melody** (or **Load MIDI**) -> the key and chords are
inferred -> correct any chord (click cycles it; shift-click steps back) -> **Generate**
a diverse set -> **Play** and click cards to hot-swap between them -> **Export MIDI**.

## Architecture

Two layers, enforced by two tsconfigs.

**Pure engine** (`tsconfig.json` — no DOM; `any`/`as` banned outside brand constructors):

- **`core`** — branded primitives (`Tick`/`Midi`/`PC`/`Degree`), the data model
  (Note, Motif, Chord/Harmony, Form, Genome, Arrangement), pitch/meter math, the
  §7.1 metric-weight grid, the 7-operator algebra, the §8.5 instrument-range table,
  and a seeded **sfc32** RNG with label-based `fork` (fixes the §8.2 child-independence bug).
- **`theory`** — Krumhansl–Schmuckler key detection, Müllensiefen step-contour
  similarity (the melody floor), roman-numeral/degree helpers, cadence classification,
  NCT reduction, and 4-way voicing (close / drop-2 / drop-3).
- **`generate`** — the **HMM harmony inference** (Viterbi for the shown progression,
  FFBS + temperature for variation — §7.2), the per-role generators (bass, melody,
  drums, winds, brass — §7.4), and `arrange()` wiring the per-role seed DAG (§8.1).
- **`critic`** — hard-constraint checking (range, articulation rate, phrase length,
  the contour floor — §7.5) and MMR diversity selection (§7.6).

**App layer** (`tsconfig.app.json` — adds DOM; imports the pure engine):

- **`midi`** — hand-rolled Standard MIDI File reader and writer (zero deps).
- **`audio`** — the two-clock transport (setInterval scheduling ahead of the
  sample-accurate `AudioContext` clock — §9.1) with loop and mid-phrase hot-swap
  (§9.3), plus a per-role WebAudio synth.
- **`app`** — vanilla-TS UI: a single `Store`, a role-coloured canvas piano-roll,
  the editable chord strip, and the candidate grid.

The central inversion (§3.3): the melody->chords arrow runs **once**, at import. After
that, harmony is owned data and the melody is generated *against* it. Structure is
deterministic; only the harmony sampler is stochastic (temperature over the HMM
posterior). Same genome -> same arrangement, always.

## Design

Five orchestral roles -> five hues, reused across the legend, chord strip, piano-rolls,
and candidate cards, so colour encodes voice everywhere. Graphite-blue workstation
surface; Space Grotesk for display, IBM Plex Mono for data.

## Not yet built (beyond M0–M2)

The form/extension **sentence algorithm** (§7.3), so generation currently arranges over
the inferred span rather than growing new phrases; the two harmonic hard-rejects that
need voice separation (inner-voice dissonance on weight-4 beats, outer-voice parallels
— §7.5); chord-tone-aware **ornament** quality and the radius->operator-chain reroll loop
(the taste-critical §13.2 work); breeding/locks UI, IndexedDB persistence, a generation
Web Worker, and a sampled soundfont in place of the synth.
