import type { AnyObj, Rect } from '../core/types';
import { isHighlight } from '../core/types';
import { drawObjects } from '../render/draw';
import type { PageMeta, DocSession } from '../app/session';
import { pdfjsLib } from './pdfjs';
import type { PDFPageProxy, RenderTask } from './pdfjs';

/** Largest bitmap (in device pixels) we are willing to allocate for one layer. */
const MAX_PIXELS = 13_000_000;

export interface Link {
  rect: Rect;
  url?: string;
  dest?: unknown;
}

/** One canvas of a page. Its bitmap covers `region` (css px at the scale it was rendered). */
export class Layer {
  readonly canvas = document.createElement('canvas');
  readonly ctx: CanvasRenderingContext2D;

  constructor(className: string, desynchronized = false) {
    this.canvas.className = `layer ${className}`;
    this.ctx = this.canvas.getContext('2d', { desynchronized, alpha: true })!;
  }

  setBitmap(region: Rect, dpr: number): void {
    const w = Math.max(1, Math.round(region.w * dpr));
    const h = Math.max(1, Math.round(region.h * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    } else this.ctx.clearRect(0, 0, w, h);
  }

  place(region: Rect, factor: number): void {
    const st = this.canvas.style;
    st.left = `${region.x * factor}px`;
    st.top = `${region.y * factor}px`;
    st.width = `${region.w * factor}px`;
    st.height = `${region.h * factor}px`;
  }

  /** Clears the bitmap but keeps the current transform (callers set it up before clearing). */
  clear(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();
  }

  release(): void {
    this.canvas.width = 0;
    this.canvas.height = 0;
    this.canvas.remove();
  }
}

export interface PageHost {
  session: DocSession;
  /** visible part of a page in css px relative to the page's top-left, at the current scale */
  visibleRect(index: number): Rect | null;
  desynchronized: boolean;
  requestRender(view: PageView): void;
}

/**
 * One page on screen: PDF bitmap, highlight layer (multiply), ink layer, live
 * layer (stroke being drawn / selection chrome), text layer and an overlay
 * that lives in page units for editors.
 */
export class PageView {
  readonly el = document.createElement('div');
  readonly textEl = document.createElement('div');
  readonly searchEl = document.createElement('div');
  /** page-unit overlay (1 unit = 1 pt) for editors / popups */
  readonly overlayEl = document.createElement('div');

  private pdfCanvas: HTMLCanvasElement | null = null;
  private hl: Layer | null = null;
  private ink: Layer | null = null;
  private live: Layer | null = null;

  proxy: PDFPageProxy | null = null;
  scale = 1;
  /** scale the bitmaps were rendered at, and the region they cover (css px at that scale) */
  private rs = 0;
  private region: Rect = { x: 0, y: 0, w: 0, h: 0 };
  dpr = 1;

  private task: RenderTask | null = null;
  private textLayerBuilt = false;
  private textLayer: InstanceType<typeof pdfjsLib.TextLayer> | null = null;
  private destroyed = false;
  private linksPromise: Promise<Link[]> | null = null;
  /** objects temporarily lifted from the ink layer (drag / transform in progress) */
  hidden = new Set<string>();
  rendered = false;
  /** while set, these objects are drawn instead of the model's (live erasing) */
  override: AnyObj[] | null = null;
  onTextReady: (() => void) | null = null;

  constructor(readonly index: number, readonly meta: PageMeta, private host: PageHost) {
    this.el.className = 'page';
    this.el.dataset.page = String(index);
    this.textEl.className = 'textLayer';
    this.searchEl.className = 'search-layer';
    this.overlayEl.className = 'page-overlay';
    this.el.append(this.textEl, this.searchEl, this.overlayEl);
  }

  get objects(): AnyObj[] {
    return this.override ?? this.host.session.model.pages[this.index] ?? [];
  }

  get modelObjects(): AnyObj[] {
    return this.host.session.model.pages[this.index] ?? [];
  }

  // ── geometry ──────────────────────────────────────────────────────────

  setScale(s: number): void {
    this.scale = s;
    const st = this.el.style;
    st.width = `${this.meta.w * s}px`;
    st.height = `${this.meta.h * s}px`;
    this.textEl.style.setProperty('--total-scale-factor', String(s));
    this.searchEl.style.transform = `scale(${s})`;
    this.overlayEl.style.transform = `scale(${s})`;
    if (this.rs) this.placeLayers();
  }

