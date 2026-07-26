import { PALETTES, PPQ, ROLE_ORDER, barsIn, clampMood, midi, motif, secPerTick, tick } from '../core/index.js';
import type { Arrangement, Form, Key, Mode, Mood, Motif, SectionLabel } from '../core/index.js';
import { MOOD_ARCS, MOOD_CORNERS, RHYTHM_LABEL, SCHEME_LABEL, TREATMENTS, describeMood, distinctPitches, formTicks, layerGains, renderHook } from '../generate/index.js';
import type { MoodArc, VariationPlan } from '../generate/index.js';
import { Transport } from '../audio/index.js';
import { parseMidi, toSMF } from '../midi/index.js';
import { ROLE_COLORS, drawRoll, lineOf, linesOf } from './pianoroll.js';
import { LENGTH_TARGETS, NOTE_NAMES, STAGES, STAGE_LABEL, Store, chordLabel, keyName } from './state.js';
import type { AppState, Stage } from './state.js';

// ─── element helpers (no casts; narrow by instanceof) ────────────────────────
function maybe(id: string): HTMLElement | null { return document.getElementById(id); }
function el(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node;
}
function input(id: string): HTMLInputElement {
  const node = el(id);
  if (!(node instanceof HTMLInputElement)) throw new Error(`#${id} is not an input`);
  return node;
}
function button(id: string): HTMLButtonElement {
  const node = el(id);
  if (!(node instanceof HTMLButtonElement)) throw new Error(`#${id} is not a button`);
  return node;
}
function canvasIn(root: ParentNode, sel: string): HTMLCanvasElement | null {
  const node = root.querySelector(sel);
  return node instanceof HTMLCanvasElement ? node : null;
}

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K, opts: { cls?: string; text?: string; html?: string; attrs?: Record<string, string> } = {},
  ...kids: (Node | null)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (opts.cls) node.className = opts.cls;
  if (opts.text !== undefined) node.textContent = opts.text;
  if (opts.html !== undefined) node.innerHTML = opts.html;
  for (const [k, v] of Object.entries(opts.attrs ?? {})) node.setAttribute(k, v);
  for (const kid of kids) if (kid) node.append(kid);
  return node;
}

const store = new Store();

// ─── audio (created on first play; browsers require a user gesture) ──────────
let audio: { ctx: AudioContext; transport: Transport } | null = null;
let lastPos: number | undefined;
let lastLen: number | undefined;
let previewDraft = -1;
let repaintQueued = false;
let previewTimer: ReturnType<typeof setTimeout> | null = null;
let playbackTarget: 'hook' | 'arrangement' | null = null;

function ensureAudio(): { ctx: AudioContext; transport: Transport } {
  if (audio) return audio;
  const ctx = new AudioContext();
  const transport = new Transport(ctx);
  transport.onTick = (pos, len) => {
    lastPos = pos; lastLen = len;
    if (playbackTarget !== 'arrangement') return;
    const play = maybe('play');
    if (!transport.playing && play) play.textContent = 'Play';
    // The transport ticks every 25ms; repainting every note 40x/s to advance a one-pixel
    // playhead is most of the app's frame budget. One coalesced frame instead.
    if (repaintQueued) return;
    repaintQueued = true;
    requestAnimationFrame(() => { repaintQueued = false; drawMain(); });
  };
  audio = { ctx, transport };
  return audio;
}

// ─── the fight driver ────────────────────────────────────────────────────────
// Module-level so a re-render or a stop cancels it; a timer left running inside a
// torn-down panel would keep driving a detached pad.
let fight: { arc: MoodArc; timer: ReturnType<typeof setInterval> } | null = null;

function stopFight(): void {
  if (fight) clearInterval(fight.timer);
  fight = null;
}

function startFight(arc: MoodArc, step: (m: Mood) => void, onStop: () => void): void {
  stopFight();
  const arr = store.current();
  if (!arr) return;
  const { transport } = ensureAudio();
  if (!transport.playing || playbackTarget !== 'arrangement') {
    transport.stop();
    transport.loop = true;
    transport.load(arr, store.get().bpm);
    playbackTarget = 'arrangement';
    transport.play();
  }
  const lengthSec = Math.max(4, arr.length * secPerTick(store.get().bpm));
  const started = performance.now();
  fight = {
    arc,
    timer: setInterval(() => {
      if (!audio?.transport.playing) { stopFight(); onStop(); return; }
      step(clampMood(arc.at(((performance.now() - started) / 1000 / lengthSec) % 1)));
    }, 100),
  };
}

function soloArrangement(m: Motif, key: Key): Arrangement {
  return {
    source: m,
    harmony: { key, events: [], length: m.length },
    tracks: [{ role: 'melody', motif: m }],
    length: m.length,
  };
}

