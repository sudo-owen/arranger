import type { Genome, Role, Rng } from '../core/index.js';
import { PALETTE_ORDER, VOICING_ORDER, clamp01 } from '../core/index.js';

/**
 * Small edits to one genome, so every choice is between close relatives.
 *
 * The complaint this answers: a fresh random pool gives six strangers, and picking
 * between strangers tells you nothing about the one you already liked. Changing
 * exactly one field at a time means the difference you hear is the field.
 */

export interface Neighbour {
  genome: Genome;
  /** What moved, for the card label. */
  changed: string;
}

const nudge = (value: number, rng: Rng, spread = 0.25): number =>
  clamp01(value + (rng.next() * 2 - 1) * spread);

type Tweak = { label: string; apply: (g: Genome, rng: Rng) => Genome };

const TWEAKS: readonly Tweak[] = [
  { label: 'busier drums', apply: (g, r) => ({ ...g, drums: { ...g.drums, fillDensity: nudge(g.drums.fillDensity, r) } }) },
  { label: 'swing', apply: (g, r) => ({ ...g, drums: { ...g.drums, swing: nudge(g.drums.swing, r, 0.3) } }) },
  { label: 'walking bass', apply: (g, r) => ({ ...g, bass: { ...g.bass, walkiness: nudge(g.bass.walkiness, r) } }) },
  { label: 'bass register', apply: (g, r) => ({ ...g, bass: { ...g.bass, register: r.int(3) - 1 } }) },
  { label: 'wind activity', apply: (g, r) => ({ ...g, winds: { ...g.winds, activity: nudge(g.winds.activity, r) } }) },
  { label: 'brass density', apply: (g, r) => ({ ...g, brass: { ...g.brass, density: nudge(g.brass.density, r) } }) },
  { label: 'brass voicing', apply: (g, r) => ({ ...g, brass: { ...g.brass, voicing: r.pick(VOICING_ORDER) } }) },
  { label: 'melody ornament', apply: (g, r) => ({ ...g, melody: { ...g.melody, ornament: nudge(g.melody.ornament, r) } }) },
  { label: 'palette', apply: (g, r) => ({ ...g, palette: r.pick(PALETTE_ORDER) }) },
];

export function neighbours(base: Genome, rng: Rng, k: number): Neighbour[] {
  const order = shuffled(TWEAKS, rng);
  return Array.from({ length: Math.min(k, order.length) }, (_, i) => {
    const tweak = order[i]!;
    return { genome: tweak.apply(base, rng), changed: tweak.label };
  });
}

/**
 * A new seed for one role, leaving every other role byte-identical — the property
 * `arrange()` has always had and nothing has used until now.
 */
export function rerollRole(base: Genome, role: Role, rng: Rng): Genome {
  const seed = rng.int(1_000_000_000);
  switch (role) {
    case 'melody': return { ...base, melody: { ...base.melody, seed } };
    case 'bass': return { ...base, bass: { ...base.bass, seed } };
    case 'drums': return { ...base, drums: { ...base.drums, seed } };
    case 'winds': return { ...base, winds: { ...base.winds, seed } };
    case 'brass': return { ...base, brass: { ...base.brass, seed } };
    default: {
      const never: never = role;
      throw new Error(`unhandled role: ${JSON.stringify(never)}`);
    }
  }
}

function shuffled<T>(xs: readonly T[], rng: Rng): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
