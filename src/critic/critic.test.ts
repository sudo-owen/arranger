import { describe, expect, it } from 'vitest';
import { BRASS_SECTION, OBOE, PPQ, PULSE_LEAD, ROLE_ORDER, WIND_SECTION, midi, motif, pc, specFor, tick } from '../core/index.js';
import type { Instrument, Motif, Note } from '../core/index.js';
import { arrange } from '../generate/index.js';
import { fixtureContext, fixtureGenome } from '../testing/index.js';
import { featureVector, isValid, loopSeamProblems, selectDiverse, violations } from './critic.js';
import { cosine } from '../theory/index.js';

const G = fixtureContext();
const arr = arrange(G, fixtureGenome());

/**
 * A relentless monophonic 32nd-note line — far past any acoustic tongue or lung.
 * (16ths at 170 BPM sit at 0.088s between onsets, just *over* the oboe's 0.083s
 * floor — the acoustic limits are closer to battle tempo than they look.)
 */
function shredLine(): Motif {
  const step = PPQ / 8;
  const count = 256;
  const notes: Note[] = [];
  for (let i = 0; i < count; i++) {
    notes.push({ start: tick(i * step), duration: tick(step), pitch: midi(72 + (i % 5)), velocity: 96 });
  }
  return motif(notes, tick(count * step));
}

describe('critic hard constraints (§7.5)', () => {
  it('a generated arrangement passes the hard constraints', () => {
    expect(violations(arr, G.source, 96)).toEqual([]);
    expect(isValid(arr, G.source, 96)).toBe(true);
  });

  it('flags an out-of-range instrument', () => {
    // Shove the bass an octave below the triangle-bass floor.
    const broken = { ...arr, tracks: arr.tracks.map((t) => t.role === 'bass'
      ? { ...t, motif: { ...t.motif, notes: t.motif.notes.map((n) => ({ ...n, pitch: (n.pitch - 24) as typeof n.pitch })) } }
      : t) };
    expect(violations(broken, G.source, 96).length).toBeGreaterThan(0);
  });
});

describe('voice classes', () => {
  const shred = shredLine();
  const withWinds = (instrument: Instrument): typeof arr =>
    ({ ...arr, tracks: arr.tracks.map((t) => (t.role === 'winds' ? { ...t, instrument, motif: shred } : t)) });

  it('holds an acoustic voice to its articulation and breath limits', () => {
    const found = violations(withWinds(OBOE), G.source, 170);
    expect(found.some((v) => v.includes('articulation'))).toBe(true);
    expect(found.some((v) => v.includes('phrase exceeds'))).toBe(true);
  });

  it('exempts a chip voice from both — a pulse channel has no tongue and no lungs', () => {
    const found = violations(withWinds(PULSE_LEAD), G.source, 170);
    expect(found.some((v) => v.includes('articulation'))).toBe(false);
    expect(found.some((v) => v.includes('phrase exceeds'))).toBe(false);
  });

  it('still enforces range on chip voices', () => {
    const tooLow = motif(shred.notes.map((n) => ({ ...n, pitch: midi(n.pitch - 36) })), shred.length);
    const broken = { ...arr, tracks: arr.tracks.map((t) => (t.role === 'winds' ? { ...t, instrument: PULSE_LEAD, motif: tooLow } : t)) };
    expect(violations(broken, G.source, 170).some((v) => v.includes('out of'))).toBe(true);
  });

  it('exempts a section from the breath limit but not from articulation', () => {
    // Players stagger their breathing between desks; they do not share a tongue.
    const found = violations(withWinds(WIND_SECTION), G.source, 170);
    expect(found.some((v) => v.includes('phrase exceeds'))).toBe(false);
    expect(found.some((v) => v.includes('articulation'))).toBe(true);
  });

  it('gives the brass section a real spec rather than letting it fall through the lookup', () => {
    // A name missing from the table escapes every check, exemption by accident.
    const brass = specFor(BRASS_SECTION);
    expect(brass).not.toBeNull();
    expect(brass!.section).toBe(true);
    expect(specFor(WIND_SECTION)!.section).toBe(true);
    expect(specFor(OBOE)!.section).toBe(false);
  });

  it('skips the breath check on block voicings, which the single-line model cannot measure', () => {
    // Four-note stacks at every beat: monophonic assumptions do not apply.
    const stacked: Note[] = [];
    for (let i = 0; i < 32; i++) {
      for (const offset of [0, 4, 7, 12]) {
        stacked.push({ start: tick(i * PPQ), duration: tick(PPQ), pitch: midi(60 + offset), velocity: 88 });
      }
    }
    const blocks = motif(stacked, tick(32 * PPQ));
    const broken = { ...arr, tracks: arr.tracks.map((t) => (t.role === 'winds' ? { ...t, instrument: OBOE, motif: blocks } : t)) };
    expect(violations(broken, G.source, 170).some((v) => v.includes('phrase exceeds'))).toBe(false);
  });
});

describe('diversity selection (§7.6)', () => {
  it('feature vectors are fixed-length; cosine self-similarity is 1', () => {
    const v = featureVector(arr);
    expect(v.length).toBe(12 + ROLE_ORDER.length + 1); // pitch-class histogram, per-role density, mean interval
    expect(cosine(v, v)).toBeCloseTo(1, 6);
  });

  it('MMR picks k distinct items, best-scored first', () => {
    const items = [0.9, 0.8, 0.85, 0.7].map((score, i) => ({ score, features: [i, 1, 0] }));
    const picked = selectDiverse(items, 3, 0.5);
    expect(picked.length).toBe(3);
    expect(picked[0]).toBe(0); // highest score leads
    expect(new Set(picked).size).toBe(3);
  });
});

describe('the loop seam is measured at the return point', () => {
  const meter = { num: 4, den: 4 };
  const bar = PPQ * 4;

  it('judges the harmonic join against the chord playback returns to', () => {
    // With an intro that plays once, the last chord leads back to the top of the BODY,
    // not to bar 1 — checking bar 1 tests a join the listener never hears.
    const chord = (root: number) => ({ root: pc(root), quality: 'min' as const });
    const events = [
      { start: tick(0), duration: tick(bar), chord: chord(0) },     // intro, played once
      { start: tick(bar), duration: tick(bar), chord: chord(9) },   // loop body starts here
      { start: tick(2 * bar), duration: tick(bar), chord: chord(4) }, // ...and ends on E
    ];
    const withHarmony = {
      ...arr,
      length: tick(3 * bar),
      harmony: { ...arr.harmony, events, length: tick(3 * bar) },
      tracks: [],
    };
    // E -> A is a fifth: fine. E -> C (bar 1) is not, and is what the old check measured.
    expect(loopSeamProblems(withHarmony, meter, bar)).toEqual([]);
    expect(loopSeamProblems(withHarmony, meter, 0).some((p) => p.includes('lead back'))).toBe(true);
  });

  it('only flags a final crash when the return point has one to collide with', () => {
    const crashes = (starts: number[]) => ({
      ...arr,
      length: tick(2 * bar),
      tracks: [{ role: 'drums' as const, motif: motif(starts.map((st) => (
        { start: tick(st), duration: tick(30), pitch: midi(49), velocity: 100 })), tick(2 * bar)) }],
    });
    expect(loopSeamProblems(crashes([0, 2 * bar - 100]), meter, 0).some((p) => p.includes('crash'))).toBe(true);
    // Same final crash, but the return point is a bar in and has no crash of its own.
    expect(loopSeamProblems(crashes([0, 2 * bar - 100]), meter, bar).some((p) => p.includes('crash'))).toBe(false);
  });
});
