import type { Arrangement, Meter, TimbreName } from '../core/index.js';
import { MASTER_CEILING, PPQ, barTicks, timbreNameFor } from '../core/index.js';
import { scheduleVoice } from './synth.js';

/**
 * The transport (spec §9.1). Two clocks: a coarse setInterval wakes every ~25ms and
 * schedules every note falling inside a ~100ms lookahead window against the sample-
 * accurate AudioContext clock. setTimeout is never on the audio path. Supports looping
 * and two kinds of hot-swap (spec §9.3):
 *
 * - `swapTo` — immediate. Cuts every ringing voice dead. Right for A/B-ing where you
 *   want to hear the new candidate NOW and an abrupt edge is honest feedback.
 * - `swapAtBoundary` — musical. Leaves scheduled voices to ring out and changes
 *   material at the next bar line. Right for anything the listener shouldn't notice
 *   as an edit, which is every in-game mood transition.
 */
interface FlatEvent {
  time: number; // seconds from loop start
  timbre: TimbreName | null; // null = percussion
  pitch: number;
  velocity: number;
  durSec: number;
}

function flatten(arr: Arrangement, bpm: number): FlatEvent[] {
  const spt = 60 / bpm / PPQ;
  const evs: FlatEvent[] = [];
  for (const tr of arr.tracks) {
    const timbre = tr.instrument ? timbreNameFor(tr.instrument) : null;
    for (const n of tr.motif.notes) {
      evs.push({ time: n.start * spt, timbre, pitch: n.pitch, velocity: n.velocity, durSec: Math.max(0.03, n.duration * spt) });
    }
  }
  return evs.sort((a, b) => a.time - b.time);
}

/**
 * The first bar line strictly beyond the lookahead window, measured from the current
 * pass origin. This is the whole trick behind a seamless swap: because nothing past
 * this point has been handed to the audio clock yet, there is nothing to cancel, so
 * ringing voices are never touched. Pure arithmetic, exported to be testable.
 */
export function nextBoundary(relNow: number, lookahead: number, barSec: number, guardSec = 0.02): number {
  if (!(barSec > 0)) return 0;
  return Math.max(0, Math.ceil((relNow + lookahead + guardSec) / barSec) * barSec);
}

export class Transport {
  private timer: ReturnType<typeof setInterval> | null = null;
  private events: FlatEvent[] = [];
  private idx = 0;
  private loopBase = 0;
  private playStart = 0;
  private loopLenSec = 0.001;
  private cursorSec = 0;
  private live: { start: number; node: AudioScheduledSourceNode }[] = [];
  private readonly lookahead = 0.1;
  private readonly intervalMs = 25;
  private readonly master: GainNode;
  loop = true;
  onTick: ((posSec: number, lenSec: number) => void) | null = null;

