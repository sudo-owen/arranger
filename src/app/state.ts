import type {
  Arrangement, BrassVoicing, Chord, ChordEvent, FormTemplate, Genome, Harmony, Key, Meter, Mode, Motif, Rng, Tick,
} from '../core/index.js';
import type { Palette } from '../core/index.js';
import { PALETTE_ORDER, PPQ, barTicks, makeRng, motif, pc, tick } from '../core/index.js';
import type { Hook, Progression } from '../generate/index.js';
import {
  RHYTHM_LABEL, SCHEME_LABEL, arrange, defaultProgression, generateHook, generateHookSet,
  harmonyFromProgression, harmonyStates, inferHarmony, progressionsFor, renderHook,
  sampleHarmony, spreadByBrightness, wholeForm,
} from '../generate/index.js';
import { detectKey } from '../theory/index.js';
import { featureVector, selectDiverse, violations } from '../critic/index.js';
import { extendTune } from './seeds.js';

export interface Candidate { genome: Genome; arr: Arrangement; progression: Progression | null }

/** The five choices, in order. The rail is this list. */
export type Stage = 'hook' | 'bed' | 'mood' | 'form' | 'vary';
export const STAGES: readonly Stage[] = ['hook', 'bed', 'mood', 'form', 'vary'];
export const STAGE_LABEL: Readonly<Record<Stage, string>> = {
  hook: 'Hook', bed: 'Bed', mood: 'Mood', form: 'Form', vary: 'Vary',
};

export interface HookConstraints { tonic: number; mode: Mode }
export interface HookDraft { id: number; hook: Hook; seed: number }

/** How many bars the chosen hook is rendered out to as the bed's source melody. */
export const BED_BARS = 16;

export type EvolutionKind = 'seed' | 'import' | 'extend' | 'arrangement-extend' | 'promote' | 'harmony' | 'generate';

/**
 * Everything needed to put the app back exactly where a decision left it.
 *
 * Nodes used to store only the melody-and-harmony half of the state, so stepping back
 * to an earlier node silently destroyed the arrangements you had generated there —
 * which made the history unusable for the thing history is for, namely trying a
 * direction and coming back if it was worse. One type, so later phases add `hook`,
 * `form` and `mood` in a single place rather than at seven call sites.
 */
export interface Snapshot {
  source: Motif;
  key: Key;
  meter: Meter;
  bpm: number;
  harmony: Harmony;
  candidates: readonly Candidate[];
  selected: number;
  /** Null only for material that came in as MIDI rather than from a generated hook. */
  hook: Hook | null;
}

export interface EvolutionNode {
  id: number;
  parentId: number | null;
  kind: EvolutionKind;
  label: string;
  detail: string;
  snapshot: Snapshot;
}

/** A specific arrangement kept aside for comparison. Restorable and A/B-able. */
export interface PinnedTake {
  id: number;
  label: string;
  nodeId: number;
  genome: Genome;
  arr: Arrangement;
}

export interface AppState {
  stage: Stage;
  source: Motif | null;
  key: Key | null;
  meter: Meter;
  bpm: number;
  harmony: Harmony | null;
  hook: Hook | null;
  /** Held constant across a candidate set so beds differ only in their arrangement. */
  melodySeed: number;
  temperature: number;
  candidates: Candidate[];
  selected: number;
  pinned: PinnedTake[];
  hookDrafts: HookDraft[];
  selectedHookDraft: number;
  evolution: EvolutionNode[];
  activeEvolution: number | null;
  status: string;
}

const VOICINGS: readonly BrassVoicing[] = ['close', 'drop2', 'drop3', 'stabs'];
const pick = <T,>(xs: readonly T[], rng: Rng): T => xs[rng.int(xs.length)] ?? xs[0]!;

