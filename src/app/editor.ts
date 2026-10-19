import type { AnyObj, ImageObj, MarkObj, NoteObj, Rect, ShapeObj, TextObj, ToolId } from '../core/types';
import { clone, uid } from '../core/objects';
import { boundsOfAll } from '../core/objects';
import { AnnotationModel } from '../core/model';
import { Emitter } from '../core/emitter';
import type { Viewer } from '../viewer/viewer';
import type { PageView } from '../viewer/pageview';
import type { DocSession } from './session';
import { Selection } from '../input/selection';
import { InputController } from '../input/controller';
import type { EditorApi, Tool } from '../input/types';
import { InkTool } from '../input/tools/ink';
import { EraserTool } from '../input/tools/eraser';
import { LassoTool } from '../input/tools/lasso';
import { SelectTool } from '../input/tools/select';
import { ShapeTool } from '../input/tools/shape';
import { TextTool } from '../input/tools/text';
import { NoteTool } from '../input/tools/note';
import { TextEditor } from '../ui/inline-editors';
import { openNoteEditor } from '../ui/note-editor';
import { settings } from './settings';
import type { PenAction } from './settings';
import { currentPreset, selectToolKind } from './presets';
import { readClip, writeClip, MARKER } from './clipboard';
import { layoutText } from '../render/textlayout';

export interface EditorEvents extends Record<string, unknown> {
  tool: ToolId;
  selection: undefined;
  toast: string;
  link: string;
  goto: unknown;
  penInfo: { type: string; pressure: number; buttons: number; tiltX: number; tiltY: number } | null;
}

/**
 * Owns the tools, the selection and everything that edits annotations for the current
 * document: shortcuts, clipboard, text / note editors, images and text markup.
 */
export class Editor extends Emitter<EditorEvents> implements EditorApi {
  selection: Selection;
  readonly controller: InputController;
  private session: DocSession | null = null;
  private spaceHeld = false;
  private textEditor: TextEditor;

  private tools: Record<string, Tool>;
  private ink: InkTool;
  private highlighter: InkTool;
  private eraser: EraserTool;
  private lasso: LassoTool;
  private select: SelectTool;
  private shape: ShapeTool;

  constructor(readonly viewer: Viewer) {
    super();
    this.selection = new Selection(new AnnotationModel(0), viewer);
    this.ink = new InkTool(this, 'pen');
    this.highlighter = new InkTool(this, 'highlighter');
    this.eraser = new EraserTool(this);
    this.lasso = new LassoTool(this);
    this.select = new SelectTool(this);
    this.shape = new ShapeTool(this);
    this.tools = {
      pen: this.ink,
      highlighter: this.highlighter,
      eraser: this.eraser,
      lasso: this.lasso,
      select: this.select,
      shape: this.shape,
      text: new TextTool(this),
      note: new NoteTool(this),
      image: this.select,
    };
    this.textEditor = new TextEditor({ model: () => this.model, selection: () => this.selection });
    this.controller = new InputController({
      viewer,
      getTool: () => this.activeTool,
      toolForAction: (a: PenAction) => (a === 'erase' ? this.eraser : a === 'lasso' ? this.lasso : a === 'select' ? this.select : null),
      isDrawing: (t) => t.id !== 'select' && t.id !== 'pan',
      isSpaceHeld: () => this.spaceHeld,
      overrideAt: (page, cx, cy, type) => {
        // a selection made with the pen button stays grabbable with the plain tip
        const sel = this.selection;
        if (!sel.active || sel.page !== page || ['select', 'lasso'].includes(this.activeTool.id)) return null;
        const q = page.clientToPage(cx, cy);
        return sel.hit(q.x, q.y, type === 'touch') ? this.lasso : null;
      },
      onPenInfo: (info) => this.emit('penInfo', info),
    });
    settings.on('change', (key) => {
      if (key === 'tool' || key === 'activePreset' || key === 'favorites') this.onToolChanged();
      if (key === 'lowLatency') viewer.desynchronized = settings.get('lowLatency');
    });
    viewer.desynchronized = settings.get('lowLatency');
    viewer.on('pages', () => this.selection.relink());
    viewer.on('geometry', (i) => {
      if (this.selection.page?.index === i) this.selection.relink();
    });
    this.onToolChanged();
  }

  // ── session binding ───────────────────────────────────────────────────

