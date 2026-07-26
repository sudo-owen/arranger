# Battle-mode rework — implementation plan

Target: an **adaptive** battle-music system for `snack/munch` — a chiptune/orchestral
hybrid at 140–185 BPM, 30–90 seconds, built around a repeated hook, that deforms in
response to how the fight is going. Authored through a staged flow where every step is a
choice between close variants.

Decisions taken (2026-07-25):

| | |
|---|---|
| **Delivery** | `song.json` + `.mid`, rendered by munch's synth. song-creatr's audition synth must match it. |
| **Scope** | Restructure the app around the staged flow. MIDI import + chord editing become an "advanced" drawer. |
| **Critic** | Voice classes — chip voices exempt from articulation/breath limits, acoustic voices keep them. |
| **History** | Full branching tree, every node restorable, pin tray for A/B. |
| **Adaptive** | Vertical layers (instant) + parametric regeneration (bar-aligned). Engine ports into munch. |
| **Mood space** | 2D — urgency × fortune. |
| **Sequencing** | Adaptive work interleaves from Phase 3. |
| **Cross-repo** | Yes — munch's synth and scheduler are in scope. |

`PLAN.md` describes the previous round of work (styling, seed melodies, lineage panel)
and is now stale.

---

## Why the current flow fights this goal

| Problem | Where |
|---|---|
| No motif — seed melodies are a random walk, nothing repeats | `src/app/seeds.ts:19` |
| Growth is one hard-coded doubling gesture | `src/app/seeds.ts:101` |
| Every generate re-randomizes all five roles; no per-role reroll | `src/app/state.ts:181` |
| Form/Section types exist but every call site uses `wholeForm()` | `src/generate/context.ts:41` |
| `genome.skeleton` is never read by `arrange()` — the form gene is dead | `src/generate/arrange.ts:19` |
| History nodes drop genome + candidates, so going back destroys your arrangement | `src/app/state.ts:21`, `:207` |
| `starred[]` is written and never rendered | `src/app/state.ts:277` |
| Audition synth (sine/saw) ≠ game synth (square/triangle/noise) | `src/audio/synth.ts` vs `battle-music.service.ts:138` |
| Acoustic articulation limits reject fast leads at battle tempo | `src/critic/critic.ts:33` |
| `drums.swing` exists in the genome but is hard-coded to 0 | `src/app/state.ts:62` |
| munch plays every pitched channel as square except the lowest | `battle-music.service.ts:138` |
| munch music is hard-disabled | `battle-music.service.ts:7` |

Worth building on: `arrange()` draws each role from its own seed (per-role reroll is
free), the 7-operator algebra in `src/core/operators.ts` is exactly the vocabulary for
per-recurrence variation, and the engine is DOM-free (`tsconfig.json:6`) with zero
runtime dependencies — so it ports into Angular unmodified.

## Length targets

At 160 BPM in 4/4: **30 s ≈ 20 bars · 60 s ≈ 40 bars · 90 s ≈ 60 bars.**
Phase 4 grows the 16-bar bed by 1.5–4× via a section plan, not another doubling.

munch loops the track (`battle-music.service.ts:127`), so the final bar must join bar 1
cleanly. Loop seam is a Phase 4 constraint, not an afterthought.

---

## The adaptive architecture

### Two time-scales

- **Immediate (< 50 ms) — vertical.** Per-role gain and mute, plus a filter sweep. A big
  hit lands and a layer opens instantly. No regeneration.
- **Musical (next bar) — parametric.** Mood change re-runs `arrange()` with a deformed
  genome and swaps in the new notes at the next bar line.

**Invariant: `genome.melody.seed` never changes with mood.** The accompaniment, harmony
colour and density deform; the hook does not. If the tune itself changes with game state
it stops being one battle theme.

### The mood space

```
                    fortune ↑ (winning)
        cruising            │            triumphant charge
    (thin, major, relaxed)  │      (brass fanfare, major, driving)
   ─────────────────────────┼───────────────────────── urgency →
      grinding attrition    │            desperate scramble
   (sparse, minor, plodding)│    (16ths, diminished colour, high register)
                    fortune ↓ (losing)
```

- **urgency** → `drums.fillDensity` ↑, hats 8th→16th, `bass.walkiness` ↑,
  `brass.density` ↑, melody register climb at the extreme, tempo +0–8 %.
- **fortune** → the *harmonic* axis. High: progression brightens toward major/mixolydian,
  picardy third on the tag, brass fanfare layer. Low: diminished and ♭II colour, falling
  contour bias, thinner brass, lower register.

