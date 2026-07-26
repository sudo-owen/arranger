import type { Genome, Motif, Note, Rng } from '../../core/index.js';
import { CRASH, HAT, KICK, SNARE, beatTicks, barTicks, midi, motif, tick } from '../../core/index.js';
import { intensityAt } from '../form.js';
import { barCount, type GenContext } from '../context.js';

/**
 * Drums — resist Euclid (spec §7.4). A backbeat is *correct*, and correct is what
 * you want under a melody. The thing that matters is marking phrase structure:
 * fill in bar 4, bigger fill in bar 8, crash on section boundaries. That's what
 * makes drums sound composed rather than looped.
 */
export function generateDrums(g: GenContext, params: Genome['drums'], rng: Rng): Motif {
  const beat = beatTicks(g.meter);
  const bar = barTicks(g.meter);
  const eighth = Math.floor(beat / 2);
  const swingOff = Math.round(eighth * (params.swing / 3)); // push the "and" toward triplet feel
  const nBars = barCount(g.harmony, g.meter);
  const boundaries = new Set<number>(g.form.sections.map((s) => s.start));
  const notes: Note[] = [];
  const hit = (t: number, pitch: number, vel = 100): void => {
    notes.push({ start: tick(t), duration: tick(30), pitch: midi(pitch), velocity: vel });
  };

  for (let b = 0; b < nBars; b++) {
    const barStart = b * bar;
    // Per bar, so a section boundary changes the kit rather than just adding a crash.
    const intensity = intensityAt(g.form, tick(barStart));
    for (let i = 0; i < g.meter.num; i++) {
      const t = barStart + i * beat;
      hit(t, i % 2 === 0 ? KICK : SNARE, Math.round(88 + intensity * 24));
      hit(t, HAT, Math.round(44 + intensity * 22));
      const andT = t + eighth + swingOff;
      if (andT < g.harmony.length && intensity > 0.3) hit(andT, HAT, Math.round(36 + intensity * 20));
      // Sixteenths only where the section is genuinely driving.
      if (intensity > 0.72) {
        const e = t + Math.floor(eighth / 2);
        if (e < g.harmony.length) hit(e, HAT, 34);
      }
    }
    if (boundaries.has(barStart)) hit(barStart, CRASH, 112);

    const fill = (b + 1) % 8 === 0 ? 'big' : (b + 1) % 4 === 0 ? 'small' : null;
    if (fill) {
      const lastBeat = barStart + (g.meter.num - 1) * beat;
      const subdiv = fill === 'big' ? 4 : 2;
      const count = Math.max(1, Math.round(subdiv * (0.5 + params.fillDensity * intensity)));
      const step = Math.max(1, Math.floor(beat / subdiv));
      for (let k = 0; k < count && k < subdiv; k++) {
        // Backbeat is structural (never random); fill CONTENTS are surface (§3.5).
        if (k > 0 && !rng.bool(0.5 + params.fillDensity * 0.5)) continue;
        hit(lastBeat + k * step, SNARE, 78 + rng.int(24));
      }
    }
  }
  return motif(notes, g.harmony.length);
}