/**
 * A genome for one candidate bed — the ~40-byte seed the whole arrangement is a
 * function of (§5.6).
 *
 * `melodySeed` is passed in and held CONSTANT across a candidate set. That is the
 * whole point of this stage: with it varying, six cards are six different tunes and
 * you cannot tell whether you prefer card 3's arrangement or just card 3's melody.
 * Fixed, every card is demonstrably the same hook and the only thing you are judging
 * is what has been built around it.
 */
function bedGenome(rng: Rng, bars: number, melodySeed: number, palette: Palette): Genome {
  const seed = (): number => rng.int(1_000_000_000);
  return {
    version: 1,
    palette,
    skeleton: { seed: seed(), temperature: 0.4 + rng.next() * 0.6, template: 'sentence' as FormTemplate, bars },
    melody: { seed: melodySeed, ornament: 0.2 + rng.next() * 0.4, radius: 1 + rng.int(3) },
    bass: { seed: seed(), walkiness: rng.next(), register: rng.int(3) - 1 },
    drums: { seed: seed(), fillDensity: 0.3 + rng.next() * 0.5, swing: 0 },
    winds: { seed: seed(), activity: 0.3 + rng.next() * 0.5, ornament: rng.next() * 0.5 },
    brass: { seed: seed(), voicing: pick(VOICINGS, rng), density: 0.3 + rng.next() * 0.5 },
  };
}

type Listener = (s: AppState) => void;

/** The single source of truth. Everything the UI shows is derived from this + a render pass. */
export class Store {
  private state: AppState = {
    stage: 'hook',
    source: null, key: null, meter: { num: 4, den: 4 }, bpm: 168,
    harmony: null, hook: null, melodySeed: 1, temperature: 0.6, candidates: [], selected: -1, pinned: [],
    hookDrafts: [], selectedHookDraft: -1,
    evolution: [], activeEvolution: null, status: 'Generate a set of hooks to begin.',
  };
  private listeners: Listener[] = [];
  private nextEvolutionId = 1;
  private nextDraftId = 1;
  private nextPinId = 1;

  get(): AppState { return this.state; }
  subscribe(fn: Listener): void { this.listeners.push(fn); fn(this.state); }
  private set(patch: Partial<AppState>): void { this.state = { ...this.state, ...patch }; for (const l of this.listeners) l(this.state); }

  /** First pass only: infer the harmony from the melody. After this the arrow reverses — harmony is owned (§3.3). */
  loadSource(source: Motif, bpm: number, meter: Meter, label = 'Imported MIDI', kind: EvolutionKind = 'import'): void {
    const key = detectKey(source);
    const harmony = inferHarmony(source, key, meter);
    const snapshot: Snapshot = { source, key, meter, bpm, harmony, candidates: [], selected: -1, hook: null };
    const node = this.node(kind, label, `${barsOf(source, meter)} bars · ${keyName(key)}`, snapshot, null);
    this.set({ ...restore(snapshot), evolution: [node], activeEvolution: node.id, status: `Started with ${label}. Extend it, shape the chords, or generate now.` });
  }

  setStage(stage: Stage): void { this.set({ stage }); }

  /** Advance or retreat along the rail, clamped to the ends. */
  step(delta: 1 | -1): void {
    const at = STAGES.indexOf(this.state.stage);
    const next = STAGES[Math.max(0, Math.min(STAGES.length - 1, at + delta))];
    if (next) this.set({ stage: next });
  }

  generateHookDrafts(constraints: HookConstraints, count = 6): void {
    const key: Key = { tonic: pc(constraints.tonic), mode: constraints.mode };
    const rng = makeRng(Math.floor(Math.random() * 1e9));
    const hookDrafts: HookDraft[] = generateHookSet(key, this.state.meter, rng, count)
      .map((hook) => ({ id: this.nextDraftId++, hook, seed: 0 }));
    this.set({
      hookDrafts,
      selectedHookDraft: hookDrafts.length ? 0 : -1,
      status: `${hookDrafts.length} hooks. Audition them, reroll any you dislike, then continue.`,
    });
  }