New pure module `src/generate/mood.ts`:

```ts
export interface Mood { urgency: number; fortune: number } // both 0–1
export function deform(base: Genome, mood: Mood): Genome
export function progressionFor(base: ProgressionSet, mood: Mood): Harmony
export function layerGains(mood: Mood): Record<Role, number>
```

`deform` is pure and total — every mood point yields a valid genome, so the runtime can
never land somewhere unrenderable.

### `song.json`

```jsonc
{
  "version": 1,
  "bpm": 168, "meter": { "num": 4, "den": 4 },
  "hook": { "cell": …, "scheme": "sequence-up", "key": … },
  "progressions": { "dark": […], "neutral": […], "bright": […] },
  "form": { "sections": […] },
  "genome": { … },
  "layers": { "melody": "always", "bass": "always", "drums": "always",
              "brass": "fortune>0.55", "winds": "urgency>0.4" }
}
```

A few hundred bytes, versioned, replacing a bank of pre-baked stems. The `.mid` export
survives as a preview/fallback artifact.

### Engine sharing

song-creatr and munch are separate trees. Proposal: a `build:engine` script in
song-creatr emitting `dist/engine/`, copied into munch at `src/app/music/engine/` with a
generated-file banner, plus a checksum test in munch that fails CI if the copy drifts
from source. Avoids monorepo surgery; revisit if the copy becomes a nuisance.

### Transition mechanics

Land every parametric change on a bar line and cover the seam with a **drum fill** —
`generateDrums` already writes fills at bar 4/8 boundaries (`src/generate/roles/drums.ts:39`),
so this is existing machinery pointed at a new trigger. Never crossfade: two square-wave
renderings of different material phase against each other and it reads as a glitch.

> **`swapTo` is not directly reusable.** `Transport.swapTo` (`src/audio/scheduler.ts:107`)
> calls `halt()`, which stops *every* live node — fine for A/B auditioning where an abrupt
> cut is acceptable, wrong for in-game transitions where it will chop ringing notes. munch
> needs a boundary-aligned variant that leaves already-scheduled voices to finish and
> only replaces events from the swap point forward. Build it in song-creatr first (the
> mood pad needs exactly the same behaviour), then port.

### Latency budget

munch schedules on a 25 ms poll with 100 ms lookahead (`battle-music.service.ts:15-16`).
A bar at 168 BPM is ~1.43 s, so regenerating one bar ahead has ~1.3 s of slack —
`arrange()` over 40 bars should be single-digit milliseconds. Measure in Phase 3; if it
ever approaches the budget, move it to a Worker (already a README follow-up).

---

## Phases

### Phase 0 — Foundation ✅ done

Six decisions worth recording, because they differ from what this plan first said:

1. **Bass moved from tuba to triangle.** Class-gating the critic meant an acoustic
   tuba bass would newly be held to a 4-second breath limit — and it plays a note per
   beat for the whole song, so every candidate would have been rejected. It was only
   passing before because the old gate never looked at it. Triangle bass is also what
   the target sound wants.
2. **No `NOISE_PERC` instrument.** Drums deliberately carry no `Instrument` (they are a
   pitch map, not a range), and inventing one would create a range check for a drum kit.
3. **The critic gates on class *and* monophony**, not role names. `runSeconds` measures
   a single line, so pointing it at a block-voiced brass stack produces a meaningless
   number — that gate now says what it means.
4. **munch's drums levelled up rather than song-creatr's levelling down.** Parity could
   have been reached by making song-creatr play band-passed noise; instead munch got
   the swept-sine kick and noise/tone snare. Battle music lives on the kick.
5. **munch now honours velocity.** It previously rendered every note at a fixed peak,
   which flattened the arrangement's internal balance (winds 74 vs melody 92 vs brass 88).
6. **`swapTo` survives for grid-changing swaps** (tempo, length); `swapAtBoundary` is
   wired to candidate A/B and pin auditioning.

Verified: 88 tests green, both typecheck boundaries clean, and the app driven end to end
in Chrome — seed → source → generate → pin two takes → branch away → step back (6
arrangements restored) → audition a pin → export MIDI. Zero console errors beyond a
pre-existing `/favicon.ico` 404.

`MUSIC_DISABLED` in munch is still `true` — flipping it is Phase 6 / a product call.

### Phase 0 — original scope (no visible UI change)

