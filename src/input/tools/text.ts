import { hitTest } from '../../core/objects';
import type { TextObj } from '../../core/types';
import type { EditorApi, Tool, ToolEvent } from '../types';

/** Click (or drag a width) to place text; click existing text to edit it. */
export class TextTool implements Tool {
  readonly id = 'text' as const;
  readonly cursor = 'text';
  private start: ToolEvent | null = null;

  constructor(private ed: EditorApi) {}

  ring(): number | null {
    return null;
  }

  down(e: ToolEvent): boolean {
    if (!e.page) return false;
    this.ed.selection.clear();
    this.start = e;
    return true;
  }

  move(): void {
    /* width is taken on release */
  }

  up(e: ToolEvent): void {
    const s = this.start;
    this.start = null;
    if (!s || !s.page) return;
    const page = s.page;
    const moved = Math.hypot(e.clientX - s.clientX, e.clientY - s.clientY);
    if (moved < 6) {
      const tol = 6 / page.bitmapScale;
      const objs = this.ed.objectsOf(page);
      for (let i = objs.length - 1; i >= 0; i--) {
        const o = objs[i];
        if (o.t === 'text' && hitTest(o, s.x, s.y, tol)) {
          this.ed.editText(page, o as TextObj, { x: o.x, y: o.y });
          return;
        }
      }
      this.ed.editText(page, null, { x: s.x, y: s.y });
    } else {
      const x = Math.min(s.x, e.x);
      this.ed.editText(page, null, { x, y: Math.min(s.y, e.y), w: Math.max(40, Math.abs(e.x - s.x)) });
    }
  }

  /** a finger tap places text like a click (fingers that don't draw only tap) */
  tap(e: ToolEvent): void {
    if (!this.down(e)) return;
    this.up(e);
  }

  cancel(): void {
    this.start = null;
  }
}
