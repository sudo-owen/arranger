import type {
  Arrangement, Chord, Genome, Harmony, Key, Meter, Mode, Motif, Rng,
} from '../core/index.js';
import type { Palette } from '../core/index.js';
import { NEUTRAL_MOOD, PALETTE_ORDER, VOICING_ORDER, barsIn, makeRng, pc } from '../core/index.js';
import type { Role, SectionLabel } from '../core/index.js';
import type { Form, Harmony as HarmonyT, Mood } from '../core/index.js';
import type { GenContext } from '../generate/index.js';
import type { FormShape, Hook, Progression, SongSpec, TreatmentId, VariationPlan, VariationScheme } from '../generate/index.js';
import {
  MOOD_CORNERS, RHYTHM_LABEL, SCHEME_LABEL, arrange, arrangeAtMood, barsForSeconds,
  defaultProgression, describeMood, planForm, secondsForBars, shapesFor,
  extendTune, generateHook, generateHookSet, harmonyFromProgression, harmonyStates, inferHarmony,
  neighbours, progressionsFor, rerollRole, renderHook, sampleHarmony,
  spreadByBrightness, specCovers, wholeForm,
  VARIATION_SCHEMES, driftAt, isStraight, varySource, variationProblems,
} from '../generate/index.js';
import { detectKey } from '../theory/index.js';
import { featureVector, loopSeamProblems, selectDiverse, violations } from '../critic/index.js';

export interface Candidate {
  genome: Genome;
  arr: Arrangement;
  progression: Progression | null;
  /** Set on a neighbour: which single field was changed to get here. */
  label?: string;
}

export type Stage = 'hook' | 'bed' | 'mood' | 'form' | 'vary';
export const STAGES: readonly Stage[] = ['hook', 'bed', 'mood', 'form', 'vary'];
export const STAGE_LABEL: Readonly<Record<Stage, string>> = {
  hook: 'Hook', bed: 'Bed', mood: 'Mood', form: 'Form', vary: 'Vary',
};

export interface HookConstraints { tonic: number; mode: Mode }

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
  hook: Hook | null;
  mood: Mood;
  form: Form | null;
  variation: VariationPlan;
}

export interface EvolutionNode {
  id: number;
  parentId: number | null;
  kind: EvolutionKind;
  label: string;
  detail: string;
  snapshot: Snapshot;
}

export interface PinnedTake {
  id: number;
  label: string;
  nodeId: number;
  genome: Genome;
  arr: Arrangement;
}

/** The lengths the Form stage offers, and what the brief asked for. */
export const LENGTH_TARGETS = [30, 60, 90] as const;

export interface AppState {
  stage: Stage;
  source: Motif | null;
  key: Key | null;
  meter: Meter;
  bpm: number;
  harmony: Harmony | null;
  hook: Hook | null;
  mood: Mood;
  form: Form | null;
  variation: VariationPlan;
  melodySeed: number;
  temperature: number;
  candidates: Candidate[];
  selected: number;
  pinned: PinnedTake[];
  hookDrafts: Hook[];
  selectedHookDraft: number;
  evolution: EvolutionNode[];
  activeEvolution: number | null;
  status: string;
}

const newSeed = (): number => Math.floor(Math.random() * 1e9);

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
function bedGenome(rng: Rng, melodySeed: number, palette: Palette): Genome {
  const seed = (): number => rng.int(1_000_000_000);
  return {
    version: 1,
    palette,
    melody: { seed: melodySeed, ornament: 0.2 + rng.next() * 0.4 },
    bass: { seed: seed(), walkiness: rng.next(), register: rng.int(3) - 1 },
    drums: { seed: seed(), fillDensity: 0.3 + rng.next() * 0.5, swing: 0 },
    winds: { seed: seed(), activity: 0.3 + rng.next() * 0.5 },
    brass: { seed: seed(), voicing: rng.pick(VOICING_ORDER), density: 0.3 + rng.next() * 0.5 },
  };
}