  constructor(private readonly ctx: AudioContext) {
    this.master = ctx.createGain();
    this.master.gain.value = MASTER_CEILING * 0.85;
    // Compressor to match munch's chain — the same mix through different gain staging
    // lands at a different level, and level differences read as tone differences.
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp);
    comp.connect(ctx.destination);
  }

  load(arr: Arrangement, bpm: number): void {
    this.events = flatten(arr, bpm);
    this.loopLenSec = Math.max(0.001, arr.length * (60 / bpm / PPQ));
    this.cursorSec = 0;
    this.idx = 0;
  }

  setVolume(v: number): void { this.master.gain.value = Math.max(0, Math.min(1, v)) * MASTER_CEILING; }
  get playing(): boolean { return this.timer !== null; }
  get positionSec(): number {
    if (!this.playing) return this.cursorSec;
    if (this.ctx.currentTime < this.playStart + this.loopBase) return this.cursorSec;
    const rel = this.ctx.currentTime - this.playStart - this.loopBase;
    return ((rel % this.loopLenSec) + this.loopLenSec) % this.loopLenSec;
  }

  play(): void {
    if (this.playing) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.playStart = this.ctx.currentTime + 0.06 - this.cursorSec;
    this.loopBase = 0;
    const next = this.events.findIndex((event) => event.time >= this.cursorSec);
    this.idx = next < 0 ? this.events.length : next;
    this.timer = setInterval(() => this.schedule(), this.intervalMs);
  }

  pause(): void {
    if (!this.playing) return;
    this.cursorSec = this.positionSec;
    this.halt();
  }

  seek(positionSec: number): void {
    const wasPlaying = this.playing;
    if (wasPlaying) this.halt();
    this.cursorSec = Math.max(0, Math.min(this.loopLenSec, positionSec));
    const next = this.events.findIndex((event) => event.time >= this.cursorSec);
    this.idx = next < 0 ? this.events.length : next;
    if (wasPlaying) this.play();
  }

  stop(): void {
    this.halt();
    this.cursorSec = 0;
    this.idx = 0;
    this.loopBase = 0;
  }

  private halt(): void {
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
    for (const v of this.live) { try { v.node.stop(); } catch { /* already stopped */ } }
    this.live = [];
  }

  /**
   * Replace the playing arrangement without dropping the beat (spec §9.3). Immediate:
   * `halt()` stops every live node, so anything ringing is cut off. Use for changes
   * that move the bar lines themselves — tempo, length — and need the transport
   * rebuilt. For anything on the same grid, prefer `swapAtBoundary`.
   */
  swapTo(arr: Arrangement, bpm: number): void {
    if (!this.playing) { this.load(arr, bpm); return; }
    const pos = this.positionSec;
    this.halt();
    this.load(arr, bpm);
    this.cursorSec = Math.min(pos, this.loopLenSec);
    this.play();
  }

  /**
   * Swap material at the next bar line, leaving already-scheduled voices to ring out.
   *
   * The trick that makes this seamless: pick a boundary strictly BEYOND the lookahead
   * window, so nothing past it has been scheduled yet and there is nothing to cancel.
   * Everything before the boundary was already queued and plays out naturally; the new
   * arrangement takes over from the boundary. No `halt()`, so no chopped tails.
   *
   * Only valid between arrangements on the same grid — a different length or tempo
   * moves the bar lines themselves, so those fall back to the immediate swap.
   *
   * @returns seconds into the loop where the change lands, or null if it fell back.
   */
  swapAtBoundary(arr: Arrangement, bpm: number, meter: Meter): number | null {
    if (!this.playing) { this.load(arr, bpm); return null; }
    const spt = 60 / bpm / PPQ;
    const nextLen = Math.max(0.001, arr.length * spt);
    const barSec = barTicks(meter) * spt;
    if (!(barSec > 0) || Math.abs(nextLen - this.loopLenSec) > 1e-6) {
      this.swapTo(arr, bpm);
      return null;
    }

    const origin = this.playStart + this.loopBase; // absolute time of this pass's tick 0
    const swapRel = nextBoundary(this.ctx.currentTime - origin, this.lookahead, barSec);

    this.events = flatten(arr, bpm);
    if (swapRel >= this.loopLenSec) {
      // The boundary is past the end of this pass. Let the old material finish and
      // start the new arrangement at the loop point — the scheduler's own wrap
      // (idx exhausted -> idx = 0, loopBase += loopLenSec) lands it exactly there.
      this.idx = this.events.length;
      return this.loopLenSec;
    }
    const next = this.events.findIndex((event) => event.time >= swapRel);
    this.idx = next < 0 ? this.events.length : next;
    return swapRel;
  }

  private schedule(): void {
    if (this.events.length === 0) return;
    const ahead = this.ctx.currentTime + this.lookahead;
    let guard = 0;
    while (guard++ < 100000) {
      const ev = this.events[this.idx];
      if (!ev) {
        if (!this.loop) {
          const end = this.playStart + this.loopBase + this.loopLenSec;
          if (this.ctx.currentTime < end) break;
          this.finish();
          this.onTick?.(0, this.loopLenSec);
          return;
        }
        this.idx = 0;
        this.loopBase += this.loopLenSec;
        continue;
      }
      const when = this.playStart + this.loopBase + ev.time;
      if (when >= ahead) break;
      const at = Math.max(when, this.ctx.currentTime);
      for (const node of scheduleVoice(this.ctx, this.master, ev.timbre, ev.pitch, ev.velocity, at, ev.durSec)) {
        this.live.push({ start: at, node });
      }
      this.idx++;
    }
    const now = this.ctx.currentTime;
    this.live = this.live.filter((v) => v.start + 3 > now);
    this.onTick?.(this.positionSec, this.loopLenSec);
  }

  private finish(): void {
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
    // Scheduled sources finish their envelopes naturally; only release our references.
    this.live = [];
    this.cursorSec = 0;
    this.idx = 0;
    this.loopBase = 0;
  }
}
