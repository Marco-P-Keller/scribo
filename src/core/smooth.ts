/**
 * Stroke smoothing ("Glättung"). It runs on the pen samples while writing and again when the
 * pen lifts, on the same samples, so the live ink and the stored stroke are the same line.
 *
 * - Works in screen pixels (`unit` = page points per CSS pixel): pen jitter and hand tremor
 *   happen on the screen, not on the paper, so the effect feels the same at every zoom.
 * - Local quadratic regression along the arc length (Savitzky–Golay for unevenly spaced
 *   samples): wobble disappears, the line does not lag behind the pen, and both ends stay
 *   where the pen touched down and lifted off.
 * - The window is wide on straight lines and gentle curves (that is where slow wobble shows)
 *   and narrows in tight turns, so the small loops of e, l and a keep their shape even at the
 *   strongest setting.
 * - Corners (k, z, 4, M …) are found at two scales and stay sharp: no fit reaches around one.
 *   A round turn is not a corner, and hooks at the very ends are smoothed away.
 */
export interface SmoothOptions {
  /** 0 = raw pen samples, 1 = strongest */
  strength: number;
  /** keep sharp corners sharp */
  corners: boolean;
  /** page units per CSS pixel (1 / zoom) */
  unit: number;
}

/** Widest fit radius (Gaussian sigma) in CSS pixels for a strength 0..1. */
export function smoothRadius(strength: number): number {
  const s = Math.min(1, Math.max(0, strength));
  return s <= 0 ? 0 : 0.5 + 2.5 * s + 5 * s * s;
}

/** Window reach in sigmas. */
const REACH = 2.6;
/** Turning angle (at 2.5 sigma) above which a point may be a corner. */
const CORNER_MIN = (52 * Math.PI) / 180;
/** At a corner the turn is concentrated: half the scale keeps most of the angle. */
const CORNER_SHARP = 0.62;
/** Corners and bends are judged at the scale of pen jitter (CSS px), whatever the strength. */
const FINE = 2.2;
/** In a bend of radius R the window is at most this × R wide … */
const BEND = 0.42;
/** … once the line turns this much (radians) over the measuring chords: loops and hairpins, not wobble. */
const BEND_MIN = 1;

/** Smooth x,y,pressure triples; returns a new array (pressure is kept as written). */
export function smoothStroke(p: number[], o: SmoothOptions): number[] {
  const sigma = smoothRadius(o.strength) * o.unit;
  if (!(sigma > 0) || p.length < 9) return p.slice();
  // samples closer than a fraction of the radius only carry jitter (a resting pen)
  let pts = thin(p, Math.min(sigma * 0.22, o.unit * 0.6));
  if (pts.length < 9) return pts;
  // fast strokes, mouse and finger give sparse samples: the fine scale must span a few of them
  const fine = Math.min(sigma, Math.max(FINE * o.unit, (1.5 * arcLength(pts).at(-1)!) / (pts.length / 3 - 1)));
  pts = trimHooks(pts, fine * 1.2);
  const n = pts.length / 3;
  const s = arcLength(pts);
  if (s[n - 1] < sigma * 0.5) return pts;

  // a light pilot pass shows the real corners and bends, without the jitter
  const pilot = fitPieces(pts, s, [0, n - 1], fine);
  const ps = arcLength(pilot);
  const corners = [0, ...findCorners(pilot, ps, fine), n - 1];
  // the window shrinks to fit each loop; a corner is not a loop, kept sharp or not
  const sig = sigma > fine ? bendRadius(pilot, ps, corners, sigma, fine) : sigma;
  const bounds = o.corners ? corners : [0, n - 1];
  return fitPieces(pts, s, bounds, sig);
}

/** Fit every piece between corners; a corner gets the mean of its two one-sided estimates. */
function fitPieces(pts: number[], s: Float64Array, bounds: number[], sig: Float64Array | number): number[] {
  const n = s.length;
  const out = pts.slice();
  const first = new Map<number, [number, number]>();
  for (let k = 0; k + 1 < bounds.length; k++) {
    const a = bounds[k];
    const b = bounds[k + 1];
    fitPiece(pts, s, a, b, sig, out);
    for (const c of [a, b]) {
      if (c === 0 || c === n - 1) continue;
      const prev = first.get(c);
      if (prev) {
        out[c * 3] = (prev[0] + out[c * 3]) / 2;
        out[c * 3 + 1] = (prev[1] + out[c * 3 + 1]) / 2;
      } else {
        first.set(c, [out[c * 3], out[c * 3 + 1]]);
      }
    }
  }
  return out;
}

