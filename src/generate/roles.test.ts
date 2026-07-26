import { describe, expect, it } from 'vitest';
import { HORN_SECTION, OBOE, TUBA, barTicks, barsIn, beatTicks, inRange, isChordTone, makeRng, pc } from '../core/index.js';
import { contourSimilarity } from '../theory/index.js';
import { chordAt } from './context.js';
import { generateBass } from './roles/bass.js';
import { generateMelody } from './roles/melody.js';
import { generateTenor } from './roles/tenor.js';
import { generateDrums } from './roles/drums.js';
import { generateWinds } from './roles/winds.js';
import { generateBrass } from './roles/brass.js';
import { fixtureContext, fixtureGenome } from '../testing/index.js';

const G = fixtureContext();
const GEN = fixtureGenome();
const BASS = generateBass(G, GEN.bass, makeRng(GEN.bass.seed));

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

describe('tenor generator (§7.4 low counter-voice)', () => {
  const motions = ['pedal', 'drive', 'octaves'] as const;
  const median = (ps: number[]): number => [...ps].sort((a, b) => a - b)[Math.floor(ps.length / 2)]!;

  it('stays monophonic in every motion — the critic checks nothing on a stack', () => {
    for (const motion of motions) {
      const tenor = generateTenor(G, BASS, { seed: 4, motion, presence: 1 }, makeRng(4));
      for (let i = 1; i < tenor.notes.length; i++) {
        expect(tenor.notes[i]!.start, `${motion} note ${i}`)
          .toBeGreaterThanOrEqual(tenor.notes[i - 1]!.start + tenor.notes[i - 1]!.duration);
      }
    }
  });

  it('tracks the bass register instead of doubling it at a fixed centre', () => {
    // A fixed centre against `register: 1` puts the tenor on 50–60 and the bass on
    // 47–57 — two voices in one octave doing one voice's job.
    for (const register of [-1, 0, 1]) {
      const bass = generateBass(G, { seed: 3, walkiness: 0.5, register }, makeRng(3));
      const bassMid = median(bass.notes.map((n) => n.pitch));
      // An octave above the bass, except where that would sustain inside the hook.
      const centre = Math.min(60, bassMid + 12);
      for (const motion of motions) {
        const tenor = generateTenor(G, bass, { seed: 6, motion, presence: 1 }, makeRng(6));
        const mid = median(tenor.notes.map((n) => n.pitch));
        expect(tenor.notes.length, `${motion}@${register}`).toBeGreaterThan(0);
        expect(mid, `${motion}@${register}`).toBeGreaterThan(bassMid);
        expect(mid, `${motion}@${register}`).toBeGreaterThanOrEqual(centre - 6);
        for (const n of tenor.notes) {
          expect(inRange(n.pitch, HORN_SECTION), `${motion}@${register} note ${n.start}`).toBe(true);
        }
      }
    }
  });

  it('never sustains past the loop point', () => {
    for (const motion of motions) {
      const tenor = generateTenor(G, BASS, { seed: 8, motion, presence: 1 }, makeRng(8));
      for (const n of tenor.notes) expect(n.start + n.duration, motion).toBeLessThanOrEqual(G.harmony.length);
    }
  });

  it('drive lands off the beat, where the bass never writes', () => {
    const beat = beatTicks(G.meter);
    const tenor = generateTenor(G, BASS, { seed: 10, motion: 'drive', presence: 1 }, makeRng(10));
    for (const n of tenor.notes) expect(n.start % beat, `at ${n.start}`).not.toBe(0);
  });

  it('presence 0 → silent', () => {
    for (const motion of motions) {
      expect(generateTenor(G, BASS, { seed: 12, motion, presence: 0 }, makeRng(12)).notes, motion).toEqual([]);
    }
  });

  it('is deterministic for a fixed seed', () => {
    const params = { seed: 14, motion: 'pedal', presence: 0.7 } as const;
    expect(generateTenor(G, BASS, params, makeRng(14))).toEqual(generateTenor(G, BASS, params, makeRng(14)));
  });
});

describe('melody generator (§7.4, §3.7)', () => {
  it('ornament 0 → every note is a chord tone on its beat (ornament(0)=id)', () => {
    const mel = generateMelody(G, { seed: 3, ornament: 0 }, makeRng(3));
    for (const n of mel.notes) {
      expect(isChordTone(n.pitch, chordAt(G.harmony, n.start).chord)).toBe(true);
    }
  });

  it('respects the contour floor across ornament densities', () => {
    for (const d of [0, 0.5, 1]) {
      const mel = generateMelody(G, { seed: 7, ornament: d }, makeRng(7));
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

  it('moves where the melody leaves room, and sustains where it does not', () => {
    // Not "never sounds where the melody has an onset": a battle hook has an onset in
    // every beat, and that contract silences this role outright.
    const coverage = (from: number, to: number): number => melody.notes
      .reduce((sum, n) => sum + Math.max(0, Math.min(to, n.start + n.duration) - Math.max(from, n.start)), 0) / (to - from);
    for (const w of winds.notes) {
      const busy = coverage(w.start, w.start + beat) >= 0.6;
      expect(w.duration > beat, `at ${w.start}`).toBe(busy);
    }
  });

  it('stays monophonic — a wind section is one line, not a stack', () => {
    for (let i = 1; i < winds.notes.length; i++) {
      expect(winds.notes[i]!.start, `note ${i}`)
        .toBeGreaterThanOrEqual(winds.notes[i - 1]!.start + winds.notes[i - 1]!.duration);
    }
  });

  it('actually sounds under a hook, which covers every beat', () => {
    expect(winds.notes.length).toBeGreaterThan(barsIn(G.harmony.length, G.meter) / 2);
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