  selectHookDraft(index: number): void {
    if (index >= 0 && index < this.state.hookDrafts.length) this.set({ selectedHookDraft: index });
  }

  /** Replace one card in place, keeping its rhythm and scheme — a nudge, not a new idea. */
  rerollHookDraft(index: number): void {
    const draft = this.state.hookDrafts[index];
    if (!draft) return;
    const hook = generateHook({
      seed: Math.floor(Math.random() * 1e9),
      key: draft.hook.key,
      meter: draft.hook.meter,
      cellBars: draft.hook.cellBars,
      scheme: draft.hook.scheme,
      rhythm: draft.hook.rhythm,
    });
    this.set({
      hookDrafts: this.state.hookDrafts.map((d, i) => (i === index ? { ...d, hook } : d)),
      status: `Rerolled hook ${index + 1} — same rhythm and restatement, new pitches.`,
    });
  }

  /** Commit the chosen hook: render it out to the bed length and own the result. */
  useSelectedHook(bars = BED_BARS): void {
    const draft = this.state.hookDrafts[this.state.selectedHookDraft];
    if (!draft) {
      this.set({ status: 'Generate and select a hook first.' });
      return;
    }
    const { hook } = draft;
    const source = renderHook(hook, bars);
    // Choose the progression rather than inferring one. A hook built from three notes
    // of the tonic triad implies almost nothing, so inference returns the blandest
    // reading that fits and leaves you correcting it bar by bar (§3.4 the other way up).
    const progression = defaultProgression(hook.key.mode);
    const harmony = harmonyFromProgression(progression, hook.key, hook.meter, bars);
    const melodySeed = Math.floor(Math.random() * 1e9);
    const snapshot: Snapshot = {
      source, key: hook.key, meter: hook.meter, bpm: this.state.bpm, harmony,
      candidates: [], selected: -1, hook,
    };
    const node = this.node('seed', `${RHYTHM_LABEL[hook.rhythm]}`,
      `${SCHEME_LABEL[hook.scheme]} · ${bars} bars · ${keyName(hook.key)}`, snapshot, null);
    this.set({
      ...restore(snapshot),
      stage: 'bed', melodySeed,
      evolution: [node], activeEvolution: node.id,
      status: `Hook committed over ${bars} bars on ${progression.name}. Generate beds to hear it arranged.`,
    });
  }

  extendSource(): void {
    const { source, key, meter, bpm, harmony, evolution, activeEvolution } = this.state;
    if (!source || !key || !harmony) return;
    const extended = extendTune(source, key);
    const nextHarmony = inferHarmony(extended, key, meter);
    const snapshot: Snapshot = { source: extended, key, meter, bpm, harmony: nextHarmony, candidates: [], selected: -1, hook: this.state.hook };
    const node = this.node('extend', `Extend to ${barsOf(extended, meter)} bars`, 'Answer phrase · diatonic turn', snapshot, activeEvolution);
    this.set({ ...restore(snapshot), evolution: [...evolution, node], activeEvolution: node.id, status: `Extended to ${barsOf(extended, meter)} bars. The source remains intact in the previous node.` });
  }

  setBpm(bpm: number): void { this.set({ bpm }); }

  setTemperature(t: number): void { this.set({ temperature: t }); }

  /** Resample the whole progression from the HMM posterior (§7.2) — an alternative reading, not a fix. */
  reinferHarmony(): void {
    const { source, key, meter, temperature } = this.state;
    if (!source || !key) return;
    const harmony = sampleHarmony(source, key, meter, temperature, makeRng(Math.floor(Math.random() * 1e9)));
    this.recordDecision('harmony', 'Re-read harmony', `Temperature ${temperature.toFixed(2)}`, harmony, `Re-inferred at temperature ${temperature.toFixed(2)}.`);
  }

