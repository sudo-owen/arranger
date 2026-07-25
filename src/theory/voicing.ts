import type { Chord, Midi } from '../core/index.js';
import { chordPCs, isChordTone, midi, nearestChordTone } from '../core/index.js';

export type VoicingStyle = 'close' | 'drop2' | 'drop3';

/**
 * Four-way close block voicing (spec §7.4): melody on top, the next three chord
 * tones stacked directly below it. Over a triad the fourth voice doubles a chord
 * tone an octave down. Returned high→low.
 */
export function closeVoicing(melody: Midi, chord: Chord, voices = 4): Midi[] {
  const pcs = chordPCs(chord);
  const top = isChordTone(melody, chord) ? melody : nearestChordTone(melody, chord);
  const out: Midi[] = [top];
  let cursor: number = top;
  while (out.length < voices) {
    cursor = nextChordToneBelow(cursor, pcs);
    out.push(midi(cursor));
  }
  return out;
}

/**
 * Drop-2: take the 2nd voice from the top and drop it an octave. Opens the voicing;
 * sounds better on brass than tight close position (spec §7.4). Returned high→low.
 */
export function drop2(voicing: readonly Midi[]): Midi[] {
  return dropVoice(voicing, 2);
}

/** Drop-3: same idea, third voice from the top. */
export function drop3(voicing: readonly Midi[]): Midi[] {
  return dropVoice(voicing, 3);
}

export function voice(melody: Midi, chord: Chord, style: VoicingStyle, voices = 4): Midi[] {
  const close = closeVoicing(melody, chord, voices);
  if (style === 'drop2') return drop2(close);
  if (style === 'drop3') return drop3(close);
  return close;
}

function nextChordToneBelow(pitch: number, pcs: readonly number[]): number {
  for (let p = pitch - 1; p > pitch - 24; p--) {
    const cls = ((p % 12) + 12) % 12;
    if (pcs.includes(cls)) return p;
  }
  return pitch - 12;
}

function dropVoice(voicing: readonly Midi[], fromTop: number): Midi[] {
  if (voicing.length < fromTop) return [...voicing];
  const idx = fromTop - 1;
  const dropped: Midi[] = voicing.map((v, i) => (i === idx ? midi(v - 12) : v));
  return [...dropped].sort((a, b) => b - a);
}
