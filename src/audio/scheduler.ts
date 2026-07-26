import type { Arrangement, Meter, Role } from '../core/index.js';
import { MASTER_CEILING, ROLE_ORDER, barTicks, secPerTick } from '../core/index.js';
import type { FlatEvent } from '../render/index.js';
import { flatten, scheduleVoice } from '../render/index.js';

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

/**
 * The timeline for the rest of this pass: the old material up to the boundary, the new
 * material from it. Pure, and the other half of what makes the swap seamless.
 *
 * The boundary sits BEYOND the lookahead window by construction, so the stretch between
 * the lookahead edge and the boundary — up to a full bar — has not been handed to the
 * audio clock yet. Replacing the array outright and seeking to the boundary drops that
 * stretch from both timelines at once: the old events are gone and the new ones are
 * skipped, so the track goes silent for the rest of the bar on every swap.
 *
 * Splicing also keeps the scheduler's cursor valid without touching it. Every event
 * already scheduled has `time` below the boundary, so it survives in the same position,
 * and an index counting consumed events still means what it meant.
 */
export function spliceAtBoundary(
  current: readonly FlatEvent[], next: readonly FlatEvent[], at: number,
): FlatEvent[] {
  return [...current.filter((e) => e.time < at), ...next.filter((e) => e.time >= at)];
}

export class Transport {
  private timer: ReturnType<typeof setInterval> | null = null;
  private events: FlatEvent[] = [];
  private idx = 0;
  /**
   * The arrangement that takes over at the next loop point. A swap always lands whole at
   * the wrap, even when it also spliced into the middle of the current pass — otherwise
   * the spliced timeline (old head, new tail) would repeat forever.
   */
  private atLoop: FlatEvent[] | null = null;
  private loopBase = 0;
  private playStart = 0;
  private loopLenSec = 0.001;
  private cursorSec = 0;
  private live: { start: number; node: AudioScheduledSourceNode }[] = [];
  private readonly lookahead = 0.1;
  private readonly intervalMs = 25;
  private readonly master: GainNode;
  private readonly layers = new Map<Role, GainNode>();
  loop = true;
  onTick: ((posSec: number, lenSec: number) => void) | null = null;

  constructor(private readonly ctx: AudioContext) {
    this.master = ctx.createGain();
    // Compressor to match munch's chain — the same mix through different gain staging
    // lands at a different level, and level differences read as tone differences.
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp);
    comp.connect(ctx.destination);
    this.setVolume(0.85);
    for (const role of ROLE_ORDER) {
      const g = ctx.createGain();
      g.connect(this.master);
      this.layers.set(role, g);
    }
  }

  /**
   * The vertical half of the adaptive mix, and the reason it lives here rather than
   * only in the game: without it the author hears every voice at full while the game
   * plays winds 16 dB down, and no amount of note-level checking catches that.
   */
  setLayerGains(gains: Record<Role, number>, glideSec = 0.08): void {
    for (const role of ROLE_ORDER) {
      const node = this.layers.get(role);
      if (node) node.gain.linearRampToValueAtTime(gains[role], this.ctx.currentTime + glideSec);
    }
  }

  load(arr: Arrangement, bpm: number): void {
    this.events = flatten(arr, bpm);
    this.atLoop = null;
    this.loopLenSec = Math.max(0.001, arr.length * secPerTick(bpm));
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

  stop(): void {
    this.halt();
    this.cursorSec = 0;
    this.idx = 0;
    this.loopBase = 0;
  }

  /**
   * Jump to a point in the loop.
   *
   * Deliberately abrupt — `halt()` cuts anything ringing, the way `swapTo` does. A seek
   * is the one gesture where the listener has *asked* for a discontinuity, so smoothing
   * it into the next bar line would feel like the scrub was ignored.
   */
  seek(sec: number): void {
    const target = Math.max(0, Math.min(sec, this.loopLenSec));
    if (!this.playing) {
      this.cursorSec = target;
      const next = this.events.findIndex((event) => event.time >= target);
      this.idx = next < 0 ? this.events.length : next;
      this.onTick?.(target, this.loopLenSec);
      return;
    }
    this.halt();
    this.cursorSec = target;
    this.loopBase = 0;
    this.play();
  }

  private halt(): void {
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
    this.atLoop = null;
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
   * Two halves make it seamless. The boundary sits strictly BEYOND the lookahead window,
   * so nothing past it has been scheduled and there is nothing to cancel — no `halt()`,
   * no chopped tails. And the timeline is SPLICED rather than replaced, so the bar
   * between the lookahead edge and the boundary still plays its old material instead of
   * falling silent.
   *
   * Only valid between arrangements on the same grid — a different length or tempo
   * moves the bar lines themselves, so those fall back to the immediate swap.
   *
   * @returns seconds into the loop where the change lands, or null if it fell back.
   */
  swapAtBoundary(arr: Arrangement, bpm: number, meter: Meter): number | null {
    if (!this.playing) { this.load(arr, bpm); return null; }
    const spt = secPerTick(bpm);
    const nextLen = Math.max(0.001, arr.length * spt);
    const barSec = barTicks(meter) * spt;
    if (!(barSec > 0) || Math.abs(nextLen - this.loopLenSec) > 1e-6) {
      this.swapTo(arr, bpm);
      return null;
    }

    const origin = this.playStart + this.loopBase; // absolute time of this pass's tick 0
    const swapRel = nextBoundary(this.ctx.currentTime - origin, this.lookahead, barSec);
    const next = flatten(arr, bpm);

    // From the NEXT pass on, the new arrangement plays whole. Both branches below only
    // decide what the remainder of the current pass sounds like.
    this.atLoop = next;

    if (swapRel >= this.loopLenSec) {
      // The boundary is past the end of this pass: the old material simply finishes and
      // the hand-off happens at the loop point, which the wrap in `schedule()` applies.
      return this.loopLenSec;
    }
    // `idx` is deliberately untouched — see `spliceAtBoundary`.
    this.events = spliceAtBoundary(this.events, next, swapRel);
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
        if (this.atLoop) { this.events = this.atLoop; this.atLoop = null; }
        this.idx = 0;
        this.loopBase += this.loopLenSec;
        continue;
      }
      const when = this.playStart + this.loopBase + ev.time;
      if (when >= ahead) break;
      const at = Math.max(when, this.ctx.currentTime);
      const dest = this.layers.get(ev.role) ?? this.master;
      for (const node of scheduleVoice(this.ctx, dest, ev.timbre, ev.pitch, ev.velocity, at, ev.durSec)) {
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