  /** The user owns the harmony: cycle one bar's chord through the vocabulary (§3.4, the main creative lever). */
  cycleChord(barIndex: number, dir: 1 | -1): void {
    const { harmony, key } = this.state;
    if (!harmony || !key) return;
    const vocab = harmonyStates(key);
    const events = harmony.events.map((e, i) => {
      if (i !== barIndex) return e;
      const cur = vocab.findIndex((c) => c.root === e.chord.root && c.quality === e.chord.quality);
      const next = vocab[((cur < 0 ? 0 : cur) + dir + vocab.length) % vocab.length]!;
      return { ...e, chord: next };
    });
    this.recordDecision('harmony', `Edit chord ${barIndex + 1}`, chordLabel(events[barIndex]?.chord ?? harmony.events[barIndex]!.chord), { ...harmony, events }, 'Harmony edited — regenerate to hear it.');
  }

  setChord(barIndex: number, chord: Chord): void {
    const { harmony } = this.state;
    if (!harmony) return;
    const events = harmony.events.map((e, i) => (i === barIndex ? { ...e, chord } : e));
    this.set({ harmony: { ...harmony, events } });
  }

  /**
   * Generate candidate beds: the SAME hook, arranged differently.
   *
   * Each candidate pairs a progression with a palette, walked in step so the set
   * covers dark→bright harmony and full-chip→orchestral voicing rather than sampling
   * both at random and landing on near-duplicates. The melody seed is constant across
   * the whole set, so the only variables are harmony and arrangement.
   */
  generateBeds(count = 6): void {
    const { source, meter, bpm, key, melodySeed, evolution, activeEvolution } = this.state;
    if (!source || !key) return;
    const bars = Math.max(1, barsOf(source, meter));
    const rng = makeRng(Math.floor(Math.random() * 1e9));
    const progs = spreadByBrightness(progressionsFor(key.mode), Math.max(count, 4));

    const pool: Candidate[] = [];
    const rejected: string[] = [];
    for (let i = 0; i < count * 4 && pool.length < count; i++) {
      const progression = progs[i % progs.length]!;
      const palette = PALETTE_ORDER[i % PALETTE_ORDER.length]!;
      const harmony = harmonyFromProgression(progression, key, meter, bars);
      const genome = bedGenome(rng, bars, melodySeed, palette);
      const arr = arrange({ harmony, form: wholeForm(harmony), meter, source }, genome);
      const problems = violations(arr, source, bpm, meter);
      if (problems.length) { rejected.push(problems[0]!); continue; }
      pool.push({ genome, arr, progression });
    }

    // Spread the survivors so near-identical takes do not fill the grid (§7.6).
    const scored = pool.map((c) => ({ features: featureVector(c.arr), score: 1 }));
    const idx = selectDiverse(scored, Math.min(count, pool.length), 0.5);
    const candidates = idx.map((i) => pool[i]!).filter(Boolean);

    if (!candidates.length) {
      this.set({ status: `No arrangement passed the critic at ${bpm} BPM — ${rejected[0] ?? 'unknown reason'}. Try a slower tempo or a sparser hook.` });
      return;
    }
    const first = candidates[0]!;
    const snapshot: Snapshot = {
      source, key, meter, bpm, harmony: first.arr.harmony,
      candidates, selected: 0, hook: this.state.hook,
    };
    const node = this.node('generate', 'Beds', `${candidates.length} arrangements · same hook`, snapshot, activeEvolution);
    const dropped = rejected.length ? ` ${rejected.length} rejected by the critic.` : '';
    this.set({
      ...restore(snapshot),
      evolution: [...evolution, node], activeEvolution: node.id,
      status: `${candidates.length} beds — select to audition, pin to keep.${dropped}`,
    });
  }

  /** Return to a node — including the arrangements it held. The next change branches from here. */
  selectEvolution(id: number): void {
    const node = this.state.evolution.find((item) => item.id === id);
    if (!node) return;
    const kept = node.snapshot.candidates.length ? ` ${node.snapshot.candidates.length} arrangements restored.` : '';
    this.set({ ...restore(node.snapshot), activeEvolution: id, status: `Returned to “${node.label}”.${kept} The next change will branch from here.` });
  }

