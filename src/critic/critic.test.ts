import { describe, expect, it } from 'vitest';
import { BRASS_SECTION, OBOE, PULSE_LEAD, PPQ, WIND_SECTION, midi, motif, specFor, tick } from '../core/index.js';
import type { Instrument, Motif, Note } from '../core/index.js';
import { arrange } from '../generate/index.js';
import { fixtureContext, fixtureGenome } from '../generate/fixtures.js';
import { cosineSim, featureVector, isValid, selectDiverse, violations } from './critic.js';

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
    expect(violations(arr, G.source, 96, G.meter)).toEqual([]);
    expect(isValid(arr, G.source, 96, G.meter)).toBe(true);
  });

  it('flags an out-of-range instrument', () => {
    // Shove the bass an octave below the triangle-bass floor.
    const broken = { ...arr, tracks: arr.tracks.map((t) => t.role === 'bass'
      ? { ...t, motif: { ...t.motif, notes: t.motif.notes.map((n) => ({ ...n, pitch: (n.pitch - 24) as typeof n.pitch })) } }
      : t) };
    expect(violations(broken, G.source, 96, G.meter).length).toBeGreaterThan(0);
  });
});

describe('voice classes', () => {
  const shred = shredLine();
  const withWinds = (instrument: Instrument): typeof arr =>
    ({ ...arr, tracks: arr.tracks.map((t) => (t.role === 'winds' ? { ...t, instrument, motif: shred } : t)) });

  it('holds an acoustic voice to its articulation and breath limits', () => {
    const found = violations(withWinds(OBOE), G.source, 170, G.meter);
    expect(found.some((v) => v.includes('articulation'))).toBe(true);
    expect(found.some((v) => v.includes('phrase exceeds'))).toBe(true);
  });

  it('exempts a chip voice from both — a pulse channel has no tongue and no lungs', () => {
    const found = violations(withWinds(PULSE_LEAD), G.source, 170, G.meter);
    expect(found.some((v) => v.includes('articulation'))).toBe(false);
    expect(found.some((v) => v.includes('phrase exceeds'))).toBe(false);
  });

  it('still enforces range on chip voices', () => {
    const tooLow = motif(shred.notes.map((n) => ({ ...n, pitch: midi(n.pitch - 36) })), shred.length);
    const broken = { ...arr, tracks: arr.tracks.map((t) => (t.role === 'winds' ? { ...t, instrument: PULSE_LEAD, motif: tooLow } : t)) };
    expect(violations(broken, G.source, 170, G.meter).some((v) => v.includes('out of'))).toBe(true);
  });

  it('exempts a section from the breath limit but not from articulation', () => {
    // Players stagger their breathing between desks; they do not share a tongue.
    const found = violations(withWinds(WIND_SECTION), G.source, 170, G.meter);
    expect(found.some((v) => v.includes('phrase exceeds'))).toBe(false);
    expect(found.some((v) => v.includes('articulation'))).toBe(true);
  });

  it('gives the brass section a real spec rather than letting it fall through the lookup', () => {
    // It used to escape every check only because the name was missing from the table.
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
    expect(violations(broken, G.source, 170, G.meter).some((v) => v.includes('phrase exceeds'))).toBe(false);
  });
});

describe('diversity selection (§7.6)', () => {
  it('feature vectors are fixed-length; cosine self-similarity is 1', () => {
    const v = featureVector(arr);
    expect(v.length).toBe(18);
    expect(cosineSim(v, v)).toBeCloseTo(1, 6);
  });

  it('MMR picks k distinct items, best-scored first', () => {
    const items = [0.9, 0.8, 0.85, 0.7].map((score, i) => ({ score, features: [i, 1, 0] }));
    const picked = selectDiverse(items, 3, 0.5);
    expect(picked.length).toBe(3);
    expect(picked[0]).toBe(0); // highest score leads
    expect(new Set(picked).size).toBe(3);
  });
});