// ─── drawing ─────────────────────────────────────────────────────────────────
function drawMain(): void {
  const c = canvasIn(document, '#mainRoll');
  if (!c) return;
  const arr = store.current();
  if (!arr) { drawRoll(c, [], 1, store.get().meter); return; }
  const head = playbackTarget === 'arrangement' && audio?.transport.playing ? lastPos : undefined;
  drawRoll(c, linesOf(arr), arr.length, store.get().meter, head, lastLen);
}

function drawSource(): void {
  const c = canvasIn(document, '#sourceRoll');
  if (!c) return;
  const { source, meter } = store.get();
  drawRoll(c, source ? lineOf(source, ROLE_COLORS.melody) : [], source?.length ?? 1, meter);
}

function renderLegend(): void {
  const box = el('legend');
  if (box.childElementCount) return;
  for (const role of ROLE_ORDER) {
    const dot = h('i');
    dot.style.background = ROLE_COLORS[role];
    box.append(h('span', { cls: 'chip' }, dot, document.createTextNode(role)));
  }
}

// ─── the rail ────────────────────────────────────────────────────────────────
function reachable(s: AppState, stage: Stage): boolean {
  return stage === 'hook' || (s.source !== null && s.harmony !== null);
}

function stageSummary(s: AppState, stage: Stage): string {
  switch (stage) {
    case 'hook':
      return s.hook ? `${RHYTHM_LABEL[s.hook.rhythm]} · ${SCHEME_LABEL[s.hook.scheme]}` : '—';
    case 'bed':
      return s.candidates.length ? `${s.candidates.length} candidates` : '—';
    case 'mood':
      return s.source ? `${s.bpm} BPM` : '—';
    case 'form':
      return s.source ? `${barsOf(s)} bars` : '—';
    case 'vary': {
      const moved = s.form?.sections.filter((sec) => s.variation[sec.label] && s.variation[sec.label] !== 'as-written').length ?? 0;
      return moved ? `${moved} sections varied` : '—';
    }
  }
}

function barsOf(s: AppState): number {
  return s.source ? barsIn(s.source.length, s.meter) : 0;
}

function renderRail(s: AppState): void {
  const rail = el('rail');
  rail.replaceChildren();
  const at = STAGES.indexOf(s.stage);
  STAGES.forEach((stage, i) => {
    const ok = reachable(s, stage);
    const b = h('button', { cls: i === at ? 'on' : i < at ? 'done' : '' });
    b.disabled = !ok;
    b.append(
      h('span', { cls: 'k', text: `${i < at && ok ? '✓ ' : ''}${STAGE_LABEL[stage]}` }),
      h('span', { cls: 'v', text: i === at ? 'choosing…' : stageSummary(s, stage) }),
    );
    b.addEventListener('click', () => { stopPlayback(); store.setStage(stage); });
    rail.append(b);
  });
}

// ─── stage: hook ─────────────────────────────────────────────────────────────
let hookTonic = 9; // A — a good dark default for battle music
let hookMode: Mode = 'minor';

const emptyNote = (text: string): HTMLElement => h('div', { cls: 'empty-note', text });

// `hint` is for what the panel cannot show — a legend for a number, an affordance with
// no visual tell. Anything the controls already say is left unsaid.
function panelHead(stage: Stage, title: string, hint?: string, action?: HTMLElement): HTMLElement[] {
  const no = String(STAGES.indexOf(stage) + 1).padStart(2, '0');
  const head = h('div', { cls: 'panel-head' },
    h('div', {}, h('span', { cls: 'section-no', text: no }), h('h2', { text: title })),
    action ?? null);
  if (!hint) head.style.marginBottom = '14px';
  return hint ? [head, h('p', { cls: 'hint', text: hint })] : [head];
}

