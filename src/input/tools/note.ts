import { NOTE_SIZE, hitTest } from '../../core/objects';
import type { NoteObj } from '../../core/types';
import type { EditorApi, Tool, ToolEvent } from '../types';

/** Drops a sticky note (saved as a real PDF comment). Tap an existing note to edit it. */
export class NoteTool implements Tool {
  readonly id = 'note' as const;
  readonly cursor = 'copy';
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
    /* nothing */
  }

  up(): void {
    const s = this.start;
    this.start = null;
    if (!s?.page) return;
    const objs = this.ed.objectsOf(s.page);
    for (let i = objs.length - 1; i >= 0; i--) {
      const o = objs[i];
      if (o.t === 'note' && hitTest(o, s.x, s.y, 4)) {
        this.ed.editNote(s.page, o as NoteObj, { x: o.x, y: o.y });
        return;
      }
    }
    this.ed.editNote(s.page, null, { x: s.x - NOTE_SIZE / 2, y: s.y - NOTE_SIZE / 2 });
  }

  /** a finger tap drops a note like a click */
  tap(e: ToolEvent): void {
    if (this.down(e)) this.up();
  }

  cancel(): void {
    this.start = null;
  }
}