/**
 * Window radius for every sample: `sigma` where the line runs straight or bends gently, less in
 * loops and hairpins (BEND × the turn's radius, measured on the pilot at three scales so tiny
 * loops are not missed), never below `fine`. Each narrow window spreads over its surroundings
 * and fades in and out.
 */
function bendRadius(pts: number[], s: Float64Array, corners: number[], sigma: number, fine: number): Float64Array {
  const n = s.length;
  const turn = turner(pts, s);
  const raw = new Float64Array(n);
  for (let k = 0; k + 1 < corners.length; k++) {
    const a = corners[k];
    const b = corners[k + 1];
    for (let i = a; i <= b; i++) {
      let radius = Infinity;
      for (const f of [0.5, 1, 1.6]) {
        // chords stop at corners: a corner is not a bend
        const r = Math.min(f * sigma, s[i] - s[a], s[b] - s[i]);
        if (r < fine) continue;
        const th = turn(i, r);
        if (th > BEND_MIN) radius = Math.min(radius, r / th);
      }
      raw[i] = Math.min(sigma, Math.max(fine, BEND * radius));
    }
  }
  // spread each minimum over one sigma, then soften the steps over half a sigma
  const low = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let m = raw[i];
    for (let j = i - 1; j >= 0 && s[i] - s[j] <= sigma; j--) m = Math.min(m, raw[j]);
    for (let j = i + 1; j < n && s[j] - s[i] <= sigma; j++) m = Math.min(m, raw[j]);
    low[i] = m;
  }
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = low[i];
    let cnt = 1;
    for (let j = i - 1; j >= 0 && s[i] - s[j] <= sigma / 2; j--) { sum += low[j]; cnt++; }
    for (let j = i + 1; j < n && s[j] - s[i] <= sigma / 2; j++) { sum += low[j]; cnt++; }
    out[i] = sum / cnt;
  }
  return out;
}

function arcLength(pts: number[]): Float64Array {
  const n = pts.length / 3;
  const s = new Float64Array(n);
  for (let i = 1; i < n; i++) s[i] = s[i - 1] + Math.hypot(pts[i * 3] - pts[i * 3 - 3], pts[i * 3 + 1] - pts[i * 3 - 2]);
  return s;
}

/**
 * A pen often lands or lifts while still moving sideways: the first or last `len` of the line
 * then points somewhere else than the stroke. Such hooks are dropped (x,y,p triples).
 */
function trimHooks(p: number[], len: number): number[] {
  const n = p.length / 3;
  if (n < 8) return p;
  const s = arcLength(p);
  if (s[n - 1] < len * 8) return p;
  // index of the first sample at least `d` along the line from sample `from` (backwards if dir < 0)
  const walk = (from: number, d: number, dir: 1 | -1) => {
    let i = from;
    while (i + dir >= 0 && i + dir < n && Math.abs(s[i] - s[from]) < d) i += dir;
    return i;
  };
  const hooked = (a: number, b: number, c: number) => {
    const ux = p[b * 3] - p[a * 3];
    const uy = p[b * 3 + 1] - p[a * 3 + 1];
    const vx = p[c * 3] - p[b * 3];
    const vy = p[c * 3 + 1] - p[b * 3 + 1];
    const l = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    return l > 0 && (ux * vx + uy * vy) / l < Math.cos((70 * Math.PI) / 180);
  };
  let first = 0;
  let last = n - 1;
  const j = walk(0, len, 1);
  if (hooked(0, j, walk(j, len * 3, 1))) first = j;
  const k = walk(n - 1, len, -1);
  if (hooked(walk(k, len * 3, -1), k, n - 1)) last = k;
  return first === 0 && last === n - 1 ? p : p.slice(first * 3, last * 3 + 3);
}

/** Keep the first and last sample, drop samples closer than `d` to the last kept one. */
function thin(p: number[], d: number): number[] {
  const n = p.length / 3;
  const out = [p[0], p[1], p[2]];
  const d2 = d * d;
  for (let i = 1; i < n - 1; i++) {
    const dx = p[i * 3] - out[out.length - 3];
    const dy = p[i * 3 + 1] - out[out.length - 2];
    if (dx * dx + dy * dy >= d2) out.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
  }
  const lx = p[n * 3 - 3];
  const ly = p[n * 3 - 2];
  // the last sample replaces a kept one that is too close, so the stroke still ends at the pen
  if (out.length > 3 && Math.hypot(lx - out[out.length - 3], ly - out[out.length - 2]) < d) out.length -= 3;
  out.push(lx, ly, p[n * 3 - 1]);
  return out;
}

/**
 * Weighted local quadratic fit of x(s) and y(s) around every sample of pts[a..b] (window radius
 * `sig`, per sample or for all). A ridge on the curvature term keeps one-sided windows (the ends
 * of a piece) and sparse windows close to a straight fit instead of letting the parabola swing
 * with the noise.
 */