export interface FormPlan { shape: FormShape; form: Form; candidate: Candidate; problems: string[] }
/** `drift` is parallel to `form.sections`, so the UI indexes rather than re-keying. */
export interface VaryPlan {
  scheme: VariationScheme;
  drift: number[];
  problems: string[];
}
/**
 * Each of the three render-time memos below rebuilds several whole arrangements, so
 * each is read far more often than its inputs change. One list of dependencies compared
 * elementwise, rather than a key type per cache: the borrowed-type version grew dummy
 * fields, and a dummy `{}` compared by identity is a cache that can never hit.
 */
type Deps = readonly unknown[];
const sameDeps = (a: Deps, b: Deps): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

class Memo<T> {
  private deps: Deps | null = null;
  private value: T | null = null;
  get(deps: Deps, build: () => T): T {
    if (this.deps && this.value !== null && sameDeps(this.deps, deps)) return this.value;
    this.deps = deps;
    this.value = build();
    return this.value;
  }
}

type Listener = (s: AppState) => void;

export class Store {
  private state: AppState = {
    stage: 'hook',
    source: null, key: null, meter: { num: 4, den: 4 }, bpm: 168,
    harmony: null, hook: null, mood: NEUTRAL_MOOD, form: null, variation: {}, melodySeed: 1, temperature: 0.6, candidates: [], selected: -1, pinned: [],
    hookDrafts: [], selectedHookDraft: -1,
    evolution: [], activeEvolution: null, status: 'Generate a set of hooks to begin.',
  };
  private listeners: Listener[] = [];
  private nextEvolutionId = 1;
  private nextPinId = 1;
  private formMemo = new Memo<FormPlan[]>();
  private cornerMemo = new Memo<{ label: string; mood: Mood; problems: string[] }[]>();
  private varyMemo = new Memo<VaryPlan[]>();

  get(): AppState { return this.state; }
  subscribe(fn: Listener): void { this.listeners.push(fn); fn(this.state); }
  private set(patch: Partial<AppState>): void { this.state = { ...this.state, ...patch }; for (const l of this.listeners) l(this.state); }

  loadSource(source: Motif, bpm: number, meter: Meter, label = 'Imported MIDI', kind: EvolutionKind = 'import'): void {
    const key = detectKey(source);
    const harmony = inferHarmony(source, key, meter);
    const snapshot: Snapshot = { source, key, meter, bpm, harmony, candidates: [], selected: -1, hook: null, mood: NEUTRAL_MOOD, form: null, variation: {} };
    const node = this.node(kind, label, `${barsOf(source, meter)} bars · ${keyName(key)}`, snapshot, null);
    this.set({ ...restore(snapshot), evolution: [...this.state.evolution, node], activeEvolution: node.id, status: `Started with ${label}.` });
  }

  setStage(stage: Stage): void { this.set({ stage }); }

  step(delta: 1 | -1): void {
    const at = STAGES.indexOf(this.state.stage);
    const next = STAGES[Math.max(0, Math.min(STAGES.length - 1, at + delta))];
    if (next) this.set({ stage: next });
  }

  generateHookDrafts(constraints: HookConstraints, count = 6): void {
    const key: Key = { tonic: pc(constraints.tonic), mode: constraints.mode };
    const rng = makeRng(newSeed());
    const hookDrafts = generateHookSet(key, this.state.meter, rng, count);
    this.set({
      hookDrafts,
      selectedHookDraft: hookDrafts.length ? 0 : -1,
      status: `${hookDrafts.length} hooks.`,
    });
  }

  selectHookDraft(index: number): void {
    if (index >= 0 && index < this.state.hookDrafts.length) this.set({ selectedHookDraft: index });
  }

  rerollHookDraft(index: number): void {
    const previous = this.state.hookDrafts[index];
    if (!previous) return;
    const hook = generateHook({ ...previous, seed: newSeed() });
    this.set({
      hookDrafts: this.state.hookDrafts.map((d, i) => (i === index ? hook : d)),
      status: `Rerolled hook ${index + 1}.`,
    });
  }

