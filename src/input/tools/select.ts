import type { AnyObj, Rect } from '../../core/types';
import { bounds, hitTest, objectsInPolygon } from '../../core/objects';
import { rectsIntersect } from '../../core/geometry';
import type { Link, PageView } from '../../viewer/pageview';
import type { EditorApi, Tool, ToolEvent } from '../types';
import { ACCENT, accentAlpha } from '../../render/accent';


/**
 * The arrow: select / move / transform objects, rubber-band select, follow links,
 * and (with mouse or pen) select PDF text natively for copying and marking up.
 */
export class SelectTool implements Tool {
  readonly id = 'select' as const;
  cursor = 'default';

  private mode: 'drag' | 'marquee' | 'native' | null = null;
  private page: PageView | null = null;
  private startPt = { x: 0, y: 0 };
  private startClient = { x: 0, y: 0 };
  private cur = { x: 0, y: 0 };
  private raf = 0;
  private links: Link[] = [];

  constructor(private ed: EditorApi) {}

  ring(): number | null {
    return null;
  }

  private topObjectAt(page: PageView, x: number, y: number) {
    const objs = this.ed.objectsOf(page);
    const tol = 7 / page.bitmapScale;
    for (let i = objs.length - 1; i >= 0; i--) if (hitTest(objs[i], x, y, tol)) return objs[i];
    return null;
  }

  private linkAt(page: PageView, x: number, y: number): Link | undefined {
    return this.links.find((l) => x >= l.rect.x && x <= l.rect.x + l.rect.w && y >= l.rect.y && y <= l.rect.y + l.rect.h);
  }

  hover(e: ToolEvent): void {
    const sel = this.ed.selection;
    if (!e.page) {
      this.cursor = 'default';
      return;
    }
    void e.page.links().then((l) => {
      this.links = l;
    });
    if (sel.active && sel.page === e.page) {
      const h = sel.hit(e.x, e.y);
      if (h) {
        this.cursor = sel.cursorFor(h);
        return;
      }
    }
    if (this.topObjectAt(e.page, e.x, e.y)) this.cursor = 'move';
    else if (this.linkAt(e.page, e.x, e.y)) this.cursor = 'pointer';
    else this.cursor = 'default';
  }

  down(e: ToolEvent): boolean {
    const sel = this.ed.selection;
    this.startClient = { x: e.clientX, y: e.clientY };
    if (!e.page) {
      sel.clear();
      return false;
    }
    this.page = e.page;
    e.page.syncScale();
    this.startPt = { x: e.x, y: e.y };
    this.cur = { x: e.x, y: e.y };
    if (sel.active && sel.page === e.page) {
      const h = sel.hit(e.x, e.y, e.pointerType === 'touch');
      if (h) {
        sel.begin(h, e.x, e.y);
        this.mode = 'drag';
        return true;
      }
    }
    const obj = this.topObjectAt(e.page, e.x, e.y);
    if (obj) {
      if (e.shift && sel.page === e.page) {
        const ids = sel.ids.includes(obj.id) ? sel.ids.filter((i) => i !== obj.id) : [...sel.ids, obj.id];
        ids.length ? sel.set(e.page, ids) : sel.clear();
        return false;
      }
      sel.set(e.page, [obj.id]);
      sel.begin('move', e.x, e.y);
      this.mode = 'drag';
      return true;
    }
    sel.clear();
    const overText = (e.raw.target as HTMLElement | null)?.closest?.('.textLayer span');
    if (overText && e.pointerType !== 'touch') {
      // let the browser select the PDF text
      this.mode = 'native';
      return false;
    }
    this.mode = 'marquee';
    e.page.liveCtx();
    return true;
  }

  move(e: ToolEvent): void {
    if (this.mode === 'drag') {
      this.ed.selection.update(e.x, e.y, { shift: e.shift, alt: e.alt }, { x: e.clientX, y: e.clientY });
    } else if (this.mode === 'marquee') {
      this.cur = { x: e.x, y: e.y };
      if (!this.raf) {
        this.raf = requestAnimationFrame(() => {
          this.raf = 0;
          this.drawMarquee();
        });
      }
    }
  }

