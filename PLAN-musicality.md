# Musicality plan — from "clever" to "music"

The engine reliably produces arrangements that are *correct*: in range, playable, loopable,
kin to the hook. What it does not yet produce is a track a composer would defend. This plan
lists what a working VGM composer would object to, grounds each objection in the code, and
sequences the fixes so each is one shippable change.

`PLAN-battle-mode.md` covers the staged flow and the adaptive model, and is current. This
document is about the *output*, not the workflow.

---

## The objections, and where they live

| Objection | Where |
|---|---|
| Monothematic — the B section is the A hook thinned, not a second tune | `variation.ts:120` (`TREATMENTS`), `form.ts:47` (B mood = quieter A) |
| No loop point; the intro is re-heard every pass | `song.ts:23` (`SongSpec` has no loop marker) |
| Exactly one chord per bar, in every track ever generated | `progressions.ts:153` |
| No modulation — the tonic is fixed for the life of the piece | `progressions.ts:16` (deliberate, see Phase 8) |
| Parallels and inner-voice clashes are unchecked between roles | `critic.ts:10` — documented TODO |
| Velocities are per-role constants; no phrase shape at all | every generator; only drums scale |
| No arpeggios, slides, duty modulation, or echo — the chip idiom's core vocabulary | `render/voice.ts`, `core/timbre.ts` |
| Bass is a jazz walking idiom, not a battle idiom | `roles/bass.ts:29-38` |
| Four drum pieces; fills only on the last beat of bars 4 and 8 | `timbre.ts:123-133`, `roles/drums.ts:42` |
| 4/4 only, even phrases only, no pickups | `state.ts:164`, `form.ts:72` (`PHRASE_BARS`) |
| Orchestration never changes by section — only density does | `form.ts:43` (`SECTION_MOOD`) |

Worth building on: `weightsFor(meter)` already computes the §7.1 metric grid and is read by
exactly one caller (`isStructural`), so Phase 1 has its input for free. `chordAt` handles
chord events of any duration, so Phase 4 needs no generator changes. `theory/voicing.ts`
returns *ordered* pitches, which is most of the voice separation Phase 7 needs.

## Order, and why

Cheapest perceptual win first, then the two structural gaps, then idiom, then the quality
gate. Each phase is independently shippable and independently revertable.

1. **Phrase dynamics** — biggest change in perceived quality per line of code, zero architectural risk
2. **Loop point + a real intro** — a convention gap rather than a refinement; unblocks munch
3. **A second theme** — the largest musical payoff and the largest design surface
4. **Harmonic rhythm** — cadential acceleration, pedal, stop-time
5. **Rhythm-section idiom** — bass patterns, a real kit
6. **Chip vocabulary** — arpeggios first, then slides and duty
7. **Voice-leading critic** — close the documented TODO
8. **Deferred** — modulation, meter, micro-timing, production

Phases 1, 4, 5 and 7 are engine-local. Phases 2 and 6 change the wire format or the timbre
table and therefore need `npm run ship` plus a munch-side change.

---

## Phase 1 — Phrase dynamics ✅ done

Four decisions that differ from what this plan first said:

1. **Additive, not multiplicative.** Scaling widens the gap between roles as the track gets
   louder, so the climax is not just louder but differently balanced — the winds fall out
   from under the brass exactly when the arrangement is thickest. A shared offset moves the
   ensemble and leaves the authored mix intact. `velocityGain`'s 1.3 ceiling makes the
   multiplicative version worse still: a melody at 92 clips almost immediately.
2. **Drums opt out of the level too, not just the accent.** `generateDrums` already writes
   `88 + intensity * 24` on the kick, so applying the section level again counts it twice.
   Drums take the lead-in only.
3. **The lead-in wrap removes the loop-seam risk by construction.** The final bars ramp to
   exactly the level the track returns to, so no separate seam guard was needed. (Phase 2
   groundwork later pointed that wrap at `form.loopStart` instead of tick 0.)
4. **Mean velocity per note is a misleading measure for drums.** It falls from intro to
   climax, which looks like a bug and is not: the kick rises 94.5 → 107.2 while the hat
   count triples, and hats are quiet. The test asserts kick velocity, not the mean.

Two existing contracts changed meaning, both deliberately: `form.test.ts`'s "keeps the hook
identical whether or not a form is applied" and `mood.test.ts`'s "leaves the hook alone at
every point on the axis" now compare `tune()` — pitch, onset, duration — and separately
assert that velocity *does* move. Applying an arc is supposed to change how the hook is
played; only a change of tune was ever the bug.

