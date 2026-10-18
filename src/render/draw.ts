import type { AnyObj, ImageObj, InkObj, MarkObj, NoteObj, ShapeObj, TextObj } from '../core/types';
import { inkPath } from '../core/ink';
import { arrowHead, dashPattern } from '../core/shapes';
import { NOTE_SIZE, boxCorners } from '../core/objects';
import { fontCss, hasRealItalic } from './fonts';
import { ASCENT, TEXT_PAD, lineHeightOf } from '../core/textmetrics';
import { layoutText } from './textlayout';

// Draws annotation objects. The context must already be set up so that one
// unit equals one PDF point (page space).

const imageCache = new WeakMap<ImageObj, HTMLImageElement>();
let invalidate: (() => void) | null = null;

/** Called when an image finished decoding so that pages can repaint. */
export function setImageLoadHandler(fn: () => void): void {
  invalidate = fn;
}

function imageFor(o: ImageObj): HTMLImageElement | null {
  let img = imageCache.get(o);
  if (!img) {
    img = new Image();
    img.decoding = 'async';
    img.onload = () => invalidate?.();
    img.src = o.src;
    imageCache.set(o, img);
  }
  return img.complete && img.naturalWidth ? img : null;
}

const ellipsePathCache = new WeakMap<ShapeObj, Path2D>();

function shapePath(o: ShapeObj): Path2D {
  let path = ellipsePathCache.get(o);
  if (path) return path;
  path = new Path2D();
  const p = o.p;
  switch (o.k) {
    case 'ellipse': {
      const unit = new Path2D();
      unit.arc(0, 0, 1, 0, Math.PI * 2);
      path.addPath(unit, new DOMMatrix([p[2], p[3], p[4], p[5], p[0], p[1]]));
      break;
    }
    case 'line':
    case 'arrow':
    case 'polyline':
    case 'rect':
    case 'poly': {
      path.moveTo(p[0], p[1]);
      for (let i = 2; i < p.length; i += 2) path.lineTo(p[i], p[i + 1]);
      if (o.k === 'rect' || o.k === 'poly') path.closePath();
      if (o.k === 'arrow') {
        const h = arrowHead(p, o.w);
        path.moveTo(h[0], h[1]);
        path.lineTo(h[2], h[3]);
        path.lineTo(h[4], h[5]);
      }
      break;
    }
  }
  ellipsePathCache.set(o, path);
  return path;
}

function drawShape(ctx: CanvasRenderingContext2D, o: ShapeObj): void {
  const path = shapePath(o);
  const closed = o.k === 'rect' || o.k === 'ellipse' || o.k === 'poly';
  ctx.save();
  ctx.globalAlpha = o.o ?? 1;
  if (o.fill && closed) {
    ctx.globalAlpha = (o.o ?? 1) * (o.fo ?? 0.25);
    ctx.fillStyle = o.fill;
    ctx.fill(path);
    ctx.globalAlpha = o.o ?? 1;
  }
  ctx.strokeStyle = o.c;
  ctx.lineWidth = o.w;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash(dashPattern(o));
  ctx.stroke(path);
  ctx.restore();
}

function drawText(ctx: CanvasRenderingContext2D, o0: TextObj): void {
  const o = o0.ls ? o0 : layoutText(o0);
  ctx.save();
  ctx.translate(o.x, o.y);
  if (o.r) ctx.rotate(o.r);
  const h = o.h ?? 0;
  if (o.bg) {
    ctx.fillStyle = o.bg;
    ctx.fillRect(0, 0, o.w, h);
  }
  ctx.font = fontCss(o);
  ctx.fontKerning = 'none';
  ctx.fillStyle = o.c;
  ctx.textBaseline = 'alphabetic';
  const lh = lineHeightOf(o);
  const fake = o.i && !hasRealItalic(o.f);
  const align = o.a ?? 'l';
  const lines = o.ls ?? [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const w = ctx.measureText(line).width;
    const x = align === 'l' ? TEXT_PAD : align === 'c' ? (o.w - w) / 2 : o.w - TEXT_PAD - w;
    const y = TEXT_PAD + i * lh + o.z * ASCENT;
    if (fake) {
      ctx.save();
      ctx.translate(x, y);
      ctx.transform(1, 0, -0.2, 1, 0, 0);
      ctx.fillText(line, 0, 0);
      ctx.restore();
    } else ctx.fillText(line, x, y);
  }
  ctx.restore();
}

