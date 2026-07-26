/**
 * Branded primitives (spec §5.2). Zero runtime cost — the brand lives only in the
 * type system. Its job is to stop `transpose(m, 2)` from silently meaning "two
 * semitones" when you meant "two scale degrees", the single most common bug here.
 *
 * `as` is permitted ONLY in these brand constructors. It is a lint error
 * everywhere else in core/theory (spec §4). Do not widen this exception — the
 * exhaustiveness guarantee in operators.ts evaporates the moment one `as` slips in.
 */

export type Tick = number & { readonly __brand: 'Tick' };
export type Midi = number & { readonly __brand: 'Midi' };
export type Degree = number & { readonly __brand: 'Degree' };
export type PC = number & { readonly __brand: 'PC' };

export const tick = (n: number): Tick => Math.round(n) as Tick;
export const midi = (n: number): Midi => n as Midi;
export const degree = (n: number): Degree => n as Degree;

export const pc = (n: number): PC => (((n % 12) + 12) % 12) as PC;

/**
 * PPQ = 960: divisible by 2,3,4,5,6,8,12,16, so triplets and quintuplets land on
 * exact integer ticks. Septuplets don't; nobody cares (spec §5.1). BPM is a render
 * parameter only — it never enters generation.
 */
export const PPQ = 960;