Measured on a 60-second arc: melody 79 (intro) → 90 (climax), spanning 60–109 against a
previously flat 92, with every melodic role tracing the arc shape and the loop seam within
4.5 velocity. Verified: 213 tests green, both typecheck boundaries, production build.

**The objection.** Melody 92, bass 96, brass 88, winds 74/62, tenor 66/82/84 — constants.
Only drums vary, and only with section intensity. Nothing swells, nothing accents, nothing
tapers. This is the single loudest "MIDI mockup" tell in the output.

**Design.** A new `src/generate/dynamics.ts`: one pure post-pass over the finished
arrangement, so the role generators stay simple and the shaping is uniform and testable.
Three multiplicative layers over each note's written velocity:

- **Metric accent** — from `weightsFor(g.meter)`, the grid that already exists. Strong beats
  up, offbeats down, roughly ±10. Drums opt out: they *define* the metre rather than
  expressing it, and they already carry their own intensity scaling.
- **Phrase arc** — position within the section from `sectionAt(form, t)`. A rise across the
  final quarter of a section whose successor is more urgent; a taper into `tag`.
- **Section level** — the section's own composed mood sets the band the other two work in.

Applied in `arrange()` after the roles are written. Pure, no RNG, so determinism holds.

**Risks.** `velocityGain` clamps to 0.25–1.3 around a nominal 100, so shaping outside
~40–120 is inaudible — the layers must be scaled to that window, not to 0–127. The loop
seam is a real hazard: if bar 1 is soft and the last bar is loud, every loop pass thuds.

**Verification.** Strong beats outrank weak beats per bar on average; a climax section's
mean velocity exceeds the intro's; velocity at the loop seam is continuous within a
tolerance; every velocity stays in [1, 127]; determinism unchanged.

**Not in this phase.** Micro-timing. It moves onsets off the grid, which touches the loop
seam, the critic's articulation gaps and MIDI export quantisation — it deserves its own
decision, and it is wrong for the chip voices regardless.

**Size.** ~150 lines plus tests. No cross-repo change: munch already honours velocity.

---

## Phase 2 — Loop point and a real intro

**The objection.** `SongSpec` carries `bars`, `formTemplate` and `variation`, and no loop
marker, so the whole track loops as one unit and every fight re-hears the intro each pass.
Game-music convention is intro-once, body-forever. The intro is also not an intro: it is the
same hook material at `{urgency: 0.25}`.

**Groundwork already done.** `Form.loopStart` exists and is threaded through its three
consumers, all still defaulting to 0 so nothing has changed behaviour yet:

- `dynamics.ts` ramps the ending toward `form.loopStart` rather than tick 0
- `loopSeamProblems(arr, meter, loopStart)` measures all three checks at the return point,
  and the crash check now only fires when the return point has a crash to collide with
- munch's `loopStart` — the absolute time of the current pass — is renamed `passOrigin`,
  so the tick offset and the clock origin no longer share a name in the one file that
  consumes both

**`SongSpec.loopStart` must be OPTIONAL, in bars, defaulting to 0.** Required would
invalidate the published `battle-theme.json` the moment the field lands, forcing a second
migration; optional means it keeps playing and simply loops whole until re-exported.
`specProblems` should range-check it against `bars` once it exists.

**Design.**

- `planForm` sets `loopStart` to the end of the `intro` section for shapes that have one.
- `SongSpec` gains `loopStart` in bars. `renderSong` surfaces it; `Arrangement` carries it
  so the transport and munch can both read it without recomputing the form.
- `Transport` wraps to `loopStartSec` rather than 0.
- **`loopSeamProblems` changes meaning**: it must check the last bar against the *loop
  start* bar, not against bar 1. Today it checks the wrong join for any track with an intro.
- The intro becomes a distinct gesture rather than a quiet A: a pickup fill, a brass stab on
  the downbeat, the bass entering alone. Cleanest as an intro-only branch in the role
  generators keyed on `sectionAt(...).label === 'intro'`.

**Risks.** Cross-repo — munch's `BattleMusicService` must honour `loopStart` or the game
plays a different structure than was auditioned. The seam-check change will newly flag
existing form shapes, which is the point but will look like a regression.

