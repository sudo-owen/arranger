import type { Genome, Instrument, Motif, Note, Rng, Tick } from '../../core/index.js';
import { HORN_SECTION, beatInBar, beatTicks, chordPCs, fitToRange, motif, tick } from '../../core/index.js';
import { chordAt, placePC, type GenContext } from '../context.js';
import { intensityAt } from '../form.js';

/**
 * Tenor — the low counter-voice, in the octave between the bass line and the brass stack.
 *
 * Takes the GENERATED bass, exactly as winds and brass take the generated melody: it is
 * written an octave above whatever the bass actually played. `bass.register` moves the
 * bottom by an octave in either direction, so a fixed centre would land on top of a
 * high-register bass and double it — one thick voice where the point is two.
 *
 * It stays out of the bass's way in time as well as in pitch: every motion below either
 * sustains across beats or lands between them, so the two low voices never share an attack.
 *
 * Monophonic BY CONSTRUCTION, which is not a stylistic preference. `critic.ts` skips the
 * articulation and breath checks for any motif with an overlap in it, so a tenor that
 * stacked would be a second acoustic voice with its physical limits silently switched off.
 */
/**
 * C4. The octave rule gives way to this, not the other way round: `bass.register: 1`
 * already puts the bass line at Bb2–Bb3, and a tenor a full octave over that would be
 * sustaining inside the hook's own range. The two low voices sit closer together at the
 * top register because the texture above them has nowhere else to go.
 */
const TOP_CENTRE = 60;

export function generateTenor(
  g: GenContext, bass: Motif, params: Genome['tenor'], rng: Rng, inst: Instrument = HORN_SECTION,
): Motif {
  const beat = beatTicks(g.meter);
  const notes: Note[] = [];
  const CENTRE = Math.min(TOP_CENTRE, medianPitch(bass) + 12);
  const sounds = (t: Tick): boolean => rng.bool(params.presence * (0.35 + intensityAt(g.form, t, g.mood) * 1.1));
  const toneAt = (t: number, which: 0 | 2): number => {
    const chord = chordAt(g.harmony, tick(t)).chord;
    const pcs = chordPCs(chord);
    return pcs[which] ?? pcs[0] ?? chord.root;
  };

  if (params.motion === 'pedal') {
    // One tone per chord, on the fifth — the root is the bass's job, and a fifth under
    // the tune is the horn writing this voice exists to be. Released half a beat early
    // so the section is never asked for an unbroken line the whole track long.
    for (const e of g.harmony.events) {
      if (!sounds(e.start)) continue;
      const duration = Math.max(beat, e.duration - beat / 2);
      if (e.start + duration > g.harmony.length) continue; // never sustain past the loop point
      notes.push({
        start: e.start, duration: tick(duration),
        pitch: placePC(CENTRE, toneAt(e.start, 2)), velocity: 66,
      });
    }
  } else if (params.motion === 'drive') {
    // The upbeat push: the second eighth of each beat, where the bass never writes.
    for (let t = 0; t + beat <= g.harmony.length; t += beat) {
      const at = t + Math.floor(beat / 2);
      if (!sounds(tick(at))) continue;
      notes.push({
        start: tick(at), duration: tick(beat - Math.floor(beat / 2)),
        pitch: placePC(CENTRE, toneAt(at, 2)), velocity: 82,
      });
    }
  } else {
    // Octaves: the chord root doubled above the bass on the kick beats. No new rhythm,
    // just more bottom — the plainest way to answer "I want more low end".
    for (let t = 0; t + beat <= g.harmony.length; t += beat) {
      const bib = beatInBar(t, g.meter);
      if (bib !== 0 && bib !== 2) continue;
      if (!sounds(tick(t))) continue;
      notes.push({
        start: tick(t), duration: tick(beat), pitch: placePC(CENTRE, toneAt(t, 0)), velocity: 84,
      });
    }
  }

  // Fold into the palette's actual instrument, like every other pitched role.
  return motif(notes.map((n) => ({ ...n, pitch: fitToRange(n.pitch, inst) })), g.harmony.length);
}

/** Where the bass line is sitting, robust to the odd approach tone at either extreme. */
function medianPitch(m: Motif): number {
  if (!m.notes.length) return 43; // G2 — a bass that wrote nothing still has to be answered somewhere
  const sorted = m.notes.map((n) => n.pitch as number).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}
