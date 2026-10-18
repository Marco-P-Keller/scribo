// Freehand shape recognition: line, ellipse/circle, rectangle, triangle, quadrilateral.
//
// Works on a single stroke in page space. Every candidate is fitted to the
// stroke and scored by its normalised mean deviation; the best candidate that
// passes the thresholds of the requested mode wins.
//   'hold' – the user deliberately holds the pen still: generous thresholds.
//   'auto' – evaluated on pen-up: strict thresholds and a minimum size so that
//            handwriting is never turned into shapes.

import { clamp, dist, distSegSq, polygonArea } from './geometry';

export interface Recognized {
  kind: 'line' | 'ellipse' | 'rect' | 'poly';
  /** same layout as ShapeObj.p for the given kind */
  p: number[];
  err: number;
}

type P = { x: number; y: number };

interface Mode {
  minDiag: number;
  line: number; // max deviation / length
  lineStraight: number; // path length / chord
  closeGap: number; // gap / path length
  ellipse: number;
  rect: number;
  poly: number;
}

const MODES: Record<'hold' | 'auto', Mode> = {
  hold: { minDiag: 10, line: 0.07, lineStraight: 1.35, closeGap: 0.32, ellipse: 0.2, rect: 0.13, poly: 0.11 },
  auto: { minDiag: 34, line: 0.022, lineStraight: 1.1, closeGap: 0.16, ellipse: 0.085, rect: 0.05, poly: 0.045 },
};

function pathLength(p: P[]): number {
  let l = 0;
  for (let i = 1; i < p.length; i++) l += dist(p[i - 1].x, p[i - 1].y, p[i].x, p[i].y);
  return l;
}

function resample(p: P[], n: number): P[] {
  const total = pathLength(p);
  if (total === 0) return p.slice(0, 1);
  const step = total / (n - 1);
  const out: P[] = [p[0]];
  let acc = 0;
  let prev = p[0];
  for (let i = 1; i < p.length; i++) {
    const cur = p[i];
    let d = dist(prev.x, prev.y, cur.x, cur.y);
    while (acc + d >= step && d > 0) {
      const t = (step - acc) / d;
      const q = { x: prev.x + (cur.x - prev.x) * t, y: prev.y + (cur.y - prev.y) * t };
      out.push(q);
      prev = q;
      d = dist(prev.x, prev.y, cur.x, cur.y);
      acc = 0;
    }
    acc += d;
    prev = cur;
  }
  if (out.length < n) out.push(p[p.length - 1]);
  return out;
}

function bbox(p: P[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of p) {
    if (q.x < x0) x0 = q.x;
    if (q.x > x1) x1 = q.x;
    if (q.y < y0) y0 = q.y;
    if (q.y > y1) y1 = q.y;
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, diag: Math.hypot(x1 - x0, y1 - y0) };
}

/** Principal axes of a point cloud. */
function pca(p: P[]) {
  let mx = 0, my = 0;
  for (const q of p) { mx += q.x; my += q.y; }
  mx /= p.length; my /= p.length;
  let sxx = 0, sxy = 0, syy = 0;
  for (const q of p) {
    const dx = q.x - mx, dy = q.y - my;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  sxx /= p.length; sxy /= p.length; syy /= p.length;
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const t = (sxx + syy) / 2;
  const d = Math.sqrt(Math.max(0, ((sxx - syy) / 2) ** 2 + sxy * sxy));
  return { mx, my, angle, l1: t + d, l2: Math.max(0, t - d) };
}

function distToPolyline(x: number, y: number, poly: P[], closed: boolean): number {
  let best = Infinity;
  const n = poly.length;
  for (let i = 0; i < n - 1; i++) best = Math.min(best, distSegSq(x, y, poly[i].x, poly[i].y, poly[i + 1].x, poly[i + 1].y));
  if (closed) best = Math.min(best, distSegSq(x, y, poly[n - 1].x, poly[n - 1].y, poly[0].x, poly[0].y));
  return Math.sqrt(best);
}

function meanDistToPolygon(pts: P[], poly: P[]): number {
  let s = 0;
  for (const q of pts) s += distToPolyline(q.x, q.y, poly, true);
  return s / pts.length;
}

/** Visvalingam–Whyatt on a closed polygon: drop the least significant vertices until `n` remain. */
function reduceTo(pts: P[], n: number): P[] {
  const poly = pts.slice();
  const area = (a: P, b: P, c: P) => Math.abs((a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y)) / 2);
  while (poly.length > n) {
    let best = 0;
    let bestA = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = area(poly[(i + poly.length - 1) % poly.length], poly[i], poly[(i + 1) % poly.length]);
      if (a < bestA) { bestA = a; best = i; }
    }
    poly.splice(best, 1);
  }
  return poly;
}

