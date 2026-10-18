import type { AnyObj, InkObj, ImageObj, Mat, MarkObj, NoteObj, Rect, ShapeObj, TextObj } from './types';
import {
  apply, boundsOfPoints, distSegSq, ellipsePolygon, meanScale, pointInPolygon, rectInflate, rectUnion,
  rotationOf, clamp,
} from './geometry';
import { inkBounds } from './ink';

export const NOTE_SIZE = 24;

let counter = 0;
export function uid(): string {
  counter = (counter + 1) % 46656;
  return Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 6) + counter.toString(36);
}

function rotatedBox(cx: number, cy: number, w: number, h: number, r: number, ox = 0, oy = 0): number[] {
  // corners of a w×h box with top-left at (cx,cy) rotated by r around (cx,cy), shifted by ox/oy first
  const c = Math.cos(r);
  const s = Math.sin(r);
  const pts: number[] = [];
  for (const [x, y] of [[0, 0], [w, 0], [w, h], [0, h]]) {
    const px = x + ox;
    const py = y + oy;
    pts.push(cx + px * c - py * s, cy + px * s + py * c);
  }
  return pts;
}

export function textHeight(o: TextObj): number {
  return o.h ?? o.z * 1.3 * Math.max(1, (o.ls ?? o.s.split('\n')).length);
}

/** Corners (clockwise, page space) of text / image boxes. */
export function boxCorners(o: TextObj | ImageObj): number[] {
  if (o.t === 'text') return rotatedBox(o.x, o.y, o.w, textHeight(o), o.r ?? 0);
  return rotatedBox(o.x, o.y, o.w, o.h, o.r ?? 0);
}

export function shapePolygon(o: ShapeObj): number[] {
  if (o.k === 'ellipse') return ellipsePolygon(o.p);
  return o.p;
}

export function bounds(o: AnyObj): Rect {
  switch (o.t) {
    case 'ink':
      return inkBounds(o);
    case 'shape': {
      const poly = shapePolygon(o);
      const r = boundsOfPoints(poly);
      const pad = o.w / 2 + (o.k === 'arrow' ? Math.max(10, o.w * 4.5) : 1);
      return rectInflate(r, pad);
    }
    case 'text':
    case 'img':
      return boundsOfPoints(boxCorners(o));
    case 'note':
      return { x: o.x, y: o.y, w: NOTE_SIZE, h: NOTE_SIZE };
    case 'mark': {
      let r: Rect | null = null;
      for (let i = 0; i < o.q.length; i += 4) r = rectUnion(r, { x: o.q[i], y: o.q[i + 1], w: o.q[i + 2], h: o.q[i + 3] });
      return r ?? { x: 0, y: 0, w: 0, h: 0 };
    }
  }
}

export function boundsOfAll(objs: AnyObj[]): Rect | null {
  let r: Rect | null = null;
  for (const o of objs) r = rectUnion(r, bounds(o));
  return r;
}

function distToPolyline(x: number, y: number, p: number[], closed: boolean, stride = 2): number {
  let best = Infinity;
  const n = p.length / stride;
  if (n === 1) return Math.hypot(x - p[0], y - p[1]);
  for (let i = 0; i < n - 1; i++) {
    const d = distSegSq(x, y, p[i * stride], p[i * stride + 1], p[(i + 1) * stride], p[(i + 1) * stride + 1]);
    if (d < best) best = d;
  }
  if (closed && n > 2) {
    const d = distSegSq(x, y, p[(n - 1) * stride], p[(n - 1) * stride + 1], p[0], p[1]);
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/** Does a disc of radius `tol` around (x,y) touch the object? */
export function hitTest(o: AnyObj, x: number, y: number, tol: number): boolean {
  const b = bounds(o);
  if (x < b.x - tol || x > b.x + b.w + tol || y < b.y - tol || y > b.y + b.h + tol) return false;
  switch (o.t) {
    case 'ink':
      return distToPolyline(x, y, o.p, false, 3) <= o.w * 0.5 + tol;
    case 'shape': {
      const poly = shapePolygon(o);
      const closed = o.k === 'rect' || o.k === 'ellipse' || o.k === 'poly';
      if (distToPolyline(x, y, poly, closed) <= o.w / 2 + tol) return true;
      return !!o.fill && closed && pointInPolygon(x, y, poly);
    }
    case 'text':
    case 'img':
      return pointInPolygon(x, y, boxCorners(o)) || distToPolyline(x, y, boxCorners(o), true) <= tol;
    case 'note':
      return true;
    case 'mark':
      for (let i = 0; i < o.q.length; i += 4) {
        if (x >= o.q[i] - tol && x <= o.q[i] + o.q[i + 2] + tol && y >= o.q[i + 1] - tol && y <= o.q[i + 1] + o.q[i + 3] + tol) return true;
      }
      return false;
  }
}

/** Representative points of an object, used to decide whether a lasso/marquee contains it. */
export function samplePoints(o: AnyObj, max = 48): number[] {
  const out: number[] = [];
  switch (o.t) {
    case 'ink': {
      const n = o.p.length / 3;
      const step = Math.max(1, Math.ceil(n / max));
      for (let i = 0; i < n; i += step) out.push(o.p[i * 3], o.p[i * 3 + 1]);
      break;
    }
    case 'shape': {
      const poly = shapePolygon(o);
      const n = poly.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        out.push(poly[2 * i], poly[2 * i + 1], (poly[2 * i] + poly[2 * j]) / 2, (poly[2 * i + 1] + poly[2 * j + 1]) / 2);
      }
      break;
    }
    case 'text':
    case 'img': {
      const c = boxCorners(o);
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        out.push(c[2 * i], c[2 * i + 1], (c[2 * i] + c[2 * j]) / 2, (c[2 * i + 1] + c[2 * j + 1]) / 2);
      }
      out.push((c[0] + c[4]) / 2, (c[1] + c[5]) / 2);
      break;
    }
    case 'note':
      out.push(o.x + NOTE_SIZE / 2, o.y + NOTE_SIZE / 2);
      break;
    case 'mark':
      for (let i = 0; i < o.q.length; i += 4) out.push(o.q[i] + o.q[i + 2] / 2, o.q[i + 1] + o.q[i + 3] / 2);
      break;
  }
  return out;
}