  useSelectedHook(bars = BED_BARS): void {
    const hook = this.state.hookDrafts[this.state.selectedHookDraft];
    if (!hook) {
      this.set({ status: 'Generate and select a hook first.' });
      return;
    }
    const source = renderHook(hook, bars);
    // Choose the progression rather than inferring one. A hook built from three notes
    // of the tonic triad implies almost nothing, so inference returns the blandest
    // reading that fits and leaves you correcting it bar by bar (§3.4 the other way up).
    const progression = defaultProgression(hook.key.mode);
    const harmony = harmonyFromProgression(progression, hook.key, hook.meter, bars);
    const melodySeed = newSeed();
    const snapshot: Snapshot = {
      source, key: hook.key, meter: hook.meter, bpm: this.state.bpm, harmony,
      candidates: [], selected: -1, hook, mood: this.state.mood, form: null, variation: {},
    };
    const node = this.node('seed', `${RHYTHM_LABEL[hook.rhythm]}`,
      `${SCHEME_LABEL[hook.scheme]} · ${bars} bars · ${keyName(hook.key)}`, snapshot, null);
    this.set({
      ...restore(snapshot),
      stage: 'bed', melodySeed,
      evolution: [...this.state.evolution, node], activeEvolution: node.id,
      status: `Hook committed over ${bars} bars on ${progression.name}.`,
    });
  }

  extendSource(): void {
    const { source, key, meter, harmony, evolution, activeEvolution } = this.state;
    if (!source || !key || !harmony) return;
    const extended = extendTune(source, key);
    const nextHarmony = inferHarmony(extended, key, meter);
    const snapshot: Snapshot = { ...this.snapshot(), source: extended, harmony: nextHarmony, candidates: [], selected: -1 };
    const node = this.node('extend', `Extend to ${barsOf(extended, meter)} bars`, 'Answer phrase · diatonic turn', snapshot, activeEvolution);
    this.set({ ...restore(snapshot), evolution: [...evolution, node], activeEvolution: node.id, status: `Extended to ${barsOf(extended, meter)} bars.` });
  }

  setBpm(bpm: number): void { this.set({ bpm }); }

  setTemperature(t: number): void { this.set({ temperature: t }); }

  reinferHarmony(): void {
    const { source, key, meter, temperature } = this.state;
    if (!source || !key) return;
    const harmony = sampleHarmony(source, key, meter, temperature, makeRng(newSeed()));
    this.recordDecision('harmony', 'Re-read harmony', `Temperature ${temperature.toFixed(2)}`, harmony, `Re-inferred at temperature ${temperature.toFixed(2)}.`);
  }

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
    this.recordDecision('harmony', `Edit chord ${barIndex + 1}`, chordLabel(events[barIndex]!.chord), { ...harmony, events }, 'Harmony edited — regenerate to hear it.');
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
    const { source, meter, bpm, key, hook, harmony: owned, evolution, activeEvolution } = this.state;
    if (!source || !key) return;
    const bars = Math.max(1, barsOf(source, meter));
    const { melodySeed } = this.state;
    const rng = makeRng(newSeed());
    // Imported material arrived without a progression, so its inferred (and possibly
    // hand-corrected) harmony is what it gets arranged over. That is the one context
    // where the chord strip means anything, and overriding it made it inert.
    const progs = hook ? spreadByBrightness(progressionsFor(key.mode), Math.max(count, 4)) : [];

