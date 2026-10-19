import { Emitter } from '../core/emitter';
import { clamp } from '../core/geometry';
import type { Rect } from '../core/types';
import type { DocSession } from '../app/session';
import { PageView } from './pageview';
import type { PageHost } from './pageview';

/** css px per PDF point at 100 % zoom (96 dpi). */
export const CSS_PER_PT = 96 / 72;
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 8;

const PAD_TOP = 22;
const PAD_BOTTOM = 120;
const PAD_X = 28;
const GAP = 14;
/** pages beyond the visible area that stay alive (in viewport heights) */
const KEEP = 1.2;

export type FitMode = 'width' | 'page' | 'none';

export interface ViewerEvents extends Record<string, unknown> {
  zoom: { zoom: number; fit: FitMode };
  page: number;
  /** scroll position or visible set changed */
  view: undefined;
  /** a page view was created or destroyed */
  pages: undefined;
  /** the text layer of a page finished building */
  textready: number;
  /** a page's annotation bitmaps got a new scale or region */
  geometry: number;
}

export class Viewer extends Emitter<ViewerEvents> implements PageHost {
  readonly el = document.createElement('div');
  readonly stage = document.createElement('div');
  readonly content = document.createElement('div');
  /** non-scrolling layer above the stage for floating UI */
  readonly overlay = document.createElement('div');
  /** "add a page" button under the last page (content and action are set by the app) */
  readonly addPageButton = document.createElement('button');

  session!: DocSession;
  desynchronized = false;

  zoom = 1;
  fit: FitMode = 'width';

  private views = new Map<number, PageView>();
  private tops: number[] = [];
  private contentW = 0;
  private contentH = 0;
  private current = 0;

  private raf = 0;
  private settleTimer = 0;
  private queue = new Set<PageView>();
  private rendering = false;
  private pendingZoom: { factor: number; fx: number; fy: number } | null = null;
  private resizeObserver: ResizeObserver;
  /** reasons that currently hold page re-renders ('input', 'swap') */
  private holds = new Set<string>();
  private lastDpr = window.devicePixelRatio;

  constructor() {
    super();
    this.el.className = 'viewer';
    this.stage.className = 'stage';
    this.stage.tabIndex = -1;
    this.content.className = 'doc';
    this.overlay.className = 'viewer-overlay';
    this.addPageButton.className = 'add-page viewer-ui';
    this.addPageButton.hidden = true;
    this.content.append(this.addPageButton);
    this.stage.append(this.content);
    this.el.append(this.stage, this.overlay);

    this.stage.addEventListener('scroll', () => this.onScroll(), { passive: true });
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(this.stage);
    window.addEventListener('resize', () => {
      if (window.devicePixelRatio !== this.lastDpr) {
        this.lastDpr = window.devicePixelRatio;
        this.rerenderAll();
      }
    });
  }

  get scale(): number {
    return this.zoom * CSS_PER_PT;
  }

  get pageCount(): number {
    return this.session?.pageCount ?? 0;
  }

  get currentPage(): number {
    return this.current;
  }

  // ── session ───────────────────────────────────────────────────────────

  setSession(session: DocSession, opts: { keepView?: boolean } = {}): void {
    const keep = opts.keepView ? { page: this.current, top: this.stage.scrollTop - (this.tops[this.current] ?? 0) } : null;
    for (const v of this.views.values()) v.destroy();
    this.views.clear();
    this.queue.clear();
    this.session = session;
    if (!opts.keepView) {
      const { zoom, fit } = this.initialZoom();
      this.zoom = zoom;
      this.fit = fit;
    }
    this.relayout();
    if (keep) {
      const i = clamp(keep.page, 0, this.pageCount - 1);
      this.stage.scrollTop = (this.tops[i] ?? 0) + keep.top;
    } else {
      this.stage.scrollTop = 0;
      this.centerHorizontally();
    }
    this.updateVisible();
    this.emit('zoom', { zoom: this.zoom, fit: this.fit });
  }

  /** Pages are centred in the content area; start with that centre in view. */
  private centerHorizontally(): void {
    this.stage.scrollLeft = Math.max(0, (this.contentW - this.stage.clientWidth) / 2);
  }

