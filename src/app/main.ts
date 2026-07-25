import { LEAD, PALETTES, PPQ, midi, motif, tick } from '../core/index.js';
import type { Arrangement, Key, Mode, Motif, Role } from '../core/index.js';
import { RHYTHM_LABEL, SCHEME_LABEL, distinctPitches, renderHook } from '../generate/index.js';
import { Transport } from '../audio/index.js';
import { parseMidi, toSMF } from '../midi/index.js';
import { ROLE_COLORS, drawRoll, lineOf, linesOf } from './pianoroll.js';
import { STAGES, STAGE_LABEL, Store, chordLabel, keyName } from './state.js';
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

/** Build an element with class, text and children in one call — this file makes a lot of DOM. */
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
let previewTimer: ReturnType<typeof setTimeout> | null = null;
let playbackTarget: 'hook' | 'source' | 'arrangement' | null = null;
let sourcePlaybackMotif: Motif | null = null;

function ensureAudio(): { ctx: AudioContext; transport: Transport } {
  if (audio) return audio;
  const ctx = new AudioContext();
  const transport = new Transport(ctx);
  transport.onTick = (pos, len) => {
    lastPos = pos; lastLen = len;
    if (playbackTarget === 'source') {
      updateSourceTransport(pos, len);
      drawSource();
    } else if (playbackTarget === 'arrangement') {
      const play = maybe('play');
      if (!transport.playing && play) play.textContent = 'Play';
      drawMain();
    }
  };
  audio = { ctx, transport };
  return audio;
}

/**
 * A bare motif dressed as an arrangement so the transport can play it. The explicit
 * LEAD matters: a track with no instrument is percussion to the renderer, so omitting
 * it turns a melody preview into a drum solo.
 */
function soloArrangement(m: Motif, key: Key): Arrangement {
  return {
    source: m,
    harmony: { key, events: [], length: m.length },
    tracks: [{ role: 'melody', instrument: LEAD, motif: m }],
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
  const head = playbackTarget === 'source' ? audio?.transport.positionSec : undefined;
  drawRoll(c, source ? lineOf(source, ROLE_COLORS.melody) : [], source?.length ?? 1, meter, head, lastLen);
}

function renderLegend(): void {
  const box = el('legend');
  if (box.childElementCount) return;
  const roles: Role[] = ['melody', 'bass', 'winds', 'brass', 'drums'];
  for (const role of roles) {
    const dot = h('i');
    dot.style.background = ROLE_COLORS[role];
    box.append(h('span', { cls: 'chip' }, dot, document.createTextNode(role)));
  }
}

// ─── the rail ────────────────────────────────────────────────────────────────
/** A stage is reachable once the material it operates on exists. */
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
    case 'vary':
      return '—';
    default: return '—';
  }
}

function barsOf(s: AppState): number {
  if (!s.source) return 0;
  return Math.max(1, Math.round(s.source.length / (PPQ * s.meter.num * (4 / s.meter.den))));
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
const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
let hookTonic = 9; // A — a good dark default for battle music
let hookMode: Mode = 'minor';

function renderHookStage(s: AppState, root: HTMLElement): void {
  root.append(
    h('div', { cls: 'panel-head' },
      h('div', {}, h('span', { cls: 'section-no', text: '01' }), h('h2', { text: 'Hook' })),
    ),
    h('p', { cls: 'hint', html: 'A short cell and how it comes back. Everything after this is built on the one you pick — three to five pitches, so it stays hummable.' }),
  );

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
    grid.textContent = 'Generate a set to begin. Each card is a different rhythm and a different way of restating it.';
    return;
  }

  s.hookDrafts.forEach((draft, i) => {
    const { hook } = draft;
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
  const draft = store.get().hookDrafts[index];
  if (!draft) return;
  stopPlayback();
  const { transport } = ensureAudio();
  const m = renderHook(draft.hook, 4);
  transport.loop = false;
  transport.load(soloArrangement(m, draft.hook.key), store.get().bpm);
  playbackTarget = 'hook';
  transport.play();
  previewDraft = index;
  store.selectHookDraft(index);
  previewTimer = setTimeout(() => { stopPlayback(); render(store.get()); },
    m.length * (60 / store.get().bpm / PPQ) * 1000 + 250);
}

// ─── stage: bed ──────────────────────────────────────────────────────────────
function renderBedStage(s: AppState, root: HTMLElement): void {
  const gen = h('button', { cls: 'primary', text: s.candidates.length ? 'Generate again' : 'Generate 6 beds' });
  gen.disabled = !s.harmony;
  gen.addEventListener('click', () => { stopPlayback(); store.generateBeds(6); });

  root.append(
    h('div', { cls: 'panel-head' },
      h('div', {}, h('span', { cls: 'section-no', text: '02' }), h('h2', { text: `Bed — ${barsOf(s)} bars` })),
      gen),
    h('p', { cls: 'hint', text: 'The same hook in all six — the melody seed is held constant. You are choosing the progression under it and the voices around it, not a different tune.' }),
  );

  const grid = h('div', { cls: 'grid' });
  root.append(grid);
  if (!s.candidates.length) {
    grid.className = 'empty-note';
    grid.textContent = 'Generate a set of arrangements over the committed hook.';
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
        h('small', { text: `${palette.label} · ${prog ? prog.brightness : 'custom'}` }),
        h('small', { text: prog ? prog.blurb : palette.blurb }),
      );
      grid.append(card);
      requestAnimationFrame(() => drawRoll(mini, linesOf(cand.arr), cand.arr.length, s.meter));
    });
  }
  root.append(mainPlayer(s));
}

