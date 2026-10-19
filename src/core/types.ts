// Annotation data model.
//
// Coordinates are "page space": the pdf.js viewport at scale 1 (page rotation
// already applied), origin top-left, y down, unit = PDF point. Objects are
// treated as immutable; every edit produces a new object so that history,
// render caches (WeakMap) and the save pipeline stay trivial.

export type Mat = [number, number, number, number, number, number]; // x' = a·x + c·y + e, y' = b·x + d·y + f

export interface Pt {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type FontId = 'sans' | 'serif' | 'mono' | 'hand';

interface Base {
  id: string;
}

/** Freehand stroke. `p` holds x,y,pressure triples. `hl` marks a highlighter. */
export interface InkObj extends Base {
  t: 'ink';
  c: string;
  w: number;
  hl?: 1;
  o?: number;
  p: number[];
  /** pressure was synthesised from speed (mouse / finger) */
  sim?: 1;
  /** smoothing 0..1 chosen when the stroke was written; missing = 0.5 */
  sm?: number;
}

export type ShapeKind = 'line' | 'arrow' | 'rect' | 'ellipse' | 'poly' | 'polyline';

/**
 * Geometric shape. Everything is point based so that any affine transform
 * (move, scale, rotate) is just a transform of the defining points:
 *  line/arrow/polyline/poly: vertices; rect: 4 corners (clockwise);
 *  ellipse: centre + two semi-axis vectors [cx, cy, ux, uy, vx, vy].
 */
export interface ShapeObj extends Base {
  t: 'shape';
  k: ShapeKind;
  p: number[];
  c: string;
  w: number;
  fill?: string;
  fo?: number;
  /** 0 solid, 1 dashed, 2 dotted */
  dash?: 0 | 1 | 2;
  o?: number;
}

export interface TextObj extends Base {
  t: 'text';
  x: number;
  y: number;
  /** wrap width */
  w: number;
  /** rotation in radians around (x, y) */
  r?: number;
  s: string;
  f: FontId;
  z: number;
  c: string;
  b?: 1;
  i?: 1;
  a?: 'l' | 'c' | 'r';
  bg?: string;
  /** cached layout: lines + total height; recomputed by the renderer */
  ls?: string[];
  h?: number;
}

/** Sticky note → saved as a real PDF /Text annotation as well. */
export interface NoteObj extends Base {
  t: 'note';
  x: number;
  y: number;
  s: string;
  c: string;
}

export interface ImageObj extends Base {
  t: 'img';
  x: number;
  y: number;
  w: number;
  h: number;
  r?: number;
  /** data URL (png / jpeg) */
  src: string;
  o?: number;
}

/** Text markup: highlight / underline / strike-through over line rects. */
export interface MarkObj extends Base {
  t: 'mark';
  k: 'hl' | 'ul' | 'st';
  /** x,y,w,h quads */
  q: number[];
  c: string;
  o?: number;
}

export type AnyObj = InkObj | ShapeObj | TextObj | NoteObj | ImageObj | MarkObj;

/** Everything that is drawn on the multiply layer (below normal ink). */
export function isHighlight(o: AnyObj): boolean {
  return (o.t === 'ink' && !!o.hl) || (o.t === 'mark' && o.k === 'hl');
}

export interface PageInfo {
  /** width / height in pt after rotation */
  w: number;
  h: number;
}

export type ToolId =
  | 'select'
  | 'pen'
  | 'highlighter'
  | 'eraser'
  | 'lasso'
  | 'text'
  | 'shape'
  | 'note'
  | 'image';

export type ShapeTool = 'line' | 'arrow' | 'rect' | 'ellipse' | 'poly' | 'polyline';

export type SnapMode = 'off' | 'hold' | 'auto';

/** A favourite / current pen configuration. */
export interface Preset {
  id: string;
  tool: 'pen' | 'highlighter';
  color: string;
  width: number;
  opacity?: number;
}