    const pool: Candidate[] = [];
    const rejected: string[] = [];
    for (let i = 0; i < count * 4 && pool.length < count; i++) {
      const progression = progs.length ? progs[i % progs.length]! : null;
      const palette = PALETTE_ORDER[i % PALETTE_ORDER.length]!;
      const harmony = progression ? harmonyFromProgression(progression, key, meter, bars) : owned;
      if (!harmony) break;
      const genome = bedGenome(rng, melodySeed, palette);
      const arr = arrange(this.contextFor(harmony, source, genome), genome);
      const problems = violations(arr, arr.source, bpm);
      if (problems.length) { rejected.push(problems[0]!); continue; }
      // A bed that falls apart at an extreme is not a bed worth offering — the Mood
      // stage would only report it afterwards. Same rule that governs the palettes.
      let cornerFail: string | null = null;
      for (const { mood, label } of MOOD_CORNERS) {
        const at = arrangeAtMood(source, key, meter, bars, genome, progression, mood);
        const problems = violations(at.arr, at.arr.source, bpm);
        if (problems.length) { cornerFail = `${label}: ${problems[0]}`; break; }
      }
      if (cornerFail) { rejected.push(cornerFail); continue; }
      pool.push({ genome, arr, progression });
    }

    // Spread the survivors so near-identical takes do not fill the grid (§7.6).
    const scored = pool.map((c) => ({ features: featureVector(c.arr), score: 1 }));
    const idx = selectDiverse(scored, Math.min(count, pool.length), 0.5);
    const candidates = idx.map((i) => pool[i]!).filter(Boolean);