// ─── stages: mood / form / vary (partly built) ───────────────────────────────
function renderMoodStage(s: AppState, root: HTMLElement): void {
  root.append(
    h('div', { cls: 'panel-head' }, h('div', {}, h('span', { cls: 'section-no', text: '03' }), h('h2', { text: 'Mood' }))),
    h('p', { cls: 'hint', text: 'Tempo and level today. The 2-D urgency × fortune pad, per-voice rerolls and swing arrive with the adaptive work.' }),
  );

  const bpm = h('input', { attrs: { type: 'range', min: '90', max: '200', step: '1', value: String(s.bpm) } });
  const bpmVal = h('span', { cls: 'val', text: String(s.bpm) });
  bpm.addEventListener('input', () => { bpmVal.textContent = bpm.value; setBpm(Number(bpm.value)); });

  const vol = h('input', { attrs: { type: 'range', min: '0', max: '100', value: '85' } });
  vol.addEventListener('input', () => audio?.transport.setVolume(Number(vol.value) / 100));

  root.append(h('div', { cls: 'knobs' },
    h('label', { text: 'Tempo' }, bpm, bpmVal),
    h('label', { text: 'Level' }, vol, h('span', { cls: 'val', text: '' }))));

  const presets = h('div', { cls: 'tempo-presets' });
  for (const [name, value] of [['Marcia', 140], ['Drive', 155], ['Battle', 168], ['Frantic', 185]] as const) {
    const b = h('button', { cls: value === s.bpm ? 'active' : '', html: `${name} <span>${value}</span>` });
    b.addEventListener('click', () => setBpm(value));
    presets.append(b);
  }
  root.append(presets);

  root.append(h('p', { cls: 'notice', text: 'Not yet built: the mood pad deforms the arrangement live and per-voice rerolls change one track while the rest stay byte-identical. The engine already supports the latter — it is the UI that is missing.' }));
  root.append(mainPlayer(s));
}

function renderFormStage(s: AppState, root: HTMLElement): void {
  const bars = barsOf(s);
  root.append(
    h('div', { cls: 'panel-head' }, h('div', {}, h('span', { cls: 'section-no', text: '04' }), h('h2', { text: 'Form' }))),
    h('p', { cls: 'hint', text: `Currently ${bars} bars. Doubling is the only growth available until the section planner lands; that is what turns this into a 30–90 second track with a seamless loop.` }),
  );

  const row = h('div', { cls: 'controls' });
  for (const target of [8, 16] as const) {
    const b = h('button', { cls: 'ghost', text: `Extend to ${target} bars` });
    b.disabled = !s.candidates[s.selected] || bars >= target;
    b.addEventListener('click', () => { stopPlayback(); store.extendSelectedArrangement(target); });
    row.append(b);
  }
  root.append(row);
  root.append(h('p', { cls: 'notice', text: 'Not yet built: pick 30s / 60s / 90s and choose between section plans (intro · A · A′ · B · A″ · tag), with the tag cadencing back into bar 1 so the in-game loop is seamless.' }));
  root.append(mainPlayer(s));
}

