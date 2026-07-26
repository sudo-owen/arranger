import { describe, expect, it } from 'vitest';
import { ROLE_ORDER, barTicks, normWeightAt, weightsFor } from '../core/index.js';
import type { Role } from '../core/index.js';
import { FORM_SHAPES, barsForSeconds, planForm } from './form.js';
import { BPM, METER, notesOf, testHooks, track, tune } from '../testing/index.js';

const hook = testHooks(1, 17)[0]!;
const arced = track({ hook, shape: FORM_SHAPES[0]!, seconds: 60 });
const flat = track({ hook, seconds: 60 });

const mean = (xs: readonly number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const weights = weightsFor(METER);
/** The most the lead-in ramp can add on top of what a generator wrote. */
const LEVEL_HEADROOM = 11;

describe('phrase dynamics', () => {
  it('accents the metric grid — strong beats are played harder than weak ones', () => {
    for (const role of ROLE_ORDER) {
      if (role === 'drums') continue; // drums are the metre; they do not express it
      const notes = notesOf(arced, role);
      if (notes.length < 8) continue;
      const strong = notes.filter((n) => normWeightAt(n.start, METER, weights) >= 0.75);
      const weak = notes.filter((n) => normWeightAt(n.start, METER, weights) < 0.25);
      if (!strong.length || !weak.length) continue;
      expect(mean(strong.map((n) => n.velocity)), role).toBeGreaterThan(mean(weak.map((n) => n.velocity)));
    }
  });

  it('plays the climax harder than the intro', () => {
    const inSection = (label: string, role: Role): number[] => {
      const s = arced.form.sections.find((x) => x.label === label)!;
      return notesOf(arced, role)
        .filter((n) => n.start >= s.start && n.start < s.start + s.length)
        .map((n) => n.velocity);
    };
    for (const role of ['melody', 'bass'] as const) {
      expect(mean(inSection('A"', role)), role).toBeGreaterThan(mean(inSection('intro', role)));
    }
  });

  it('joins the loop without a step — the last bar arrives where bar 1 starts', () => {
    // The lead-in wraps: the section after the last one is the first one. Without that,
    // a track ending at its climax steps ~20 velocity into its own downbeat, every pass.
    const bar = barTicks(METER);
    const lastBar = notesOf(arced, 'melody').filter((n) => n.start >= arced.arr.length - bar);
    const firstBar = notesOf(arced, 'melody').filter((n) => n.start < bar);
    expect(lastBar.length).toBeGreaterThan(0);
    expect(Math.abs(mean(lastBar.map((n) => n.velocity)) - mean(firstBar.map((n) => n.velocity))))
      .toBeLessThan(12);
  });

  it('keeps every velocity inside the window where it does anything', () => {
    // `velocityGain` clamps its multiplier at 0.25 and 1.3, so shaping past ~25 and ~130
    // is written into the MIDI file and then inaudible in both renderers.
    for (const t of [arced, flat]) {
      for (const role of ROLE_ORDER) {
        for (const n of notesOf(t, role)) {
          expect(n.velocity, `${role} @ ${n.start}`).toBeGreaterThanOrEqual(25);
          expect(n.velocity, `${role} @ ${n.start}`).toBeLessThanOrEqual(127);
        }
      }
    }
  });

  it('preserves the authored balance between roles', () => {
    // Additive, not multiplicative: shaping moves the ensemble without re-mixing it, so
    // the melody still sits over the winds at the climax as well as in the intro.
    expect(mean(notesOf(arced, 'melody').map((n) => n.velocity)))
      .toBeGreaterThan(mean(notesOf(arced, 'winds').map((n) => n.velocity)));
  });

  it('leaves the drums their own arc without counting it twice', () => {
    // `generateDrums` already writes `88 + intensity * 24` on the kick, so the level
    // offset is deliberately not applied here. Measured per NOTE the drums look like they
    // get quieter toward the climax — the mean falls because the hat count triples and
    // hats are quiet. The kick is the honest reading, and it has to rise.
    const kickIn = (label: string): number[] => {
      const s = arced.form.sections.find((x) => x.label === label)!;
      return notesOf(arced, 'drums')
        .filter((n) => n.pitch === 36 && n.start >= s.start && n.start < s.start + s.length)
        .map((n) => n.velocity);
    };
    expect(mean(kickIn('A"'))).toBeGreaterThan(mean(kickIn('intro')));
    // ...and stays inside what the generator alone writes, plus the lead-in ramp.
    expect(Math.max(...kickIn('A"'))).toBeLessThanOrEqual(112 + LEVEL_HEADROOM);
  });

  it('shapes without touching a single note', () => {
    // The whole pass is velocity. Anything else is a bug in a post-pass.
    const bars = barsForSeconds(60, BPM, METER);
    const other = track({ hook, form: planForm(FORM_SHAPES[2]!, bars, METER), seconds: 60 });
    for (const role of ROLE_ORDER) {
      expect(tune(notesOf(other, role)).length, role).toBe(notesOf(other, role).length);
    }
    expect(tune(notesOf(arced, 'melody'))).toEqual(tune(notesOf(flat, 'melody')));
  });

  it('is deterministic', () => {
    const again = track({ hook, shape: FORM_SHAPES[0]!, seconds: 60 });
    expect(notesOf(again, 'melody')).toEqual(notesOf(arced, 'melody'));
  });

  it('ramps the ending toward the loop point, not toward tick 0', () => {
    // With a head that plays once, aiming the final crescendo at the intro would target a
    // level the loop never returns to. The last bars have to arrive where playback does.
    const bars = barsForSeconds(60, BPM, METER);
    const plan = planForm(FORM_SHAPES[0]!, bars, METER);
    const body = plan.sections.find((x) => x.label === 'A')!;
    const toIntro = track({ hook, form: { ...plan, loopStart: plan.sections[0]!.start }, seconds: 60 });
    const toBody = track({ hook, form: { ...plan, loopStart: body.start }, seconds: 60 });

    const lastBarOf = (t: typeof toIntro): number[] => notesOf(t, 'melody')
      .filter((n) => n.start >= t.arr.length - barTicks(METER))
      .map((n) => n.velocity);

    // `A` is more urgent than `intro`, so aiming at it lands the ending louder.
    expect(mean(lastBarOf(toBody))).toBeGreaterThan(mean(lastBarOf(toIntro)));
  });
});
