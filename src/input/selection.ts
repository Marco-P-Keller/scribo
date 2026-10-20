import type { AnyObj, InkObj, Mat, Rect, ShapeObj, TextObj } from '../core/types';
import { Emitter } from '../core/emitter';
import type { AnnotationModel, Patch } from '../core/model';
import { clamp, dist, mul, rotateM, scaleM, translateM } from '../core/geometry';
import { boundsOfAll, clone, isTransformable, recolor, rewidth, transformObj } from '../core/objects';
import { resmooth } from '../core/ink';
import type { SmoothOptions } from '../core/smooth';
import { drawObjects } from '../render/draw';
import { layoutText } from '../render/textlayout';
import { ACCENT, accentAlpha } from '../render/accent';
import type { PageView } from '../viewer/pageview';
import type { Viewer } from '../viewer/viewer';

export type HandleId = 'move' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate' | `v${number}`;

interface Drag {
  handle: HandleId;
  start: { x: number; y: number };
  box: Rect;
  objs: AnyObj[];
  /** current transform (move / scale / rotate) */
  m: Mat;
  /** replacement objects for modes that can't be expressed as a matrix (vertex, text width) */
  custom: AnyObj[] | null;
  moved: boolean;
  /** last pointer position (client px) of a move; drives edge scrolling and dropping on another page */
  client: { x: number; y: number } | null;
  mods: { shift?: boolean; alt?: boolean };
  /** the other page the objects would be dropped on (pointer over it), else null */
  target: PageView | null;
}

/** css px from the top / bottom edge of the document area where a move starts scrolling */
const EDGE = 44;


export interface SelectionEvents extends Record<string, unknown> {
  change: undefined;
}

/**
 * The current selection (always on one page) with its move / scale / rotate /
 * vertex handles and the clipboard-style commands acting on it.
 */
export class Selection extends Emitter<SelectionEvents> {
  page: PageView | null = null;
  ids: string[] = [];
  private drag: Drag | null = null;

  constructor(private model: AnnotationModel, private viewer: Viewer) {
    super();
  }

  get active(): boolean {
    return !!this.page && this.ids.length > 0;
  }

  get dragging(): boolean {
    return !!this.drag?.moved;
  }

  objects(): AnyObj[] {
    if (!this.page) return [];
    const list = this.model.pages[this.page.index] ?? [];
    const set = new Set(this.ids);
    return list.filter((o) => set.has(o.id));
  }

  set(page: PageView, ids: string[]): void {
    if (this.page && this.page !== page) this.erase();
    this.page = page;
    this.ids = ids;
    this.draw();
    this.emit('change', undefined);
  }

  clear(): void {
    if (!this.page && !this.ids.length) return;
    this.stopEdgeScroll();
    this.clearDrop();
    this.erase();
    this.page = null;
    this.ids = [];
    this.drag = null;
    this.emit('change', undefined);
  }

  /**
   * Pages far from the viewport are torn down and rebuilt when they come back. Follow the
   * selection to the page's current view and repaint the chrome (also after zoom / re-render).
   */
  relink(): void {
    if (!this.page) return;
    const v = this.viewer.viewFor(this.page.index);
    if (!v) return;
    if (v !== this.page) {
      this.page = v;
      // a move scrolled the page out of view and back: keep carrying the objects
      if (this.drag?.handle === 'move') {
        v.hidden = new Set(this.ids);
        v.redrawAnnotations();
      } else this.drag = null;
    }
    if (!this.drag?.moved) this.draw();
  }

  /** drop selection ids that no longer exist (after undo / delete) and refresh the chrome */
  refresh(): void {
    if (!this.page) return;
    const live = new Set((this.model.pages[this.page.index] ?? []).map((o) => o.id));
    const ids = this.ids.filter((id) => live.has(id));
    if (!ids.length) this.clear();
    else {
      this.ids = ids;
      this.draw();
      this.emit('change', undefined);
    }
  }

  private erase(): void {
    if (this.page) {
      this.page.hidden.clear();
      this.page.clearLive();
      this.page.redrawAnnotations();
    }
  }

  // ── geometry ──────────────────────────────────────────────────────────

  /** Selection bounds in page space. */
  bounds(): Rect | null {
    return boundsOfAll(this.drag?.objs ?? this.objects());
  }

  /** "Vertex mode": a single line / arrow / polygon is edited by its end points. */
  private vertexShape(): ShapeObj | null {
    const objs = this.objects();
    if (objs.length !== 1) return null;
    const o = objs[0];
    if (o.t === 'shape' && ['line', 'arrow', 'polyline', 'poly'].includes(o.k)) return o;
    return null;
  }

