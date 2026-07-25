import type { DrumVoice, TimbreName } from '../core/index.js';
import { MASTER_CEILING, TIMBRES, drumVoice, velocityGain } from '../core/index.js';

/**
 * A native-WebAudio renderer for the timbre table in `core/timbre.ts` (spec §9.2).
 *
 * This file holds NO tone decisions — every number comes from the shared table, so
 * munch's `BattleMusicService` renders the same arrangement the same way. What you
 * audition here is what ships. Previously the two diverged completely: a sine lead and
 * sawtooth winds here, all square waves there.
 */
const freq = (pitch: number): number => 440 * 2 ** ((pitch - 69) / 12);

const noiseCache = new WeakMap<AudioContext, AudioBuffer>();
function noise(ctx: AudioContext): AudioBuffer {
  const hit = noiseCache.get(ctx);
  if (hit) return hit;
  const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  noiseCache.set(ctx, buf);
  return buf;
}

export { MASTER_CEILING };

/** Schedule one note; returns the source nodes so the transport can cancel them on a hot-swap. */
export function scheduleVoice(
  ctx: AudioContext, dest: AudioNode, timbre: TimbreName | null,
  pitch: number, velocity: number, when: number, durSec: number,
): AudioScheduledSourceNode[] {
  if (timbre === null) return drum(ctx, dest, drumVoice(pitch), velocityGain(velocity), when);

  const t = TIMBRES[timbre];
  const f = freq(pitch);
  const env = ctx.createGain();
  env.connect(dest);

  const osc = ctx.createOscillator();
  osc.type = t.wave;
  osc.frequency.setValueAtTime(f, when);
  const extra: AudioScheduledSourceNode[] = [];

  // ── filter ──
  const end = when + durSec;
  if (t.filter.kind === 'none') {
    osc.connect(env);
  } else if (t.filter.kind === 'lowpass') {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = t.filter.hz;
    osc.connect(lp); lp.connect(env);
  } else if (t.filter.kind === 'bandpass-rel') {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f * t.filter.mult;
    bp.Q.value = t.filter.q;
    osc.connect(bp); bp.connect(env);
  } else {
    const { openMult, peakMult, settleMult, openSec } = t.filter;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(f * openMult, when);
    const openAt = Math.min(when + openSec, end);
    lp.frequency.linearRampToValueAtTime(f * peakMult, openAt);
    // exponentialRamp needs a strictly later target and a positive value
    lp.frequency.exponentialRampToValueAtTime(Math.max(200, f * settleMult), Math.max(openAt + 0.001, end));
    osc.connect(lp); lp.connect(env);
  }

  // ── vibrato ──
  if (t.vibratoHz !== undefined && t.vibratoDepthHz !== undefined) {
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = t.vibratoHz;
    lfoGain.gain.value = t.vibratoDepthHz;
    lfo.connect(lfoGain); lfoGain.connect(osc.frequency);
    lfo.start(when); lfo.stop(end + 0.02);
    extra.push(lfo);
  }

  // ── envelope ──
  // The release lands INSIDE the notated duration, so a note ends when it says it
  // does. Releasing past the end (as this used to) smears every loop seam.
  const attack = Math.min(t.attackSec, durSec * 0.5);
  const peak = t.peak * velocityGain(velocity);
  const sustain = peak * t.sustain;
  const relStart = Math.max(when + attack, end - t.releaseSec);

  env.gain.setValueAtTime(0.0001, when);
  env.gain.linearRampToValueAtTime(peak, when + attack);
  if (t.sustain < 1) {
    env.gain.linearRampToValueAtTime(sustain, Math.min(relStart, when + attack + 0.06));
  }
  env.gain.setValueAtTime(sustain, relStart);
  env.gain.linearRampToValueAtTime(0.0001, end);

  osc.start(when);
  osc.stop(end + 0.02);
  return [osc, ...extra];
}

function drum(ctx: AudioContext, dest: AudioNode, v: DrumVoice, g: number, when: number): AudioScheduledSourceNode[] {
  const env = ctx.createGain();
  env.connect(dest);

  if (v.kind === 'kick') {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(v.fromHz, when);
    osc.frequency.exponentialRampToValueAtTime(v.toHz, when + v.sweepSec);
    osc.connect(env);
    env.gain.setValueAtTime(v.peak * g, when);
    env.gain.exponentialRampToValueAtTime(0.001, when + v.decaySec);
    osc.start(when); osc.stop(when + v.decaySec + 0.02);
    return [osc];
  }

  if (v.kind === 'snare') {
    const n = ctx.createBufferSource(); n.buffer = noise(ctx);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = v.highpassHz;
    n.connect(hp); hp.connect(env);
    const tone = ctx.createOscillator(); tone.type = 'triangle'; tone.frequency.value = v.toneHz; tone.connect(env);
    env.gain.setValueAtTime(v.peak * g, when);
    env.gain.exponentialRampToValueAtTime(0.001, when + v.decaySec);
    n.start(when); n.stop(when + v.decaySec + 0.02);
    tone.start(when); tone.stop(when + v.decaySec * 0.7);
    return [n, tone];
  }

  const n = ctx.createBufferSource(); n.buffer = noise(ctx);
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = v.highpassHz;
  n.connect(hp); hp.connect(env);
  env.gain.setValueAtTime(v.peak * g, when);
  env.gain.exponentialRampToValueAtTime(0.001, when + v.decaySec);
  n.start(when); n.stop(when + v.decaySec + 0.02);
  return [n];
}