  private placeLayers(): void {
    const f = this.scale / this.rs;
    this.hl?.place(this.region, f);
    this.ink?.place(this.region, f);
    this.live?.place(this.region, f);
    if (this.pdfCanvas) {
      const st = this.pdfCanvas.style;
      st.left = `${this.region.x * f}px`;
      st.top = `${this.region.y * f}px`;
      st.width = `${this.region.w * f}px`;
      st.height = `${this.region.h * f}px`;
    }
  }

  /** Is the current bitmap good enough for the current scale and viewport? */
  isCurrent(): boolean {
    if (!this.rendered || Math.abs(this.rs - this.scale) > 1e-6 || this.dpr !== window.devicePixelRatio) return false;
    const full = this.region.w >= this.meta.w * this.rs - 1 && this.region.h >= this.meta.h * this.rs - 1;
    if (full) return true;
    const vis = this.host.visibleRect(this.index);
    if (!vis) return true;
    const r = this.region;
    return vis.x >= r.x - 1 && vis.y >= r.y - 1 && vis.x + vis.w <= r.x + r.w + 1 && vis.y + vis.h <= r.y + r.h + 1;
  }

  private computeRegion(s: number, dpr: number): Rect {
    const W = this.meta.w * s;
    const H = this.meta.h * s;
    if (W * H * dpr * dpr <= MAX_PIXELS) return { x: 0, y: 0, w: W, h: H };
    const vis = this.host.visibleRect(this.index) ?? { x: 0, y: 0, w: Math.min(W, 1600), h: Math.min(H, 1200) };
    // grow around the visible area until the pixel budget is used up
    const budget = MAX_PIXELS / (dpr * dpr);
    let padX = vis.w * 0.5;
    let padY = vis.h * 0.5;
    const area = (px: number, py: number) => Math.min(W, vis.w + 2 * px) * Math.min(H, vis.h + 2 * py);
    while (area(padX, padY) > budget && padX > 0) {
      padX *= 0.85;
      padY *= 0.85;
    }
    const x0 = Math.max(0, Math.floor((vis.x - padX) / 64) * 64);
    const y0 = Math.max(0, Math.floor((vis.y - padY) / 64) * 64);
    const x1 = Math.min(W, Math.ceil((vis.x + vis.w + padX) / 64) * 64);
    const y1 = Math.min(H, Math.ceil((vis.y + vis.h + padY) / 64) * 64);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  // ── PDF bitmap ────────────────────────────────────────────────────────

  async render(): Promise<void> {
    if (this.destroyed) return;
    const { session } = this.host;
    if (!this.proxy) this.proxy = await session.pdf.getPage(this.index + 1);
    if (this.destroyed) return;
    this.task?.cancel();
    const s = this.scale;
    const dpr = window.devicePixelRatio || 1;
    const region = this.computeRegion(s, dpr);
    const canvas = document.createElement('canvas');
    canvas.className = 'layer pdf';
    canvas.width = Math.max(1, Math.round(region.w * dpr));
    canvas.height = Math.max(1, Math.round(region.h * dpr));
    const viewport = this.proxy.getViewport({ scale: s * dpr });
    const task = this.proxy.render({
      canvas,
      viewport,
      transform: [1, 0, 0, 1, -region.x * dpr, -region.y * dpr],
      background: '#ffffff',
      annotationMode: pdfjsLib.AnnotationMode.ENABLE,
      optionalContentConfigPromise: session.ocConfig,
    });
    this.task = task;
    try {
      await task.promise;
    } catch (e) {
      if ((e as { name?: string })?.name === 'RenderingCancelledException') return;
      throw e;
    }
    if (this.destroyed || this.task !== task) return;
    this.task = null;
    // swap in the new bitmap together with the annotation layers
    this.rs = s;
    this.dpr = dpr;
    this.region = region;
    if (this.pdfCanvas) this.pdfCanvas.replaceWith(canvas);
    else this.el.insertBefore(canvas, this.el.firstChild);
    this.pdfCanvas = canvas;
    this.rendered = true;
    this.placeLayers();
    this.redrawAnnotations();
    this.buildTextLayer();
  }

  cancel(): void {
    this.task?.cancel();
    this.task = null;
  }

  private buildTextLayer(): void {
    if (this.textLayerBuilt || !this.proxy) return;
    this.textLayerBuilt = true;
    const proxy = this.proxy;
    const run = async () => {
      if (this.destroyed) return;
      try {
        const layer = new pdfjsLib.TextLayer({
          textContentSource: proxy.streamTextContent(),
          container: this.textEl,
          viewport: proxy.getViewport({ scale: this.scale }),
        });
        await layer.render();
        this.textLayer = layer;
        this.textEl.dataset.ready = '1';
        this.onTextReady?.();
      } catch {
        /* text layer is optional */
      }
    };
    if ('requestIdleCallback' in window) window.requestIdleCallback(() => void run(), { timeout: 800 });
    else setTimeout(() => void run(), 60);
  }

  /** Full text of the page as the text layer sees it (null until the layer is built). */
  pageText(): string | null {
    return this.textLayer ? this.textLayer.textContentItemsStr.join('') : null;
  }

  /** Rects (page units) covering text range [start, end) of `pageText()`. */
  textRects(start: number, end: number): Rect[] {
    const layer = this.textLayer;
    if (!layer) return [];
    const conv = this.converter();
    const k = this.el.getBoundingClientRect().width / this.meta.w || 1;
    const out: Rect[] = [];
    let offset = 0;
    const strs = layer.textContentItemsStr;
    for (let i = 0; i < strs.length && offset < end; i++) {
      const len = strs[i].length;
      const a = Math.max(start, offset) - offset;
      const b = Math.min(end, offset + len) - offset;
      offset += len;
      if (b <= a) continue;
      const node = layer.textDivs[i]?.firstChild;
      if (!node || node.nodeType !== Node.TEXT_NODE) continue;
      const range = document.createRange();
      range.setStart(node, Math.min(a, (node as Text).length));
      range.setEnd(node, Math.min(b, (node as Text).length));
      for (const r of range.getClientRects()) {
        const p0 = conv(r.left, r.top);
        out.push({ x: p0.x, y: p0.y, w: r.width / k, h: r.height / k });
      }
    }
    return out;
  }

  /** Paint search hits; `current` is the index (within this page) to emphasise, or -1. */
  setSearch(matches: { start: number; end: number }[], current: number): Rect | null {
    this.searchEl.replaceChildren();
    let focus: Rect | null = null;
    matches.forEach((m, i) => {
      for (const r of this.textRects(m.start, m.end)) {
        const d = document.createElement('div');
        d.className = i === current ? 'hit current' : 'hit';
        d.style.cssText = `left:${r.x - 1}px;top:${r.y - 1}px;width:${r.w + 2}px;height:${r.h + 2}px`;
        this.searchEl.append(d);
        if (i === current && !focus) focus = r;
      }
    });
    return focus;
  }

  async links(): Promise<Link[]> {
    if (!this.linksPromise) {
      this.linksPromise = (async () => {
        if (!this.proxy) this.proxy = await this.host.session.pdf.getPage(this.index + 1);
        const vp = this.proxy.getViewport({ scale: 1 });
        const anns = await this.proxy.getAnnotations();
        const out: Link[] = [];
        for (const a of anns) {
          if (a.subtype !== 'Link' || !a.rect) continue;
          const url: string | undefined = a.url ?? a.unsafeUrl;
          const dest: unknown = a.dest;
          if (!url && !dest) continue;
          const [x0, y0] = vp.convertToViewportPoint(a.rect[0], a.rect[1]);
          const [x1, y1] = vp.convertToViewportPoint(a.rect[2], a.rect[3]);
          out.push({ rect: { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) }, url, dest });
        }
        return out;
      })();
    }
    return this.linksPromise;
  }