function renderVaryStage(s: AppState, root: HTMLElement): void {
  root.append(
    h('div', { cls: 'panel-head' }, h('div', {}, h('span', { cls: 'section-no', text: '05' }), h('h2', { text: 'Variation' }))),
    h('p', { cls: 'hint', text: 'How the hook differs each time it returns — the lever that decides whether a two-minute fight is bearable.' }),
  );
  if (s.hook) {
    root.append(h('div', { cls: 'layerrow' },
      h('span', { cls: 'sw' }), h('span', { cls: 'nm', text: `${RHYTHM_LABEL[s.hook.rhythm]} · ${SCHEME_LABEL[s.hook.scheme]} · ${distinctPitches(s.hook)} pitches` })));
  }
  root.append(h('p', { cls: 'notice', text: 'Not yet built: per-recurrence operator chains, so A′ comes back thinned, A″ an octave up on brass, and a sub-melody fills B. The seven operators this needs already exist in core.' }));
  root.append(mainPlayer(s));
}

/** The shared "listen to the selected arrangement" block. */
function mainPlayer(s: AppState): HTMLElement {
  const wrap = h('div');
  wrap.style.marginTop = '16px';
  wrap.append(h('p', { cls: 'side-title', text: 'Selected arrangement' }));
  const c = h('canvas', { cls: 'roll roll-main', attrs: { id: 'mainRoll' } });
  wrap.append(c);

  const play = h('button', { cls: 'primary', text: 'Play', attrs: { id: 'play' } });
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
    root.append(h('p', { cls: 'empty-note', text: 'No history yet.' }));
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
    tray.textContent = 'Pin takes with ☆ to keep them. Pins survive every later branch.';
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
  s.harmony.events.forEach((ev, i) => {
    const b = h('button', { cls: 'chord', text: chordLabel(ev.chord), attrs: { title: 'Click to change · Shift-click for previous' } });
    b.addEventListener('click', (e) => store.cycleChord(i, e.shiftKey ? -1 : 1));
    strip.append(b);
  });
}

// ─── render ──────────────────────────────────────────────────────────────────
function render(s: AppState): void {
  if (playbackTarget === 'source' && sourcePlaybackMotif !== s.source) stopPlayback();
  renderLegend();
  renderRail(s);

  const root = el('stage');
  root.replaceChildren();
  if (s.stage === 'hook') renderHookStage(s, root);
  else if (s.stage === 'bed') renderBedStage(s, root);
  else if (s.stage === 'mood') renderMoodStage(s, root);
  else if (s.stage === 'form') renderFormStage(s, root);
  else renderVaryStage(s, root);

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

function selectCandidate(i: number): void {
  store.select(i);
  if (audio?.transport.playing) {
    const arr = store.current();
    // Bar-aligned, not immediate: when judging two takes against each other, a chopped
    // note tail is the loudest thing in the comparison.
    if (arr && playbackTarget === 'arrangement') audio.transport.swapAtBoundary(arr, store.get().bpm, store.get().meter);
  }
}

function updateSourceTransport(_position: number, _duration: number): void { /* reserved for the scrub row */ }

function stopPlayback(): void {
  if (previewTimer !== null) clearTimeout(previewTimer);
  previewTimer = null;
  audio?.transport.stop();
  previewDraft = -1;
  playbackTarget = null;
  sourcePlaybackMotif = null;
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
temp.addEventListener('input', () => {
  const t = Number(temp.value) / 100;
  store.setTemperature(t);
  el('tempVal').textContent = t.toFixed(2);
});

el('export').addEventListener('click', () => {
  const arr = store.current();
  if (!arr) { store.setStatus('Nothing to export yet — generate a bed first.'); return; }
  const bytes = toSMF(arr, store.get().bpm, store.get().meter);
  const blob = new Blob([new Uint8Array(bytes)], { type: 'audio/midi' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'battle-theme.mid';
  a.click();
  URL.revokeObjectURL(url);
});

window.addEventListener('resize', () => { drawMain(); drawSource(); });
store.subscribe(render);