  private singleText(): TextObj | null {
    const objs = this.objects();
    return objs.length === 1 && objs[0].t === 'text' ? objs[0] : null;
  }

  canTransform(): boolean {
    return this.objects().some(isTransformable);
  }

  private handles(box: Rect): { id: HandleId; x: number; y: number }[] {
    const s = this.page?.bitmapScale ?? this.viewer.scale;
    const pad = 5 / s;
    const x0 = box.x - pad, y0 = box.y - pad, x1 = box.x + box.w + pad, y1 = box.y + box.h + pad;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const out: { id: HandleId; x: number; y: number }[] = [
      { id: 'nw', x: x0, y: y0 }, { id: 'ne', x: x1, y: y0 }, { id: 'se', x: x1, y: y1 }, { id: 'sw', x: x0, y: y1 },
      { id: 'n', x: cx, y: y0 }, { id: 'e', x: x1, y: cy }, { id: 's', x: cx, y: y1 }, { id: 'w', x: x0, y: cy },
      { id: 'rotate', x: cx, y: y0 - 28 / s },
    ];
    return out;
  }

  /** Which handle (if any) is at page-space point (x, y)? `move` = inside the body. */
  hit(x: number, y: number, touch = false): HandleId | null {
    if (!this.active) return null;
    const s = this.page!.bitmapScale;
    const tol = (touch ? 20 : 11) / s;
    const v = this.vertexShape();
    if (v) {
      for (let i = 0; i < v.p.length / 2; i++) if (dist(x, y, v.p[2 * i], v.p[2 * i + 1]) <= tol) return `v${i}`;
    } else if (this.canTransform()) {
      const box = this.bounds();
      if (box) {
        const handles = this.handles(box);
        // corners / rotate first, then edges
        for (const h of handles) if (dist(x, y, h.x, h.y) <= tol) return h.id;
      }
    }
    const box = this.bounds();
    if (box) {
      const pad = 6 / s;
      if (x >= box.x - pad && x <= box.x + box.w + pad && y >= box.y - pad && y <= box.y + box.h + pad) return 'move';
    }
    return null;
  }

  cursorFor(handle: HandleId | null): string {
    switch (handle) {
      case 'move': return 'move';
      case 'nw': case 'se': return 'nwse-resize';
      case 'ne': case 'sw': return 'nesw-resize';
      case 'n': case 's': return 'ns-resize';
      case 'e': case 'w': return 'ew-resize';
      case 'rotate': return 'grab';
      case null: return '';
      default: return 'crosshair';
    }
  }

  // ── interaction ───────────────────────────────────────────────────────

  begin(handle: HandleId, x: number, y: number): void {
    if (!this.page) return;
    const objs = this.objects();
    const box = boundsOfAll(objs);
    if (!box) return;
    this.drag = { handle, start: { x, y }, box, objs, m: [1, 0, 0, 1, 0, 0], custom: null, moved: false, client: null, mods: {}, target: null };
    this.page.syncScale();
    this.page.hidden = new Set(this.ids);
    this.page.redrawAnnotations();
    this.draw();
  }