**Verification.** The seam check targets the loop point; a track with an intro loops back to
the loop point and not to 0; the intro is excluded from the looping body; existing form
length and section-arithmetic tests still pass.

**Size.** Medium, spread thin: core types, `form.ts`, `critic.ts`, `scheduler.ts`, `song.ts`,
plus munch.

---

## Phase 3 — A second theme

**The objection.** Every section is the same 1–2 bar cell processed. B is where a listener
expects a *different tune*, and its absence is why 90 seconds wears through.

**Design.** Three options, and this one is a genuine fork worth deciding before code:

- **(a) Derived contrast** — build B by transformation: retrograde, inversion at a different
  degree, augmentation with a new contour. Cheap, guaranteed related, and risks sounding
  like one more variation, which is exactly the complaint.
- **(b) A second hook, contrast-constrained** — run `generateHookSet` with its own seed and
  *require* contrast: `contourSimilarity(A, B)` below a ceiling, a different rhythm family,
  a complementary register. This is the inverse of the contour floor the critic already
  enforces, which is a pleasing symmetry — the same measure, bounded from the other side.
- **(c) B is authored** — the user picks two hooks from the Hook grid.

**Recommendation: (b) as the generator, (c) as the UI.** The Hook stage picks A; the Form
stage offers "give B its own tune" with a six-card grid pre-filtered for contrast against A.

Consequences:

- `Section` gains `theme: 'A' | 'B'`. `varySource` becomes theme-aware.
- **The contour floor changes meaning.** `critic.ts:58` compares the written melody against
  *the* source; with two themes each section must be judged against its own theme. This is
  load-bearing and easy to get subtly wrong.
- `SongSpec` gains the second hook — still a few hundred bytes.
- The Bed stage's premise survives: B is chosen once, not per bed, so the grid still varies
  only orchestration.

**Risks.** The largest surface of any phase, and it touches the one aesthetic rule the critic
enforces. Contrast that is too strong reads as two pieces spliced together — the ceiling
needs tuning against real output, not chosen a priori.

**Verification.** A/B similarity below the ceiling and above a floor (related, not alien);
each section's written melody kin to its own theme; all existing corner × tempo × palette
sweeps still green.

**Size.** Large. Worth splitting into "engine supports two themes" and "UI to choose B".

---

## Phase 4 — Harmonic rhythm

**The objection.** One chord per bar, always. No acceleration into cadences, no pedal
points, no stop-time — the three devices that make a four-bar loop feel like it is going
somewhere.

**Design.**

- `ProgressionStep` gains `bars?: number` (default 1), so a progression can hold the tonic
  for two bars and then move twice in one.
- `harmonyFromProgression` gains cadential acceleration: in the last bar of a phrase in a
  climax section, split the bar into two chords (a secondary dominant into the target).
- Pedal: `Progression` gains `pedal?: number` (semitones above tonic). `generateBass` holds
  it while the upper voices move.
- Stop-time: better modelled as a variation treatment than a harmonic feature — everything
  but the melody rests for a bar.

**The property that makes this cheap:** every generator reads harmony through `chordAt`,
which already handles events of arbitrary duration. Variable harmonic rhythm needs no
generator changes at all.

**Risks.** `generateBeds` and the form math assume the progression length divides the bar
count ("the total is a multiple of the progression, so the loop joins cleanly"). Variable
step lengths break that assumption and the loop seam depends on it.

**Verification.** The `Harmony` contiguity invariant holds (gap-free cover of [0, length));
the loop seam still resolves; progression tests still pass at every length the UI offers.

**Size.** Medium, concentrated in `progressions.ts`.

---

## Phase 5 — Rhythm-section idiom

**The objection.** The bass walks in quarter notes with chromatic approach tones — a jazz
idiom, at 168 BPM, under a battle hook. The kit is four pieces and the fill is always snare
on the last beat of bars 4 and 8.

**Design.** Both are genome-shaped exactly like the existing enums (`brass.voicing`,
`tenor.motion`), so they cost nothing architecturally:

- `genome.bass.pattern`: `walking` (today) · `driving-8ths` · `octave-pump` · `gallop` ·
  `riff` (locked to the kick).
- Percussion map gains `TOM_LOW/MID/HIGH`, `RIDE`, and open vs closed hat, with voices in
  `drumVoice`. Fills draw from a small vocabulary keyed on intensity rather than one shape.
- `genome.drums.feel`: `straight` · `half-time` · `double-time`.