function renderHookStage(s: AppState, root: HTMLElement): void {
  root.append(...panelHead('hook', 'Hook'));

  const keySel = h('select');
  NOTE_NAMES.forEach((n, i) => {
    const o = h('option', { text: n, attrs: { value: String(i) } });
    if (i === hookTonic) o.selected = true;
    keySel.append(o);
  });
  keySel.addEventListener('change', () => { hookTonic = Number(keySel.value); });

  const modeSel = h('select');
  (['minor', 'major'] as Mode[]).forEach((m) => {
    const o = h('option', { text: m[0]!.toUpperCase() + m.slice(1), attrs: { value: m } });
    if (m === hookMode) o.selected = true;
    modeSel.append(o);
  });
  modeSel.addEventListener('change', () => { hookMode = modeSel.value === 'major' ? 'major' : 'minor'; });

  const gen = h('button', { cls: 'accent', text: s.hookDrafts.length ? 'Generate 6 more' : 'Generate 6 hooks' });
  gen.addEventListener('click', () => {
    stopPlayback();
    store.generateHookDrafts({ tonic: hookTonic, mode: hookMode }, 6);
  });

  root.append(h('div', { cls: 'controls' },
    h('label', { cls: 'field', text: 'Key' }, keySel),
    h('label', { cls: 'field', text: 'Mode' }, modeSel),
    gen));

  const grid = h('div', { cls: 'grid' });
  grid.style.marginTop = '14px';
  root.append(grid);

  if (!s.hookDrafts.length) {
    grid.className = 'empty-note';
    grid.textContent = 'Generate a set to begin.';
    return;
  }

  s.hookDrafts.forEach((hook, i) => {
    const card = h('div', { cls: 'card' + (i === s.selectedHookDraft ? ' selected' : '') });
    card.addEventListener('click', () => store.selectHookDraft(i));

    const play = h('button', { cls: 'icon', text: previewDraft === i ? '■' : '▶', attrs: { title: 'Audition' } });
    play.addEventListener('click', (e) => { e.stopPropagation(); previewHook(i); });
    const reroll = h('button', { cls: 'icon', text: '⟳', attrs: { title: 'Reroll pitches, keep the rhythm' } });
    reroll.addEventListener('click', (e) => { e.stopPropagation(); stopPlayback(); store.rerollHookDraft(i); });

    const mini = h('canvas', { cls: 'mini' });
    card.append(
      h('div', { cls: 'card-head' },
        h('span', { cls: 't', text: RHYTHM_LABEL[hook.rhythm] }),
        h('div', { cls: 'card-actions' }, play, reroll)),
      mini,
      h('small', { text: `${SCHEME_LABEL[hook.scheme]} · ${distinctPitches(hook)} pitches · ${hook.cellBars} bar${hook.cellBars > 1 ? 's' : ''}` }),
    );
    grid.append(card);
    const preview = renderHook(hook, 4);
    requestAnimationFrame(() => drawRoll(mini, lineOf(preview, ROLE_COLORS.melody), preview.length, hook.meter));
  });
}

function previewHook(index: number): void {
  if (previewDraft === index && audio?.transport.playing) { stopPlayback(); render(store.get()); return; }
  const hook = store.get().hookDrafts[index];
  if (!hook) return;
  stopPlayback();
  const { transport } = ensureAudio();
  const m = renderHook(hook, 4);
  transport.loop = false;
  transport.load(soloArrangement(m, hook.key), store.get().bpm);
  playbackTarget = 'hook';
  transport.play();
  previewDraft = index;
  store.selectHookDraft(index);
  previewTimer = setTimeout(() => { stopPlayback(); render(store.get()); },
    m.length * secPerTick(store.get().bpm) * 1000 + 250);
}

// ─── stage: bed ──────────────────────────────────────────────────────────────
function renderBedStage(s: AppState, root: HTMLElement): void {
  const gen = h('button', { cls: 'primary', text: s.candidates.length ? 'Generate again' : 'Generate 6 beds' });
  gen.disabled = !s.harmony;
  gen.addEventListener('click', () => { stopPlayback(); store.generateBeds(6); });

  root.append(...panelHead('bed', `Bed — ${barsOf(s)} bars`, undefined, gen));

  const grid = h('div', { cls: 'grid' });
  root.append(grid);
  if (!s.candidates.length) {
    grid.className = 'empty-note';
    grid.textContent = 'Generate a set to begin.';
  } else {
    s.candidates.forEach((cand, i) => {
      const pinned = s.pinned.some((p) => p.genome === cand.genome);
      const card = h('div', { cls: 'card' + (i === s.selected ? ' selected' : '') });
      card.addEventListener('click', () => selectCandidate(i));
      const pin = h('button', { cls: 'icon', text: pinned ? '★' : '☆', attrs: { title: pinned ? 'Pinned' : 'Pin for comparison' } });
      pin.disabled = pinned;
      pin.addEventListener('click', (e) => { e.stopPropagation(); store.pin(i); });
      const mini = h('canvas', { cls: 'mini' });
      const prog = cand.progression;
      const palette = PALETTES[cand.genome.palette];
      card.append(
        h('div', { cls: 'card-head' },
          h('span', { cls: 't', text: prog ? prog.name : `#${i + 1}` }),
          h('div', { cls: 'card-actions' }, pin)),
        mini,
        h('small', { text: cand.label ? `± ${cand.label}` : `${palette.label} · ${prog ? prog.brightness : 'custom'}` }),
        h('small', { text: cand.label ? palette.label : prog ? prog.blurb : palette.blurb }),
      );
      grid.append(card);
      requestAnimationFrame(() => drawRoll(mini, linesOf(cand.arr), cand.arr.length, s.meter));
    });
  }
  if (s.candidates.length) {
    const near = h('button', { cls: 'small', text: '± variations of the selected take' });
    near.addEventListener('click', () => { stopPlayback(); store.generateNeighbours(6); });
    const bar = h('div', { cls: 'controls' });
    bar.style.marginTop = '12px';
    bar.append(near);
    root.append(bar);
  }
  root.append(mainPlayer(s));
}