/** Minimum-area oriented bounding rectangle (brute force over angles). */
function minAreaRect(pts: P[]) {
  let best: { area: number; angle: number; x0: number; y0: number; x1: number; y1: number } | null = null;
  for (let deg = 0; deg < 90; deg += 1) {
    const a = (deg * Math.PI) / 180;
    const e = extentsAt(pts, a);
    const area = (e.x1 - e.x0) * (e.y1 - e.y0);
    if (!best || area < best.area) best = { area, angle: a, ...e };
  }
  return best!;
}

function extentsAt(pts: P[], angle: number) {
  const c = Math.cos(angle), s = Math.sin(angle);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of pts) {
    const u = q.x * c + q.y * s;
    const v = -q.x * s + q.y * c;
    if (u < x0) x0 = u;
    if (u > x1) x1 = u;
    if (v < y0) y0 = v;
    if (v > y1) y1 = v;
  }
  return { x0, y0, x1, y1 };
}

function rectCorners(angle: number, x0: number, y0: number, x1: number, y1: number): P[] {
  const c = Math.cos(angle), s = Math.sin(angle);
  const f = (u: number, v: number): P => ({ x: u * c - v * s, y: u * s + v * c });
  return [f(x0, y0), f(x1, y0), f(x1, y1), f(x0, y1)];
}

/** Winding of the stroke around a point in radians (absolute). */
function windingAngle(pts: P[], cx: number, cy: number): number {
  let total = 0;
  let prev = Math.atan2(pts[0].y - cy, pts[0].x - cx);
  for (let i = 1; i < pts.length; i++) {
    const a = Math.atan2(pts[i].y - cy, pts[i].x - cx);
    let d = a - prev;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    total += d;
    prev = a;
  }
  return Math.abs(total);
}

/** Smallest turning angle at any vertex of a closed polygon (radians). */
function minExteriorAngle(poly: P[]): number {
  let min = Math.PI;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[(i + n - 1) % n], b = poly[i], c = poly[(i + 1) % n];
    const v1x = b.x - a.x, v1y = b.y - a.y, v2x = c.x - b.x, v2y = c.y - b.y;
    const ang = Math.abs(Math.atan2(v1x * v2y - v1y * v2x, v1x * v2x + v1y * v2y));
    if (ang < min) min = ang;
  }
  return min;
}

function snapAngle(a: number, step: number, tol: number): number {
  const k = Math.round(a / step) * step;
  return Math.abs(a - k) <= tol ? k : a;
}

/** Plain Nelder–Mead simplex minimiser – plenty for a 5 parameter ellipse. */
function nelderMead(f: (x: number[]) => number, x0: number[], step: number[], iters = 260): number[] {
  const n = x0.length;
  let simplex = [x0.slice()];
  for (let i = 0; i < n; i++) {
    const x = x0.slice();
    x[i] += step[i];
    simplex.push(x);
  }
  let vals = simplex.map(f);
  for (let it = 0; it < iters; it++) {
    const order = vals.map((_, i) => i).sort((a, b) => vals[a] - vals[b]);
    simplex = order.map((i) => simplex[i]);
    vals = order.map((i) => vals[i]);
    if (Math.abs(vals[n] - vals[0]) < 1e-7) break;
    const centroid = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) centroid[j] += simplex[i][j] / n;
    const mix = (t: number) => centroid.map((c, j) => c + t * (simplex[n][j] - c));
    const xr = mix(-1);
    const fr = f(xr);
    if (fr < vals[0]) {
      const xe = mix(-2);
      const fe = f(xe);
      if (fe < fr) { simplex[n] = xe; vals[n] = fe; } else { simplex[n] = xr; vals[n] = fr; }
    } else if (fr < vals[n - 1]) {
      simplex[n] = xr; vals[n] = fr;
    } else {
      const xc = mix(fr < vals[n] ? -0.5 : 0.5);
      const fc = f(xc);
      if (fc < Math.min(fr, vals[n])) { simplex[n] = xc; vals[n] = fc; } else {
        for (let i = 1; i <= n; i++) {
          simplex[i] = simplex[i].map((v, j) => simplex[0][j] + 0.5 * (v - simplex[0][j]));
          vals[i] = f(simplex[i]);
        }
      }
    }
  }
  let bi = 0;
  for (let i = 1; i <= n; i++) if (vals[i] < vals[bi]) bi = i;
  return simplex[bi];
}