  // ── annotation layers ─────────────────────────────────────────────────

  private pageTransform(ctx: CanvasRenderingContext2D): void {
    const k = this.dpr * this.rs;
    ctx.setTransform(k, 0, 0, k, -this.region.x * this.dpr, -this.region.y * this.dpr);
  }

  /** Redraws committed objects (highlights below, everything else above). */
  redrawAnnotations(): void {
    if (!this.rendered) return;
    const objs = this.objects.filter((o) => !this.hidden.has(o.id));
    const hls = objs.filter(isHighlight);
    const rest = objs.filter((o) => !isHighlight(o));

    if (hls.length || this.hl) {
      if (!this.hl) {
        this.hl = new Layer('hl');
        this.el.insertBefore(this.hl.canvas, this.ink?.canvas ?? this.textEl);
      }
      this.hl.setBitmap(this.region, this.dpr);
      this.hl.place(this.region, this.scale / this.rs);
      this.pageTransform(this.hl.ctx);
      drawObjects(this.hl.ctx, hls);
    }
    if (rest.length || this.ink) {
      if (!this.ink) {
        this.ink = new Layer('ink');
        this.el.insertBefore(this.ink.canvas, this.live?.canvas ?? this.textEl);
      }
      this.ink.setBitmap(this.region, this.dpr);
      this.ink.place(this.region, this.scale / this.rs);
      this.pageTransform(this.ink.ctx);
      drawObjects(this.ink.ctx, rest);
    }
    // keep stacking: pdf < hl < ink < live < text
    if (this.live) this.live.place(this.region, this.scale / this.rs);
  }