  /** Slides fit the whole page, documents fit the width; very large screens don't blow pages up. */
  private initialZoom(): { zoom: number; fit: FitMode } {
    const m = this.session.metas[0];
    if (!m) return { zoom: 1, fit: 'none' };
    const w = this.stage.clientWidth || 1000;
    const h = this.stage.clientHeight || 700;
    const fitW = (w - 2 * PAD_X) / (m.w * CSS_PER_PT);
    const fitH = (h - PAD_TOP - 40) / (m.h * CSS_PER_PT);
    const landscape = m.w > m.h;
    const z = landscape ? Math.min(fitW, fitH) : fitW;
    const zoom = clamp(z, 0.4, 1.5);
    return { zoom, fit: zoom === z ? (landscape ? 'page' : 'width') : 'none' };
  }

  // ── layout ────────────────────────────────────────────────────────────

  private relayout(): void {
    const s = this.scale;
    const metas = this.session.metas;
    this.tops = new Array(metas.length);
    let y = PAD_TOP;
    let maxW = 0;
    for (let i = 0; i < metas.length; i++) {
      this.tops[i] = y;
      y += metas[i].h * s + GAP;
      maxW = Math.max(maxW, metas[i].w * s);
    }
    this.contentH = y - GAP + PAD_BOTTOM;
    this.contentW = Math.max(maxW + 2 * PAD_X, this.stage.clientWidth);
    this.content.style.width = `${this.contentW}px`;
    this.content.style.height = `${this.contentH}px`;
    const b = this.addPageButton;
    b.style.left = `${this.contentW / 2}px`;
    b.style.top = `${y - GAP + 34}px`;
    for (const v of this.views.values()) this.positionView(v);
  }

  private positionView(v: PageView): void {
    const s = this.scale;
    v.setScale(s);
    v.el.style.left = `${(this.contentW - v.meta.w * s) / 2}px`;
    v.el.style.top = `${this.tops[v.index]}px`;
  }

  /** index of the page whose vertical span contains (or is nearest to) y */
  private pageIndexAt(y: number): number {
    let lo = 0;
    let hi = this.tops.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.tops[mid] <= y) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  pageTop(i: number): number {
    return this.tops[i] ?? 0;
  }

  // ── visibility / rendering ───────────────────────────────────────────