// ─── stages: mood / form / vary (partly built) ───────────────────────────────
function renderMoodStage(s: AppState, root: HTMLElement): void {
  root.append(...panelHead('mood', 'Mood', 'Drag the pad while it plays.'));

  if (!s.candidates[s.selected]) {
    root.append(emptyNote('Pick a bed first.'));
    return;
  }

  const row = h('div', { cls: 'mood-row' });
  const pad = h('div', { cls: 'pad', attrs: { role: 'application', 'aria-label': 'urgency and fortune' } });
  const dot = h('div', { cls: 'dot' });
  pad.append(dot);
  const framed = h('div', { cls: 'pad-frame' },
    h('span', { cls: 'ax top', text: 'winning' }), pad,
    h('span', { cls: 'ax bottom', text: 'losing' }), h('span', { cls: 'ax right', text: 'urgent →' }));
  const readout = h('div', { cls: 'mood-readout' });
  row.append(framed, readout);
  root.append(row);

  let live = s.mood;
  const place = (m: Mood): void => {
    dot.style.left = `${m.urgency * 100}%`;
    dot.style.top = `${(1 - m.fortune) * 100}%`;
    const { name, detail } = describeMood(m);
    readout.replaceChildren(
      h('div', { cls: 'mood-name', text: name }),
      h('p', { cls: 'hint', text: detail }),
    );
  };
  place(live);

  // Preview on drag (audio only), commit on release. Routing every pointer move through
  // the store would rebuild the whole panel underneath the cursor.
  // Two clocks, matching the two time-scales the mood model is built around: gains
  // glide at frame rate, re-arrangement is throttled toward the bar line it can
  // actually land on. Re-arranging per frame paid for ~120 arrangements per drag to
  // hear one, and paid for them even with playback stopped.
  // The slow clock, shared by both drivers below: re-render at `m` and cross over at the
  // next bar line. They differ only in when they decide it is worth paying for — the pad
  // on a debounce after the cursor settles, the fight on how far the mood has travelled.
  const rearrange = (m: Mood): void => {
    const next = store.arrangeForMood(m);
    if (next) audio?.transport.swapAtBoundary(next.arr, store.get().bpm, store.get().meter);
  };
  let queued = false;
  let rearrangeAt: ReturnType<typeof setTimeout> | null = null;
  const preview = (): void => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(() => { queued = false; audio?.transport.setLayerGains(layerGains(live)); });
    }
    if (!audio?.transport.playing || playbackTarget !== 'arrangement') return;
    if (rearrangeAt !== null) clearTimeout(rearrangeAt);
    rearrangeAt = setTimeout(() => { rearrangeAt = null; rearrange(live); }, 200);
  };
  const at = (e: PointerEvent): Mood => {
    const r = pad.getBoundingClientRect();
    return { urgency: (e.clientX - r.left) / r.width, fortune: 1 - (e.clientY - r.top) / r.height };
  };
  pad.addEventListener('pointerdown', (e) => {
    pad.setPointerCapture(e.pointerId);
    live = clampMood(at(e)); place(live); preview();
  });
  pad.addEventListener('pointermove', (e) => {
    if (!pad.hasPointerCapture(e.pointerId)) return;
    live = clampMood(at(e)); place(live); preview();
  });
  pad.addEventListener('pointerup', (e) => {
    pad.releasePointerCapture(e.pointerId);
    store.setMood(live);
  });

  const corners = h('div', { cls: 'controls' });
  for (const { mood, label } of MOOD_CORNERS) {
    const b = h('button', { cls: 'small', text: label });
    b.addEventListener('click', () => store.setMood(mood));
    corners.append(b);
  }
  root.append(h('p', { cls: 'side-title', text: 'Jump to a corner' }), corners);

  // One pass of a fight. Gains glide every tick; the arrangement swaps at the next bar
  // line, but only once the mood has actually travelled — a continuous sweep re-arranged
  // per frame would pay for a hundred arrangements to hear four.
  root.append(h('p', { cls: 'side-title', text: 'Play a fight' }));
  const arcs = h('div', { cls: 'controls' });
  const arcHint = h('p', { cls: 'hint' });
  // Deliberately NOT a re-render: rebuilding the panel would replace the pad this is
  // driving, and the fight would go on writing to a detached element.
  const buttons = new Map<MoodArc, HTMLButtonElement>();
  const paintArcs = (): void => {
    for (const [arc, b] of buttons) b.className = arc === fight?.arc ? 'small primary' : 'small';
    // Idle needs no line — the buttons are labelled and their blurbs are on hover.
    arcHint.textContent = fight ? `Playing “${fight.arc.label}” — ${fight.arc.blurb}.` : '';
  };
  for (const arc of MOOD_ARCS) {
    const b = h('button', { cls: 'small', text: arc.label, attrs: { title: arc.blurb } });
    buttons.set(arc, b);
    b.addEventListener('click', () => {
      if (fight?.arc === arc) { stopFight(); paintArcs(); return; }
      let lastArranged = live;
      startFight(arc, (m) => {
        live = m;
        place(m);
        audio?.transport.setLayerGains(layerGains(m));
        if (Math.hypot(m.urgency - lastArranged.urgency, m.fortune - lastArranged.fortune) < 0.18) return;
        lastArranged = m;
        rearrange(m);
      }, paintArcs);
      paintArcs();
    });
    arcs.append(b);
  }
  paintArcs();
  root.append(arcs, arcHint);

  root.append(h('p', { cls: 'side-title', text: 'Reroll one voice' }));
  for (const role of ROLE_ORDER) {
    const swatch = h('span', { cls: 'sw' });
    swatch.style.background = ROLE_COLORS[role];
    const roll = h('button', { cls: 'small', text: '⟳ reroll' });
    roll.addEventListener('click', () => store.rerollVoice(role));
    root.append(h('div', { cls: 'layerrow' }, swatch, h('span', { cls: 'nm', text: role }), roll));
  }

  const report = store.moodCornerReport();
  const bad = report.filter((c) => c.problems.length);
  root.append(h('p', {
    cls: bad.length ? 'notice warn' : 'notice',
    text: bad.length
      ? `Fails at ${bad.length} of 4 corners — ${bad[0]!.label}: ${bad[0]!.problems[0]}`
      : `Playable at all four corners: ${report.map((c) => c.label).join(', ')}.`,
  }));

  const bpm = h('input', { attrs: { type: 'range', min: '90', max: '200', step: '1', value: String(s.bpm) } });
  const bpmVal = h('span', { cls: 'val', text: String(s.bpm) });
  bpm.addEventListener('input', () => { bpmVal.textContent = bpm.value; });
  bpm.addEventListener('change', () => setBpm(Number(bpm.value)));
  const vol = h('input', { attrs: { type: 'range', min: '0', max: '100', value: '85' } });
  vol.addEventListener('input', () => audio?.transport.setVolume(Number(vol.value) / 100));
  root.append(h('div', { cls: 'knobs' },
    h('label', { text: 'Tempo' }, bpm, bpmVal),
    h('label', { text: 'Level' }, vol, h('span', { cls: 'val' }))));

  const presets = h('div', { cls: 'tempo-presets' });
  for (const [name, value] of [['Marcia', 140], ['Drive', 155], ['Battle', 168], ['Frantic', 185]] as const) {
    const b = h('button', { cls: value === s.bpm ? 'active' : '', html: `${name} <span>${value}</span>` });
    b.addEventListener('click', () => setBpm(value));
    presets.append(b);
  }
  root.append(presets, mainPlayer(s));
}

