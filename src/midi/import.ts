import type { Meter, Motif, Note } from '../core/index.js';
import { PPQ, barTicks, midi, motif, tick } from '../core/index.js';

export interface ParsedMidi {
  motif: Motif;
  bpm: number;
  meter: Meter;
}

/**
 * Minimal Standard MIDI File reader (spec §10 Import). Merges all tracks into one
 * melody line and rescales to the engine's PPQ. Handles running status, tempo and
 * time-signature meta events; ignores the rest. Enough to get a tune in — but not enough
 * to get an ARRANGEMENT in: the merge is what makes per-track instrumentation
 * unrecoverable, whatever the program-change bytes said.
 */
export function parseMidi(buffer: ArrayBuffer): ParsedMidi {
  const dv = new DataView(buffer);
  let p = 0;
  const u8 = (): number => dv.getUint8(p++);
  const peek = (): number => dv.getUint8(p);
  const u16 = (): number => { const v = dv.getUint16(p); p += 2; return v; };
  const u32 = (): number => { const v = dv.getUint32(p); p += 4; return v; };
  const tag = (): string => String.fromCharCode(u8(), u8(), u8(), u8());
  const varLen = (): number => {
    let v = 0;
    for (;;) { const b = u8(); v = (v << 7) | (b & 0x7f); if ((b & 0x80) === 0) break; }
    return v;
  };

  if (tag() !== 'MThd') throw new Error('Not a MIDI file (missing MThd header).');
  u32();
  u16(); // format
  const ntrks = u16();
  const rawDivision = u16();
  const ppqIn = (rawDivision & 0x8000) !== 0 ? 480 : rawDivision || 480;
  const scale = PPQ / ppqIn;

  let bpm = 120;
  let meter: Meter = { num: 4, den: 4 };
  const notes: Note[] = [];

  for (let t = 0; t < ntrks; t++) {
    if (p + 8 > dv.byteLength || tag() !== 'MTrk') break;
    const end = Math.min(dv.byteLength, p + 4 + 0) + u32(); // read length, then bound
    let pos = 0;
    let running = 0;
    const active = new Map<number, { start: number; velocity: number }>();

    const close = (pitch: number, at: number): void => {
      const on = active.get(pitch);
      if (!on) return;
      active.delete(pitch);
      notes.push({
        start: tick(Math.round(on.start * scale)),
        duration: tick(Math.max(1, Math.round((at - on.start) * scale))),
        pitch: midi(pitch),
        velocity: on.velocity,
      });
    };

    while (p < end) {
      pos += varLen();
      let status = peek();
      if ((status & 0x80) !== 0) { p++; running = status; } else { status = running; }
      const type = status & 0xf0;

      if (status === 0xff) {
        const metaType = u8();
        const mlen = varLen();
        const dataStart = p;
        if (metaType === 0x51 && mlen === 3) { const micros = (u8() << 16) | (u8() << 8) | u8(); bpm = Math.round(60000000 / micros); }
        else if (metaType === 0x58 && mlen >= 2) { const nn = u8(); const dd = u8(); meter = { num: nn || 4, den: 2 ** dd || 4 }; }
        p = dataStart + mlen;
      } else if (status === 0xf0 || status === 0xf7) {
        const slen = varLen(); p += slen;
      } else if (type === 0x90) {
        const pitch = u8(); const vel = u8();
        if (vel > 0) active.set(pitch, { start: pos, velocity: vel }); else close(pitch, pos);
      } else if (type === 0x80) {
        const pitch = u8(); u8(); close(pitch, pos);
      } else if (type === 0xc0 || type === 0xd0) {
        // Program change, discarded. `timbreForProgram` is the read side of what
        // `export.ts` stamps, and wants this plus per-track notes rather than the merge.
        u8();
      }
      else { u8(); u8(); }
    }
    p = end;
  }

  notes.sort((a, b) => a.start - b.start);
  const lastEnd = notes.reduce((m, n) => Math.max(m, n.start + n.duration), 0);
  const bar = barTicks(meter);
  const length = tick(Math.max(bar, Math.ceil(lastEnd / bar) * bar));
  return { motif: motif(notes, length), bpm, meter };
}