interface EllipseFit { cx: number; cy: number; a: number; b: number; rot: number; err: number }

function ellipseError(pts: P[], cx: number, cy: number, a: number, b: number, rot: number): number {
  if (a < 1e-3 || b < 1e-3) return 1e9;
  const c = Math.cos(rot), s = Math.sin(rot);
  let err = 0;
  for (const q of pts) {
    const u = (q.x - cx) * c + (q.y - cy) * s;
    const v = -(q.x - cx) * s + (q.y - cy) * c;
    err += Math.abs(Math.sqrt((u / a) ** 2 + (v / b) ** 2) - 1);
  }
  return err / pts.length;
}

function fitEllipse(pts: P[]): EllipseFit {
  const bb = bbox(pts);
  const pc = pca(pts);
  const cx0 = (bb.x0 + bb.x1) / 2, cy0 = (bb.y0 + bb.y1) / 2;
  const starts: number[][] = [
    [cx0, cy0, bb.w / 2, bb.h / 2, 0],
    [cx0, cy0, Math.sqrt(2 * pc.l1), Math.sqrt(2 * pc.l2) || bb.h / 2, pc.angle],
  ];
  let best: number[] = starts[0];
  let bestErr = Infinity;
  for (const s of starts) {
    const f = (x: number[]) => ellipseError(pts, x[0], x[1], x[2], x[3], x[4]);
    const x = nelderMead(f, s, [bb.w * 0.06, bb.h * 0.06, bb.w * 0.06, bb.h * 0.06, 0.15]);
    const e = f(x);
    if (e < bestErr) { bestErr = e; best = x; }
  }
  const [cx, cy] = best;
  let a = Math.abs(best[2]);
  let b = Math.abs(best[3]);
  let rot = best[4];
  if (b > a) { [a, b] = [b, a]; rot += Math.PI / 2; }
  rot = ((rot % Math.PI) + Math.PI) % Math.PI;
  return { cx, cy, a, b, rot, err: ellipseError(pts, cx, cy, a, b, rot) };
}