  /**
   * Select a candidate — and adopt its harmony. Each bed carries its own progression,
   * so leaving the app-level harmony behind would leave the chord strip describing a
   * different arrangement from the one playing.
   */
  select(i: number): void {
    const candidate = this.state.candidates[i];
    if (!candidate) return;
    this.set({ selected: i, harmony: candidate.arr.harmony });
  }

  extendSelectedArrangement(targetBars: 8 | 16): void {
    const { candidates, selected, meter, bpm, evolution, activeEvolution } = this.state;
    const candidate = candidates[selected];
    if (!candidate) {
      this.set({ status: 'Select an arrangement before extending it.' });
      return;
    }
    const currentBars = Math.max(1, Math.round(candidate.arr.harmony.length / barTicks(meter)));
    if (currentBars >= targetBars) {
      this.set({ status: `The selected arrangement is already ${currentBars} bars.` });
      return;
    }
    const melody = candidate.arr.tracks.find((track) => track.role === 'melody')?.motif;
    if (!melody) {
      this.set({ status: 'The selected arrangement has no melody track.' });
      return;
    }
    const targetLength = targetBars * barTicks(meter);
    let source = melody;
    while (source.length < targetLength) source = extendTune(source, candidate.arr.harmony.key);
    source = motif(source.notes
      .filter((note) => note.start < targetLength)
      .map((note) => ({ ...note, duration: tick(Math.min(note.duration, targetLength - note.start)) })), tick(targetLength));
    const harmony = extendHarmony(candidate.arr.harmony, tick(targetLength));
    const genome: Genome = { ...candidate.genome, skeleton: { ...candidate.genome.skeleton, bars: targetBars } };
    const arr = arrange({ harmony, form: wholeForm(harmony), meter, source }, genome);
    const extended = { genome, arr, progression: candidate.progression };
    const snapshot: Snapshot = { source, key: harmony.key, meter, bpm, harmony, candidates: [extended], selected: 0, hook: this.state.hook };
    const node = this.node('arrangement-extend', `Arrangement to ${targetBars} bars`, `From candidate ${selected + 1} · style preserved`, snapshot, activeEvolution);
    this.set({
      ...restore(snapshot),
      evolution: [...evolution, node], activeEvolution: node.id,
      status: `Extended the selected arrangement to ${targetBars} bars using the same genome and harmony pattern.`,
    });
  }

  /** Promote the selected arrangement's melody to the next source, enabling another extend/generate pass. */
  promoteCurrentMelody(): void {
    const { candidates, selected, key, meter, bpm, harmony, evolution, activeEvolution } = this.state;
    const candidate = candidates[selected];
    if (!candidate || !key || !harmony) {
      this.set({ status: 'Select an arrangement before using its melody as the source.' });
      return;
    }
    const melody = candidate.arr.tracks.find((track) => track.role === 'melody')?.motif;
    if (!melody) {
      this.set({ status: 'The selected arrangement has no melody track.' });
      return;
    }
    const snapshot: Snapshot = { source: melody, key, meter, bpm, harmony, candidates: [], selected: -1, hook: this.state.hook };
    const node = this.node(
      'promote',
      `Use candidate ${selected + 1}`,
      `${barsOf(melody, meter)} bars · generated melody`,
      snapshot, activeEvolution,
    );
    this.set({
      ...restore(snapshot),
      evolution: [...evolution, node],
      activeEvolution: node.id,
      status: `Candidate ${selected + 1} is now the source melody. Extend it or generate another set.`,
    });
  }