  attach(session: DocSession): void {
    this.textEditor.close(false);
    this.controller.cancelActive();
    this.session = session;
    this.selection?.clear();
    this.selection = new Selection(session.model, this.viewer);
    this.selection.on('change', () => this.emit('selection', undefined));
    session.model.on('change', () => this.selection.refresh());
  }

  get model(): AnnotationModel {
    return this.session!.model;
  }

  get activeTool(): Tool {
    return this.tools[settings.get('tool')] ?? this.select;
  }

  objectsOf(page: PageView): AnyObj[] {
    return page.modelObjects.filter((o) => !page.hidden.has(o.id));
  }

  // ── tools ─────────────────────────────────────────────────────────────

  setTool(id: ToolId): void {
    if (id === 'pen' || id === 'highlighter') selectToolKind(id);
    else settings.set('tool', id);
  }

  private lastTool: Tool | null = null;
  private onToolChanged(): void {
    const tool = this.activeTool;
    if (this.lastTool && this.lastTool !== tool) {
      this.controller.cancelActive();
      this.lastTool.deactivate?.();
    }
    if (this.lastTool !== tool) {
      if (this.session && !['lasso', 'select', 'shape'].includes(tool.id)) this.selection?.clear();
      tool.activate?.();
    }
    this.lastTool = tool;
    this.viewer.stage.classList.toggle('select-mode', tool.id === 'select');
    this.controller.updateCursor(tool);
    this.emit('tool', settings.get('tool'));
    if (settings.get('tool') === 'image') {
      // image is an action, not a mode: ask for a file and return to the previous tool
      settings.set('tool', currentPreset().tool);
      this.pickImage();
    }
  }

  get tool(): ToolId {
    return settings.get('tool');
  }

  // ── EditorApi ─────────────────────────────────────────────────────────

  toast(message: string): void {
    this.emit('toast', message);
  }

  openLink(url: string): void {
    this.emit('link', url);
  }

  gotoDestination(dest: unknown): void {
    this.emit('goto', dest);
  }

  editText(page: PageView, obj: TextObj | null, at: { x: number; y: number; w?: number }): void {
    this.textEditor.open(page, obj, at);
  }

  get editingText(): boolean {
    return this.textEditor.isOpen;
  }

  closeTextEditor(): void {
    this.textEditor.close(true);
  }

  editNote(page: PageView, obj: NoteObj | null, at: { x: number; y: number }): void {
    const a = page.pageToClient(at.x, at.y);
    const s = this.viewer.scale;
    const rect = new DOMRect(a.x, a.y, 24 * s, 24 * s);
    openNoteEditor({
      anchor: rect,
      text: obj?.s ?? '',
      color: obj?.c ?? settings.get('note').color,
      isNew: !obj,
      onDone: ({ text, color, deleted }) => {
        if (deleted && obj) {
          this.model.remove('Notiz löschen', page.index, [obj.id]);
          return;
        }
        if (obj) {
          if (obj.s !== text || obj.c !== color) this.model.replace('Notiz ändern', page.index, [{ ...obj, s: text, c: color }]);
        } else if (text.trim()) {
          const n: NoteObj = { id: uid(), t: 'note', x: at.x, y: at.y, s: text, c: color };
          this.model.add('Notiz', page.index, n);
        }
      },
    });
  }

  // ── text style applied to a selection ─────────────────────────────────

  /** Re-style selected text objects (called by the text popover). */
  restyleSelectedText(partial: Partial<TextObj>): void {
    if (!this.selection.active) return;
    const objs = this.selection.objects().filter((o): o is TextObj => o.t === 'text');
    if (!objs.length) return;
    this.model.replace('Text ändern', this.selection.page!.index, objs.map((o) => layoutText({ ...o, ...partial })));
    this.selection.draw();
  }

  /** Re-style selected shapes (called by the shape popover). */
  restyleSelectedShapes(partial: Partial<ShapeObj>): void {
    if (!this.selection.active) return;
    const objs = this.selection.objects().filter((o): o is ShapeObj => o.t === 'shape');
    if (!objs.length) return;
    const next = objs.map((o) => {
      const n: ShapeObj = { ...o, ...partial };
      if (!n.fill) {
        delete n.fill;
        delete n.fo;
      }
      if (!n.dash) delete n.dash;
      return n;
    });
    this.model.replace('Form ändern', this.selection.page!.index, next);
    this.selection.draw();
  }

  // ── clipboard ─────────────────────────────────────────────────────────