  up(e: ToolEvent): void {
    const page = this.page;
    const mode = this.mode;
    this.mode = null;
    this.page = null;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (mode === 'drag') {
      const changed = this.ed.selection.end();
      if (!changed && page) this.maybeTap(page, e);
      return;
    }
    if (mode !== 'marquee' || !page) return;
    page.clearLive();
    const moved = Math.hypot(e.clientX - this.startClient.x, e.clientY - this.startClient.y);
    if (moved < 5) {
      this.maybeTap(page, e);
      return;
    }
    const x0 = Math.min(this.startPt.x, e.x), x1 = Math.max(this.startPt.x, e.x);
    const y0 = Math.min(this.startPt.y, e.y), y1 = Math.max(this.startPt.y, e.y);
    const poly = [x0, y0, x1, y0, x1, y1, x0, y1];
    const objs = this.ed.objectsOf(page);
    let picked = objectsInPolygon(objs, poly, 0.5);
    if (!picked.length) picked = objs.filter((o) => rectsIntersectBounds(o, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }));
    if (picked.length) this.ed.selection.set(page, picked.map((o) => o.id));
  }

  /** click without drag: follow a link, edit text / note */
  private maybeTap(page: PageView, e: ToolEvent): void {
    const moved = Math.hypot(e.clientX - this.startClient.x, e.clientY - this.startClient.y);
    if (moved > 5) return;
    const obj = this.ed.selection.objects()[0];
    if (obj && this.ed.selection.ids.length === 1 && e.time - lastTap.t < 380 && lastTap.id === obj.id) {
      if (obj.t === 'text') this.ed.editText(page, obj, { x: obj.x, y: obj.y });
      else if (obj.t === 'note') this.ed.editNote(page, obj, { x: obj.x, y: obj.y });
    }
    lastTap = { t: e.time, id: obj?.id ?? '' };
    if (!obj) {
      const link = this.linkAt(page, e.x, e.y);
      if (link?.url) this.ed.openLink(link.url);
      else if (link?.dest) this.ed.gotoDestination(link.dest);
    } else if (obj.t === 'note' && this.ed.selection.ids.length === 1) {
      this.ed.editNote(page, obj, { x: obj.x, y: obj.y });
    }
  }

  tap(e: ToolEvent): void {
    if (!e.page) {
      this.ed.selection.clear();
      return;
    }
    const obj = this.topObjectAt(e.page, e.x, e.y);
    if (obj) {
      this.ed.selection.set(e.page, [obj.id]);
      if (obj.t === 'note') this.ed.editNote(e.page, obj, { x: obj.x, y: obj.y });
      return;
    }
    this.ed.selection.clear();
    void e.page.links().then((links) => {
      this.links = links;
      const link = this.linkAt(e.page!, e.x, e.y);
      if (link?.url) this.ed.openLink(link.url);
      else if (link?.dest) this.ed.gotoDestination(link.dest);
    });
  }

  dblclick(e: ToolEvent): void {
    if (!e.page) return;
    const obj = this.topObjectAt(e.page, e.x, e.y);
    if (obj?.t === 'text') this.ed.editText(e.page, obj, { x: obj.x, y: obj.y });
  }

  cancel(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.mode === 'drag') this.ed.selection.end();
    this.page?.clearLive();
    this.page = null;
    this.mode = null;
  }

  private drawMarquee(): void {
    const page = this.page;
    if (!page) return;
    const ctx = page.liveScreenCtx();
    page.clearLive();
    const s = page.bitmapScale;
    const x = Math.min(this.startPt.x, this.cur.x) * s, y = Math.min(this.startPt.y, this.cur.y) * s;
    const w = Math.abs(this.cur.x - this.startPt.x) * s, h = Math.abs(this.cur.y - this.startPt.y) * s;
    ctx.save();
    ctx.fillStyle = accentAlpha(0.1);
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.restore();
  }
}

let lastTap = { t: 0, id: '' };

function rectsIntersectBounds(o: AnyObj, r: Rect): boolean {
  return rectsIntersect(bounds(o), r);
}