function fitPiece(pts: number[], s: Float64Array, a: number, b: number, sig: Float64Array | number, out: number[]): void {
  for (let i = a; i <= b; i++) {
    const sigma = typeof sig === 'number' ? sig : sig[i];
    const reach = REACH * sigma;
    const inv2 = 1 / (2 * sigma * sigma);
    let lo = i;
    let hi = i;
    while (lo > a && s[i] - s[lo - 1] <= reach) lo--;
    while (hi < b && s[hi + 1] - s[i] <= reach) hi++;
    if (hi === lo) continue;
    const xi = pts[i * 3];
    const yi = pts[i * 3 + 1];
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0;
    let x0 = 0, x1 = 0, x2 = 0, y0 = 0, y1 = 0, y2 = 0;
    for (let j = lo; j <= hi; j++) {
      const d = s[j] - s[i];
      const u = d / sigma;
      const w = Math.exp(-d * d * inv2);
      const wu = w * u;
      const wu2 = wu * u;
      const dx = pts[j * 3] - xi;
      const dy = pts[j * 3 + 1] - yi;
      s0 += w; s1 += wu; s2 += wu2; s3 += wu2 * u; s4 += wu2 * u * u;
      x0 += w * dx; x1 += wu * dx; x2 += wu2 * dx;
      y0 += w * dy; y1 += wu * dy; y2 += wu2 * dy;
    }
    // few samples in the window (fast strokes, mouse, finger): a parabola would just pass
    // through them, so lean on the straight fit
    s4 += s0 * (0.2 + 4 / (s0 * s0));
    // Cramer's rule for the constant term of [[s0 s1 s2][s1 s2 s3][s2 s3 s4]] c = t
    const m0 = s2 * s4 - s3 * s3;
    const m1 = s1 * s4 - s3 * s2;
    const m2 = s1 * s3 - s2 * s2;
    const det = s0 * m0 - s1 * m1 + s2 * m2;
    if (!(Math.abs(det) > 1e-12 * s0 * s0 * s0)) continue;
    out[i * 3] = xi + (x0 * m0 - s1 * (x1 * s4 - s3 * x2) + s2 * (x1 * s3 - s2 * x2)) / det;
    out[i * 3 + 1] = yi + (y0 * m0 - s1 * (y1 * s4 - s3 * y2) + s2 * (y1 * s3 - s2 * y2)) / det;
  }
}

/** Angle (radians) between the chords that arrive at and leave sample i over arc length r. */
function turner(pts: number[], s: Float64Array): (i: number, r: number) => number {
  const n = s.length;
  const at = (t: number): [number, number] => {
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (s[mid] <= t) lo = mid;
      else hi = mid;
    }
    const f = s[hi] > s[lo] ? Math.min(1, Math.max(0, (t - s[lo]) / (s[hi] - s[lo]))) : 0;
    return [pts[lo * 3] + (pts[hi * 3] - pts[lo * 3]) * f, pts[lo * 3 + 1] + (pts[hi * 3 + 1] - pts[lo * 3 + 1]) * f];
  };
  return (i, r) => {
    const [ax, ay] = at(s[i] - r);
    const [bx, by] = at(s[i] + r);
    const ux = pts[i * 3] - ax;
    const uy = pts[i * 3 + 1] - ay;
    const vx = bx - pts[i * 3];
    const vy = by - pts[i * 3 + 1];
    const l = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    return l > 0 ? Math.acos(Math.min(1, Math.max(-1, (ux * vx + uy * vy) / l))) : 0;
  };
}

/** Indices of sharp corners at the scale `sigma`, never within 2.5 sigma of either end. */
function findCorners(pts: number[], s: Float64Array, sigma: number): number[] {
  const n = s.length;
  const len = s[n - 1];
  const r = 2.5 * sigma;
  if (len < 3 * r) return [];
  const turn = turner(pts, s);
  const cuts: number[] = [];
  let best = -1;
  let bestTurn = 0;
  const close = () => {
    if (best >= 0 && (!cuts.length || s[best] - s[cuts[cuts.length - 1]] >= r)) cuts.push(best);
    best = -1;
    bestTurn = 0;
  };
  for (let i = 1; i < n - 1; i++) {
    if (s[i] < r || len - s[i] < r) {
      close();
      continue;
    }
    const big = turn(i, r);
    const small = big > CORNER_MIN ? turn(i, r / 2) : 0;
    if (big > CORNER_MIN && small > CORNER_SHARP * big) {
      if (small > bestTurn) {
        best = i;
        bestTurn = small;
      }
    } else {
      close();
    }
  }
  close();
  return cuts;
}
