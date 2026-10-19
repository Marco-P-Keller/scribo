import type { AnyObj, InkObj, ShapeObj } from '../../core/types';
import { uid } from '../../core/objects';
import { pressureCurve, strokePoints } from '../../core/ink';
import { PressureFilter } from '../../core/pressure';
import { smoothStroke, type SmoothOptions } from '../../core/smooth';
import { recognizeShape } from '../../core/recognize';
import type { Recognized } from '../../core/recognize';
import { dist } from '../../core/geometry';
import { drawObj } from '../../render/draw';
import { currentPreset } from '../../app/presets';
import { settings } from '../../app/settings';
import type { PageView } from '../../viewer/pageview';
import type { EditorApi, Tool, ToolEvent } from '../types';

/** Pen hold time (ms) before a stroke snaps to the recognised shape. */
const HOLD_MS = 460;
/** Movement (css px) that counts as "still holding". */
const HOLD_SLOP = 3;

/**
 * Pen and highlighter. One class for both – the active favourite decides the nib.
 * Writes with pressure, snaps to shapes when the pen rests (or on lift, depending on the setting).
 */
export class InkTool implements Tool {
  readonly id: 'pen' | 'highlighter';
  readonly cursor = 'none';

  private page: PageView | null = null;
  private pts: number[] = [];
  private sim = false;
  private style = currentPreset();
  private pointerType: ToolEvent['pointerType'] = 'pen';
  private holdTimer = 0;
  private anchor = { x: 0, y: 0 };
  private snapped: Recognized | null = null;
  private convert: ((x: number, y: number) => { x: number; y: number }) | null = null;
  private raf = 0;
  private predicted: number[] = [];
  private filter = new PressureFilter(1);
  /** pressure (or speed) changes the width of this stroke */
  private varies = false;
  private smooth: SmoothOptions = { strength: 0.5, corners: true, unit: 1 };
  /** first raw pressure and whether every raw sample so far had exactly that value */
  private raw0 = -1;
  private rawFlat = true;

  constructor(private ed: EditorApi, kind: 'pen' | 'highlighter') {
    this.id = kind;
  }

  ring(): number | null {
    const p = currentPreset();
    const s = this.ed.viewer.scale;
    return Math.max(2.5, (p.width * s) / 2);
  }

  down(e: ToolEvent): boolean {
    if (!e.page) return false;
    this.page = e.page;
    this.page.syncScale();
    this.ed.selection.clear();
    this.style = currentPreset();
    this.pointerType = e.pointerType;
    this.convert = e.page.converter();
    this.varies = settings.get('pressureWidth');
    // smoothing works in screen pixels: the zoom at which the stroke is written decides the scale
    this.smooth = { strength: settings.get('smoothing'), corners: settings.get('smoothCorners'), unit: 1 / this.ed.viewer.scale };
    this.sim = this.varies && e.pointerType !== 'pen';
    this.pts = [];
    this.predicted = [];
    this.snapped = null;
    this.filter = new PressureFilter(this.varies ? settings.get('pressureAmount') : 0);
    this.raw0 = -1;
    this.rawFlat = true;
    for (const s of e.samples) this.push(s.x, s.y, s.p);
    if (!this.pts.length) this.push(e.x, e.y, e.pressure);
    this.anchor = { x: e.clientX, y: e.clientY };
    this.page.liveCtx();
    this.page.liveCanvas?.classList.toggle('multiply', this.id === 'highlighter');
    this.armHold();
    this.schedule();
    return true;
  }

  move(e: ToolEvent): void {
    if (!this.page) return;
    if (this.snapped) {
      // lines follow the pen after snapping so the angle / length can still be adjusted
      if (this.snapped.kind === 'line' && this.convert) {
        const q = this.convert(e.clientX, e.clientY);
        const [x0, y0] = this.snapped.p;
        let ang = Math.atan2(q.y - y0, q.x - x0);
        const len = dist(x0, y0, q.x, q.y);
        const step = Math.PI / 4;
        const snap = Math.round(ang / step) * step;
        if (Math.abs(ang - snap) < (4 * Math.PI) / 180) ang = snap;
        this.snapped = { ...this.snapped, p: [x0, y0, x0 + Math.cos(ang) * len, y0 + Math.sin(ang) * len] };
        this.schedule();
      }
      return;
    }
    for (const s of e.samples) this.push(s.x, s.y, s.p);
    this.predicted = [];
    const last = this.pts.length ? this.pts[this.pts.length - 1] : 0.5;
    for (const s of e.predicted.slice(0, 2)) this.predicted.push(s.x, s.y, last);
    if (this.varies && !this.sim && this.pointerType === 'pen' && this.pts.length > 18 && this.rawFlat && Math.abs(this.raw0 - pressureCurve(0.5, settings.get('sensitivity'))) < 1e-3) {
      // hardware without pressure reports a constant value: fall back to speed based width
      this.sim = true;
    }
    if (dist(e.clientX, e.clientY, this.anchor.x, this.anchor.y) > HOLD_SLOP) {
      this.anchor = { x: e.clientX, y: e.clientY };
      this.armHold();
    }
    this.schedule();
  }