/** Sticky-note glyph, also used for the exported /Text annotation. */
export function drawNoteIcon(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, size = NOTE_SIZE): void {
  const s = size / 24;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.lineJoin = 'round';
  // shadow-less flat sticky: body + folded corner + text lines
  ctx.beginPath();
  ctx.moveTo(3, 1.5);
  ctx.lineTo(21, 1.5);
  ctx.quadraticCurveTo(22.5, 1.5, 22.5, 3);
  ctx.lineTo(22.5, 16);
  ctx.lineTo(15, 22.5);
  ctx.lineTo(3, 22.5);
  ctx.quadraticCurveTo(1.5, 22.5, 1.5, 21);
  ctx.lineTo(1.5, 3);
  ctx.quadraticCurveTo(1.5, 1.5, 3, 1.5);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(15, 22.5);
  ctx.lineTo(15, 16);
  ctx.lineTo(22.5, 16);
  ctx.closePath();
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fill();
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.moveTo(5.5, 7);
  ctx.lineTo(18.5, 7);
  ctx.moveTo(5.5, 11);
  ctx.lineTo(18.5, 11);
  ctx.moveTo(5.5, 15);
  ctx.lineTo(11, 15);
  ctx.stroke();
  ctx.restore();
}

function drawImage(ctx: CanvasRenderingContext2D, o: ImageObj): void {
  const img = imageFor(o);
  ctx.save();
  ctx.translate(o.x, o.y);
  if (o.r) ctx.rotate(o.r);
  ctx.globalAlpha = o.o ?? 1;
  if (img) ctx.drawImage(img, 0, 0, o.w, o.h);
  else {
    ctx.fillStyle = 'rgba(128,128,128,0.15)';
    ctx.fillRect(0, 0, o.w, o.h);
  }
  ctx.restore();
}

function drawMark(ctx: CanvasRenderingContext2D, o: MarkObj): void {
  ctx.save();
  ctx.globalAlpha = o.o ?? 1;
  ctx.fillStyle = o.c;
  ctx.strokeStyle = o.c;
  for (let i = 0; i < o.q.length; i += 4) {
    const x = o.q[i], y = o.q[i + 1], w = o.q[i + 2], h = o.q[i + 3];
    if (o.k === 'hl') {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillRect(x, y, w, h);
    } else {
      ctx.lineWidth = Math.max(0.8, h * 0.07);
      ctx.lineCap = 'butt';
      const ly = o.k === 'ul' ? y + h * 0.94 : y + h * 0.55;
      ctx.beginPath();
      ctx.moveTo(x, ly);
      ctx.lineTo(x + w, ly);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawInk(ctx: CanvasRenderingContext2D, o: InkObj): void {
  ctx.save();
  ctx.globalAlpha = o.o ?? 1;
  ctx.fillStyle = o.c;
  if (o.hl) ctx.globalCompositeOperation = 'multiply';
  ctx.fill(inkPath(o));
  ctx.restore();
}

export function drawObj(ctx: CanvasRenderingContext2D, o: AnyObj): void {
  switch (o.t) {
    case 'ink':
      return drawInk(ctx, o);
    case 'shape':
      return drawShape(ctx, o);
    case 'text':
      return drawText(ctx, o);
    case 'note':
      return drawNoteIcon(ctx, (o as NoteObj).x, (o as NoteObj).y, (o as NoteObj).c);
    case 'img':
      return drawImage(ctx, o);
    case 'mark':
      return drawMark(ctx, o);
  }
}

export function drawObjects(ctx: CanvasRenderingContext2D, objs: readonly AnyObj[]): void {
  for (const o of objs) drawObj(ctx, o);
}

/** Outline of a text / image box for selection chrome. */
export function boxOutline(o: TextObj | ImageObj): number[] {
  return boxCorners(o);
}