  /** Keep an arrangement aside for comparison. Pins survive every later branch. */
  pin(i: number): void {
    const c = this.state.candidates[i];
    if (!c) return;
    const nodeId = this.state.activeEvolution ?? 0;
    const label = `Take ${this.nextPinId}`;
    const take: PinnedTake = { id: this.nextPinId++, label, nodeId, genome: c.genome, arr: c.arr };
    this.set({ pinned: [...this.state.pinned, take], status: `Pinned candidate ${i + 1} as ${label}. ${this.state.pinned.length + 1} kept for comparison.` });
  }

  unpin(id: number): void {
    const take = this.state.pinned.find((p) => p.id === id);
    if (!take) return;
    this.set({ pinned: this.state.pinned.filter((p) => p.id !== id), status: `Removed ${take.label}.` });
  }

  /** Load a pinned take as the current selection so it can be auditioned against others. */
  auditionPin(id: number): void {
    const take = this.state.pinned.find((p) => p.id === id);
    if (!take) return;
    this.set({
      candidates: [{ genome: take.genome, arr: take.arr, progression: null }],
      selected: 0, harmony: take.arr.harmony,
      status: `Auditioning ${take.label}.`,
    });
  }

  current(): Arrangement | null { return this.state.candidates[this.state.selected]?.arr ?? null; }
  setStatus(status: string): void { this.set({ status }); }

  private node(kind: EvolutionKind, label: string, detail: string, snapshot: Snapshot, parentId: number | null): EvolutionNode {
    return { id: this.nextEvolutionId++, parentId, kind, label, detail, snapshot };
  }

  private recordDecision(kind: EvolutionKind, label: string, detail: string, harmony: Harmony, status: string): void {
    const { source, key, meter, bpm, evolution, activeEvolution } = this.state;
    if (!source || !key) return;
    const snapshot: Snapshot = { source, key, meter, bpm, harmony, candidates: [], selected: -1, hook: this.state.hook };
    const node = this.node(kind, label, detail, snapshot, activeEvolution);
    this.set({ ...restore(snapshot), evolution: [...evolution, node], activeEvolution: node.id, status });
  }
}

/** A snapshot as a state patch — the one place that decides what "restore" means. */
function restore(s: Snapshot): Pick<AppState, 'source' | 'key' | 'meter' | 'bpm' | 'harmony' | 'candidates' | 'selected' | 'hook'> {
  return {
    source: s.source, key: s.key, meter: s.meter, bpm: s.bpm, harmony: s.harmony,
    candidates: [...s.candidates], selected: s.selected, hook: s.hook,
  };
}

function barsOf(source: Motif, meter: Meter): number {
  return Math.max(1, Math.round(source.length / (PPQ * meter.num * (4 / meter.den))));
}


function extendHarmony(source: Harmony, targetLength: Tick): Harmony {
  if (!source.events.length || source.length <= 0) return { ...source, length: targetLength };
  const events: ChordEvent[] = [];
  for (let offset = 0; offset < targetLength; offset += source.length) {
    for (const event of source.events) {
      const start = event.start + offset;
      if (start >= targetLength) break;
      events.push({ ...event, start: tick(start), duration: tick(Math.min(event.duration, targetLength - start)) });
    }
  }
  return { key: source.key, events, length: targetLength };
}

const NAMES = ['C', 'C\u266f', 'D', 'E\u266d', 'E', 'F', 'F\u266f', 'G', 'A\u266d', 'A', 'B\u266d', 'B'];
export const keyName = (k: Key): string => `${NAMES[k.tonic % 12]} ${k.mode}`;
export function chordLabel(chord: Chord): string {
  const root = NAMES[chord.root % 12] ?? '?';
  const suffix: Partial<Record<Chord['quality'], string>> = {
    maj: '', min: 'm', dim: '\u00b0', aug: '+', dom7: '7', maj7: 'maj7', min7: 'm7', min7b5: 'm7\u266d5', dim7: '\u00b07', sus4: 'sus4', sus2: 'sus2',
  };
  return `${root}${suffix[chord.quality] ?? ''}`;
}