- **Voice classes.** `src/core/instruments.ts`: add `class: 'chip' | 'acoustic'` to
  `InstrumentSpec`; add `PULSE_LEAD`, `PULSE_2`, `TRI_BASS`, `NOISE_PERC` with no
  articulation ceiling. `src/critic/critic.ts:33` skips articulation-rate and
  breath-length checks for chip class.
- **Timbre parity.** Rewrite `src/audio/synth.ts` so chip roles mirror munch exactly —
  square lead, triangle bass, noise drums through the same 160/320/4000 Hz bandpass
  split and envelopes. Acoustic roles keep the filtered saw. One shared timbre table.
- **munch synth.** Map GM program numbers → timbre in `scheduleNote` so the hybrid is
  actually audible in-game (~30 lines). Without this, everything collapses to square.
- **History carries everything.** `EvolutionNode` gains `stage`, `hook`, `genome`,
  `candidates`, `form`, `progression`, `mood`. `selectEvolution()` restores all of it.
  Add `pinned: NodeId[]` and a compare tray.

### Phase 1 — Shell + Stage 1 (Hook) ✅ done

Layout direction chosen from three clickable mockups in `mockups/` (kept as the visual
reference): **A · stage rail**, at a larger card and type scale with raised contrast.

Two generator bugs the tests and the browser caught, both quality rather than crashes:

1. **One-pitch cells.** The strong-beat rule could pick the root every time while the
   weak-beat walk clamped back to it, so some seeds produced a hook on a single
   repeated note. Fixed by reflecting instead of clamping at the edges of the pitch
   set, capping how long one anchor can run, and making "at least three distinct
   pitches" an enforced invariant rather than a tendency. 600 generated cells now
   land in the 3–5 band.
2. **Rhythm collisions in a set.** Drawing a rhythm per card independently meant a
   six-card set routinely showed four cards on the same rhythm — most of the choice
   wasted. Rhythms and schemes now rotate from a single offset, so all five of each
   appear before any repeat.

Stages 3–5 render what exists today (tempo, extend-to-8/16) with an explicit note
naming what is still missing, so the rail is walkable end to end rather than dead.

Verified: 104 tests green, both typechecks clean, driven in Chrome through
hooks → reroll → commit → 6 beds → pin two → branch away → restore (6 arrangements
back) → all five stages → export. Zero console errors.

### Phase 1 — original scope

Stage rail (`Hook → Bed → Mood → Form → Variation`), lineage sidebar, advanced drawer.

New pure `src/generate/hook.ts`:

```ts
export type RestatementScheme =
  | 'immediate' | 'sequence-up' | 'sequence-down' | 'answer' | 'ostinato';
export interface Hook { cell: Motif; scheme: RestatementScheme; key: Key; meter: Meter }
export function generateHook(opts: HookOptions): Hook
export function renderHook(h: Hook, bars: number): Motif
```

Cell generated **rhythm first** from a library of battle rhythms (driving 8ths, gallop,
syncopated 16ths, fanfare), then pitched against a chord arpeggio plus passing tones and
constrained to **3–5 distinct pitch classes** — few pitches with a distinctive rhythm is
what makes a hook stick. `renderHook` reuses `sequence()` and `invert()`.

UI: 6 hook cards, preview on hover, reroll all or one in place.

### Phase 2 — Stage 2 (Bed, 16 bars) ✅ done

Two engine bugs surfaced, both of which would have quietly capped the quality of
everything built later:

1. **`generateMelody` snapped every onset to the beat.** Written for quarter-note
   source melodies, where it is a no-op; against a hook it collapsed a bar of eighths
   or sixteenths onto four onsets, discarded the rest as duplicates, and then failed
   the contour floor — the generator throwing away the tune it was asked to preserve.
   Every palette was rejected at every register until this was fixed. Now snaps to
   sixteenths, which leaves quarter-note sources byte-identical (the golden tests
   confirm it).
2. **`generateBass` ignored its instrument's range.** Winds and brass have always
   folded into range; bass never did, so `register: -1` wrote below any bass voice's
   floor. Now takes the palette instrument and folds like the others.

Deliberate scope cut: **no acoustic-lead palette.** A flute or clarinet lead is
correctly rejected by the critic at 168 BPM (breath limit over a continuous 16-bar
line), so offering it would mean offering a card that can never be generated. Lead is
always chip and bass always triangle; the palette varies only winds and brass.

Verified: 122 tests green, and in the browser six beds covering six distinct
progressions across dark/neutral/bright with four palettes rotating, chords resolving
correctly (`i–♭VI–♭VII–i` → Am F G Am, `i–iv–V–i` → Am Dm E Am), and the chord strip
following the selected card.

