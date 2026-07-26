import { clamp01 } from './math.js';

export interface Mood {
  /** 0 = restrained, 1 = frantic. Drives density and rhythmic activity. */
  urgency: number;
  /** 0 = losing, 1 = winning. Drives harmonic brightness and brass. */
  fortune: number;
}

export const NEUTRAL_MOOD: Mood = { urgency: 0.5, fortune: 0.5 };

export const clampMood = (m: Mood): Mood => ({ urgency: clamp01(m.urgency), fortune: clamp01(m.fortune) });

/**
 * A section's authored mood composed with the track's current one, so the pad moves
 * the whole arc rather than overriding the shape. At a neutral pad you hear exactly
 * what the section plan asked for.
 */
export const composeMood = (global: Mood, section: Mood): Mood => clampMood({
  urgency: global.urgency + (section.urgency - 0.5),
  fortune: global.fortune + (section.fortune - 0.5),
});
