import { describe, expect, it } from 'vitest';
import { smoothRadius, smoothStroke } from '../src/core/smooth';
import { inkOutline, resmooth, strokePoints } from '../src/core/ink';
import { pointInPolygon } from '../src/core/geometry';
import { decodeNotes, encodeNotes } from '../src/core/serialize';
import type { InkObj } from '../src/core/types';

function noise(seed: number) {
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  return () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
}

/** Samples every `step` px along a polyline, with Gaussian jitter of `sd` px. */
function pen(vertices: [number, number][], sd: number, step = 0.8, seed = 3): number[] {
  const g = noise(seed);
  const out: number[] = [];
  for (let i = 0; i + 1 < vertices.length; i++) {
    const [ax, ay] = vertices[i];
    const [bx, by] = vertices[i + 1];
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / step));
    for (let j = 0; j < n; j++) out.push(ax + ((bx - ax) * j) / n + g() * sd, ay + ((by - ay) * j) / n + g() * sd, 0.5);
  }
  const [lx, ly] = vertices[vertices.length - 1];
  out.push(lx, ly, 0.5);
  return out;
}

function circle(r: number, sd: number): number[] {
  const g = noise(9);
  const out: number[] = [];
  for (let a = 0; a <= Math.PI * 2; a += 0.8 / r) out.push(r * Math.cos(a) + g() * sd, r * Math.sin(a) + g() * sd, 0.5);
  return out;
}

const ys = (p: number[]) => p.filter((_, i) => i % 3 === 1);
const rms = (v: number[]) => Math.sqrt(v.reduce((a, b) => a + b * b, 0) / v.length);
const opts = (strength: number, corners = true, unit = 1) => ({ strength, corners, unit });

describe('stroke smoothing', () => {
  it('leaves the samples alone when switched off', () => {
    const p = pen([[0, 0], [80, 0]], 0.4);
    expect(smoothStroke(p, opts(0))).toEqual(p);
  });

  it('removes pen jitter, more with more strength', () => {
    const p = pen([[0, 0], [120, 0]], 0.4);
    const raw = rms(ys(p));
    const mid = rms(ys(smoothStroke(p, opts(0.5))));
    const strong = rms(ys(smoothStroke(p, opts(1))));
    expect(mid).toBeLessThan(raw * 0.6);
    expect(strong).toBeLessThan(mid);
  });

  it('does not lag: the line starts and ends where the pen touched down and lifted off', () => {
    const p = pen([[0, 0], [40, 10], [60, 40]], 0);
    for (const s of [0.5, 1]) {
      const q = smoothStroke(p, opts(s));
      expect(Math.hypot(q[0], q[1])).toBeLessThan(0.05);
      expect(Math.hypot(q[q.length - 3] - 60, q[q.length - 2] - 40)).toBeLessThan(0.05);
    }
  });

  it('keeps circles and small loops at their size', () => {
    for (const r of [4, 8]) {
      const q = smoothStroke(circle(r, 0.3), opts(1, false));
      const radii: number[] = [];
      for (let i = 0; i < q.length; i += 3) radii.push(Math.hypot(q[i], q[i + 1]));
      const mean = radii.reduce((a, b) => a + b, 0) / radii.length;
      expect(Math.abs(mean - r) / r).toBeLessThan(0.05);
    }
  });

  it('keeps sharp corners sharp, unless asked not to', () => {
    const zig = pen([[0, 0], [14, -16], [28, 0], [42, -16], [56, 0]], 0);
    const near = (q: number[], x: number, y: number) => {
      let m = Infinity;
      for (let i = 0; i < q.length; i += 3) m = Math.min(m, Math.hypot(q[i] - x, q[i + 1] - y));
      return m;
    };
    expect(near(smoothStroke(zig, opts(1)), 28, 0)).toBeLessThan(0.3);
    expect(near(smoothStroke(zig, opts(1, false)), 28, 0)).toBeGreaterThan(1);
  });

  it('works in screen pixels, so the result looks the same at every zoom', () => {
    const p = pen([[0, 0], [30, 20], [70, 0]], 0.4);
    const half = p.map((v, i) => (i % 3 === 2 ? v : v / 2));
    const a = smoothStroke(p, opts(0.7, true, 1));
    const b = smoothStroke(half, opts(0.7, true, 0.5));
    expect(b.length).toBe(a.length);
    for (let i = 0; i < a.length; i += 3) expect(Math.abs(b[i] * 2 - a[i])).toBeLessThan(1e-6);
  });

  it('only the last few pixels change while the pen is still moving', () => {
    const full = pen([[0, 0], [30, -12], [50, 6], [90, -4], [120, 10]], 0.35);
    const part = full.slice(0, 3 * 120);
    const sigma = smoothRadius(0.6);
    const a = smoothStroke(full, opts(0.6));
    const b = smoothStroke(part, opts(0.6));
    let first = 0;
    while (first < b.length / 3 && a[first * 3] === b[first * 3] && a[first * 3 + 1] === b[first * 3 + 1]) first++;
    let tail = 0;
    for (let k = first + 1; k < b.length / 3; k++) tail += Math.hypot(b[k * 3] - b[k * 3 - 3], b[k * 3 + 1] - b[k * 3 - 2]);
    expect(first).toBeGreaterThan(40);
    expect(tail).toBeLessThan(6.5 * sigma);
  });
});

describe('smoothed strokes', () => {
  it('draw the final millimetre: a hook at the end is not cut short', () => {
    const p = [...pen([[0, 0], [20, 0], [20, 2]], 0, 0.25)];
    const o: InkObj = { id: 'h', t: 'ink', c: '#000', w: 1, p, v: 2 };
    const poly = inkOutline(o).flat();
    expect(pointInPolygon(20, 0, poly)).toBe(true);
    expect(pointInPolygon(20, 1.5, poly)).toBe(true);
  });

  it('are stored rounded and thinned out, and keep their marker through a save', () => {
    const p = strokePoints(pen([[0, 0], [50, 10]], 0.3, 0.2), opts(0.5, true, 0.5));
    expect(p.length).toBeLessThan(pen([[0, 0], [50, 10]], 0.3, 0.2).length);
    for (const v of p) expect(Math.round(v * 100) / 100).toBeCloseTo(v, 10);
    const o: InkObj = { id: 's', t: 'ink', c: '#000000', w: 2, p, v: 2 };
    const back = decodeNotes(encodeNotes([[o]], [{ w: 595, h: 842 }]))!;
    expect((back.pages['0'].objs[0] as InkObj).v).toBe(2);
  });

  it('"Smooth strokes" turns an older stroke into a smoothed one', () => {
    const old: InkObj = { id: 'o', t: 'ink', c: '#000000', w: 2, p: pen([[0, 0], [60, 0]], 0.4), sm: 0.3 };
    const once = resmooth(old, opts(0.5));
    expect(once.v).toBe(2);
    expect(once.sm).toBeUndefined();
    expect(rms(ys(once.p))).toBeLessThan(rms(ys(old.p)) * 0.6);
    // pressing it again smooths further
    expect(rms(ys(resmooth(once, opts(0.5)).p))).toBeLessThan(rms(ys(once.p)));
  });
});