    if (!candidates.length) {
      this.set({ status: `No arrangement passed the critic at ${bpm} BPM — ${rejected[0] ?? 'unknown reason'}. Generate again, or try a slower tempo.` });
      return;
    }
    const first = candidates[0]!;
    const snapshot: Snapshot = {
      ...this.snapshot(), harmony: first.arr.harmony,
      candidates, selected: 0, form: null,
    };
    const node = this.node('generate', 'Beds', `${candidates.length} arrangements · same hook`, snapshot, activeEvolution);
    const dropped = rejected.length ? ` ${rejected.length} rejected by the critic.` : '';
    this.set({
      ...restore(snapshot),
      evolution: [...evolution, node], activeEvolution: node.id,
      status: `${candidates.length} beds.${dropped}`,
    });
  }

  /**
   * Re-arrange the selected bed at `mood` without touching the store.
   *
   * The pad calls this on every pointer move so you hear the deformation live. Going
   * through `set()` there would rebuild the entire DOM at pointer rate, so the drag
   * previews and only the release commits.
   */
  /** The context every arrangement in the store is built from — form included. */
  private contextFor(harmony: HarmonyT, source: Motif, genome: Genome): GenContext {
    const form = this.state.form ?? wholeForm(harmony);
    const { variation, meter } = this.state;
    return { harmony, form, meter, source: varySource(source, form, variation, harmony, meter, genome) };
  }

  arrangeForMood(mood: Mood): { arr: Arrangement; genome: Genome; progression: Progression } | null {
    const { source, key, meter, form, candidates, selected } = this.state;
    const candidate = candidates[selected];
    if (!source || !key || !candidate) return null;
    return arrangeAtMood(source, key, meter, barsOf(source, meter), candidate.genome, candidate.progression, mood, form ?? undefined, this.state.variation);
  }

  setMood(mood: Mood): void {
    const next = this.arrangeForMood(mood);
    if (!next) { this.set({ mood }); return; }
    const { candidates, selected } = this.state;
    this.set({
      mood,
      harmony: next.arr.harmony,
      candidates: candidates.map((c, i) => (i === selected ? { ...c, arr: next.arr, progression: next.progression } : c)),
      status: `Mood: ${describeMood(mood).name} · ${next.progression.name}.`,
    });
  }

  /**
   * Which of the four extremes the current bed survives. An arrangement that behaves
   * at neutral and falls apart at high urgency is a bug worth seeing while authoring.
   */
  moodCornerReport(): { label: string; mood: Mood; problems: string[] }[] {
    const { source, bpm, candidates, selected } = this.state;
    const candidate = candidates[selected];
    if (!source || !candidate) return [];
    // Four full arrangements — 7x the cost of the entire DOM rebuild, and it grows with
    // bar count. It is read during render, so without this it recomputes an unchanged
    // answer on every pin, status message and re-clicked tempo preset.
    return this.cornerMemo.get(
      [source, bpm, candidate.genome, candidate.progression, this.state.variation, this.state.form],
      () => MOOD_CORNERS.flatMap(({ mood, label }) => {
        const next = this.arrangeForMood(mood);
        return next ? [{ label, mood, problems: violations(next.arr, next.arr.source, bpm) }] : [];
      }),
    );
  }

  generateNeighbours(count = 6): void {
    const { source, key, bpm, candidates, selected, evolution, activeEvolution } = this.state;
    const candidate = candidates[selected];
    if (!source || !key || !candidate) {
      this.set({ status: 'Select a take before asking for variations of it.' });
      return;
    }
    const rng = makeRng(newSeed());
    const harmony = candidate.arr.harmony;
    const kept: Candidate[] = [{ ...candidate }];
    for (const n of neighbours(candidate.genome, rng, count - 1)) {
      const arr = arrange(this.contextFor(harmony, source, n.genome), n.genome);
      if (!violations(arr, arr.source, bpm).length) {
        kept.push({ genome: n.genome, arr, progression: candidate.progression, label: n.changed });
      }
    }
    const snapshot: Snapshot = { ...this.snapshot(), candidates: kept, selected: 0, harmony };
    const node = this.node('generate', 'Variations', `${kept.length - 1} one-field tweaks`, snapshot, activeEvolution);
    this.set({
      ...restore(snapshot),
      evolution: [...evolution, node], activeEvolution: node.id,
      status: `${kept.length - 1} variations of the selected take.`,
    });
  }

  /**
   * Candidate section plans at a target length. Each is a whole track: the hook
   * re-rendered across the span, harmony tiled under it, and the arrangement generated
   * against the plan so the sections are actually audible.
   */
  planForms(seconds: number): FormPlan[] {
    const { source, key, meter, bpm, hook, mood, variation, candidates, selected } = this.state;
    const base = candidates[selected];
    if (!source || !key || !hook || !base) return [];
    // Three whole arrangements — 26-53x a DOM rebuild — and this is read during render,
    // so without the cache every status message and pin recomputes all of them.
    return this.formMemo.get([source, bpm, base.genome, base.progression, seconds, variation, mood], () => {
    const bars = barsForSeconds(seconds, bpm, meter);
    const grown = renderHook(hook, bars);
    return shapesFor(bars).map((shape) => {
      const form = planForm(shape, bars, meter);
      // The genome is untouched across shapes: length and section plan live in `Form`,
      // which is what `arrange` reads. The bed is the same bed, grown.
      const next = arrangeAtMood(grown, key, meter, bars, base.genome, base.progression, mood, form, variation);
      return {
        shape, form,
        candidate: { genome: base.genome, arr: next.arr, progression: next.progression },
        problems: [...violations(next.arr, next.arr.source, bpm), ...loopSeamProblems(next.arr, meter)],
      };
    });
    });
  }

  useForm(plan: FormPlan): void {
    const { key, meter, bpm, hook, evolution, activeEvolution } = this.state;
    if (!key || !hook) return;
    const bars = barsIn(plan.candidate.arr.length, meter);
    const source = renderHook(hook, bars);
    const snapshot: Snapshot = {
      ...this.snapshot(),
      source, harmony: plan.candidate.arr.harmony,
      candidates: [plan.candidate], selected: 0, form: plan.form,
    };
    const node = this.node('arrangement-extend', plan.shape.label,
      `${bars} bars · ${Math.round(secondsForBars(bars, bpm, meter))}s · ${plan.form.sections.map((s) => s.label).join(' ')}`,
      snapshot, activeEvolution);
    this.set({
      ...restore(snapshot),
      evolution: [...evolution, node], activeEvolution: node.id,
      status: `${plan.shape.label} — ${bars} bars, ${plan.form.sections.length} sections, loop seam clean.`,
    });
  }

  /**
   * Every variation scheme rendered against the committed form, so the stage is a
   * comparison rather than a commitment: each card is a whole playable track, carries
   * its own problems, and reports how far each section actually moved. Auditioning one
   * does not disturb the take — only `useVariation` writes.
   */
  varyPlans(): VaryPlan[] {
    const { source, key, meter, bpm, form, mood, candidates, selected } = this.state;
    const base = candidates[selected];
    if (!source || !key || !base || !form) return [];
    return this.varyMemo.get([source, bpm, base.genome, base.progression, form, mood], () => {
      const bars = barsOf(source, meter);
      return VARIATION_SCHEMES.map((scheme) => {
        const next = arrangeAtMood(source, key, meter, bars, base.genome, base.progression, mood, form, scheme.plan);
        const varied = next.arr.source;
        return {
          scheme,
          drift: form.sections.map((sec) => driftAt(source, varied, sec)),
          problems: [
            ...variationProblems(source, varied, form),
            ...violations(next.arr, varied, bpm),
            ...loopSeamProblems(next.arr, meter),
          ],
        };
      });
    });
  }

  useVariation(plan: VariationPlan, label: string): void {
    const { source, key, meter, bpm, mood, form, candidates, selected, evolution, activeEvolution } = this.state;
    const base = candidates[selected];
    if (!source || !key || !base || !form) return;
    const next = arrangeAtMood(source, key, meter, barsOf(source, meter), base.genome, base.progression, mood, form, plan);
    const problems = [...variationProblems(source, next.arr.source, form), ...violations(next.arr, next.arr.source, bpm)];
    if (problems.length) {
      this.set({ status: `That variation does not hold: ${problems[0]}` });
      return;
    }
    const candidate: Candidate = { genome: base.genome, arr: next.arr, progression: next.progression };
    const snapshot: Snapshot = { ...this.snapshot(), candidates: [candidate], selected: 0, variation: plan };
    const detail = form.sections.map((s) => `${s.label}:${plan[s.label] ?? '—'}`).join(' ');
    const node = this.node('arrangement-extend', label, detail, snapshot, activeEvolution);
    this.set({
      ...restore(snapshot),
      evolution: [...evolution, node], activeEvolution: node.id,
      status: `${label} — ${isStraight(plan) ? 'every return identical' : detail}.`,
    });
  }

  /** One section's treatment, for pulling a scheme apart and hearing what each part did. */
  setTreatment(label: SectionLabel, id: TreatmentId): void {
    const plan = { ...this.state.variation, [label]: id };
    this.useVariation(plan, `${label} → ${id}`);
  }

  rerollVoice(role: Role): void {
    const { source, bpm, candidates, selected } = this.state;
    const candidate = candidates[selected];
    if (!source || !candidate) return;
    const genome = rerollRole(candidate.genome, role, makeRng(newSeed()));
    const harmony = candidate.arr.harmony;
    const arr = arrange(this.contextFor(harmony, source, genome), genome);
    if (violations(arr, arr.source, bpm).length) {
      this.set({ status: `That ${role} reroll broke a constraint — try again.` });
      return;
    }
    this.set({
      candidates: candidates.map((c, i) => (i === selected ? { ...c, genome, arr } : c)),
      status: `Rerolled ${role}.`,
    });
  }

  selectEvolution(id: number): void {
    const node = this.state.evolution.find((item) => item.id === id);
    if (!node) return;
    const kept = node.snapshot.candidates.length ? ` ${node.snapshot.candidates.length} arrangements restored.` : '';
    this.set({ ...restore(node.snapshot), activeEvolution: id, status: `Returned to “${node.label}”.${kept}` });
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

  promoteCurrentMelody(): void {
    const { candidates, selected, key, meter, harmony, evolution, activeEvolution } = this.state;
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
    const snapshot: Snapshot = { ...this.snapshot(), source: melody, candidates: [], selected: -1 };
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
      status: `Candidate ${selected + 1} is now the source melody.`,
    });
  }

  pin(i: number): void {
    const c = this.state.candidates[i];
    if (!c) return;
    const nodeId = this.state.activeEvolution ?? 0;
    const label = `Take ${this.nextPinId}`;
    const take: PinnedTake = { id: this.nextPinId++, label, nodeId, genome: c.genome, arr: c.arr };
    this.set({ pinned: [...this.state.pinned, take], status: `Pinned candidate ${i + 1} as ${label}.` });
  }

  unpin(id: number): void {
    const take = this.state.pinned.find((p) => p.id === id);
    if (!take) return;
    this.set({ pinned: this.state.pinned.filter((p) => p.id !== id), status: `Removed ${take.label}.` });
  }

  auditionPin(id: number): void {
    const take = this.state.pinned.find((p) => p.id === id);
    if (!take) return;
    this.set({
      candidates: [{ genome: take.genome, arr: take.arr, progression: null }],
      selected: 0, harmony: take.arr.harmony,
      status: `Auditioning ${take.label}.`,
    });
  }

  songSpec(): SongSpec | null {
    const { hook, key, meter, bpm, source, candidates, selected } = this.state;
    const candidate = candidates[selected];
    if (!hook || !key || !source || !candidate) return null;
    const shapeId = this.state.form?.template;
    const spec: SongSpec = {
      version: 1, bpm, meter, key,
      bars: barsOf(source, meter),
      hook,
      genome: candidate.genome,
      progressionId: candidate.progression?.id ?? defaultProgression(key.mode).id,
      ...(shapeId ? { formTemplate: shapeId } : {}),
      ...(isStraight(this.state.variation) ? {} : { variation: this.state.variation }),
    };
    // A spec rebuilds its source from the hook, so material grown past the hook by
    // extend/promote cannot be expressed. Exporting anyway would ship a track that
    // plays a different tune in-game than the one auditioned here.
    return specCovers(spec, source) ? spec : null;
  }

  current(): Arrangement | null { return this.state.candidates[this.state.selected]?.arr ?? null; }
  setStatus(status: string): void { this.set({ status }); }

  private snapshot(): Snapshot {
    const { source, key, meter, bpm, harmony, candidates, selected, hook, mood, form, variation } = this.state;
    if (!source || !key || !harmony) throw new Error('snapshot before a source exists');
    return { source, key, meter, bpm, harmony, candidates, selected, hook, mood, form, variation };
  }

  private node(kind: EvolutionKind, label: string, detail: string, snapshot: Snapshot, parentId: number | null): EvolutionNode {
    return { id: this.nextEvolutionId++, parentId, kind, label, detail, snapshot };
  }

  private recordDecision(kind: EvolutionKind, label: string, detail: string, harmony: Harmony, status: string): void {
    const { source, key, evolution, activeEvolution } = this.state;
    if (!source || !key) return;
    const snapshot: Snapshot = { ...this.snapshot(), harmony, candidates: [], selected: -1 };
    const node = this.node(kind, label, detail, snapshot, activeEvolution);
    this.set({ ...restore(snapshot), evolution: [...evolution, node], activeEvolution: node.id, status });
  }
}

function restore(s: Snapshot): Snapshot & { candidates: Candidate[] } {
  return {
    ...s,
    candidates: [...s.candidates],
  };
}

const barsOf = (source: Motif, meter: Meter): number => barsIn(source.length, meter);


export const NOTE_NAMES = ['C', 'C\u266f', 'D', 'E\u266d', 'E', 'F', 'F\u266f', 'G', 'A\u266d', 'A', 'B\u266d', 'B'];
export const keyName = (k: Key): string => `${NOTE_NAMES[k.tonic % 12]} ${k.mode}`;
export function chordLabel(chord: Chord): string {
  const root = NOTE_NAMES[chord.root % 12] ?? '?';
  const suffix: Partial<Record<Chord['quality'], string>> = {
    maj: '', min: 'm', dim: '\u00b0', aug: '+', dom7: '7', maj7: 'maj7', min7: 'm7', min7b5: 'm7\u266d5', dim7: '\u00b07', sus4: 'sus4', sus2: 'sus2',
  };
  return `${root}${suffix[chord.quality] ?? ''}`;
}
