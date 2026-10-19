import type { AnyObj, FontId, ImageObj, InkObj, MarkObj, NoteObj, ShapeObj, TextObj } from './types';

// The editable annotation layer is stored inside the PDF as an embedded file
// ("scribo-notes.json"). The baked appearance (visible in every viewer) is
// written separately by the export code. Files come from the outside world, so
// decoding validates everything instead of trusting it.

export const NOTES_FILENAME = 'scribo-notes.json';
export const FORMAT_VERSION = 1;

export interface PageNotes {
  w: number;
  h: number;
  objs: AnyObj[];
}

export interface NotesFile {
  v: number;
  app: 'Scribo';
  pageCount: number;
  pages: Record<string, PageNotes>;
}

// ── encoding ─────────────────────────────────────────────────────────────

/** Ink points are delta-encoded integers (1/100 pt) – compresses far better than floats. */
function packInk(o: InkObj): Record<string, unknown> {
  const d: number[] = [];
  let lx = 0, ly = 0, lp = 0;
  for (let i = 0; i < o.p.length; i += 3) {
    const x = Math.round(o.p[i] * 100);
    const y = Math.round(o.p[i + 1] * 100);
    const p = Math.round(o.p[i + 2] * 100);
    d.push(x - lx, y - ly, p - lp);
    lx = x; ly = y; lp = p;
  }
  const { p: _p, ...rest } = o;
  return { ...rest, d };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function packObj(o: AnyObj): Record<string, unknown> {
  switch (o.t) {
    case 'ink':
      return packInk(o);
    case 'shape':
      return { ...o, p: o.p.map(round2) };
    case 'text': {
      const { ls: _ls, h: _h, ...rest } = o; // layout is recomputed on load
      return { ...rest, x: round2(o.x), y: round2(o.y), w: round2(o.w) };
    }
    default:
      return { ...o };
  }
}

export function encodeNotes(pages: AnyObj[][], sizes: { w: number; h: number }[]): Uint8Array {
  const out: NotesFile = { v: FORMAT_VERSION, app: 'Scribo', pageCount: pages.length, pages: {} };
  pages.forEach((objs, i) => {
    if (!objs.length) return;
    out.pages[String(i)] = { w: round2(sizes[i]?.w ?? 0), h: round2(sizes[i]?.h ?? 0), objs: objs.map(packObj) as unknown as AnyObj[] };
  });
  return new TextEncoder().encode(JSON.stringify(out));
}

// ── decoding / validation ────────────────────────────────────────────────

const COLOR = /^#[0-9a-fA-F]{6}$/;
const IMG = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const FONTS: FontId[] = ['sans', 'serif', 'mono', 'hand'];

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const col = (v: unknown, d: string): string => (typeof v === 'string' && COLOR.test(v) ? v : d);
const str = (v: unknown, max = 20000): string => (typeof v === 'string' ? v.slice(0, max) : '');
const nums = (v: unknown, min = 0, max = 1_000_000): number[] | null => {
  if (!Array.isArray(v) || v.length < min || v.length > max) return null;
  const out = new Array<number>(v.length);
  for (let i = 0; i < v.length; i++) {
    if (typeof v[i] !== 'number' || !Number.isFinite(v[i])) return null;
    out[i] = v[i] as number;
  }
  return out;
};
const optNum = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function unpackInk(r: Record<string, unknown>): InkObj | null {
  let p: number[] | null = null;
  const d = nums(r.d, 3);
  if (d && d.length % 3 === 0) {
    p = new Array<number>(d.length);
    let x = 0, y = 0, q = 0;
    for (let i = 0; i < d.length; i += 3) {
      x += d[i]; y += d[i + 1]; q += d[i + 2];
      p[i] = x / 100; p[i + 1] = y / 100; p[i + 2] = Math.min(1, Math.max(0, q / 100));
    }
  } else {
    const raw = nums(r.p, 3);
    if (raw && raw.length % 3 === 0) p = raw;
  }
  if (!p) return null;
  const o: InkObj = { id: str(r.id, 40) || 'x', t: 'ink', c: col(r.c, '#000000'), w: Math.min(200, Math.max(0.1, num(r.w, 2))), p };
  if (r.hl) o.hl = 1;
  if (r.sim) o.sim = 1;
  const sm = optNum(r.sm);
  if (sm !== undefined) o.sm = Math.min(1, Math.max(0, sm));
  const op = optNum(r.o);
  if (op !== undefined) o.o = Math.min(1, Math.max(0, op));
  return o;
}

function unpackObj(r: unknown): AnyObj | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  const id = str(o.id, 40) || Math.random().toString(36).slice(2);
  switch (o.t) {
    case 'ink':
      return unpackInk(o);
    case 'shape': {
      const kinds = ['line', 'arrow', 'rect', 'ellipse', 'poly', 'polyline'];
      if (typeof o.k !== 'string' || !kinds.includes(o.k)) return null;
      const p = nums(o.p, 4, 5000);
      if (!p) return null;
      if ((o.k === 'ellipse' && p.length !== 6) || (o.k === 'rect' && p.length !== 8) || p.length % 2) return null;
      const s: ShapeObj = { id, t: 'shape', k: o.k as ShapeObj['k'], p, c: col(o.c, '#000000'), w: Math.min(200, Math.max(0.1, num(o.w, 2))) };
      if (typeof o.fill === 'string' && COLOR.test(o.fill)) s.fill = o.fill;
      const fo = optNum(o.fo);
      if (fo !== undefined) s.fo = Math.min(1, Math.max(0, fo));
      if (o.dash === 1 || o.dash === 2) s.dash = o.dash;
      const op = optNum(o.o);
      if (op !== undefined) s.o = Math.min(1, Math.max(0, op));
      return s;
    }
    case 'text': {
      const t: TextObj = {
        id, t: 'text', x: num(o.x), y: num(o.y), w: Math.max(8, num(o.w, 200)), s: str(o.s),
        f: FONTS.includes(o.f as FontId) ? (o.f as FontId) : 'sans', z: Math.min(400, Math.max(4, num(o.z, 14))), c: col(o.c, '#000000'),
      };
      if (o.b) t.b = 1;
      if (o.i) t.i = 1;
      if (o.a === 'c' || o.a === 'r') t.a = o.a;
      if (typeof o.bg === 'string' && COLOR.test(o.bg)) t.bg = o.bg;
      const r2 = optNum(o.r);
      if (r2) t.r = r2;
      return t;
    }
    case 'note':
      return { id, t: 'note', x: num(o.x), y: num(o.y), s: str(o.s), c: col(o.c, '#ffd60a') } satisfies NoteObj;
    case 'img': {
      if (typeof o.src !== 'string' || !IMG.test(o.src)) return null;
      const img: ImageObj = { id, t: 'img', x: num(o.x), y: num(o.y), w: Math.max(2, num(o.w, 100)), h: Math.max(2, num(o.h, 100)), src: o.src };
      const r2 = optNum(o.r);
      if (r2) img.r = r2;
      const op = optNum(o.o);
      if (op !== undefined) img.o = Math.min(1, Math.max(0, op));
      return img;
    }
    case 'mark': {
      const q = nums(o.q, 4, 20000);
      if (!q || q.length % 4 || !['hl', 'ul', 'st'].includes(o.k as string)) return null;
      const m: MarkObj = { id, t: 'mark', k: o.k as MarkObj['k'], q, c: col(o.c, '#ffe14d') };
      const op = optNum(o.o);
      if (op !== undefined) m.o = Math.min(1, Math.max(0, op));
      return m;
    }
  }
  return null;
}

export function decodeNotes(bytes: Uint8Array): NotesFile | null {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (!json || typeof json !== 'object') return null;
  const j = json as Record<string, unknown>;
  if (j.app !== 'Scribo' || typeof j.v !== 'number' || j.v > FORMAT_VERSION) return null;
  const pages: Record<string, PageNotes> = {};
  const src = (j.pages ?? {}) as Record<string, { w?: unknown; h?: unknown; objs?: unknown }>;
  for (const key of Object.keys(src)) {
    if (!/^\d+$/.test(key)) continue;
    const pg = src[key];
    const objs: AnyObj[] = [];
    if (Array.isArray(pg.objs)) {
      for (const r of pg.objs) {
        const o = unpackObj(r);
        if (o) objs.push(o);
      }
    }
    pages[key] = { w: num(pg.w), h: num(pg.h), objs };
  }
  return { v: j.v, app: 'Scribo', pageCount: num(j.pageCount), pages };
}
