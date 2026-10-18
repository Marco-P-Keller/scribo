import type { AnyObj, ImageObj, InkObj, Mat, MarkObj, NoteObj, ShapeObj, TextObj } from '../core/types';
import { isHighlight } from '../core/types';
import { apply, hexToRgb, mul, rotateM } from '../core/geometry';
import { inkOutline } from '../core/ink';
import { arrowHead, dashPattern } from '../core/shapes';
import { ASCENT, TEXT_PAD, lineHeightOf } from '../core/textmetrics';

// Builds PDF content-stream operators for annotation objects. Pure and free of
// pdf-lib so it can be unit tested; everything pdf-lib specific (fonts, images,
// graphics-state resources) is injected through `ContentCtx`.

export interface FontHandle {
  /** resource name inside the form's /Font dictionary */
  name: string;
  widthOf(text: string, size: number): number;
  /** hex string including angle brackets */
  encode(text: string): string;
  /** the font has no real italic → shear the text matrix */
  fakeItalic: boolean;
}

export interface ContentCtx {
  /** page space → PDF default user space */
  T: Mat;
  /** returns the resource name of an ExtGState with the given alpha / blend mode */
  gs(opts: { alpha?: number; blend?: 'Multiply' }): string;
  font(o: TextObj): FontHandle;
  image(o: ImageObj): { name: string } | null;
}

export const n = (v: number): string => {
  if (Number.isInteger(v)) return String(v);
  const s = v.toFixed(3);
  return s.replace(/\.?0+$/, '') || '0';
};

const rgb = (hex: string): string => {
  const [r, g, b] = hexToRgb(hex);
  return `${n(r / 255)} ${n(g / 255)} ${n(b / 255)}`;
};

function pt(T: Mat, x: number, y: number): [number, number] {
  const q = apply(T, x, y);
  return [q.x, q.y];
}

// ── ink ─────────────────────────────────────────────────────────────────

/** quadratic-through-midpoints outline (see ink.outlinePath) as cubic Bézier operators */
export function outlineOps(outline: [number, number][], T: Mat): string {
  const pts: [number, number][] = [];
  let last: [number, number] | null = null;
  for (const [x, y] of outline) {
    const q = pt(T, x, y);
    if (last && Math.hypot(q[0] - last[0], q[1] - last[1]) < 0.1) continue;
    pts.push(q);
    last = q;
  }
  const len = pts.length;
  if (len < 3) {
    if (!len) return '';
    // a dot: draw a small circle
    const [cx, cy] = pts[0];
    const r = 0.5;
    return circleOps(cx, cy, r, r);
  }
  const mid = (a: [number, number], b: [number, number]): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let s = mid(pts[len - 1], pts[0]);
  const out: string[] = [`${n(s[0])} ${n(s[1])} m`];
  for (let i = 0; i < len; i++) {
    const c = pts[i];
    const e = mid(c, pts[(i + 1) % len]);
    const c1: [number, number] = [s[0] + (2 / 3) * (c[0] - s[0]), s[1] + (2 / 3) * (c[1] - s[1])];
    const c2: [number, number] = [e[0] + (2 / 3) * (c[0] - e[0]), e[1] + (2 / 3) * (c[1] - e[1])];
    out.push(`${n(c1[0])} ${n(c1[1])} ${n(c2[0])} ${n(c2[1])} ${n(e[0])} ${n(e[1])} c`);
    s = e;
  }
  out.push('h');
  return out.join('\n');
}

function circleOps(cx: number, cy: number, rx: number, ry: number): string {
  const k = 0.5522847498;
  return [
    `${n(cx + rx)} ${n(cy)} m`,
    `${n(cx + rx)} ${n(cy + k * ry)} ${n(cx + k * rx)} ${n(cy + ry)} ${n(cx)} ${n(cy + ry)} c`,
    `${n(cx - k * rx)} ${n(cy + ry)} ${n(cx - rx)} ${n(cy + k * ry)} ${n(cx - rx)} ${n(cy)} c`,
    `${n(cx - rx)} ${n(cy - k * ry)} ${n(cx - k * rx)} ${n(cy - ry)} ${n(cx)} ${n(cy - ry)} c`,
    `${n(cx + k * rx)} ${n(cy - ry)} ${n(cx + rx)} ${n(cy - k * ry)} ${n(cx + rx)} ${n(cy)} c`,
    'h',
  ].join('\n');
}

