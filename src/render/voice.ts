import type { DrumVoice, TimbreName } from '../core/index.js';
import { TIMBRES, drumVoice, velocityGain } from '../core/index.js';

/**
 * The WebAudio renderer for the timbre table in `core/timbre.ts` (spec §9.2).
 *
 * SHARED between song-creatr's transport and munch's battle music — this package is
 * vendored into the game alongside the engine. It held no tone decisions even before
 * that (every number comes from the table), but the node graph itself used to be
 * written out twice, and the copies drifted three ways: the noise buffer length, the
 * master gain, and whether per-role layer gains were applied at all. The claim that
 * "what you audition is what ships" only holds if one file makes the sound.
 *
 * It needs DOM lib for `AudioContext`, so it lives outside the DOM-free engine — but it
 * touches no `document` and no `window`, and stays headless-testable.
 */
export const midiToHz = (pitch: number): number => 440 * 2 ** ((pitch - 69) / 12);
const freq = midiToHz;

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
  } else if (t.filter.kind === 'lowpass-rel') {
    // Nyquist matters here in a way it does not for the fixed lowpass: the cutoff
    // tracks the pitch, so at the top of a wind section's range 4×f is past half the
    // sample rate and an unclamped value makes the filter misbehave rather than open.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.min(f * t.filter.mult, ctx.sampleRate * 0.45);
    lp.Q.value = t.filter.q;
    osc.connect(lp); lp.connect(env);
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