export function recognizeShape(
  raw: P[],
  mode: 'hold' | 'auto',
  debug?: (msg: string, data?: unknown) => void,
): Recognized | null {
  const M = MODES[mode];
  const pts: P[] = [];
  for (const q of raw) {
    const l = pts[pts.length - 1];
    if (!l || dist(l.x, l.y, q.x, q.y) > 0.01) pts.push({ x: q.x, y: q.y });
  }
  if (pts.length < 6) return null;
  const bb = bbox(pts);
  if (bb.diag < M.minDiag) return null;
  const len = pathLength(pts);
  const first = pts[0], last = pts[pts.length - 1];
  const chord = dist(first.x, first.y, last.x, last.y);
  const closed = chord / len < M.closeGap;
  const rs = resample(pts, 72);
  debug?.('basic', { len, chord, closed, diag: bb.diag });

  const candidates: Recognized[] = [];

  // ── line ────────────────────────────────────────────────────────────
  if (!closed && len / Math.max(chord, 1e-6) <= M.lineStraight) {
    const pc = pca(rs);
    const dx = Math.cos(pc.angle), dy = Math.sin(pc.angle);
    let maxDev = 0;
    for (const q of rs) maxDev = Math.max(maxDev, Math.abs((q.x - pc.mx) * -dy + (q.y - pc.my) * dx));
    const err = maxDev / Math.max(chord, 1e-6);
    debug?.('line', { err });
    if (err <= M.line) {
      // project the true end points on the fitted line; snap to multiples of 45° when close
      const t0 = (first.x - pc.mx) * dx + (first.y - pc.my) * dy;
      const t1 = (last.x - pc.mx) * dx + (last.y - pc.my) * dy;
      const dir = t1 >= t0 ? 1 : -1;
      let ang = Math.atan2(dy * dir, dx * dir);
      ang = snapAngle(ang, Math.PI / 4, (mode === 'hold' ? 6 : 3) * (Math.PI / 180));
      const mid = { x: pc.mx + (dx * (t0 + t1)) / 2, y: pc.my + (dy * (t0 + t1)) / 2 };
      const half = Math.abs(t1 - t0) / 2;
      const ux = Math.cos(ang), uy = Math.sin(ang);
      candidates.push({
        kind: 'line',
        p: [mid.x - ux * half, mid.y - uy * half, mid.x + ux * half, mid.y + uy * half],
        err: err * 0.8,
      });
    }
  }

  // ── closed shapes ──────────────────────────────────────────────────
  if (closed) {
    const winding = windingAngle(rs, (bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2);
    debug?.('closed', { winding });
    const turnsOk = winding > (mode === 'hold' ? Math.PI * 1.6 : Math.PI * 1.75) && winding < Math.PI * 2.8;
    if (turnsOk) {
      // ellipse / circle
      const fit = fitEllipse(rs);
      let { a, b, rot } = fit;
      if (a / b < 1.14) {
        const r = (a + b) / 2;
        a = r;
        b = r;
      } else {
        const sn = snapAngle(rot, Math.PI / 2, 9 * (Math.PI / 180));
        rot = sn >= Math.PI ? 0 : sn;
      }
      const err = ellipseError(rs, fit.cx, fit.cy, a, b, rot);
      debug?.('ellipse', { err, ratio: a / b });
      if (err <= M.ellipse) {
        const c = Math.cos(rot), s = Math.sin(rot);
        candidates.push({ kind: 'ellipse', p: [fit.cx, fit.cy, a * c, a * s, -b * s, b * c], err });
      }

      // rectangle / triangle / quadrilateral
      const polys: Recognized[] = [];
      for (const n of [4, 3]) {
        const corners = reduceTo(rs, n);
        if (polygonArea(corners.flatMap((q) => [q.x, q.y])) < bb.w * bb.h * 0.08) continue;
        const sharp = minExteriorAngle(corners) > (28 * Math.PI) / 180;
        const perr = meanDistToPolygon(rs, corners) / bb.diag;
        debug?.('polygon', { n, perr });
        if (n === 4) {
          const mr = minAreaRect(rs);
          let ang = mr.angle;
          const snapped = snapAngle(ang, Math.PI / 2, 7 * (Math.PI / 180));
          ang = snapped >= Math.PI / 2 ? 0 : snapped;
          const ext = ang === mr.angle ? mr : extentsAt(rs, ang);
          const rc = rectCorners(ang, ext.x0, ext.y0, ext.x1, ext.y1);
          const rerr = meanDistToPolygon(rs, rc) / bb.diag;
          debug?.('rect', { rerr });
          if (rerr <= M.rect) {
            candidates.push({ kind: 'rect', p: rc.flatMap((q) => [q.x, q.y]), err: rerr });
            continue;
          }
        }
        if (sharp && perr <= M.poly) polys.push({ kind: 'poly', p: corners.flatMap((q) => [q.x, q.y]), err: perr });
      }
      // a quadrilateral has to be clearly better than a triangle, otherwise the extra
      // vertex is just wobble in the stroke
      const quad = polys.find((c) => c.p.length === 8);
      const tri = polys.find((c) => c.p.length === 6);
      if (quad && tri && quad.err > tri.err * 0.4) polys.splice(polys.indexOf(quad), 1);
      candidates.push(...polys);
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => weighted(a, M) - weighted(b, M));
  return candidates[0];
}

function weighted(c: Recognized, M: Mode): number {
  const limit = c.kind === 'line' ? M.line : c.kind === 'ellipse' ? M.ellipse : c.kind === 'rect' ? M.rect : M.poly;
  return clamp(c.err / limit, 0, 10);
}