export function objectsInPolygon(objs: AnyObj[], poly: number[], minFraction = 0.5): AnyObj[] {
  const bb = boundsOfPoints(poly);
  const res: AnyObj[] = [];
  for (const o of objs) {
    const b = bounds(o);
    if (b.x > bb.x + bb.w || b.x + b.w < bb.x || b.y > bb.y + bb.h || b.y + b.h < bb.y) continue;
    const pts = samplePoints(o);
    const n = pts.length / 2;
    if (!n) continue;
    let inside = 0;
    for (let i = 0; i < pts.length; i += 2) if (pointInPolygon(pts[i], pts[i + 1], poly)) inside++;
    if (inside / n >= minFraction) res.push(o);
  }
  return res;
}

export function transformObj(o: AnyObj, m: Mat): AnyObj {
  const s = meanScale(m);
  const sx = Math.hypot(m[0], m[1]);
  const sy = Math.hypot(m[2], m[3]);
  switch (o.t) {
    case 'ink': {
      const p = new Array<number>(o.p.length);
      for (let i = 0; i < o.p.length; i += 3) {
        const q = apply(m, o.p[i], o.p[i + 1]);
        p[i] = q.x;
        p[i + 1] = q.y;
        p[i + 2] = o.p[i + 2];
      }
      return { ...o, p, w: Math.max(0.1, o.w * s) };
    }
    case 'shape': {
      const p = new Array<number>(o.p.length);
      if (o.k === 'ellipse') {
        const c = apply(m, o.p[0], o.p[1]);
        p[0] = c.x;
        p[1] = c.y;
        for (const i of [2, 4]) {
          p[i] = m[0] * o.p[i] + m[2] * o.p[i + 1];
          p[i + 1] = m[1] * o.p[i] + m[3] * o.p[i + 1];
        }
      } else {
        for (let i = 0; i < o.p.length; i += 2) {
          const q = apply(m, o.p[i], o.p[i + 1]);
          p[i] = q.x;
          p[i + 1] = q.y;
        }
      }
      return { ...o, p, w: Math.max(0.1, o.w * s) };
    }
    case 'text': {
      const q = apply(m, o.x, o.y);
      const t: TextObj = { ...o, x: q.x, y: q.y, w: Math.max(8, o.w * sx), z: clamp(o.z * s, 4, 400), r: (o.r ?? 0) + rotationOf(m) };
      delete t.ls;
      delete t.h;
      if (!t.r) delete t.r;
      return t;
    }
    case 'note': {
      const q = apply(m, o.x + NOTE_SIZE / 2, o.y + NOTE_SIZE / 2);
      return { ...o, x: q.x - NOTE_SIZE / 2, y: q.y - NOTE_SIZE / 2 } satisfies NoteObj;
    }
    case 'img': {
      const c = Math.cos(o.r ?? 0);
      const sn = Math.sin(o.r ?? 0);
      // transform the centre, scale about it, accumulate rotation
      const cx = o.x + (o.w / 2) * c - (o.h / 2) * sn;
      const cy = o.y + (o.w / 2) * sn + (o.h / 2) * c;
      const q = apply(m, cx, cy);
      const w = Math.max(4, o.w * sx);
      const h = Math.max(4, o.h * sy);
      const r = (o.r ?? 0) + rotationOf(m);
      const c2 = Math.cos(r);
      const s2 = Math.sin(r);
      const img: ImageObj = { ...o, w, h, r, x: q.x - (w / 2) * c2 + (h / 2) * s2, y: q.y - (w / 2) * s2 - (h / 2) * c2 };
      if (!img.r) delete img.r;
      return img;
    }
    case 'mark': {
      const q = new Array<number>(o.q.length);
      for (let i = 0; i < o.q.length; i += 4) {
        const a = apply(m, o.q[i], o.q[i + 1]);
        q[i] = a.x;
        q[i + 1] = a.y;
        q[i + 2] = o.q[i + 2] * sx;
        q[i + 3] = o.q[i + 3] * sy;
      }
      return { ...o, q } satisfies MarkObj;
    }
  }
}