### Phase 2 — original scope

- New `src/generate/progressions.ts` — named battle loops (`i–♭VI–♭VII–i`, `i–iv–V–i`,
  Andalusian `i–♭VII–♭VI–V`, `vi–IV–I–V`) in dark/neutral/bright variants, so Phase 3's
  fortune axis has somewhere to move. Choosing a progression beats correcting an
  inferred one.
- Candidates hold `genome.melody.seed` fixed and vary progression + accompaniment, so
  you audition *orchestration* rather than a new tune per card.
- New genome field `palette` — which roles render chip vs acoustic.

### Phase 2b — Phrasing and sections ✅ done

Two changes toward making an acoustic lead possible, both worth having regardless.

**Hooks breathe.** `renderHook` now clears an eighth note at the end of every phrase
(minimum phrase: two bars, so a one-bar ostinato sings rather than gasps). Four of the
five rhythm figures fill every sixteenth of the bar, so tiling them straight produced
one unbroken 23-second line — unplayable by anyone, and tiring to listen to for two
minutes of combat regardless of who is playing it. Longest phrase is now 5.5s.

**Sections are explicit.** `InstrumentSpec.section` means a desk of players who stagger
their breathing, so the phrase limit does not apply; articulation still does, because
they do not share a tongue. `BRASS_SECTION` is now a real spec with `section: true`
instead of a plain `Instrument` that escaped every check because its name was missing
from the lookup table. Added `WIND_SECTION`, which the acoustic palettes now use in
place of a solo oboe — the winds generator writes sustained gap-filling lines, which is
section writing, not solo writing.

**Ornament respects the voice.** `ornament` now reads `Context.instrument` — a field
that had been declared since the original spec and never once passed — and refuses to
subdivide below what that voice can articulate: a sixteenth for acoustic, a
thirty-second for chip. Decorating a line of sixteenths was writing thirty-seconds at
22 notes/sec, past any player; the critic caught it afterwards and threw away the whole
arrangement. Not writing the figure is the honest fix. Derived from voice class rather
than tempo, because tempo deliberately does not enter generation (§8.5).

**Result: `winds-lead` is a real palette.** The hook itself carried by the wind section
over a chip rhythm section. All five palettes now pass the critic across every rhythm,
every register and ornament at 0.3 — 100 combinations in the test.

One consequence worth knowing: melodies are no longer byte-identical across palettes.
An acoustic lead gets the same skeleton with the unplayable ornaments left out, so its
onsets are a strict subset of the chip version — the same tune, less surface, never a
different tune. The bed test asserts exactly that.

### Phase 3 — Stage 3 (Mood) ✅ done

**3a · Authoring.** `generate/mood.ts` holds the 2-D model: `deform(genome, mood)`
(total over the unit square, and it never touches `melody.seed`), `progressionForMood`
(sticky — it keeps the current progression while its brightness still fits, or a pad
drag across a border swaps harmony every frame), and `layerGains`. `generate/mutate.ts`
adds `neighbours()` (k variants, each one field apart) and `rerollRole()`, which finally
uses the per-role seed independence `arrange()` has had since the start.

The pad previews on drag and commits on release: routing pointer moves through the store
would rebuild the panel under the cursor, so the drag re-arranges and swaps at the next
bar line for audio only. The stage also reports live whether the bed survives all four
corners.

**3b · Runtime.** `npm run vendor:engine` copies the DOM-free packages into
`munch/src/app/music/engine` with a recorded checksum; `npm run vendor:check` fails if
they drift. `BattleMusicService` now renders from `song.json` via the engine instead of
parsing a MIDI file — which deleted its hand-mirrored timbre table and its hand-rolled
MIDI parser outright. Mood moves on two time-scales: per-role gain nodes glide in ~80 ms,
and the re-arrangement swaps at the loop point, the one boundary always beyond the
lookahead window.

Verified end to end: a song authored in the app, exported as **3.1 KB of song.json**,
rendered by munch's own vendored engine across 25 mood points — zero invalid, note
counts rising monotonically with both axes, and the melody at exactly 150 notes at every
corner, so the hook really is invariant.

One honest note: mood can change the melody's *ornamentation*, because a re-picked
progression can push the ornamented line below the contour floor and it falls back to
its bare skeleton. The tune is the same; the surface may lose an ornament.

`MUSIC_DISABLED` is still `true` in munch — flipping it stays a product call.

