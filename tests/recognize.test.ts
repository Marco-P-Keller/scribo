import { describe, expect, it } from 'vitest';
import { recognizeShape } from '../src/core/recognize';

// deterministic noise
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

type P = { x: number; y: number };

function jitter(pts: P[], amp: number, seed: number): P[] {
  const r = rng(seed);
  // low-frequency wobble + high-frequency noise, like a hand
  const f1 = 0.5 + r() * 1.5;
  const ph = r() * 6.28;
  return pts.map((p, i) => ({
    x: p.x + (r() - 0.5) * amp + Math.sin(i * 0.15 * f1 + ph) * amp * 0.9,
    y: p.y + (r() - 0.5) * amp + Math.cos(i * 0.13 * f1 + ph) * amp * 0.9,
  }));
}

function circle(cx: number, cy: number, rx: number, ry: number, rot = 0, over = 0.12, n = 90, start = 0): P[] {
  const out: P[] = [];
  const total = Math.PI * 2 * (1 + over);
  for (let i = 0; i <= n; i++) {
    const a = start + (i / n) * total;
    const x = rx * Math.cos(a);
    const y = ry * Math.sin(a);
    out.push({ x: cx + x * Math.cos(rot) - y * Math.sin(rot), y: cy + x * Math.sin(rot) + y * Math.cos(rot) });
  }
  return out;
}

function polyline(corners: P[], step = 3, close = true, over = 0.04): P[] {
  const pts: P[] = [];
  const c = close ? corners.concat([corners[0], corners[1]]) : corners;
  let extra = over;
  for (let i = 0; i < c.length - 1; i++) {
    const a = c[i], b = c[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(2, Math.round(len / step));
    for (let k = 0; k < n; k++) pts.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
    if (close && i === c.length - 3) {
      // overshoot into the first side, then stop
      const t = Math.min(1, extra * 8);
      const nb = c[i + 2];
      pts.push({ x: b.x + (nb.x - b.x) * t * 0.5, y: b.y + (nb.y - b.y) * t * 0.5 });
      break;
    }
  }
  return pts;
}

function rect(x: number, y: number, w: number, h: number, rot = 0): P[] {
  const cs = [
    { x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h },
  ].map((p) => ({ x: x + p.x * Math.cos(rot) - p.y * Math.sin(rot), y: y + p.x * Math.sin(rot) + p.y * Math.cos(rot) }));
  return polyline(cs);
}

function line(x0: number, y0: number, x1: number, y1: number, curve = 0): P[] {
  const n = Math.round(Math.hypot(x1 - x0, y1 - y0) / 3);
  const nx = -(y1 - y0), ny = x1 - x0;
  const l = Math.hypot(nx, ny) || 1;
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const bow = Math.sin(t * Math.PI) * curve;
    return { x: x0 + (x1 - x0) * t + (nx / l) * bow, y: y0 + (y1 - y0) * t + (ny / l) * bow };
  });
}

describe('shape recognition – positives', () => {
  for (const mode of ['hold', 'auto'] as const) {
    describe(mode, () => {
      it('detects circles', () => {
        for (let seed = 1; seed <= 12; seed++) {
          const s = jitter(circle(200, 200, 60, 60, 0, 0.1, 90, seed), 1.2, seed);
          const r = recognizeShape(s, mode);
          expect(r?.kind, `circle seed ${seed}`).toBe('ellipse');
        }
      });

      it('detects ellipses (rotated and axis aligned)', () => {
        for (let seed = 1; seed <= 12; seed++) {
          const rot = (seed % 3) * 0.5;
          const s = jitter(circle(300, 200, 90, 45, rot, 0.08, 100, seed), 1.2, seed);
          const r = recognizeShape(s, mode);
          expect(r?.kind, `ellipse seed ${seed}`).toBe('ellipse');
        }
      });

      it('detects rectangles', () => {
        for (let seed = 1; seed <= 12; seed++) {
          const s = jitter(rect(100, 100, 160 + seed * 3, 90), 1.2, seed);
          const r = recognizeShape(s, mode);
          expect(r?.kind, `rect seed ${seed}`).toBe('rect');
        }
      });

      it('detects straight lines', () => {
        for (let seed = 1; seed <= 12; seed++) {
          const s = jitter(line(50, 80 + seed, 320, 90 + seed * 4), 0.8, seed);
          const r = recognizeShape(s, mode);
          expect(r?.kind, `line seed ${seed}`).toBe('line');
        }
      });

      it('detects triangles', () => {
        for (let seed = 1; seed <= 12; seed++) {
          const s = jitter(polyline([{ x: 150, y: 60 }, { x: 250, y: 220 }, { x: 40, y: 210 }]), 1.2, seed);
          const r = recognizeShape(s, mode);
          expect(r?.kind, `triangle seed ${seed}`).toBe('poly');
          expect(r!.p.length).toBe(6);
        }
      });
    });
  }

  it('snaps near-horizontal lines to horizontal', () => {
    const r = recognizeShape(line(50, 100, 300, 104), 'hold')!;
    expect(r.kind).toBe('line');
    expect(Math.abs(r.p[3] - r.p[1])).toBeLessThan(0.01);
  });

  it('makes a near circle a true circle', () => {
    const r = recognizeShape(jitter(circle(100, 100, 50, 46, 0, 0.1, 90, 3), 1, 3), 'hold')!;
    expect(r.kind).toBe('ellipse');
    const [, , ux, uy, vx, vy] = r.p;
    expect(Math.hypot(ux, uy)).toBeCloseTo(Math.hypot(vx, vy), 3);
  });
});

describe('shape recognition – must not trigger on handwriting-like strokes', () => {
  const wave = (amp: number, len: number) =>
    Array.from({ length: Math.round(len / 3) }, (_, i) => ({ x: i * 3, y: Math.sin(i * 0.25) * amp }));

  it('ignores tiny strokes in auto mode', () => {
    expect(recognizeShape(circle(10, 10, 6, 6, 0, 0.1, 40), 'auto')).toBeNull();
    expect(recognizeShape(line(0, 0, 20, 1), 'auto')).toBeNull();
  });

  it('ignores waves / zig-zags', () => {
    expect(recognizeShape(wave(20, 200), 'auto')).toBeNull();
    expect(recognizeShape(wave(20, 200), 'hold')).toBeNull();
    const zig: P[] = [];
    for (let i = 0; i < 8; i++) zig.push(...line(i * 30, i % 2 ? 0 : 60, (i + 1) * 30, i % 2 ? 60 : 0));
    expect(recognizeShape(zig, 'auto')).toBeNull();
  });

  it('ignores spirals and figure-eights', () => {
    const spiral = Array.from({ length: 160 }, (_, i) => {
      const a = i * 0.12;
      const r = 8 + i * 0.5;
      return { x: 200 + r * Math.cos(a), y: 200 + r * Math.sin(a) };
    });
    expect(recognizeShape(spiral, 'auto')?.kind).not.toBe('ellipse');
    const eight = Array.from({ length: 120 }, (_, i) => {
      const t = (i / 119) * Math.PI * 2;
      return { x: 100 + 60 * Math.sin(t), y: 100 + 80 * Math.sin(t) * Math.cos(t) };
    });
    expect(recognizeShape(eight, 'auto')).toBeNull();
  });

  it('ignores a curved arc (not a line)', () => {
    expect(recognizeShape(line(0, 0, 200, 0, 40), 'auto')).toBeNull();
  });

  it('ignores an open "C" / "U" shape', () => {
    const c = circle(100, 100, 50, 50, 0, -0.4, 60);
    expect(recognizeShape(c, 'auto')).toBeNull();
  });
});