  private onScroll(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.updateVisible();
      this.scheduleSettle();
    });
  }

  private onResize(): void {
    if (!this.session) return;
    if (this.fit === 'width') this.fitWidth(false);
    else if (this.fit === 'page') this.fitPage(false);
    else {
      this.relayout();
      this.updateVisible();
    }
  }

  updateVisible(): void {
    if (!this.session || !this.tops.length) return;
    const s = this.scale;
    const top = this.stage.scrollTop;
    const h = this.stage.clientHeight;
    const lo = top - h * KEEP;
    const hi = top + h + h * KEEP;
    const first = this.pageIndexAt(lo);
    const metas = this.session.metas;
    let created = false;
    const wanted = new Set<number>();
    for (let i = first; i < metas.length && this.tops[i] <= hi; i++) {
      if (this.tops[i] + metas[i].h * s < lo) continue;
      wanted.add(i);
      if (!this.views.has(i)) {
        const v = new PageView(i, metas[i], this);
        v.onTextReady = () => this.emit('textready', i);
        v.onGeometry = () => this.emit('geometry', i);
        this.views.set(i, v);
        this.content.append(v.el);
        this.positionView(v);
        created = true;
      }
    }
    let removed = false;
    for (const [i, v] of this.views) {
      if (!wanted.has(i)) {
        v.destroy();
        this.views.delete(i);
        this.queue.delete(v);
        removed = true;
      }
    }
    for (const v of this.views.values()) if (!v.rendered || !v.isCurrent()) this.requestRender(v);
    const cur = this.pageIndexAt(top + h * 0.35);
    if (cur !== this.current) {
      this.current = cur;
      this.emit('page', cur);
    }
    this.emit('view', undefined);
    if (created || removed) this.emit('pages', undefined);
  }

  private scheduleSettle(): void {
    clearTimeout(this.settleTimer);
    this.settleTimer = window.setTimeout(() => {
      for (const v of this.views.values()) if (!v.isCurrent()) this.requestRender(v);
    }, 120);
  }

  requestRender(view: PageView): void {
    this.queue.add(view);
    if (!this.rendering && !this.paused) queueMicrotask(() => void this.pump());
  }

  get paused(): boolean {
    return this.holds.size > 0;
  }

  /**
   * Hold page re-renders while the pen draws (they would move the live layer under the
   * stroke) and while the document swaps its PDF (old page numbers, new file).
   */
  setPaused(on: boolean, reason = 'input'): void {
    if (this.holds.has(reason) === on) return;
    if (on) this.holds.add(reason);
    else this.holds.delete(reason);
    if (!this.paused && this.queue.size && !this.rendering) queueMicrotask(() => void this.pump());
  }

  private async pump(): Promise<void> {
    if (this.rendering) return;
    this.rendering = true;
    try {
      while (this.queue.size && !this.paused) {
        const mid = this.stage.scrollTop + this.stage.clientHeight / 2;
        let best: PageView | null = null;
        let bestD = Infinity;
        for (const v of this.queue) {
          const c = this.tops[v.index] + (v.meta.h * this.scale) / 2;
          const d = Math.abs(c - mid);
          if (d < bestD) {
            bestD = d;
            best = v;
          }
        }
        if (!best) break;
        this.queue.delete(best);
        if (this.views.get(best.index) !== best) continue;
        try {
          await best.render();
        } catch (e) {
          console.error('page render failed', best.index, e);
        }
        // yield so pen input / scrolling stay responsive between pages
        await new Promise((r) => setTimeout(r, 0));
      }
    } finally {
      this.rendering = false;
    }
  }

  rerenderAll(): void {
    for (const v of this.views.values()) {
      v.rendered = false;
      this.requestRender(v);
    }
  }

  /** Visible part of a page in css px relative to its top-left corner. */
  visibleRect(index: number): Rect | null {
    const meta = this.session.metas[index];
    if (!meta) return null;
    const s = this.scale;
    const top = this.tops[index];
    const left = (this.contentW - meta.w * s) / 2;
    const x0 = Math.max(0, this.stage.scrollLeft - left);
    const y0 = Math.max(0, this.stage.scrollTop - top);
    const x1 = Math.min(meta.w * s, this.stage.scrollLeft + this.stage.clientWidth - left);
    const y1 = Math.min(meta.h * s, this.stage.scrollTop + this.stage.clientHeight - top);
    if (x1 <= x0 || y1 <= y0) return null;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  // ── pages ─────────────────────────────────────────────────────────────

  viewFor(i: number): PageView | undefined {
    return this.views.get(i);
  }

  get realized(): PageView[] {
    return [...this.views.values()];
  }

  /** The page under a client coordinate (with a small tolerance around the edges). */
  pageAtClient(clientX: number, clientY: number, tolerance = 14): PageView | null {
    const r = this.stage.getBoundingClientRect();
    const docY = clientY - r.top + this.stage.scrollTop;
    const docX = clientX - r.left + this.stage.scrollLeft;
    const s = this.scale;
    const i = this.pageIndexAt(docY);
    const meta = this.session.metas[i];
    if (!meta) return null;
    const v = this.views.get(i);
    if (!v) return null;
    const left = (this.contentW - meta.w * s) / 2;
    if (docX < left - tolerance || docX > left + meta.w * s + tolerance) return null;
    if (docY < this.tops[i] - tolerance || docY > this.tops[i] + meta.h * s + tolerance) return null;
    return v;
  }

  /** Nearest realized page to a client y (used when a stroke leaves the page). */
  scrollToPage(i: number, opts: { smooth?: boolean; offsetPt?: number } = {}): void {
    i = clamp(i, 0, this.pageCount - 1);
    const y = this.tops[i] + (opts.offsetPt ?? 0) * this.scale - PAD_TOP / 2;
    this.stage.scrollTo({ top: Math.max(0, y), behavior: opts.smooth ? 'smooth' : 'auto' });
    // a jump that ends where the last frame was (e.g. zoom + jump back) fires no scroll event
    if (!opts.smooth) this.updateVisible();
  }

  // ── zoom ──────────────────────────────────────────────────────────────

  /** Zoom keeping the content under (clientX, clientY) fixed; default focal point = stage centre. */
  setZoom(zoom: number, focal?: { x: number; y: number }, fit: FitMode = 'none'): void {
    const z = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    if (Math.abs(z - this.zoom) < 1e-4 && fit === this.fit) return;
    const r = this.stage.getBoundingClientRect();
    const fx = focal ? focal.x - r.left : this.stage.clientWidth / 2;
    const fy = focal ? focal.y - r.top : this.stage.clientHeight / 2;
    const s0 = this.scale;
    const docY = this.stage.scrollTop + fy;
    const i = this.pageIndexAt(docY);
    const ptY = (docY - this.tops[i]) / s0;
    const relX = (this.stage.scrollLeft + fx - this.contentW / 2) / s0;
    this.zoom = z;
    this.fit = fit;
    this.relayout();
    const s1 = this.scale;
    this.stage.scrollTop = this.tops[i] + ptY * s1 - fy;
    this.stage.scrollLeft = this.contentW / 2 + relX * s1 - fx;
    this.updateVisible();
    this.scheduleSettle();
    this.emit('zoom', { zoom: this.zoom, fit: this.fit });
  }

  /** Coalesces rapid wheel / pinch input into one relayout per frame. */
  zoomBy(factor: number, focal?: { x: number; y: number }): void {
    const r = this.stage.getBoundingClientRect();
    const fx = focal?.x ?? r.left + r.width / 2;
    const fy = focal?.y ?? r.top + r.height / 2;
    if (this.pendingZoom) {
      this.pendingZoom.factor *= factor;
      this.pendingZoom.fx = fx;
      this.pendingZoom.fy = fy;
      return;
    }
    this.pendingZoom = { factor, fx, fy };
    requestAnimationFrame(() => {
      const p = this.pendingZoom;
      this.pendingZoom = null;
      if (p) this.setZoom(this.zoom * p.factor, { x: p.fx, y: p.fy });
    });
  }

  zoomStep(dir: 1 | -1): void {
    const steps = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6, 8];
    const z = this.zoom;
    const next = dir > 0 ? steps.find((v) => v > z + 0.01) : [...steps].reverse().find((v) => v < z - 0.01);
    this.setZoom(next ?? z);
  }

  fitWidth(anchor = true): void {
    const m = this.session.metas[this.current] ?? this.session.metas[0];
    if (!m) return;
    const z = (this.stage.clientWidth - 2 * PAD_X) / (m.w * CSS_PER_PT);
    this.applyFit(clamp(z, MIN_ZOOM, 4), 'width', anchor);
  }

  fitPage(anchor = true): void {
    const m = this.session.metas[this.current] ?? this.session.metas[0];
    if (!m) return;
    const zw = (this.stage.clientWidth - 2 * PAD_X) / (m.w * CSS_PER_PT);
    const zh = (this.stage.clientHeight - PAD_TOP - 24) / (m.h * CSS_PER_PT);
    this.applyFit(clamp(Math.min(zw, zh), MIN_ZOOM, 4), 'page', anchor);
    this.scrollToPage(this.current);
  }

  private applyFit(z: number, fit: FitMode, anchor: boolean): void {
    if (anchor) this.setZoom(z, undefined, fit);
    else {
      const page = this.current;
      const off = this.stage.scrollTop - this.tops[page];
      const ratio = z / this.zoom;
      this.zoom = z;
      this.fit = fit;
      this.relayout();
      this.stage.scrollTop = this.tops[page] + off * ratio;
      this.centerHorizontally();
      this.updateVisible();
      this.scheduleSettle();
      this.emit('zoom', { zoom: this.zoom, fit: this.fit });
    }
  }

  // ── redraw hooks ──────────────────────────────────────────────────────

  /** Annotation objects on these pages changed. */
  invalidate(pages: number[]): void {
    for (const i of pages) this.views.get(i)?.redrawAnnotations();
  }

  panBy(dx: number, dy: number): void {
    this.stage.scrollLeft += dx;
    this.stage.scrollTop += dy;
  }

  destroy(): void {
    this.resizeObserver.disconnect();
    for (const v of this.views.values()) v.destroy();
    this.views.clear();
  }
}