  /**
   * `client` (the pointer in client px) lets a move scroll at the edges of the document area and
   * carry the objects onto another page; the page-space point is then taken from it.
   */
  update(x: number, y: number, mods: { shift?: boolean; alt?: boolean } = {}, client?: { x: number; y: number }): void {
    const d = this.drag;
    if (!d || !this.page) return;
    d.mods = mods;
    if (client && d.handle === 'move') {
      // the stage may have scrolled since the drag started: convert afresh
      ({ x, y } = this.viewer.clientToPageAt(this.page.index, client.x, client.y));
      d.client = client;
      const over = this.viewer.pageAtClient(client.x, client.y, 0);
      d.target = over && over.index !== this.page.index ? over : null;
      this.edgeScroll();
    }
    const dx = x - d.start.x;
    const dy = y - d.start.y;
    if (!d.moved && Math.hypot(dx, dy) * this.page.bitmapScale < 2.5) return;
    d.moved = true;
    d.custom = null;
    const { box } = d;

    if (d.handle === 'move') {
      let tx = dx, ty = dy;
      if (mods.shift) {
        if (Math.abs(dx) > Math.abs(dy)) ty = 0;
        else tx = 0;
      }
      d.m = translateM(tx, ty);
    } else if (d.handle === 'rotate') {
      const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
      let a = Math.atan2(y - cy, x - cx) - Math.atan2(d.start.y - cy, d.start.x - cx);
      const step = Math.PI / 12;
      const snapped = Math.round(a / step) * step;
      if (mods.shift || Math.abs(a - snapped) < (3 * Math.PI) / 180) a = snapped;
      d.m = rotateM(a, cx, cy);
    } else if (d.handle.startsWith('v')) {
      const o = d.objs[0] as ShapeObj;
      const i = Number(d.handle.slice(1));
      const p = o.p.slice();
      let nx = x, ny = y;
      // 45° snapping against the neighbouring vertex for lines
      if (o.k === 'line' || o.k === 'arrow') {
        const j = i === 0 ? 1 : 0;
        const ox = p[2 * j], oy = p[2 * j + 1];
        const ang = Math.atan2(y - oy, x - ox);
        const len = dist(ox, oy, x, y);
        const step = Math.PI / 4;
        const snap = Math.round(ang / step) * step;
        if (mods.shift || Math.abs(ang - snap) < (3.5 * Math.PI) / 180) {
          nx = ox + Math.cos(snap) * len;
          ny = oy + Math.sin(snap) * len;
        }
      }
      p[2 * i] = nx;
      p[2 * i + 1] = ny;
      d.custom = [{ ...o, p }];
    } else {
      // scale handles
      const h = d.handle;
      const west = h.includes('w'), east = h.includes('e'), north = h.includes('n'), south = h.includes('s');
      const ax = west ? box.x + box.w : east ? box.x : box.x + box.w / 2;
      const ay = north ? box.y + box.h : south ? box.y : box.y + box.h / 2;
      const hx = west ? box.x : east ? box.x + box.w : null;
      const hy = north ? box.y : south ? box.y + box.h : null;
      let sx = hx === null ? 1 : (x - ax) / (hx - ax || 1);
      let sy = hy === null ? 1 : (y - ay) / (hy - ay || 1);
      const corner = hx !== null && hy !== null;
      const single = this.singleText();
      if (single && !corner && hx !== null) {
        // text: edge handles change the wrap width, not the font size
        sx = Math.max(0.1, sx);
        const w = Math.max(24, single.w * sx);
        const nx = west ? single.x + single.w - w : single.x;
        d.custom = [layoutText({ ...single, x: nx, w })];
      } else {
        if (corner) {
          const k = Math.max(Math.abs(sx), Math.abs(sy));
          sx = k;
          sy = k;
        }
        sx = clamp(sx, 0.05, 40);
        sy = clamp(sy, 0.05, 40);
        d.m = scaleM(sx, sy, ax, ay);
      }
    }
    this.draw();
  }

  /** Finish the drag; returns true if the document changed. */
  end(): boolean {
    const d = this.drag;
    const page = this.page;
    this.drag = null;
    this.stopEdgeScroll();
    this.clearDrop();
    if (!d || !page) return false;
    page.hidden.clear();
    if (d.moved && d.handle === 'move' && d.target) {
      this.moveToPage(page, d.target, d.m);
      return true;
    }
    if (!d.moved) {
      page.redrawAnnotations();
      this.draw();
      return false;
    }
    let result: AnyObj[];
    let label = 'Verschieben';
    if (d.custom) {
      result = d.custom;
      label = d.handle.startsWith('v') ? 'Form bearbeiten' : 'Größe ändern';
    } else {
      result = d.objs.map((o) => (isTransformable(o) || d.handle === 'move' ? transformObj(o, d.m) : o));
      result = result.map((o) => (o.t === 'text' ? layoutText(o) : o));
      label = d.handle === 'move' ? 'Verschieben' : d.handle === 'rotate' ? 'Drehen' : 'Größe ändern';
    }
    this.model.replace(label, page.index, result);
    this.draw();
    return true;
  }