  copySelection(e?: ClipboardEvent): boolean {
    const objs = this.selection.objects();
    if (!objs.length) return false;
    const marker = writeClip(objs);
    if (e?.clipboardData) {
      e.clipboardData.setData('text/plain', marker);
      e.preventDefault();
    } else void navigator.clipboard?.writeText(marker).catch(() => undefined);
    return true;
  }

  cutSelection(e?: ClipboardEvent): void {
    if (this.copySelection(e)) this.selection.delete();
  }

  /** Where to drop pasted content: centre of the visible part of the current page. */
  private dropTarget(): { page: PageView; x: number; y: number } | null {
    const v = this.viewer;
    const page = v.viewFor(v.currentPage) ?? v.realized[0];
    if (!page) return null;
    const r = v.visibleRect(page.index) ?? { x: 0, y: 0, w: page.meta.w * v.scale, h: page.meta.h * v.scale };
    return { page, x: (r.x + r.w / 2) / v.scale, y: (r.y + r.h / 2) / v.scale };
  }

  async paste(e?: ClipboardEvent): Promise<void> {
    const target = this.dropTarget();
    if (!target) return;
    const text = e?.clipboardData?.getData('text/plain') ?? (await navigator.clipboard?.readText().catch(() => '')) ?? '';
    const clip = readClip(text);
    if (clip?.length) {
      e?.preventDefault();
      const b = boundsOfAll(clip);
      if (!b) return;
      const dx = target.x - (b.x + b.w / 2);
      const dy = target.y - (b.y + b.h / 2);
      const copies = clip.map((o) => clone(o, dx, dy)).map((o) => (o.t === 'text' ? layoutText(o) : o));
      this.model.add('Einfügen', target.page.index, ...copies);
      this.selection.set(target.page, copies.map((c) => c.id));
      return;
    }
    const files = [...(e?.clipboardData?.files ?? [])];
    const img = files.find((f) => f.type.startsWith('image/'));
    if (img) {
      e?.preventDefault();
      await this.insertImage(img);
      return;
    }
    if (text.trim() && !text.startsWith(MARKER)) {
      e?.preventDefault();
      const st = settings.get('text');
      const o = layoutText({
        id: uid(), t: 'text', x: Math.max(8, target.x - 120), y: Math.max(8, target.y - 20), w: 240, s: text.slice(0, 4000),
        f: st.font, z: st.size, c: st.color,
      });
      this.model.add('Text einfügen', target.page.index, o);
      this.selection.set(target.page, [o.id]);
    }
  }

  // ── images ────────────────────────────────────────────────────────────

  pickImage(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp,image/gif,image/bmp';
    input.onchange = () => {
      const f = input.files?.[0];
      if (f) void this.insertImage(f);
    };
    input.click();
  }