**Risk worth naming now.** Driving eighths at 185 BPM is 6.2 notes/sec. `LOW_BRASS` — added
last round — has a ceiling of 7/s, and `LOW_WINDS` 10/s. So the new bass patterns land
inside the articulation margin of the low sections we just introduced, and `deep-brass` with
`driving-8ths` at the top of the tempo band will be close to rejection. That interaction
should be a test, not a surprise.

**Verification.** Every (pattern × palette × tempo) combination passes the critic — the same
sweep shape `beds.test.ts` already uses; the kit additions stay inside the GM percussion map
so export still opens correctly in a DAW.

**Size.** Medium, low risk, high payoff per line.

---

## Phase 6 — Chip vocabulary

**The objection.** The single most identifiable technique in the idiom — the fast broken
chord that implies a triad on one channel — is absent, along with pitch slides, duty
modulation and echo. A chiptune composer clocks this immediately.

**Design, split in two:**

**6a — Arpeggios.** The highest-identity, lowest-risk half. An arp is a natural eighth entry
in the `core/operators.ts` algebra: take a sustained chord tone, emit the chord as a cycling
figure at a fixed subdivision. Reaches the output as a `tenor.motion` value and a winds
treatment, gated on chip-class palettes. No renderer change, survives MIDI export, and munch
needs nothing.

**6b — Slides, duty, echo.** Each needs renderer support and a munch-side match:

- *Slide* adds a note-level property, which touches the `Note` type — the most invasive
  change in this document — plus a pitch-bend path in export.
- *Duty modulation* needs a `PeriodicWave` in `voice.ts`; WebAudio's `square` has no duty
  control.
- *Echo* is better generated as notes than as a `DelayNode`: it is what the hardware idiom
  actually did, it survives export, and it needs no renderer change at all.

**Recommendation.** Do 6a alone first, and take echo-as-notes with it. Defer slides and duty
until the renderer work is worth doing in both repos at once.

**Size.** 6a small; 6b medium and cross-repo.

---

## Phase 7 — Voice-leading critic

**The objection.** Roles are generated independently against a chord symbol. Parallel fifths
and octaves between outer voices, doubled leading tones, and inner-voice clashes are all
reachable and none is checked. `critic.ts:10` already says so.

**Design.** The blocker is voice separation, and it is smaller than it looks:
`theory/voicing.ts` already returns *ordered* pitches, so preserving that order through
`generateBrass` gives the critic named voices rather than a chord soup. Then:

- No parallel 5ths/8ves between outer voices across a chord change.
- No m2/M7 between inner voices on weight-4 beats.
- Leading tone resolves where the progression implies it.

**Ship these as warnings, not rejections.** Turning three new hard rules on at once against a
generator that has never been held to them will reject most candidates, and the failure mode
("No arrangement passed the critic") is the worst UX in the app. Surface them on the Bed and
Mood stages, watch the rate, and promote to hard rules individually once the generators earn
it.

**Size.** Medium, and the warning framing is what de-risks it.

---

## Phase 8 — Deferred, with reasons

- **Modulation.** The climax key lift is *the* genre gesture, and it directly contradicts a
  deliberate decision: every progression shares a tonic so the fortune axis can slide
  between them without the track becoming a different piece (`progressions.ts:16`). Doing
  both means the mood pipeline needs a notion of "the key we are in now" separate from "the
  key the piece is in" — real work in `arrangeAtMood`, and a question about what happens
  when a fight swings mid-modulation. Worth doing, worth doing on purpose.
- **Non-4/4 meter.** `Meter` is generic and `weightsFor` handles it; only the UI hardcodes
  4/4. 6/8 is a genre staple and this is mostly a UI and hook-generator change.
- **Asymmetric phrases and pickups.** `PHRASE_BARS` rounding makes everything even, and
  every hook starts on beat 1.
- **Micro-timing.** See Phase 1.
- **Orchestration by section.** Sections change density but never colour; B should be able to
  hand the tune to the horns and drop the lead.
- **Production.** Single oscillator per voice, mono, dry. Detune/unison, stereo placement and
  a reverb send are all real gains and all cross-repo.

---

## What this plan does not claim

That any of it makes the output *good*. The critic checks physics, and after Phase 7 it will
check a little counterpoint, but nothing here scores musicality — that stays off the critical
path by design (`critic.ts:6`). These phases remove specific, nameable reasons a composer
would reject the output. Whether what is left is worth listening to is a question for ears.