  /** Drop the selection on another page: one undo step that removes it here and adds it there. */
  private moveToPage(from: PageView, to: PageView, m: Mat): void {
    const off = this.viewer.pageOffset(from.index, to.index);
    const shift = mul(translateM(off.x, off.y), m);
    const list = this.model.pages[from.index] ?? [];
    const dest = this.model.pages[to.index];
    if (!dest) return;
    const set = new Set(this.ids);
    const patches: Patch[] = [];
    const moved: AnyObj[] = [];
    // removals from the back so that undo re-inserts every object at its old z position
    for (let i = list.length - 1; i >= 0; i--) {
      if (set.has(list[i].id)) patches.push({ page: from.index, id: list[i].id, before: list[i], after: null, index: i });
    }
    for (const o of list) {
      if (!set.has(o.id)) continue;
      const n = transformObj(o, shift);
      moved.push(n.t === 'text' ? layoutText(n) : n);
    }
    moved.forEach((o, i) => patches.push({ page: to.index, id: o.id, before: null, after: o, index: dest.length + i }));
    from.clearLive();
    from.redrawAnnotations();
    // follow the objects first: the model change prunes selection ids that aren't on the selection's page
    this.page = to;
    this.ids = moved.map((o) => o.id);
    this.model.commit('Auf andere Seite verschieben', patches);
    this.draw();
    this.emit('change', undefined);
  }

  // ── moving across pages ───────────────────────────────────────────────

  /** the page that shows the objects being carried onto it */
  private dropPage: PageView | null = null;
  private scrollRaf = 0;

  private clearDrop(): void {
    this.dropPage?.clearLive();
    this.dropPage = null;
  }

  /** Scroll while a move is held near the top or bottom edge, so objects can travel to pages out of view. */
  private edgeScroll(): void {
    if (this.scrollRaf) return;
    const speed = this.edgeSpeed();
    if (!speed) return;
    this.scrollRaf = requestAnimationFrame(() => {
      this.scrollRaf = 0;
      const d = this.drag;
      const v = this.edgeSpeed();
      if (!d?.client || !v) return;
      this.viewer.stage.scrollTop += v;
      // the page under a still pointer changed: same client point, new page-space point
      this.update(d.start.x, d.start.y, d.mods, d.client);
    });
  }

  private edgeSpeed(): number {
    const c = this.drag?.client;
    if (!c) return 0;
    const r = this.viewer.stage.getBoundingClientRect();
    const into = c.y < r.top + EDGE ? c.y - (r.top + EDGE) : c.y > r.bottom - EDGE ? c.y - (r.bottom - EDGE) : 0;
    if (!into) return 0;
    return Math.sign(into) * Math.min(26, 3 + Math.abs(into) * 0.4);
  }

  private stopEdgeScroll(): void {
    cancelAnimationFrame(this.scrollRaf);
    this.scrollRaf = 0;
  }

  // ── chrome ────────────────────────────────────────────────────────────

  draw(): void {
    const page = this.page;
    if (!page || !page.rendered) return;
    page.clearLive();
    const d = this.drag;
    const target = d?.moved && d.handle === 'move' ? d.target : null;
    if (this.dropPage && this.dropPage !== target) this.clearDrop();
    if (!this.ids.length) return;
    const ctxP = page.liveCtx();
    // lifted objects under the live transform
    if (d && d.moved) {
      ctxP.save();
      if (d.custom) drawObjects(ctxP, d.custom);
      else {
        ctxP.transform(...d.m);
        drawObjects(ctxP, d.objs.map((o) => o));
      }
      ctxP.restore();
    }
    if (target && d) {
      // carried over another page: show them there too, with the selection frame
      const off = this.viewer.pageOffset(page.index, target.index);
      const m = mul(translateM(off.x, off.y), d.m);
      const ctxT = target.liveCtx();
      target.clearLive();
      ctxT.save();
      ctxT.transform(...m);
      drawObjects(ctxT, d.objs);
      ctxT.restore();
      this.dropPage = target;
      this.chrome(target, d.objs.map((o) => transformObj(o, m)), false);
      return;
    }
    const objs = d?.moved ? (d.custom ?? d.objs.map((o) => transformObj(o, d.m))) : this.objects();
    this.chrome(page, objs, !(d && d.moved));
  }

