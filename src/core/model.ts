import type { AnyObj } from './types';
import { Emitter } from './emitter';

/** One atomic change of one object. `before`/`after` null = object didn't exist. */
export interface Patch {
  page: number;
  id: string;
  before: AnyObj | null;
  after: AnyObj | null;
  /** index in the page's object list (used to restore removed objects at the same z position) */
  index: number;
}

export interface HistoryEntry {
  label: string;
  patches: Patch[];
  /** optional structural change (page insert / delete / rotate …) that is undone with this entry */
  structure?: StructureChange;
}

/** Swapping the whole page structure; the document layer knows how to apply it. */
export interface StructureChange {
  undo: () => Promise<void> | void;
  redo: () => Promise<void> | void;
}

export interface ModelEvents extends Record<string, unknown> {
  /** objects on these pages changed (add / remove / replace) */
  change: { pages: number[] };
  /** history pointer or dirty state moved */
  history: undefined;
}

/**
 * Annotation store for one document: per-page object lists, undo / redo and
 * dirty tracking. All mutation goes through `commit()` so that every edit is
 * undoable and every redraw is triggered from exactly one place.
 */
export class AnnotationModel extends Emitter<ModelEvents> {
  pages: AnyObj[][] = [];
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  /** undoStack length at the last save; -1 when the saved state is unreachable */
  private cleanDepth = 0;
  private structuralDirty = false;

  constructor(pageCount = 0) {
    super();
    this.pages = Array.from({ length: pageCount }, () => []);
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  get undoLabel(): string | undefined {
    return this.undoStack[this.undoStack.length - 1]?.label;
  }
  get redoLabel(): string | undefined {
    return this.redoStack[this.redoStack.length - 1]?.label;
  }
  get dirty(): boolean {
    return this.structuralDirty || this.cleanDepth !== this.undoStack.length;
  }

  markClean(): void {
    this.cleanDepth = this.undoStack.length;
    this.structuralDirty = false;
    this.emit('history', undefined);
  }

  /** Mark the document as changed by something outside the undo stack (e.g. loaded annotations were migrated). */
  markDirty(): void {
    this.structuralDirty = true;
    this.emit('history', undefined);
  }

  find(page: number, id: string): AnyObj | undefined {
    return this.pages[page]?.find((o) => o.id === id);
  }

  count(): number {
    return this.pages.reduce((n, p) => n + p.length, 0);
  }

  /** Replace everything (used when a document is opened or the structure changes). */
  reset(pages: AnyObj[][]): void {
    this.pages = pages;
    this.undoStack = [];
    this.redoStack = [];
    this.cleanDepth = 0;
    this.structuralDirty = false;
    this.emit('change', { pages: pages.map((_, i) => i) });
    this.emit('history', undefined);
  }

  /** Swap the page lists without touching history (undo of structural changes). */
  setPages(pages: AnyObj[][]): void {
    this.pages = pages;
    this.emit('change', { pages: pages.map((_, i) => i) });
  }

  // ── editing ───────────────────────────────────────────────────────────

  add(label: string, page: number, ...objs: AnyObj[]): void {
    const base = this.pages[page].length;
    this.commit(label, objs.map((o, i) => ({ page, id: o.id, before: null, after: o, index: base + i })));
  }

  remove(label: string, page: number, ids: string[]): void {
    const patches: Patch[] = [];
    const list = this.pages[page];
    for (const id of ids) {
      const index = list.findIndex((o) => o.id === id);
      if (index >= 0) patches.push({ page, id, before: list[index], after: null, index });
    }
    if (patches.length) this.commit(label, patches);
  }

  replace(label: string, page: number, updates: AnyObj[]): void {
    const patches: Patch[] = [];
    const list = this.pages[page];
    for (const after of updates) {
      const index = list.findIndex((o) => o.id === after.id);
      if (index >= 0 && list[index] !== after) patches.push({ page, id: after.id, before: list[index], after, index });
    }
    if (patches.length) this.commit(label, patches);
  }

  /** Apply patches immediately and record one history entry. */
  commit(label: string, patches: Patch[], structure?: StructureChange): void {
    if (!patches.length && !structure) return;
    this.applyPatches(patches, false);
    this.undoStack.push({ label, patches, structure });
    if (this.undoStack.length > 500) {
      this.undoStack.shift();
      if (this.cleanDepth >= 0) this.cleanDepth--;
    }
    if (this.redoStack.length) {
      // redo states are gone: if the clean state was among them it is unreachable now
      if (this.cleanDepth > this.undoStack.length - 1) this.cleanDepth = -1;
      this.redoStack = [];
    }
    this.emit('history', undefined);
  }

  async undo(): Promise<boolean> {
    const e = this.undoStack.pop();
    if (!e) return false;
    if (e.structure) await e.structure.undo();
    this.applyPatches(e.patches, true);
    this.redoStack.push(e);
    this.emit('history', undefined);
    return true;
  }

  async redo(): Promise<boolean> {
    const e = this.redoStack.pop();
    if (!e) return false;
    if (e.structure) await e.structure.redo();
    this.applyPatches(e.patches, false);
    this.undoStack.push(e);
    this.emit('history', undefined);
    return true;
  }

  private applyPatches(patches: Patch[], reverse: boolean): void {
    const touched = new Set<number>();
    const seq = reverse ? [...patches].reverse() : patches;
    for (const p of seq) {
      const list = this.pages[p.page];
      if (!list) continue;
      const from = reverse ? p.after : p.before;
      const to = reverse ? p.before : p.after;
      touched.add(p.page);
      if (from && to) {
        const i = list.findIndex((o) => o.id === p.id);
        if (i >= 0) list[i] = to;
      } else if (!from && to) {
        list.splice(Math.min(p.index, list.length), 0, to);
      } else if (from && !to) {
        const i = list.findIndex((o) => o.id === p.id);
        if (i >= 0) list.splice(i, 1);
      }
    }
    if (touched.size) this.emit('change', { pages: [...touched] });
  }
}