### Phase 3 — original scope

**3a · Authoring (song-creatr)**
- `src/generate/mood.ts` as above.
- `src/generate/mutate.ts` — `neighbours(genome, rng, k)`: variants differing in exactly
  one field, so every choice is between close relatives, never strangers.
- **Mood pad**: a 2D surface you drag while it plays, hearing the song deform live.
  Requires the boundary-aligned swap described above.
- Corner validation — the critic runs at all four corners, not one arrangement. A genome
  that's great at neutral and shreds at high urgency is caught at authoring time.
- Remaining knobs: BPM (presets 140/155/170/185), swing (currently hard-coded to 0),
  climax position, per-role 🎲.

**3b · Runtime (munch)**
- Port the engine, ship `song.json`, wire the vertical layer mixer.
- Prove the loop end-to-end on the 16-bar bed before Phase 4 makes it a full song.

### Debt clearance (after Phase 3) ✅ done

Three things flagged during the reviews and left alone at the time.

**The chord strip and the HMM path were inert — including for imported MIDI.**
`inferHarmony` ran on import, and then `generateBeds` overrode it with a library
progression, so every chord edit, the temperature slider and re-infer were writing to a
value nothing downstream read. Rather than delete a spec feature, they now live exactly
where they apply: a hook's harmony belongs to its bed's progression (chords render
disabled, with a line saying so), and imported material — which genuinely has no
progression — is arranged over its own inferred, hand-correctable harmony. Verified in
the browser: a chord edit on the demo import survives Generate.

**A second hook wiped the first hook's history.** `useSelectedHook` set
`evolution: [node]`, discarding the tree — so the one comparison a branching tree exists
for could not be made. Each hook is now its own root and every subtree stays reachable.

**Beds are corner-validated.** A bed that falls apart at an extreme is not a bed worth
offering; the Mood stage would only report it afterwards. Same rule that already governs
the palettes. Measured cost: none — still 6 of 6 beds per Generate across 20 runs.

### Phase 4 — Stage 4 (Form → 30/60/90 s) ✅ done

`generate/form.ts` plans sections; `arrange()` finally reads `g.form`, which had been
declared since before this work and read by exactly one line (the crash cymbal).

**`Section.density` became `Section.mood`.** Density was urgency under another name, on
one axis where the rest of the system has two — no way to say "quieter but brighter".
Section moods are absolute positions COMPOSED with the track's current mood, so dragging
the pad raises or lowers the whole arc instead of flattening it. The `Mood` type moved to
core, since `Section` carries one.

Two constraints shape every plan: bar counts are whole phrases (four bars), and the total
is a multiple of the four-chord progression so the last bar leads back to the first.
`loopSeamProblems` in the critic checks the join three ways — a chord that does not
return, a crash colliding with the downbeat crash, and material sustaining past the loop.

Two real bugs surfaced:

1. **`contourSimilarity` sampled at a fixed 32 points regardless of length.** Fine at 16
   bars, but at 64 that is one sample every two bars — below the rate the melody moves,
   so it measured aliasing and rejected long tracks for "sounding different". Sampling now
   follows length at eighth-note resolution. This was pre-existing; Phase 4 exposed it by
   making tracks long enough to trip it.
2. **A six-section shape cannot fit 30 s at 140 BPM** (16 bars, needs 24). `shapesFor`
   only offers plans that fit, rather than silently overrunning the requested length.

`SongSpec` carries `formShapeId`, without which the game rendered the right number of
bars with no arc — a long loop rather than the track that was auditioned.

Verified end to end: a 60 s Arc authored in the app, exported as **2.4 KB**, rendered by
munch's own vendored engine — 44 bars / 62.9 s, sections `intro 4 · A 12 · A' 8 · B 8 ·
A" 8 · tag 4`, zero invalid mood points, drum density tracking the arc (8.5 → 12.8 → 16.9
hits/bar at the climax), and the melody within 2% across all four corners.

### Phase 4 — original scope

- New `src/generate/form.ts`: `planForm(targetSeconds, bpm, meter, rng, style): Form`.
  60 s at 160 BPM = 40 bars, e.g. `intro 4 · A 8 · A′ 8 · B 8 · A″ 8 · tag 4`, each
  section carrying intensity and a role set.
- **`arrange()` starts reading `g.form.sections`** — role generators look up the section
  at time *t* and scale density by its intensity. Signature-preserving change to
  `bass.ts`, `drums.ts`, `winds.ts`, `brass.ts`. Also revives `drums.ts:37`, which today
  crashes only on bar 1.