// Concrete hexes from ROLE_COLORS, not CSS variables: the canvas needs values anyway,
// and the `--melody`/`--bass`/… custom properties were removed from styles.css as dead.
const SECTION_HUE: Readonly<Record<SectionLabel, string>> = {
  intro: ROLE_COLORS.drums, A: ROLE_COLORS.melody, "A'": ROLE_COLORS.melody,
  B: ROLE_COLORS.winds, 'A"': ROLE_COLORS.brass, tag: ROLE_COLORS.bass,
};

let formSeconds = 60;

/** The form as a proportional strip. With `drift` (parallel to `form.sections`) each
 *  cell also reports how far its treatment moved that section. */
function sectionBar(form: Form, drift?: readonly number[]): HTMLElement {
  const total = formTicks(form);
  const row = h('div', { cls: 'formbar' });
  form.sections.forEach((sec, i) => {
    const moved = drift?.[i] ?? 0;
    const cell = h('div', { text: moved ? `${sec.label} ${Math.round(moved * 100)}%` : sec.label });
    cell.style.width = `${(sec.length / total) * 100}%`;
    cell.style.background = SECTION_HUE[sec.label];
    if (drift) cell.style.opacity = String(0.35 + moved * 0.65);
    row.append(cell);
  });
  return row;
}

function renderFormStage(s: AppState, root: HTMLElement): void {
  root.append(...panelHead('form', 'Form'));

  if (!s.candidates[s.selected] || !s.hook) {
    root.append(emptyNote('Pick a bed first.'));
    return;
  }

  const lengths = h('div', { cls: 'controls' });
  for (const seconds of LENGTH_TARGETS) {
    const b = h('button', { cls: seconds === formSeconds ? 'small primary' : 'small', text: `${seconds}s` });
    b.addEventListener('click', () => { formSeconds = seconds; render(store.get()); });
    lengths.append(b);
  }
  root.append(lengths);

  const plans = store.planForms(formSeconds);
  if (!plans.length) {
    root.append(emptyNote('No section plan fits that length at this tempo — try a longer target.'));
    root.append(mainPlayer(s));
    return;
  }

  const grid = h('div');
  grid.style.marginTop = '14px';
  for (const plan of plans) {
    const bars = barsIn(plan.candidate.arr.length, s.meter);
    const chosen = s.form?.template === plan.shape.template && s.candidates[s.selected]?.arr.length === plan.candidate.arr.length;
    const card = h('div', { cls: 'card' + (chosen ? ' selected' : '') });
    card.style.marginBottom = '10px';
    const use = h('button', { cls: 'small', text: chosen ? 'in use' : 'use this' });
    use.disabled = chosen || plan.problems.length > 0;
    use.addEventListener('click', (e) => { e.stopPropagation(); stopPlayback(); store.useForm(plan); });
    card.append(
      h('div', { cls: 'card-head' },
        h('span', { cls: 't', text: `${plan.shape.label} · ${bars} bars` }),
        h('div', { cls: 'card-actions' }, use)),
      sectionBar(plan.form),
      h('small', { text: plan.shape.blurb }),
      h('small', {
        text: plan.problems.length ? `⚠ ${plan.problems[0]}` : `${plan.form.sections.map((x) => x.label).join(' · ')} — loop seam clean`,
      }),
    );
    grid.append(card);
  }
  root.append(grid, mainPlayer(s));
}

