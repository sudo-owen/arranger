import { describe, expect, it } from 'vitest';
import { PPQ, pc, tick } from '../core/index.js';
import type { Chord, ChordEvent, Harmony, Quality } from '../core/index.js';
import { classifyCadence } from './cadence.js';

const ch = (root: number, quality: Quality): Chord => ({ root: pc(root), quality });
const prog = (chords: readonly Chord[]): Harmony => {
  const events: ChordEvent[] = chords.map((chord, i) => ({
    start: tick(i * PPQ * 4), duration: tick(PPQ * 4), chord,
  }));
  return { key: { tonic: pc(0), mode: 'major' }, events, length: tick(chords.length * PPQ * 4) };
};

const I = ch(0, 'maj');
const IV = ch(5, 'maj');
const V = ch(7, 'maj');
const vi = ch(9, 'min');

describe('cadence classification', () => {
  it('V→I is authentic', () => expect(classifyCadence(prog([I, V, I]))).toBe('authentic'));
  it('ending on V is a half cadence', () => expect(classifyCadence(prog([I, V]))).toBe('half'));
  it('IV→I is plagal', () => expect(classifyCadence(prog([I, IV, I]))).toBe('plagal'));
  it('V→vi is deceptive', () => expect(classifyCadence(prog([I, V, vi]))).toBe('deceptive'));
});