  up(e: ToolEvent): void {
    if (!this.page) return;
    const page = this.page;
    // the lift-off sample carries (almost) no pressure: it would only thin the end
    for (const s of e.samples) this.push(s.x, s.y, this.pts.length ? this.pts[this.pts.length - 1] : s.p, true);
    this.predicted = [];
    clearTimeout(this.holdTimer);
    cancelAnimationFrame(this.raf);
    this.raf = 0;

    const obj = this.finish();
    page.liveCanvas?.classList.remove('multiply');
    if (obj) this.ed.model.add('Zeichnen', page.index, obj);
    page.clearLive();
    this.reset();
  }

  cancel(): void {
    clearTimeout(this.holdTimer);
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.page?.clearLive();
    this.page?.liveCanvas?.classList.remove('multiply');
    this.reset();
  }

  /** Append a sample; pen pressure goes through the user's pressure filter. */
  private push(x: number, y: number, p: number, filtered = false): void {
    if (this.pointerType !== 'pen') {
      this.pts.push(x, y, 0.5);
      return;
    }
    if (!filtered) {
      if (this.raw0 < 0) this.raw0 = p;
      else if (Math.abs(p - this.raw0) > 1e-3) this.rawFlat = false;
    }
    this.pts.push(x, y, filtered ? p : this.filter.next(p));
  }

  private reset(): void {
    this.page = null;
    this.pts = [];
    this.predicted = [];
    this.snapped = null;
  }

  // ── shape snapping ───────────────────────────────────────────────────

  private xy(): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    for (let i = 0; i < this.pts.length; i += 3) out.push({ x: this.pts[i], y: this.pts[i + 1] });
    return out;
  }

  private armHold(): void {
    clearTimeout(this.holdTimer);
    if (settings.get('snap') === 'off') return;
    this.holdTimer = window.setTimeout(() => {
      if (!this.page || this.snapped || this.pts.length < 18) return;
      const rec = recognizeShape(this.xy(), 'hold');
      if (!rec) return;
      if (this.id === 'highlighter' && rec.kind !== 'line') return;
      this.snapped = rec;
      this.schedule();
    }, HOLD_MS);
  }

  private shapeFrom(rec: Recognized): AnyObj {
    const st = this.style;
    if (this.id === 'highlighter') {
      // a straight highlighter bar stays an ink stroke so it keeps the multiply look
      const [x0, y0, x1, y1] = rec.p;
      const p: number[] = [];
      const n = Math.max(2, Math.ceil(dist(x0, y0, x1, y1) / 6));
      for (let i = 0; i <= n; i++) p.push(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, 0.5);
      const o: InkObj = { id: uid(), t: 'ink', c: st.color, w: st.width, hl: 1, p, sim: 1 };
      if (st.opacity !== undefined && st.opacity < 1) o.o = st.opacity;
      return o;
    }
    const kind = rec.kind === 'poly' ? 'poly' : rec.kind;
    const o: ShapeObj = { id: uid(), t: 'shape', k: kind, p: rec.p.map((v) => Math.round(v * 100) / 100), c: st.color, w: st.width };
    if (st.opacity !== undefined && st.opacity < 1) o.o = st.opacity;
    return o;
  }

  // ── result ───────────────────────────────────────────────────────────

  private finish(): AnyObj | null {
    if (this.snapped) return this.shapeFrom(this.snapped);
    if (settings.get('snap') === 'auto') {
      const rec = recognizeShape(this.xy(), 'auto');
      if (rec && (this.id === 'pen' || rec.kind === 'line')) return this.shapeFrom(rec);
    }
    const st = this.style;
    const o: InkObj = { id: uid(), t: 'ink', c: st.color, w: st.width, p: strokePoints(this.pts, this.smooth), v: 2 };
    if (this.id === 'highlighter') o.hl = 1;
    if (this.sim) o.sim = 1;
    if (st.opacity !== undefined && st.opacity < 1) o.o = st.opacity;
    return o;
  }

  // ── live rendering ───────────────────────────────────────────────────

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
    if (this.snapped) {
      drawObj(ctx, this.shapeFrom(this.snapped));
      return;
    }
    const st = this.style;
    // the same smoothing as the stored stroke, so lifting the pen changes nothing
    const p = smoothStroke(this.predicted.length ? this.pts.concat(this.predicted) : this.pts, this.smooth);
    const live: InkObj = { id: 'live', t: 'ink', c: st.color, w: st.width, p: p.length < 6 ? [p[0], p[1], p[2], p[0] + 0.01, p[1], p[2]] : p, v: 2 };
    if (this.id === 'highlighter') live.hl = 1;
    if (this.sim) live.sim = 1;
    if (st.opacity !== undefined && st.opacity < 1) live.o = st.opacity;
    drawObj(ctx, live);
  }
}