/** Objects that can be rotated / freely scaled; marks stay glued to their text. */
export function isTransformable(o: AnyObj): boolean {
  return o.t !== 'mark' && o.t !== 'note';
}

export function recolor(o: AnyObj, color: string): AnyObj {
  return o.t === 'img' ? o : { ...o, c: color };
}

export function rewidth(o: AnyObj, w: number): AnyObj {
  if (o.t === 'ink' || o.t === 'shape') return { ...o, w };
  return o;
}

/** Re-id an object (copy / paste / duplicate). */
export function clone(o: AnyObj, dx = 0, dy = 0): AnyObj {
  const c = transformObj(o, [1, 0, 0, 1, dx, dy]);
  return { ...c, id: uid() };
}

/**
 * Partial ("point") erasing: cut every part of an ink stroke that lies within
 * `r` of (cx, cy). Returns the replacement pieces, or null if nothing was touched.
 */
export function splitInk(o: InkObj, cx: number, cy: number, r: number): InkObj[] | null {
  const R = r + o.w * 0.25;
  const R2 = R * R;
  const n = o.p.length / 3;
  let touched = false;
  const pieces: number[][] = [];
  let cur: number[] = [];
  const pushPiece = () => {
    if (cur.length >= 6) pieces.push(cur);
    cur = [];
  };
  const inside = (i: number) => {
    const dx = o.p[i * 3] - cx;
    const dy = o.p[i * 3 + 1] - cy;
    return dx * dx + dy * dy <= R2;
  };
  for (let i = 0; i < n; i++) {
    const ins = inside(i);
    if (i > 0) {
      // segment i-1 → i : find the part inside the disc
      const ax = o.p[(i - 1) * 3];
      const ay = o.p[(i - 1) * 3 + 1];
      const bx = o.p[i * 3];
      const by = o.p[i * 3 + 1];
      const dx = bx - ax;
      const dy = by - ay;
      const fx = ax - cx;
      const fy = ay - cy;
      const A = dx * dx + dy * dy;
      const B = 2 * (fx * dx + fy * dy);
      const C = fx * fx + fy * fy - R2;
      const disc = B * B - 4 * A * C;
      const aIn = inside(i - 1);
      if (!aIn && !ins && disc > 0 && A > 0) {
        const sq = Math.sqrt(disc);
        const t0 = (-B - sq) / (2 * A);
        const t1 = (-B + sq) / (2 * A);
        if (t0 > 0 && t1 < 1) {
          // segment passes completely through the disc
          touched = true;
          const pa = o.p[(i - 1) * 3 + 2];
          const pb = o.p[i * 3 + 2];
          cur.push(ax + dx * t0, ay + dy * t0, pa + (pb - pa) * t0);
          pushPiece();
          cur.push(ax + dx * t1, ay + dy * t1, pa + (pb - pa) * t1);
        }
      } else if (aIn !== ins && A > 0) {
        touched = true;
        const sq = Math.sqrt(Math.max(0, disc));
        const pa = o.p[(i - 1) * 3 + 2];
        const pb = o.p[i * 3 + 2];
        if (aIn) {
          const t = clamp((-B + sq) / (2 * A), 0, 1); // exit point
          cur = [ax + dx * t, ay + dy * t, pa + (pb - pa) * t];
        } else {
          const t = clamp((-B - sq) / (2 * A), 0, 1); // entry point
          cur.push(ax + dx * t, ay + dy * t, pa + (pb - pa) * t);
          pushPiece();
        }
      }
    }
    if (ins) {
      touched = true;
      if (cur.length) pushPiece();
    } else {
      cur.push(o.p[i * 3], o.p[i * 3 + 1], o.p[i * 3 + 2]);
    }
  }
  if (cur.length) pushPiece();
  if (!touched) return null;
  return pieces.map((p) => ({ ...o, id: uid(), p }));
}
