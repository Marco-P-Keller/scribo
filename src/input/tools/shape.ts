import type { ShapeObj } from '../../core/types';
import { uid } from '../../core/objects';
import { dist } from '../../core/geometry';
import { ellipsePoints, rectPoints } from '../../core/shapes';
import { drawObj } from '../../render/draw';
import { settings } from '../../app/settings';
import type { PageView } from '../../viewer/pageview';
import type { EditorApi, Tool, ToolEvent } from '../types';

/** Lines, arrows, rectangles, ellipses (drag) and polygons / polylines (click points). */
export class ShapeTool implements Tool {
  readonly id = 'shape' as const;
  readonly cursor = 'crosshair';

  private page: PageView | null = null;
  private a = { x: 0, y: 0 };
  private b = { x: 0, y: 0 };
  private verts: number[] = [];
  private hoverPt: { x: number; y: number } | null = null;
  private dragging = false;
  private lastClick = { t: 0, x: 0, y: 0 };
  private raf = 0;

  constructor(private ed: EditorApi) {}

  ring(): number | null {
    return null;
  }

  private kind() {
    return settings.get('shape').kind;
  }

  private isPoly(): boolean {
    const k = this.kind();
    return k === 'poly' || k === 'polyline';
  }

  private make(points: number[]): ShapeObj {
    const st = settings.get('shape');
    const k = this.kind();
    const o: ShapeObj = { id: uid(), t: 'shape', k, p: points, c: st.color, w: st.width };
    if (st.dash) o.dash = st.dash;
    if (st.fill && (k === 'rect' || k === 'ellipse' || k === 'poly')) {
      o.fill = st.fill;
      o.fo = st.fillOpacity;
    }
    return o;
  }

  private geometry(shift: boolean, alt: boolean): number[] {
    let { x: x1, y: y1 } = this.b;
    const { x: x0, y: y0 } = this.a;
    const k = this.kind();
    if (shift) {
      if (k === 'line' || k === 'arrow') {
        const ang = Math.atan2(y1 - y0, x1 - x0);
        const snap = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
        const len = dist(x0, y0, x1, y1);
        x1 = x0 + Math.cos(snap) * len;
        y1 = y0 + Math.sin(snap) * len;
      } else {
        const d = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
        x1 = x0 + Math.sign(x1 - x0 || 1) * d;
        y1 = y0 + Math.sign(y1 - y0 || 1) * d;
      }
    }
    if (alt && (k === 'rect' || k === 'ellipse')) {
      return k === 'rect' ? rectPoints(x0 - (x1 - x0), y0 - (y1 - y0), x1, y1) : ellipsePoints(x0 - (x1 - x0), y0 - (y1 - y0), x1, y1);
    }
    if (k === 'rect') return rectPoints(x0, y0, x1, y1);
    if (k === 'ellipse') return ellipsePoints(x0, y0, x1, y1);
    return [x0, y0, x1, y1];
  }

  hover(e: ToolEvent): void {
    if (!this.page || !this.isPoly() || !this.verts.length || e.page !== this.page) return;
    this.hoverPt = { x: e.x, y: e.y };
    this.schedule();
  }

  down(e: ToolEvent): boolean {
    if (!e.page) return false;
    this.ed.selection.clear();
    if (this.page && this.page !== e.page) this.finishPoly(false);
    this.page = e.page;
    e.page.syncScale();
    e.page.liveCtx();
    this.a = { x: e.x, y: e.y };
    this.b = { x: e.x, y: e.y };
    this.dragging = true;
    if (this.isPoly()) {
      const fast = e.time - this.lastClick.t < 380 && dist(e.clientX, e.clientY, this.lastClick.x, this.lastClick.y) < 8;
      const first = this.verts.length >= 4 && dist(e.x, e.y, this.verts[0], this.verts[1]) < 10 / e.page.bitmapScale;
      if (fast && this.verts.length >= 4) {
        this.finishPoly(true);
        return true;
      }
      if (first && this.kind() === 'poly') {
        this.finishPoly(true);
        return true;
      }
      this.verts.push(e.x, e.y);
      this.lastClick = { t: e.time, x: e.clientX, y: e.clientY };
    }
    this.schedule();
    return true;
  }

  move(e: ToolEvent): void {
    this.b = { x: e.x, y: e.y };
    if (this.isPoly()) this.hoverPt = { x: e.x, y: e.y };
    this.shift = e.shift;
    this.alt = e.alt;
    this.schedule();
  }

  private shift = false;
  private alt = false;

  up(e: ToolEvent): void {
    this.dragging = false;
    if (this.isPoly()) {
      this.schedule();
      return;
    }
    const page = this.page;
    if (!page) return;
    this.b = { x: e.x, y: e.y };
    const len = dist(this.a.x, this.a.y, this.b.x, this.b.y) * page.bitmapScale;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    page.clearLive();
    this.page = null;
    if (len < 4) return;
    const obj = this.make(this.geometry(e.shift, e.alt));
    this.ed.model.add('Form', page.index, obj);
    this.ed.selection.set(page, [obj.id]);
  }

  /** Enter / double click: complete the polygon in progress. */
  finishPoly(commit: boolean): void {
    const page = this.page;
    if (!page || !this.isPoly()) return;
    const v = this.verts;
    this.verts = [];
    this.hoverPt = null;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    page.clearLive();
    this.page = null;
    if (!commit || v.length < 4) return;
    const obj = this.make(v);
    this.ed.model.add('Form', page.index, obj);
    this.ed.selection.set(page, [obj.id]);
  }

  /** called by the editor for Enter / Escape */
  finish(): void {
    this.finishPoly(true);
  }

  cancel(): void {
    this.dragging = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (!this.isPoly()) {
      this.page?.clearLive();
      this.page = null;
    }
  }

  deactivate(): void {
    this.verts = [];
    this.page?.clearLive();
    this.page = null;
  }

  private schedule(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render();
    });
  }

  private render(): void {
    const page = this.page;
    if (!page) return;
    const ctx = page.liveCtx();
    page.clearLive();
    if (this.isPoly()) {
      const pts = this.verts.slice();
      if (this.hoverPt) pts.push(this.hoverPt.x, this.hoverPt.y);
      if (pts.length >= 4) drawObj(ctx, this.make(pts));
      return;
    }
    if (!this.dragging) return;
    drawObj(ctx, this.make(this.geometry(this.shift, this.alt)));
  }
}