- Loop seam: tag cadences back into bar 1, no crash on the wrap; `loopSeamScore` in the
  critic rejects candidates that thud at the join.
- Adaptive extends to section scale — mood biases which section comes next.

### Phase 5 — Stage 5 (Variation) ✅ done

Per-recurrence operator chains in `generate/variation.ts`. Seven treatments — as-written,
thinned, ornamented, octave up/down, answered, double-time — each a bounded chain over
the `core` operators, applied to the SOURCE per section before `arrange`, so all five
voices answer the variation rather than the statement.

A treatment with a knob bounds itself: `thinned` and `double-time` search their
thresholds for the boldest move that still reads as the hook. Kinship is measured by
contour similarity, which is blind to time-scaling and — by also scoring the first
statement alone — to repetition, so `double-time` and `octave-up` both register as the
same tune. `variationProblems` is the backstop for anything a treatment cannot bound.

The UI is five whole-track schemes to compare, plus a per-section grid, each card showing
what share of every section's notes the treatment moved.

Mood-awareness is `variationForMood`: outside a ±0.25 band around neutral fortune, every
section steps one rung along `thinned → answered → as-written → ornamented`; a section
already at the bottom strains upward to `octave-up` instead. Authored register and tempo
statements are left alone. Like `deform` it biases rather than assigns, and it is exactly
the identity at neutral — so what you author is what you audition, and the fight arcs
change the tune rather than only the mix. The triumphant half of "brass restatement" was
already served by `layerGains`, which brings brass forward as fortune rises.

The sub-melody is in `roles/winds.ts`: where the melody leaves a whole window open —
which is what a thinned section is — the winds carry the hook's own material inverted
around its centre rather than punctuating the gap. Measured, a thinned section carries
~60% more wind than an unvaried one.

**Not built, deliberately:** per-recurrence reroll. Only `ornamented` is stochastic, so a
reroll button would do nothing on six of the seven treatments; a version worth having
needs per-section state, which is the `Section.variation` restructure below.

`melody.radius` and the whole `skeleton` group were removed from `Genome` — written by
`bedGenome`, read by nothing. Section plans live in `Form`, which is what `arrange`
actually reads.

This is the anti-fatigue lever — the hook returns four times and is never identical.

### Phase 6 — Game integration

Map real battle state (HP ratio, turn momentum, status effects, boss phase) onto
urgency × fortune in `battle.component.ts`; smooth it so the music doesn't twitch on
every point of damage. Flip `MUSIC_DISABLED`. Tune against real fights.

---

## Ordering rationale

Phase 0 first because timbre parity changes every judgement made afterward — without it
you tune against a sound that isn't what ships. Phases 1–2 produce a static 16-bar loop
worth listening to. Phase 3 proves the adaptive loop end-to-end while the musical
material is still small enough to debug. Phase 4 is the largest new algorithm. Phase 5 is
taste surface and wants the whole song audible first.

## Known next steps

- **`Section.variation`** — variation is keyed by `SectionLabel` and threaded separately
  through `arrangeAtMood`, `SongSpec`, `Snapshot`, `AppState` and two caches. `Section`
  already carries `mood` the same way, materialised by `planForm`. Moving variation there
  removes the parallel channel, makes keying positional (so a form could repeat a label,
  and A′ could differ from A″ on the same material), and is what per-recurrence reroll
  needs. ~2–3h; changes the wire format.
- **`violations(arr, source, bpm)`** — every production caller now passes `arr.source`.
  The parameter's only remaining function is to let a caller pass the wrong one, which is
  what broke the reroll invariant under a variation once already.
- **Fight arcs run on a wall clock**, polling `transport.playing` on a 100 ms interval.
  `Transport` already exposes `positionSec`/`loopLenSec` and fires `onTick`; driving from
  those makes the arc loop-synchronous by construction and survives pause and seek.
- **`setTreatment` writes a history node per click**, unlike every other audition control
  — the mood pad previews on drag and commits on release.

## Deferred

IndexedDB persistence, offline WAV render, sampled soundfont, generation Web Worker
(unless Phase 3 measurement demands it), the two harmonic hard-rejects needing voice
separation.

## Open sub-decisions

- **Engine sharing** — copy-with-checksum vs `file:` npm dependency. Settle at Phase 3;
  copy-with-checksum is the default.
- **Mood smoothing** — how fast urgency/fortune are allowed to move. Needs real fights to
  tune, so it lands in Phase 6.
