import { describe, expect, it } from 'vitest';
import { OBOE, TUBA, barTicks, beatTicks, inRange, isChordTone, makeRng, pc } from '../core/index.js';
import { contourSimilarity } from '../theory/index.js';
import { chordAt } from './context.js';
import { generateBass } from './roles/bass.js';
import { generateMelody } from './roles/melody.js';
import { generateDrums } from './roles/drums.js';
import { generateWinds } from './roles/winds.js';
import { generateBrass } from './roles/brass.js';
import { fixtureContext, fixtureGenome } from './fixtures.js';

const G = fixtureContext();
const GEN = fixtureGenome();

describe('bass generator (§7.4)', () => {
  it('places the chord root on every downbeat', () => {
    const bass = generateBass(G, GEN.bass, makeRng(GEN.bass.seed));
    const bar = barTicks(G.meter);
    for (let b = 0; b * bar < G.harmony.length; b++) {
      const note = bass.notes.find((n) => n.start === b * bar);
      expect(note).toBeDefined();
      if (note) expect(pc(note.pitch)).toBe(chordAt(G.harmony, note.start).chord.root);
    }
  });

  it('walkiness 0 → only chord tones (no approach tones)', () => {
    const bass = generateBass(G, { seed: 5, walkiness: 0, register: 0 }, makeRng(5));
    for (const n of bass.notes) {
      expect(isChordTone(n.pitch, chordAt(G.harmony, n.start).chord)).toBe(true);
    }
  });

  it('stays within a bass instrument range', () => {
    const bass = generateBass(G, GEN.bass, makeRng(GEN.bass.seed));
    for (const n of bass.notes) expect(inRange(n.pitch, TUBA)).toBe(true);
  });
});

describe('melody generator (§7.4, §3.7)', () => {
  it('ornament 0 → every note is a chord tone on its beat (ornament(0)=id)', () => {
    const mel = generateMelody(G, { seed: 3, ornament: 0, radius: 0 }, makeRng(3));
    for (const n of mel.notes) {
      expect(isChordTone(n.pitch, chordAt(G.harmony, n.start).chord)).toBe(true);
    }
  });

  it('respects the contour floor across ornament densities', () => {
    for (const d of [0, 0.5, 1]) {
      const mel = generateMelody(G, { seed: 7, ornament: d, radius: 0.5 }, makeRng(7));
      expect(contourSimilarity(mel, G.source)).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('is deterministic for a fixed seed', () => {
    const a = generateMelody(G, GEN.melody, makeRng(GEN.melody.seed));
    const b = generateMelody(G, GEN.melody, makeRng(GEN.melody.seed));
    expect(a).toEqual(b);
  });
});

describe('drums generator (§7.4)', () => {
  const drums = generateDrums(G, GEN.drums, makeRng(GEN.drums.seed));
  const beat = beatTicks(G.meter);
  const at = (t: number, pitch: number) => drums.notes.some((n) => n.start === t && n.pitch === pitch);

  it('backbeat: kick on 1 & 3, snare on 2 & 4', () => {
    expect(at(0, 36)).toBe(true);            // kick beat 1
    expect(at(2 * beat, 36)).toBe(true);     // kick beat 3
    expect(at(beat, 38)).toBe(true);         // snare beat 2
    expect(at(3 * beat, 38)).toBe(true);     // snare beat 4
  });

  it('crashes on the section boundary downbeat', () => {
    expect(at(0, 49)).toBe(true);
  });

  it('is deterministic for a fixed seed', () => {
    expect(generateDrums(G, GEN.drums, makeRng(GEN.drums.seed))).toEqual(drums);
  });
});

describe('winds generator (§7.4 complementary rhythm)', () => {
  const melody = generateMelody(G, GEN.melody, makeRng(GEN.melody.seed));
  const winds = generateWinds(G, melody, GEN.winds, makeRng(GEN.winds.seed));
  const beat = beatTicks(G.meter);

  it('only sounds where the melody is inactive', () => {
    for (const w of winds.notes) {
      const melodyOnsetHere = melody.notes.some((n) => n.start >= w.start && n.start < w.start + beat);
      expect(melodyOnsetHere).toBe(false);
    }
  });

  it('stays within the oboe range', () => {
    for (const w of winds.notes) expect(inRange(w.pitch, OBOE)).toBe(true);
  });

  it('is deterministic for a fixed seed', () => {
    expect(generateWinds(G, melody, GEN.winds, makeRng(GEN.winds.seed))).toEqual(winds);
  });
});

describe('brass generator (§7.4 block harmonisation)', () => {
  const melody = generateMelody(G, GEN.melody, makeRng(GEN.melody.seed));
  const brass = generateBrass(G, melody, { seed: 9, voicing: 'drop2', density: 1 }, makeRng(9));

  it('produces stacked notes within the brass range', () => {
    expect(brass.notes.length).toBeGreaterThan(0);
    for (const n of brass.notes) {
      expect(n.pitch).toBeGreaterThanOrEqual(40);
      expect(n.pitch).toBeLessThanOrEqual(82);
    }
  });

  it('stabs mode locks to beats 1 & 3', () => {
    const bar = barTicks(G.meter);
    const beat = beatTicks(G.meter);
    const stabs = generateBrass(G, melody, { seed: 2, voicing: 'stabs', density: 1 }, makeRng(2));
    for (const n of stabs.notes) {
      const bib = Math.floor((((n.start % bar) + bar) % bar) / beat);
      expect(bib === 0 || bib === 2).toBe(true);
    }
  });

  it('is deterministic for a fixed seed', () => {
    expect(generateBrass(G, melody, { seed: 9, voicing: 'drop2', density: 1 }, makeRng(9))).toEqual(brass);
  });
});