function inkOps(o: InkObj, c: ContentCtx): string {
  const gs = o.hl || (o.o ?? 1) < 1 ? `/${c.gs({ alpha: o.o ?? 1, blend: o.hl ? 'Multiply' : undefined })} gs\n` : '';
  return `q\n${gs}${rgb(o.c)} rg\n${outlineOps(inkOutline(o), c.T)}\nf\nQ`;
}

// ── shapes ──────────────────────────────────────────────────────────────

function ellipseOps(p: number[], T: Mat): string {
  const [cx, cy, ux, uy, vx, vy] = p;
  const k = 0.5522847498;
  const P = (a: number, b: number) => pt(T, cx + ux * a + vx * b, cy + uy * a + vy * b);
  const seg = (a0: number, b0: number, a1: number, b1: number, a2: number, b2: number) => {
    const p1 = P(a0, b0), p2 = P(a1, b1), p3 = P(a2, b2);
    return `${n(p1[0])} ${n(p1[1])} ${n(p2[0])} ${n(p2[1])} ${n(p3[0])} ${n(p3[1])} c`;
  };
  const s = P(1, 0);
  return [
    `${n(s[0])} ${n(s[1])} m`,
    seg(1, k, k, 1, 0, 1),
    seg(-k, 1, -1, k, -1, 0),
    seg(-1, -k, -k, -1, 0, -1),
    seg(k, -1, 1, -k, 1, 0),
    'h',
  ].join('\n');
}

function polyOps(p: number[], T: Mat, close: boolean): string {
  const out: string[] = [];
  for (let i = 0; i < p.length; i += 2) {
    const [x, y] = pt(T, p[i], p[i + 1]);
    out.push(`${n(x)} ${n(y)} ${i === 0 ? 'm' : 'l'}`);
  }
  if (close) out.push('h');
  return out.join('\n');
}

function shapeOps(o: ShapeObj, c: ContentCtx): string {
  const closed = o.k === 'rect' || o.k === 'ellipse' || o.k === 'poly';
  const body = o.k === 'ellipse' ? ellipseOps(o.p, c.T) : polyOps(o.p, c.T, closed);
  const dash = dashPattern(o);
  const out: string[] = ['q'];
  const alpha = o.o ?? 1;
  if (o.fill && closed) {
    out.push(`/${c.gs({ alpha: alpha * (o.fo ?? 0.25) })} gs`, `${rgb(o.fill)} rg`, body, 'f');
  }
  out.push(`/${c.gs({ alpha })} gs`, `${rgb(o.c)} RG`, `${n(o.w)} w 1 J 1 j`);
  out.push(dash.length ? `[${dash.map(n).join(' ')}] 0 d` : '[] 0 d');
  out.push(body, 'S');
  if (o.k === 'arrow') {
    const h = arrowHead(o.p, o.w);
    out.push('[] 0 d', polyOps(h, c.T, false), 'S');
  }
  out.push('Q');
  return out.join('\n');
}

// ── text ────────────────────────────────────────────────────────────────

function textOps(o: TextObj, c: ContentCtx): string {
  const lines = o.ls ?? o.s.split('\n');
  if (!lines.some((l) => l)) return '';
  const font = c.font(o);
  const lh = lineHeightOf(o);
  const r = o.r ?? 0;
  const cs = Math.cos(r), sn = Math.sin(r);
  const toPage = (lx: number, ly: number): [number, number] => [o.x + lx * cs - ly * sn, o.y + lx * sn + ly * cs];
  const out: string[] = ['q'];
  if (o.bg) {
    const h = o.h ?? lines.length * lh + TEXT_PAD * 2;
    const quad = [...toPage(0, 0), ...toPage(o.w, 0), ...toPage(o.w, h), ...toPage(0, h)];
    out.push(`${rgb(o.bg)} rg`, polyOps(quad, c.T, true), 'f');
  }
  out.push(`${rgb(o.c)} rg`);
  // text space → page space linear part: x axis = (cos, sin), up = (sin, -cos)
  const lin = (vx: number, vy: number): [number, number] => [c.T[0] * vx + c.T[2] * vy, c.T[1] * vx + c.T[3] * vy];
  const ax = lin(cs, sn);
  const up = lin(sn, -cs);
  const align = o.a ?? 'l';
  lines.forEach((line, i) => {
    if (!line) return;
    const w = font.widthOf(line, o.z);
    const lx = align === 'l' ? TEXT_PAD : align === 'c' ? (o.w - w) / 2 : o.w - TEXT_PAD - w;
    const ly = TEXT_PAD + i * lh + o.z * ASCENT;
    const [ox, oy] = pt(c.T, ...toPage(lx, ly));
    let tm: Mat = [ax[0], ax[1], up[0], up[1], ox, oy];
    if (font.fakeItalic) tm = mul(tm, [1, 0, 0.2, 1, 0, 0]);
    out.push(`BT /${font.name} ${n(o.z)} Tf ${tm.map(n).join(' ')} Tm ${font.encode(line)} Tj ET`);
  });
  out.push('Q');
  return out.join('\n');
}