function renderVaryStage(s: AppState, root: HTMLElement): void {
  // The only hint left on this stage: the percentages in the section bar have no legend
  // anywhere else, and read as a confidence or a level without one.
  root.append(...panelHead('vary', 'Variation',
    'Percentages are the share of that section’s notes the treatment moved.'));

  if (!s.form || !s.candidates[s.selected]) {
    root.append(emptyNote('Commit a form first.'));
    return;
  }
  if (s.hook) {
    root.append(h('div', { cls: 'layerrow' },
      h('span', { cls: 'sw' }), h('span', { cls: 'nm', text: `${RHYTHM_LABEL[s.hook.rhythm]} · ${SCHEME_LABEL[s.hook.scheme]} · ${distinctPitches(s.hook)} pitches` })));
  }

  const asList = (p: VariationPlan): string => s.form!.sections.map((sec) => p[sec.label] ?? 'as-written').join(' ');
  const inUse = asList(s.variation);

  const grid = h('div');
  grid.style.marginTop = '14px';
  for (const plan of store.varyPlans()) {
    const chosen = asList(plan.scheme.plan) === inUse;
    const card = h('div', { cls: 'card' + (chosen ? ' selected' : '') });
    card.style.marginBottom = '10px';
    const use = h('button', { cls: 'small', text: chosen ? 'in use' : 'use this' });
    use.disabled = chosen || plan.problems.length > 0;
    use.addEventListener('click', (e) => {
      e.stopPropagation();
      stopPlayback();
      store.useVariation(plan.scheme.plan, plan.scheme.label);
    });
    const moved = plan.drift.filter((d) => d > 0).length;
    card.append(
      h('div', { cls: 'card-head' },
        h('span', { cls: 't', text: `${plan.scheme.label} · ${moved}/${plan.drift.length} sections moved` }),
        h('div', { cls: 'card-actions' }, use)),
      sectionBar(s.form, plan.drift),
      h('small', { text: plan.scheme.blurb }),
      h('small', {
        text: plan.problems.length ? `⚠ ${plan.problems[0]}` : s.form.sections
          .map((sec) => `${sec.label}:${plan.scheme.plan[sec.label] ?? 'as-written'}`).join(' · '),
      }),
    );
    grid.append(card);
  }
  root.append(grid);

  // Per-section override — the part that makes this a bench rather than five presets.
  const bench = h('div', { cls: 'card' });
  bench.style.marginTop = '4px';
  bench.append(h('div', { cls: 'card-head' }, h('span', { cls: 't', text: 'Set one section at a time' })));
  for (const sec of s.form.sections) {
    const row = h('div', { cls: 'controls' });
    const tag = h('span', { cls: 'nm', text: sec.label });
    tag.style.minWidth = '46px';
    tag.style.color = SECTION_HUE[sec.label];
    row.append(tag);
    for (const t of TREATMENTS) {
      const on = (s.variation[sec.label] ?? 'as-written') === t.id;
      const b = h('button', { cls: on ? 'small primary' : 'small', text: t.label, attrs: { title: t.blurb } });
      b.disabled = on;
      b.addEventListener('click', () => { stopPlayback(); store.setTreatment(sec.label, t.id); });
      row.append(b);
    }
    bench.append(row);
  }
  root.append(bench, mainPlayer(s));
}

function mainPlayer(s: AppState): HTMLElement {
  const wrap = h('div');
  wrap.style.marginTop = '16px';
  wrap.append(h('p', { cls: 'side-title', text: 'Selected arrangement' }));
  const c = h('canvas', { cls: 'roll roll-main', attrs: { id: 'mainRoll' } });
  wrap.append(c);

  // Selecting a bed starts playback, so this button is rebuilt mid-play — it has to read
  // the transport rather than assume a stopped one.
  const playing = playbackTarget === 'arrangement' && audio?.transport.playing === true;
  const play = h('button', { cls: 'primary', text: playing ? 'Stop' : 'Play', attrs: { id: 'play' } });
  play.disabled = !s.candidates[s.selected];
  play.addEventListener('click', () => {
    const arr = store.current();
    if (!arr) return;
    const { transport } = ensureAudio();
    if (playbackTarget === 'arrangement' && transport.playing) { stopPlayback(); play.textContent = 'Play'; return; }
    stopPlayback();
    transport.loop = true;
    transport.load(arr, store.get().bpm);
    playbackTarget = 'arrangement';
    transport.play();
    play.textContent = 'Stop';
  });

  const srcRoll = h('canvas', { cls: 'roll roll-source', attrs: { id: 'sourceRoll' } });
  const srcTitle = h('p', { cls: 'side-title', text: `Hook, as written out over ${barsOf(s)} bars` });
  srcTitle.style.marginTop = '16px';

  wrap.append(h('div', { cls: 'transport-row' }, play), srcTitle, srcRoll);
  requestAnimationFrame(() => { drawMain(); drawSource(); });
  return wrap;
}