  async insertImage(file: Blob): Promise<void> {
    const target = this.dropTarget();
    if (!target) return;
    let bmp: ImageBitmap;
    try {
      bmp = await createImageBitmap(file);
    } catch {
      this.toast('Dieses Bild kann nicht gelesen werden');
      return;
    }
    const MAX = 2000;
    const k = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * k));
    const hgt = Math.max(1, Math.round(bmp.height * k));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = hgt;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0, w, hgt);
    bmp.close();
    let src = c.toDataURL('image/png');
    if (src.length > 2_500_000) src = c.toDataURL('image/jpeg', 0.88); // photos: much smaller than PNG
    const pw = target.page.meta.w;
    const boxW = Math.min(pw * 0.55, w);
    const boxH = (boxW * hgt) / w;
    const o: ImageObj = {
      id: uid(), t: 'img', x: Math.max(4, target.x - boxW / 2), y: Math.max(4, target.y - boxH / 2), w: boxW, h: boxH, src,
    };
    this.model.add('Bild', target.page.index, o);
    this.selection.set(target.page, [o.id]);
  }

  // ── text markup from the browser selection ────────────────────────────

  hasTextSelection(): boolean {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
    const node = sel.getRangeAt(0).commonAncestorContainer;
    return !!(node instanceof Element ? node : node.parentElement)?.closest('.stage');
  }

  /** Highlight / underline / strike the currently selected PDF text. */
  markSelection(kind: MarkObj['k'], color: string): boolean {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
    const rects = [...sel.getRangeAt(0).getClientRects()].filter((r) => r.width > 1 && r.height > 1);
    let any = false;
    const patches: { page: PageView; mark: MarkObj }[] = [];
    for (const page of this.viewer.realized) {
      const pr = page.el.getBoundingClientRect();
      const conv = page.converter();
      const mine = rects.filter((r) => r.left >= pr.left - 2 && r.right <= pr.right + 2 && r.top >= pr.top - 2 && r.bottom <= pr.bottom + 2);
      if (!mine.length) continue;
      const pts: Rect[] = mine.map((r) => {
        const a = conv(r.left, r.top);
        const b = conv(r.right, r.bottom);
        return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
      });
      const merged = mergeLineRects(pts);
      patches.push({ page, mark: { id: uid(), t: 'mark', k: kind, c: color, q: merged.flatMap((r) => [r.x, r.y, r.w, r.h].map((v) => Math.round(v * 100) / 100)) } });
      any = true;
    }
    if (!any) return false;
    const label = kind === 'hl' ? 'Markieren' : kind === 'ul' ? 'Unterstreichen' : 'Durchstreichen';
    for (const { page, mark } of patches) this.model.add(label, page.index, mark);
    sel.removeAllRanges();
    return true;
  }

  // ── keyboard ──────────────────────────────────────────────────────────

  /** Returns true if the key was consumed. */
  onKeyDown(e: KeyboardEvent): boolean {
    const target = e.target as HTMLElement | null;
    const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    if (typing) return false;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();

    if (e.key === ' ' && !mod) {
      if (!this.spaceHeld) {
        this.spaceHeld = true;
        this.viewer.stage.style.cursor = 'grab';
      }
      e.preventDefault();
      return true;
    }
    if (mod && k === 'z') {
      e.preventDefault();
      void (e.shiftKey ? this.model.redo() : this.model.undo());
      return true;
    }
    if (mod && k === 'y') {
      e.preventDefault();
      void this.model.redo();
      return true;
    }
    if (mod && k === 'd') {
      e.preventDefault();
      this.selection.duplicate();
      return true;
    }
    if (mod && k === 'a') {
      const page = this.viewer.viewFor(this.viewer.currentPage);
      if (page && ['select', 'lasso'].includes(this.tool)) {
        e.preventDefault();
        this.selection.selectAll(page);
        return true;
      }
      return false;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (this.selection.active) {
        e.preventDefault();
        this.selection.delete();
        return true;
      }
      return false;
    }
    if (e.key === 'Escape') {
      if (this.selection.active) {
        this.selection.clear();
        return true;
      }
      this.controller.cancelActive();
      window.getSelection()?.removeAllRanges();
      return false;
    }
    if (e.key === 'Enter' && this.tool === 'shape') {
      this.shape.finish();
      return true;
    }
    if (e.key === 'Enter' && this.selection.active && this.selection.ids.length === 1) {
      const o = this.selection.objects()[0];
      if (o?.t === 'text') {
        e.preventDefault();
        this.editText(this.selection.page!, o, { x: o.x, y: o.y });
        return true;
      }
    }
    if (this.selection.active && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && !mod) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      this.nudge(dx, dy);
      return true;
    }
    if (!mod && !e.altKey) {
      const map: Record<string, ToolId> = { v: 'select', p: 'pen', h: 'highlighter', e: 'eraser', l: 'lasso', t: 'text', s: 'shape', n: 'note' };
      if (map[k]) {
        this.setTool(map[k]);
        return true;
      }
    }
    return false;
  }

  onKeyUp(e: KeyboardEvent): void {
    if (e.key === ' ' && this.spaceHeld) {
      this.spaceHeld = false;
      this.controller.updateCursor(this.activeTool);
    }
  }

  private nudge(dx: number, dy: number): void {
    const page = this.selection.page;
    if (!page) return;
    const moved = this.selection.objects().map((o) => clone(o, dx, dy));
    // keep ids (replace, not add)
    const same = this.selection.objects().map((o, i) => ({ ...moved[i], id: o.id }));
    this.model.replace('Verschieben', page.index, same);
    this.selection.draw();
  }
}

function mergeLineRects(rects: Rect[]): Rect[] {
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
  const out: Rect[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    const sameLine = last && Math.abs(last.y + last.h / 2 - (r.y + r.h / 2)) < Math.min(last.h, r.h) * 0.6;
    if (last && sameLine && r.x <= last.x + last.w + 3) {
      const x0 = Math.min(last.x, r.x);
      const y0 = Math.min(last.y, r.y);
      const x1 = Math.max(last.x + last.w, r.x + r.w);
      const y1 = Math.max(last.y + last.h, r.y + r.h);
      Object.assign(last, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    } else out.push({ ...r });
  }
  return out;
}