  /** Make the annotation bitmaps match the current scale right now (called before interaction starts). */
  syncScale(): void {
    if (this.rendered && Math.abs(this.rs - this.scale) > 1e-6) {
      // adopt the current scale for the vector layers; the PDF bitmap keeps being stretched until re-rendered
      this.rs = this.scale;
      this.dpr = window.devicePixelRatio || 1;
      this.region = this.computeRegion(this.scale, this.dpr);
      this.placeLayers();
      this.redrawAnnotations();
      this.host.requestRender(this);
    }
  }

  // ── live layer ────────────────────────────────────────────────────────

  /** Context in page units (pt) of the live layer; created on demand. */
  liveCtx(): CanvasRenderingContext2D {
    if (!this.live) {
      this.live = new Layer('live', this.host.desynchronized);
      this.el.insertBefore(this.live.canvas, this.textEl);
      this.live.setBitmap(this.region, this.dpr);
      this.live.place(this.region, this.scale / this.rs);
    }
    this.pageTransform(this.live.ctx);
    return this.live.ctx;
  }

  /** Context in css pixels relative to the page's top-left (for selection chrome, handles). */
  liveScreenCtx(): CanvasRenderingContext2D {
    const ctx = this.liveCtx();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, -this.region.x * this.dpr, -this.region.y * this.dpr);
    return ctx;
  }

  clearLive(): void {
    this.live?.clear();
  }

  /** Pre-create the live layer when the pen hovers so that the first stroke has no allocation hiccup. */
  warmLive(): void {
    if (this.rendered) this.liveCtx();
  }

  releaseLive(): void {
    this.live?.release();
    this.live = null;
  }

  get liveCanvas(): HTMLCanvasElement | null {
    return this.live?.canvas ?? null;
  }

  get hasLive(): boolean {
    return !!this.live;
  }

  /** Scale of the annotation bitmaps (equals `scale` unless a zoom re-render is pending). */
  get bitmapScale(): number {
    return this.rs || this.scale;
  }

  // ── lifecycle ─────────────────────────────────────────────────────────

  clientToPage(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.el.getBoundingClientRect();
    const k = r.width / this.meta.w || this.scale;
    return { x: (clientX - r.left) / k, y: (clientY - r.top) / k };
  }

  /** Fast repeated conversion client → page space (one layout read for many samples). */
  converter(): (clientX: number, clientY: number) => { x: number; y: number } {
    const r = this.el.getBoundingClientRect();
    const k = r.width / this.meta.w || this.scale;
    return (cx, cy) => ({ x: (cx - r.left) / k, y: (cy - r.top) / k });
  }

  pageToClient(x: number, y: number): { x: number; y: number } {
    const r = this.el.getBoundingClientRect();
    const k = r.width / this.meta.w || this.scale;
    return { x: r.left + x * k, y: r.top + y * k };
  }

  destroy(): void {
    this.destroyed = true;
    this.task?.cancel();
    this.hl?.release();
    this.ink?.release();
    this.live?.release();
    if (this.pdfCanvas) {
      this.pdfCanvas.width = 0;
      this.pdfCanvas.height = 0;
    }
    this.proxy?.cleanup();
    this.el.remove();
  }
}
