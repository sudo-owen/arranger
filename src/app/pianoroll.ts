import type { Arrangement, Meter, Motif, Role } from '../core/index.js';
import { barTicks } from '../core/index.js';

export const ROLE_COLORS: Readonly<Record<Role, string>> = {
  melody: '#d4a452',
  bass: '#7588c5',
  drums: '#9a9a91',
  winds: '#68a698',
  brass: '#c86f5b',
};

interface RollNote { start: number; duration: number; pitch: number; velocity: number }
export interface Line { notes: readonly RollNote[]; color: string }

export const linesOf = (arr: Arrangement): Line[] =>
  arr.tracks.map((t) => ({ notes: t.motif.notes, color: ROLE_COLORS[t.role] }));
export const lineOf = (m: Motif, color: string): Line[] => [{ notes: m.notes, color }];

export function drawRoll(canvas: HTMLCanvasElement, lines: Line[], length: number, meter: Meter, playPos?: number, lenSec?: number): void {
  const g = canvas.getContext('2d');
  if (!g) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 300;
  const h = canvas.clientHeight || 120;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#0d0d0c';
  g.fillRect(0, 0, w, h);

  let lo = 127;
  let hi = 0;
  let any = false;
  for (const l of lines) for (const n of l.notes) { lo = Math.min(lo, n.pitch); hi = Math.max(hi, n.pitch); any = true; }
  if (!any) { lo = 48; hi = 84; }
  lo -= 2; hi += 2;
  const span = Math.max(1, hi - lo);
  const pad = 6;
  const yOf = (p: number): number => pad + (h - 2 * pad) * (1 - (p - lo) / span);
  const xOf = (t: number): number => (t / Math.max(1, length)) * w;
  const noteH = Math.max(2, ((h - 2 * pad) / span) * 0.9);

  const bar = barTicks(meter);
  g.strokeStyle = 'rgba(238,234,225,0.07)';
  g.lineWidth = 1;
  for (let t = 0; t <= length; t += bar) {
    const x = Math.round(xOf(t)) + 0.5;
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
  }

  for (const l of lines) {
    g.fillStyle = l.color;
    for (const n of l.notes) {
      const x = xOf(n.start);
      const wid = Math.max(2, xOf(n.start + n.duration) - x - 1);
      const y = yOf(n.pitch) - noteH / 2;
      g.globalAlpha = 0.32 + 0.55 * (n.velocity / 127);
      roundRect(g, x + 0.5, y, wid, noteH, Math.min(3, noteH / 2));
      g.fill();
    }
  }
  g.globalAlpha = 1;

  if (playPos !== undefined && lenSec && lenSec > 0) {
    const x = (playPos / lenSec) * w;
    g.strokeStyle = 'rgba(200,179,109,0.9)';
    g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
  }
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}