// ─── sidebar ─────────────────────────────────────────────────────────────────
function renderEvolution(s: AppState): void {
  const root = el('evolution');
  root.replaceChildren();
  if (!s.evolution.length) {
    // A plain line, not a dashed drop-target box — nothing is droppable here.
    root.append(h('p', { cls: 'tree-empty', text: 'No history yet.' }));
    return;
  }
  const depth = new Map<number, number>();
  for (const node of s.evolution) {
    depth.set(node.id, node.parentId === null ? 0 : (depth.get(node.parentId) ?? 0) + 1);
  }
  for (const node of s.evolution) {
    const d = Math.min(3, depth.get(node.id) ?? 0);
    const b = h('button', {
      cls: `depth-${d}${node.id === s.activeEvolution ? ' on' : ''}`,
      text: `${node.id === s.activeEvolution ? '● ' : '○ '}${node.label} — ${node.detail}`,
      attrs: { title: `${node.kind}: ${node.label} — ${node.detail}` },
    });
    b.addEventListener('click', () => { stopPlayback(); store.selectEvolution(node.id); });
    root.append(b);
  }
}

function renderPins(s: AppState): void {
  const tray = el('pinTray');
  tray.replaceChildren();
  if (!s.pinned.length) {
    tray.className = 'pin-tray empty';
    tray.textContent = 'Pin takes with ☆ to keep them.';
    return;
  }
  tray.className = 'pin-tray';
  for (const take of s.pinned) {
    const active = s.candidates[s.selected]?.genome === take.genome;
    const label = h('button', { cls: 'pin-label', text: take.label, attrs: { title: 'Audition this take' } });
    label.addEventListener('click', () => {
      store.auditionPin(take.id);
      // Cross over at the next bar rather than restarting — comparing two takes works
      // best when the beat never breaks.
      if (audio?.transport.playing && playbackTarget === 'arrangement') {
        audio.transport.swapAtBoundary(take.arr, store.get().bpm, store.get().meter);
      }
    });
    const drop = h('button', { cls: 'pin-drop', text: '×', attrs: { title: 'Remove' } });
    drop.addEventListener('click', () => store.unpin(take.id));
    tray.append(h('div', { cls: 'pin' + (active ? ' active' : '') }, label, drop));
  }
}

function renderChords(s: AppState): void {
  const strip = el('chordStrip');
  strip.replaceChildren();
  if (!s.harmony) { strip.textContent = 'Chords appear here once a hook is committed.'; return; }
  // A hook's harmony belongs to the bed's progression, so editing it here would be
  // discarded by the next Generate. Imported material has no progression, and there
  // these controls are the only way to shape its harmony.
  const owned = s.hook !== null;
  s.harmony.events.forEach((ev, i) => {
    const b = h('button', { cls: 'chord', text: chordLabel(ev.chord) });
    if (owned) {
      b.disabled = true;
      b.title = 'Chosen by the selected bed’s progression';
    } else {
      b.title = 'Click to change · Shift-click for previous';
      b.addEventListener('click', (e) => store.cycleChord(i, e.shiftKey ? -1 : 1));
    }
    strip.append(b);
  });
  for (const id of ['temp', 'tempVal', 'reinfer']) {
    const node = maybe(id);
    if (node) node.style.display = owned ? 'none' : '';
  }
  const note = el('harmonyNote');
  note.textContent = owned
    ? 'The selected bed owns its harmony — pick a different progression on the Bed stage to change it.'
    : 'Imported melodies have no progression, so these chords are inferred and yours to correct.';
}

// ─── render ──────────────────────────────────────────────────────────────────
const STAGE_VIEWS: Readonly<Record<Stage, (s: AppState, root: HTMLElement) => void>> = {
  hook: renderHookStage, bed: renderBedStage, mood: renderMoodStage,
  form: renderFormStage, vary: renderVaryStage,
};

