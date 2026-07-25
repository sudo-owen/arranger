import type { Arrangement, Meter, Role } from '../core/index.js';
import { PPQ, TIMBRES, timbreNameFor } from '../core/index.js';

/**
 * Standard MIDI File writer (spec §7/§10 Export, milestone M7). One track per role,
 * drums on channel 10, correct tempo and track names — "opens in a DAW with correct
 * tempo and track names." The app hands off here; real libraries do the rest.
 *
 * The program number is not decoration: it is how munch recovers which timbre a track
 * should render through. It comes from the shared timbre table rather than a local
 * role->program map, so a chip lead exports as GM 80 (square lead) and reads back as
 * a square lead, instead of exporting as a flute and being guessed at.
 */

export function toSMF(arr: Arrangement, bpm: number, meter: Meter): Uint8Array {
  const out: number[] = [];
  const pushStr = (s: string): void => { for (const ch of s) out.push(ch.charCodeAt(0)); };
  const pushU16 = (v: number): void => { out.push((v >> 8) & 0xff, v & 0xff); };
  const pushU32 = (v: number): void => { out.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff); };

  pushStr('MThd'); pushU32(6); pushU16(1); pushU16(1 + arr.tracks.length); pushU16(PPQ);

  writeChunk(out, metaTrack(bpm, meter));
  for (let i = 0; i < arr.tracks.length; i++) {
    const tr = arr.tracks[i]!;
    const channel = tr.role === 'drums' ? 9 : i % 16;
    const program = tr.instrument ? TIMBRES[timbreNameFor(tr.instrument)].gmProgram : 0;
    writeChunk(out, roleTrack(tr.role, channel, program, tr.motif.notes));
  }
  return Uint8Array.from(out);

  function writeChunk(dst: number[], body: number[]): void {
    pushStrTo(dst, 'MTrk');
    dst.push((body.length >>> 24) & 0xff, (body.length >>> 16) & 0xff, (body.length >>> 8) & 0xff, body.length & 0xff);
    for (const b of body) dst.push(b);
  }
}

function pushStrTo(dst: number[], s: string): void { for (const ch of s) dst.push(ch.charCodeAt(0)); }

function varLen(v: number): number[] {
  const bytes = [v & 0x7f];
  let n = v >> 7;
  while (n > 0) { bytes.unshift((n & 0x7f) | 0x80); n >>= 7; }
  return bytes;
}

function metaTrack(bpm: number, meter: Meter): number[] {
  const body: number[] = [];
  const micros = Math.round(60000000 / bpm);
  body.push(0x00, 0xff, 0x51, 0x03, (micros >> 16) & 0xff, (micros >> 8) & 0xff, micros & 0xff);
  const dd = Math.round(Math.log2(meter.den));
  body.push(0x00, 0xff, 0x58, 0x04, meter.num, dd, 24, 8);
  pushName(body, 'arrangement');
  body.push(0x00, 0xff, 0x2f, 0x00);
  return body;
}

interface Ev { tick: number; data: number[] }

function roleTrack(role: Role, channel: number, program: number, notes: readonly { start: number; duration: number; pitch: number; velocity: number }[]): number[] {
  const evs: Ev[] = [];
  if (role !== 'drums') evs.push({ tick: 0, data: [0xc0 | channel, program & 0x7f] });
  for (const n of notes) {
    evs.push({ tick: n.start, data: [0x90 | channel, n.pitch & 0x7f, Math.max(1, Math.min(127, n.velocity)) ] });
    evs.push({ tick: n.start + n.duration, data: [0x80 | channel, n.pitch & 0x7f, 0x40] });
  }
  evs.sort((a, b) => a.tick - b.tick || (b.data[0]! & 0xf0) - (a.data[0]! & 0xf0)); // note-offs before note-ons at a tick

  const body: number[] = [];
  pushName(body, role);
  let prev = 0;
  for (const ev of evs) {
    for (const d of varLen(ev.tick - prev)) body.push(d);
    for (const d of ev.data) body.push(d);
    prev = ev.tick;
  }
  body.push(0x00, 0xff, 0x2f, 0x00);
  return body;
}

function pushName(body: number[], name: string): void {
  body.push(0x00, 0xff, 0x03, name.length);
  for (const ch of name) body.push(ch.charCodeAt(0));
}