// ── notes, images, marks ────────────────────────────────────────────────

/** Sticky-note icon as PDF path operators in a 24×24 box whose top-left is (x, y) in page space. */
export function noteIconOps(o: NoteObj, T: Mat, size: number): string {
  const s = size / 24;
  const P = (ix: number, iy: number): string => {
    const [x, y] = pt(T, o.x + ix * s, o.y + iy * s);
    return `${n(x)} ${n(y)}`;
  };
  return [
    'q',
    `${rgb(o.c)} rg 0.2 0.2 0.2 RG ${n(1.2 * s)} w 1 j`,
    `${P(3, 1.5)} m ${P(21, 1.5)} l ${P(22.5, 3)} l ${P(22.5, 16)} l ${P(15, 22.5)} l ${P(3, 22.5)} l ${P(1.5, 21)} l ${P(1.5, 3)} l h B`,
    `0.55 0.55 0.55 rg ${P(15, 22.5)} m ${P(15, 16)} l ${P(22.5, 16)} l h f`,
    `0.35 0.35 0.35 RG ${n(1.4 * s)} w 1 J`,
    `${P(5.5, 7)} m ${P(18.5, 7)} l S ${P(5.5, 11)} m ${P(18.5, 11)} l S ${P(5.5, 15)} m ${P(11, 15)} l S`,
    'Q',
  ].join('\n');
}

function imageOps(o: ImageObj, c: ContentCtx): string {
  const im = c.image(o);
  if (!im) return '';
  // image space is the unit square, y up; map it onto the (rotated) box in page space
  const m: Mat = mul(c.T, mul([1, 0, 0, 1, o.x, o.y], mul(rotateM(o.r ?? 0), [o.w, 0, 0, -o.h, 0, o.h])));
  const gs = (o.o ?? 1) < 1 ? `/${c.gs({ alpha: o.o ?? 1 })} gs\n` : '';
  return `q\n${gs}${m.map(n).join(' ')} cm\n/${im.name} Do\nQ`;
}

function markOps(o: MarkObj, c: ContentCtx): string {
  const out: string[] = ['q'];
  if (o.k === 'hl') out.push(`/${c.gs({ alpha: o.o ?? 1, blend: 'Multiply' })} gs`, `${rgb(o.c)} rg`);
  else out.push(`${rgb(o.c)} RG`);
  for (let i = 0; i < o.q.length; i += 4) {
    const x = o.q[i], y = o.q[i + 1], w = o.q[i + 2], h = o.q[i + 3];
    if (o.k === 'hl') {
      out.push(polyOps([x, y, x + w, y, x + w, y + h, x, y + h], c.T, true), 'f');
    } else {
      const ly = o.k === 'ul' ? y + h * 0.94 : y + h * 0.55;
      out.push(`${n(Math.max(0.8, h * 0.07))} w`, polyOps([x, ly, x + w, ly], c.T, false), 'S');
    }
  }
  out.push('Q');
  return out.join('\n');
}

/**
 * All objects of one page as a content stream. Highlights go first so that
 * the multiply blend sits underneath pen ink, exactly like on screen. Sticky
 * notes are exported as separate /Text annotations and are skipped here.
 */
export function buildContent(objs: AnyObj[], c: ContentCtx): string {
  const out: string[] = [];
  const draw = (o: AnyObj) => {
    switch (o.t) {
      case 'ink': out.push(inkOps(o, c)); break;
      case 'shape': out.push(shapeOps(o, c)); break;
      case 'text': out.push(textOps(o, c)); break;
      case 'img': out.push(imageOps(o, c)); break;
      case 'mark': out.push(markOps(o, c)); break;
      case 'note': break;
    }
  };
  for (const o of objs) if (isHighlight(o)) draw(o);
  for (const o of objs) if (!isHighlight(o)) draw(o);
  return out.filter(Boolean).join('\n');
}