  /** Selection frame, handles or vertex knobs around `objs` on `page`'s live layer. */
  private chrome(page: PageView, objs: AnyObj[], handles: boolean): void {
    const s = page.bitmapScale;
    const ctx = page.liveScreenCtx();
    const vshape = this.vertexShape();
    if (!objs.length) return;
    const bb = boundsOfAll(objs);
    if (!bb) return;
    ctx.save();
    ctx.lineJoin = 'round';
    const px = (v: number) => v * s;

    if (vshape) {
      const o = (objs[0] as ShapeObj);
      // outline + vertex handles
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      for (let i = 0; i < o.p.length; i += 2) ctx[i ? 'lineTo' : 'moveTo'](px(o.p[i]), px(o.p[i + 1]));
      if (o.k === 'poly') ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      for (let i = 0; i < o.p.length; i += 2) this.knob(ctx, px(o.p[i]), px(o.p[i + 1]), 6);
    } else {
      const pad = 5;
      const x = px(bb.x) - pad, y = px(bb.y) - pad, w = px(bb.w) + 2 * pad, h = px(bb.h) + 2 * pad;
      ctx.fillStyle = accentAlpha(0.06);
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1.25;
      this.roundRect(ctx, x, y, w, h, 4);
      ctx.fill();
      ctx.stroke();
      if (handles && this.canTransform()) {
        const hs = this.handles({ x: bb.x, y: bb.y, w: bb.w, h: bb.h });
        const rot = hs.find((q) => q.id === 'rotate')!;
        ctx.beginPath();
        ctx.moveTo(px((bb.x + bb.w / 2)), y);
        ctx.lineTo(px(rot.x), px(rot.y));
        ctx.stroke();
        for (const hnd of hs) {
          if (hnd.id === 'rotate') this.knob(ctx, px(hnd.x), px(hnd.y), 7, true);
          else this.knob(ctx, px(hnd.x), px(hnd.y), hnd.id.length === 2 ? 6 : 4.5);
        }
      }
    }
    ctx.restore();
  }

  private knob(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, accent = false): void {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.28)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 1;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = accent ? ACCENT : '#fff';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = ACCENT;
    ctx.stroke();
    if (accent) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(x, y, r * 0.5, -0.4, Math.PI * 1.35);
      ctx.stroke();
    }
    ctx.restore();
  }

  private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  }

  /** Screen rectangle (client px) of the selection, for floating menus. */
  clientBounds(): { x: number; y: number; w: number; h: number } | null {
    if (!this.page) return null;
    const b = boundsOfAll(this.objects());
    if (!b) return null;
    const a = this.page.pageToClient(b.x, b.y);
    const c = this.page.pageToClient(b.x + b.w, b.y + b.h);
    return { x: a.x, y: a.y, w: c.x - a.x, h: c.y - a.y };
  }

  // ── commands ──────────────────────────────────────────────────────────

  delete(): void {
    if (!this.active) return;
    const page = this.page!.index;
    const ids = this.ids.slice();
    this.clear();
    this.model.remove('Löschen', page, ids);
  }

  duplicate(offset = 14): void {
    if (!this.active) return;
    const page = this.page!;
    const copies = this.objects().map((o) => clone(o, offset, offset));
    this.model.add('Duplizieren', page.index, ...copies);
    this.set(page, copies.map((c) => c.id));
  }

  recolor(color: string): void {
    if (!this.active) return;
    this.model.replace('Farbe ändern', this.page!.index, this.objects().map((o) => recolor(o, color)));
    this.draw();
  }

  /** Smooth the selected ink strokes once more (one undo step); other objects stay as they are. */
  smooth(opts: SmoothOptions): void {
    if (!this.active) return;
    const ink = this.objects().filter((o): o is InkObj => o.t === 'ink');
    if (!ink.length) return;
    this.model.replace('Glätten', this.page!.index, ink.map((o) => resmooth(o, opts)));
    this.draw();
  }

  rewidth(w: number): void {
    if (!this.active) return;
    this.model.replace('Stärke ändern', this.page!.index, this.objects().map((o) => rewidth(o, w)));
    this.draw();
  }

  /** Reorder within the page: bring to front or send to back (one undo step). */
  arrange(front: boolean): void {
    if (!this.active) return;
    const page = this.page!;
    const list = this.model.pages[page.index];
    const moving = this.objects();
    const patches: Patch[] = [];
    for (let i = list.length - 1; i >= 0; i--) {
      if (this.ids.includes(list[i].id)) patches.push({ page: page.index, id: list[i].id, before: list[i], after: null, index: i });
    }
    const rest = list.length - moving.length;
    moving.forEach((o, i) => patches.push({ page: page.index, id: o.id, before: null, after: o, index: front ? rest + i : i }));
    this.model.commit(front ? 'Nach vorne' : 'Nach hinten', patches);
    this.set(page, moving.map((o) => o.id));
  }

  /** Select all objects on a page. */
  selectAll(page: PageView): void {
    const ids = (this.model.pages[page.index] ?? []).map((o) => o.id);
    if (ids.length) this.set(page, ids);
  }

  /** Bounds helper for clipboard paste placement. */
  static boundsOf(objs: AnyObj[]): Rect | null {
    return boundsOfAll(objs);
  }
}
