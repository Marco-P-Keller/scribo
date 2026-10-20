import type { AnyObj } from '../../core/types';
import type { Patch } from '../../core/model';
import { hitTest, splitInk } from '../../core/objects';
import { settings } from '../../app/settings';
import type { PageView } from '../../viewer/pageview';
import type { EditorApi, Tool, ToolEvent } from '../types';

/**
 * Eraser. "Stroke" mode removes every object the eraser touches, "point" mode cuts
 * ink strokes apart and only removes the touched piece. Edits are shown live and
 * committed as a single undo step when the pen lifts. Images are never erased.
 */
export class EraserTool implements Tool {
  readonly id = 'eraser' as const;
  readonly cursor = 'none';

  private page: PageView | null = null;
  private original: AnyObj[] = [];
  private work: AnyObj[] = [];
  private raf = 0;
  private dirty = false;
  private last: { x: number; y: number } | null = null;

  constructor(private ed: EditorApi) {}

  ring(): number | null {
    return settings.get('eraserSize');
  }

  private radiusPt(): number {
    return settings.get('eraserSize') / this.ed.viewer.scale;
  }

  down(e: ToolEvent): boolean {
    if (!e.page) return false;
    this.ed.selection.clear();
    this.page = e.page;
    e.page.syncScale();
    this.original = e.page.modelObjects.slice();
    this.work = this.original.slice();
    this.last = null;
    this.sweep(e.x, e.y);
    for (const s of e.samples) this.sweep(s.x, s.y);
    return true;
  }

  move(e: ToolEvent): void {
    for (const s of e.samples) this.sweep(s.x, s.y);
  }

  up(e: ToolEvent): void {
    for (const s of e.samples) this.sweep(s.x, s.y);
    this.last = null;
    this.commit();
  }

  /** Erase along the segment from the previous sample so fast strokes can't skip thin lines. */
  private sweep(x: number, y: number): void {
    const prev = this.last;
    this.last = { x, y };
    if (!prev) {
      this.erase(x, y);
      return;
    }
    const step = Math.max(0.5, this.radiusPt() * 0.5);
    const n = Math.max(1, Math.ceil(Math.hypot(x - prev.x, y - prev.y) / step));
    for (let i = 1; i <= n; i++) this.erase(prev.x + ((x - prev.x) * i) / n, prev.y + ((y - prev.y) * i) / n);
  }

  cancel(): void {
    if (this.page) {
      this.page.override = null;
      this.page.redrawAnnotations();
    }
    this.page = null;
  }

  private erase(x: number, y: number): void {
    const r = this.radiusPt();
    const point = settings.get('eraserMode') === 'point';
    const next: AnyObj[] = [];
    let changed = false;
    for (const o of this.work) {
      if (o.t === 'img') {
        // pictures are removed on purpose only: select, then delete
        next.push(o);
        continue;
      }
      if (point && o.t === 'ink') {
        const pieces = splitInk(o, x, y, r);
        if (pieces) {
          next.push(...pieces);
          changed = true;
          continue;
        }
      } else if (hitTest(o, x, y, r)) {
        changed = true;
        continue;
      }
      next.push(o);
    }
    if (changed) {
      this.work = next;
      this.dirty = true;
      this.schedule();
    }
  }

  private schedule(): void {
    if (this.raf || !this.page) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      if (!this.page || !this.dirty) return;
      this.dirty = false;
      this.page.override = this.work;
      this.page.redrawAnnotations();
    });
  }

  private commit(): void {
    const page = this.page;
    if (!page) return;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    const kept = new Set(this.work.map((o) => o.id));
    const origIds = new Set(this.original.map((o) => o.id));
    const patches: Patch[] = [];
    // removals in descending order so that undo (reverse) re-inserts at valid indexes
    for (let i = this.original.length - 1; i >= 0; i--) {
      const o = this.original[i];
      if (!kept.has(o.id)) patches.push({ page: page.index, id: o.id, before: o, after: null, index: i });
    }
    const survivors = this.original.filter((o) => kept.has(o.id)).length;
    let at = survivors;
    for (const o of this.work) {
      if (!origIds.has(o.id)) patches.push({ page: page.index, id: o.id, before: null, after: o, index: at++ });
    }
    page.override = null;
    this.page = null;
    if (patches.length) this.ed.model.commit('Radieren', patches);
    else page.redrawAnnotations();
  }
}
