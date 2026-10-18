import { getStroke, type StrokeOptions } from 'perfect-freehand';
import type { InkObj, Rect } from './types';
import { boundsOfPoints } from './geometry';

export type Outline = [number, number][];

/** Pen / highlighter nibs are tuned here so on-screen ink and exported PDF ink are identical. */
export function strokeOptions(o: Pick<InkObj, 'w' | 'hl' | 'sim'>): StrokeOptions {
  if (o.hl) {
    return {
      size: o.w,
      thinning: 0,
      smoothing: 0.6,
      streamline: 0.55,
      simulatePressure: false,
      start: { cap: true, taper: 0 },
      end: { cap: true, taper: 0 },
      last: true,
    };
  }
  const taper = Math.min(o.w * 2.2, 5);
  return {
    size: o.w,
    thinning: o.sim ? 0.45 : 0.62,
    smoothing: 0.55,
    streamline: o.sim ? 0.55 : 0.4,
    simulatePressure: !!o.sim,
    start: { cap: true, taper: 0 },
    end: { cap: true, taper },
    last: true,
  };
}

const outlineCache = new WeakMap<InkObj, Outline>();

export function inkOutline(o: InkObj): Outline {
  let out = outlineCache.get(o);
  if (out) return out;
  const pts: number[][] = [];
  for (let i = 0; i < o.p.length; i += 3) pts.push([o.p[i], o.p[i + 1], o.p[i + 2]]);
  out = getStroke(pts, strokeOptions(o)) as Outline;
  outlineCache.set(o, out);
  return out;
}

/** Smooth closed path through the outline polygon (quadratic curves between midpoints). */
export function outlinePath(outline: Outline, path = new Path2D()): Path2D {
  const n = outline.length;
  if (n < 3) return path;
  const [px, py] = outline[n - 1];
  const [cx, cy] = outline[0];
  path.moveTo((px + cx) / 2, (py + cy) / 2);
  for (let i = 0; i < n; i++) {
    const [qx, qy] = outline[i];
    const [nx, ny] = outline[(i + 1) % n];
    path.quadraticCurveTo(qx, qy, (qx + nx) / 2, (qy + ny) / 2);
  }
  path.closePath();
  return path;
}

const pathCache = new WeakMap<InkObj, Path2D>();

export function inkPath(o: InkObj): Path2D {
  let p = pathCache.get(o);
  if (!p) {
    p = outlinePath(inkOutline(o));
    pathCache.set(o, p);
  }
  return p;
}

const boundsCache = new WeakMap<InkObj, Rect>();

export function inkBounds(o: InkObj): Rect {
  let b = boundsCache.get(o);
  if (!b) {
    const r = boundsOfPoints(o.p, 3);
    const pad = o.w * 0.9 + 1;
    b = { x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad };
    boundsCache.set(o, b);
  }
  return b;
}

/**
 * Maps raw device pressure (0..1) through the user's sensitivity curve.
 * `sensitivity` 0.5 = linear, <0.5 firmer pen needed, >0.5 lighter touch is enough.
 */
export function pressureCurve(raw: number, sensitivity = 0.5): number {
  const p = Math.min(1, Math.max(0, raw));
  const gamma = Math.pow(2, (0.5 - sensitivity) * 2); // 0.5 → 1, 1 → 0.5, 0 → 2
  return Math.pow(p, gamma);
}

/** Drop samples that are closer than `minDist` to their predecessor (keeps the last). */
export function decimate(p: number[], minDist: number): number[] {
  if (p.length <= 6) return p;
  const out: number[] = [p[0], p[1], p[2]];
  const md2 = minDist * minDist;
  let lx = p[0];
  let ly = p[1];
  const n = p.length;
  for (let i = 3; i < n - 3; i += 3) {
    const dx = p[i] - lx;
    const dy = p[i + 1] - ly;
    if (dx * dx + dy * dy >= md2) {
      out.push(p[i], p[i + 1], p[i + 2]);
      lx = p[i];
      ly = p[i + 1];
    }
  }
  out.push(p[n - 3], p[n - 2], p[n - 1]);
  return out;
}

/** Round to keep documents small without visible change (0.01 pt). */
export function roundPts(p: number[]): number[] {
  const out = new Array<number>(p.length);
  for (let i = 0; i < p.length; i += 3) {
    out[i] = Math.round(p[i] * 100) / 100;
    out[i + 1] = Math.round(p[i + 1] * 100) / 100;
    out[i + 2] = Math.round(p[i + 2] * 100) / 100;
  }
  return out;
}
