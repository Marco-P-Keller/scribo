import { objectsInPolygon, hitTest } from '../../core/objects';
import { boundsOfPoints } from '../../core/geometry';
import type { PageView } from '../../viewer/pageview';
import type { EditorApi, Tool, ToolEvent } from '../types';
import { ACCENT, accentAlpha } from '../../render/accent';


/**
 * Freehand lasso. Selects everything that is (mostly) inside the loop. While a selection
 * exists, dragging inside it moves it and the handles scale / rotate it; anywhere else
 * starts a new lasso.
 */
export class LassoTool implements Tool {
  readonly id = 'lasso' as const;
  cursor = 'crosshair';

  private page: PageView | null = null;
  private path: number[] = [];
  private mode: 'lasso' | 'drag' | null = null;
  private raf = 0;
  private tapObj: string | null = null;

  constructor(private ed: EditorApi) {}

  ring(): number | null {
    return null;
  }

  hover(e: ToolEvent): void {
    const sel = this.ed.selection;
    if (sel.active && e.page === sel.page) this.cursor = sel.cursorFor(sel.hit(e.x, e.y)) || 'crosshair';
    else this.cursor = 'crosshair';
  }

  down(e: ToolEvent): boolean {
    const sel = this.ed.selection;
    if (sel.active && e.page && e.page === sel.page) {
      const h = sel.hit(e.x, e.y, e.pointerType === 'touch');
      if (h) {
        sel.begin(h, e.x, e.y);
        this.mode = 'drag';
        return true;
      }
    }
    if (!e.page) return false;
    sel.clear();
    this.page = e.page;
    e.page.syncScale();
    this.path = [e.x, e.y];
    this.mode = 'lasso';
    // a plain tap on an object selects just that object
    const objs = this.ed.objectsOf(e.page);
    const tol = 8 / e.page.bitmapScale;
    this.tapObj = null;
    for (let i = objs.length - 1; i >= 0; i--) {
      if (hitTest(objs[i], e.x, e.y, tol)) {
        this.tapObj = objs[i].id;
        break;
      }
    }
    this.page.liveCtx();
    return true;
  }

  move(e: ToolEvent): void {
    if (this.mode === 'drag') {
      this.ed.selection.update(e.x, e.y, { shift: e.shift, alt: e.alt });
      return;
    }
    if (this.mode !== 'lasso' || !this.page) return;
    for (const s of e.samples) this.path.push(s.x, s.y);
    if (!this.raf) {
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        this.render(false);
      });
    }
  }

  up(e: ToolEvent): void {
    if (this.mode === 'drag') {
      this.ed.selection.end();
      this.mode = null;
      return;
    }
    const page = this.page;
    this.mode = null;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (!page) return;
    page.clearLive();
    this.page = null;
    // a closed loop ends where it started, so judge "tap or lasso" by the size of the drawn path
    const b = boundsOfPoints(this.path);
    if (Math.max(b.w, b.h) * page.bitmapScale < 8) {
      if (this.tapObj) this.ed.selection.set(page, [this.tapObj]);
      return;
    }
    if (this.path.length < 6) return;
    const picked = objectsInPolygon(this.ed.objectsOf(page), this.path);
    if (picked.length) this.ed.selection.set(page, picked.map((o) => o.id));
    else this.ed.toast('Nichts ausgewählt');
  }

  cancel(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.mode === 'drag') this.ed.selection.end();
    this.page?.clearLive();
    this.page = null;
    this.mode = null;
  }

  deactivate(): void {
    this.ed.selection.clear();
  }

  private render(closing: boolean): void {
    const page = this.page;
    if (!page) return;
    const ctx = page.liveScreenCtx();
    page.clearLive();
    const s = page.bitmapScale;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < this.path.length; i += 2) ctx[i ? 'lineTo' : 'moveTo'](this.path[i] * s, this.path[i + 1] * s);
    if (closing) ctx.closePath();
    ctx.fillStyle = accentAlpha(0.08);
    ctx.fill();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([6, 5]);
    ctx.stroke();
    ctx.restore();
  }
}
