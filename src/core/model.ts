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
  /** unique per entry: identifies the document state reached by applying it */
  id: number;
  label: string;
  patches: Patch[];
  /** optional structural change (page insert / delete / rotate …) that is undone with this entry */
  structure?: StructureChange;
  /** later replaces with the same key are folded into this entry (see `replace`) */
  merge?: string;
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
  private seq = 0;
  /** state id of the last save (0 = the state the document was opened in) */
  private cleanId = 0;
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
    return this.structuralDirty || this.cleanId !== this.stateId;
  }

  /** Identifies the current document state; undo / redo return to earlier ids, new edits get new ones. */
  get stateId(): number {
    return this.undoStack[this.undoStack.length - 1]?.id ?? 0;
  }

  markClean(): void {
    this.markCleanAt(this.stateId);
  }

  /** The state `id` was saved (edits made while the file was written stay dirty). */
  markCleanAt(id: number): void {
    this.cleanId = id;
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
    this.cleanId = 0;
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
    // the page can vanish under a running interaction (structural undo)
    if (!this.pages[page]) return;
    const base = this.pages[page].length;
    this.commit(label, objs.map((o, i) => ({ page, id: o.id, before: null, after: o, index: base + i })));
  }

  remove(label: string, page: number, ids: string[]): void {
    const patches: Patch[] = [];
    const list = this.pages[page];
    if (!list) return;
    for (const id of ids) {
      const index = list.findIndex((o) => o.id === id);
      if (index >= 0) patches.push({ page, id, before: list[index], after: null, index });
    }
    if (patches.length) this.commit(label, patches);
  }

  /** `merge`: consecutive replaces with the same key (a slider being dragged) become one undo step. */
  replace(label: string, page: number, updates: AnyObj[], merge?: string): void {
    const patches: Patch[] = [];
    const list = this.pages[page];
    if (!list) return;
    for (const after of updates) {
      const index = list.findIndex((o) => o.id === after.id);
      if (index >= 0 && list[index] !== after) patches.push({ page, id: after.id, before: list[index], after, index });
    }
    if (!patches.length) return;
    if (merge && this.mergeInto(merge, patches)) return;
    this.commit(label, patches);
    if (merge && !this.swapping) this.undoStack[this.undoStack.length - 1].merge = merge;
  }

  /** Fold replace-only patches into the newest history entry if it carries the same merge key. */
  private mergeInto(key: string, patches: Patch[]): boolean {
    const top = this.undoStack[this.undoStack.length - 1];
    // a saved state must stay reachable by undo, so never merge across a save
    if (!top || top.merge !== key || top.structure || this.swapping || this.redoStack.length || this.cleanId === top.id) return false;
    const known = new Map(top.patches.map((p) => [`${p.page}/${p.id}`, p]));
    if (patches.some((p) => !known.has(`${p.page}/${p.id}`))) return false;
    this.applyPatches(patches, false);
    for (const p of patches) known.get(`${p.page}/${p.id}`)!.after = p.after;
    this.emit('history', undefined);
    return true;
  }

  /** Apply patches immediately and record one history entry. */
  commit(label: string, patches: Patch[], structure?: StructureChange): void {
    if (!patches.length && !structure) return;
    if (this.swapping && !structure) {
      // shown right away, recorded once the new page lists are in place
      this.applyPatches(patches, false);
      this.held.push({ label, patches });
      return;
    }
    this.applyPatches(patches, false);
    this.undoStack.push({ id: ++this.seq, label, patches, structure });
    if (this.undoStack.length > 500) this.undoStack.shift();
    // redo states are gone (a saved state among them can't come back: its id is never reused)
    this.redoStack = [];
    this.emit('history', undefined);
  }

  /**
   * Undo, redo and page-structure edits run strictly one after another: structural steps
   * reload the PDF asynchronously and must not interleave (double click on "add page",
   * Ctrl+Z held down during a page operation).
   */
  private queue: Promise<unknown> = Promise.resolve();

  serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  undo(): Promise<boolean> {
    return this.serial(() => this.undoNow());
  }

  redo(): Promise<boolean> {
    return this.serial(() => this.redoNow());
  }

  private async undoNow(): Promise<boolean> {
    const e = this.undoStack.pop();
    if (!e) return false;
    const step = async () => {
      if (e.structure) await e.structure.undo();
      this.applyPatches(e.patches, true);
      this.redoStack.push(e);
      this.emit('history', undefined);
    };
    if (e.structure) await this.whileSwapping(step);
    else await step();
    return true;
  }

  private async redoNow(): Promise<boolean> {
    const e = this.redoStack.pop();
    if (!e) return false;
    const step = async () => {
      if (e.structure) await e.structure.redo();
      this.applyPatches(e.patches, false);
      this.undoStack.push(e);
      this.emit('history', undefined);
    };
    if (e.structure) await this.whileSwapping(step);
    else await step();
    return true;
  }

  // ── edits during an asynchronous page-structure swap ─────────────────

  private swapping = 0;
  private held: { label: string; patches: Patch[] }[] = [];

  /**
   * Runs a step that replaces all page lists asynchronously (page operations and their
   * undo). Edits made meanwhile (a stroke ends, Delete is pressed) would be overwritten by
   * the swap; they are replayed onto the new lists afterwards, as later history entries.
   */
  async whileSwapping<T>(fn: () => Promise<T>): Promise<T> {
    this.swapping++;
    try {
      return await fn();
    } finally {
      if (--this.swapping === 0) this.replayHeld();
    }
  }

  private replayHeld(): void {
    const held = this.held;
    this.held = [];
    for (const h of held) {
      const patches = this.rebase(h.patches);
      if (patches.length) this.commit(h.label, patches);
    }
  }

  /** Re-express patches against the current page lists; parts whose objects are gone are dropped. */
  private rebase(patches: Patch[]): Patch[] {
    const scratch = new Map<number, AnyObj[]>();
    const listOf = (page: number): AnyObj[] | null => {
      if (!this.pages[page]) return null;
      let l = scratch.get(page);
      if (!l) {
        l = this.pages[page].slice();
        scratch.set(page, l);
      }
      return l;
    };
    const out: Patch[] = [];
    for (const p of patches) {
      const list = listOf(p.page);
      if (!list) continue;
      const i = list.findIndex((o) => o.id === p.id);
      if (p.before && p.after) {
        // only if the swap left the object alone: an edit of its old version would undo the swap
        if (i < 0 || list[i] !== p.before) continue;
        out.push({ ...p, index: i });
        list[i] = p.after;
      } else if (p.after) {
        if (i >= 0) continue;
        const at = Math.min(p.index, list.length);
        out.push({ ...p, index: at });
        list.splice(at, 0, p.after);
      } else if (p.before) {
        if (i < 0) continue;
        out.push({ ...p, before: list[i], index: i });
        list.splice(i, 1);
      }
    }
    return out;
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