function render(s: AppState): void {
  renderLegend();
  renderRail(s);

  const root = el('stage');
  root.replaceChildren();
  STAGE_VIEWS[s.stage](s, root);

  el('keyLabel').textContent = s.key ? `${keyName(s.key)} · ${s.meter.num}/${s.meter.den} · ${s.bpm} BPM` : '—';
  el('status').textContent = s.status;
  renderChords(s);
  renderEvolution(s);
  renderPins(s);

  const at = STAGES.indexOf(s.stage);
  button('stageBack').disabled = at === 0;
  const next = button('stageNext');
  if (s.stage === 'hook') {
    next.textContent = 'Use this hook →';
    next.disabled = s.selectedHookDraft < 0;
  } else {
    next.textContent = 'continue →';
    next.disabled = at === STAGES.length - 1;
  }
}

/** Select a candidate and put it on. Picking a bed is an act of listening, so the click
 *  that selects one is also the click that plays it — there is nothing to do with a
 *  selected bed except hear it. */
function selectCandidate(i: number): void {
  const s = store.get();
  const arr = s.candidates[i]?.arr;
  if (!arr) return;
  const live = playbackTarget === 'arrangement' && audio?.transport.playing === true;
  if (live && i === s.selected) return; // already the thing you are hearing
  const { transport } = ensureAudio();
  if (live) {
    // Bar-aligned, not immediate: when judging two takes against each other, a chopped
    // note tail is the loudest thing in the comparison.
    transport.swapAtBoundary(arr, s.bpm, s.meter);
  } else {
    stopPlayback();
    transport.loop = true;
    transport.load(arr, s.bpm);
    playbackTarget = 'arrangement';
    transport.play();
  }
  store.select(i); // renders last, so the transport button reads the state it lands in
}

function stopPlayback(): void {
  stopFight();
  if (previewTimer !== null) clearTimeout(previewTimer);
  previewTimer = null;
  audio?.transport.stop();
  previewDraft = -1;
  playbackTarget = null;
  const play = maybe('play');
  if (play) play.textContent = 'Play';
}

function setBpm(bpm: number): void {
  store.setBpm(bpm);
  if (audio?.transport.playing) {
    const arr = store.current();
    if (arr && playbackTarget === 'arrangement') audio.transport.swapTo(arr, bpm); // tempo moves the bar lines
  }
}

// ─── a built-in melody so the app works with zero setup ──────────────────────
function demoMotif(): Motif {
  const q = PPQ;
  const pitches = [67, 64, 60, 64, 65, 67, 69, 67, 64, 65, 67, 72, 71, 67, 64, 60];
  const notes = pitches.map((p, i) => ({ start: tick(i * q), duration: tick(i === pitches.length - 1 ? q * 2 : q), pitch: midi(p), velocity: 96 }));
  return motif(notes, tick(16 * q));
}

// ─── wiring ──────────────────────────────────────────────────────────────────
el('stageBack').addEventListener('click', () => { stopPlayback(); store.step(-1); });
el('stageNext').addEventListener('click', () => {
  stopPlayback();
  if (store.get().stage === 'hook') store.useSelectedHook();
  else store.step(1);
});

input('file').addEventListener('change', (e) => {
  const target = e.currentTarget;
  if (!(target instanceof HTMLInputElement)) return;
  const file = target.files?.[0];
  if (!file) return;
  stopPlayback();
  file.arrayBuffer().then((buf) => {
    try {
      const parsed = parseMidi(buf);
      store.loadSource(parsed.motif, parsed.bpm, parsed.meter);
      store.setStage('bed');
    } catch (err) {
      store.setStatus(`Could not read that MIDI file: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }).catch(() => store.setStatus('Could not read that file.'));
});

el('demo').addEventListener('click', () => {
  stopPlayback();
  store.loadSource(demoMotif(), 168, { num: 4, den: 4 }, 'Classic demo', 'import');
  store.setStage('bed');
});
el('extend').addEventListener('click', () => {
  if (!store.get().source) { store.setStatus('Commit a hook before extending.'); return; }
  stopPlayback();
  store.extendSource();
});
el('promote').addEventListener('click', () => { stopPlayback(); store.promoteCurrentMelody(); });
el('reinfer').addEventListener('click', () => store.reinferHarmony());

const temp = input('temp');
temp.addEventListener('input', () => { el('tempVal').textContent = (Number(temp.value) / 100).toFixed(2); });
temp.addEventListener('change', () => store.setTemperature(Number(temp.value) / 100));

el('export').addEventListener('click', () => {
  const arr = store.current();
  if (!arr) { store.setStatus('Nothing to export yet — generate a bed first.'); return; }
  download('battle-theme.mid', new Blob([new Uint8Array(toSMF(arr, store.get().bpm, store.get().meter))], { type: 'audio/midi' }));
});

el('exportSpec').addEventListener('click', () => {
  const spec = store.songSpec();
  if (!spec) { store.setStatus('Commit a hook and select a bed first.'); return; }
  download('battle-theme.json', new Blob([JSON.stringify(spec, null, 2)], { type: 'application/json' }));
  store.setStatus('Exported song.json — the game rebuilds the track from this at any mood.');
});

function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

window.addEventListener('resize', () => { drawMain(); drawSource(); });
store.subscribe(render);
