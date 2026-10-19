import type { AnyObj, Mat, TextObj } from '../core/types';
import { Emitter } from '../core/emitter';
import { AnnotationModel } from '../core/model';
import { NOTES_FILENAME, decodeNotes } from '../core/serialize';
import { fontKey } from '../core/fontmeta';
import { clone, transformObj } from '../core/objects';
import { layoutText } from '../render/textlayout';
import { fontFileUrl } from '../render/fonts';
import { loadPdf } from '../viewer/pdfjs';
import type { PDFDocumentProxy } from '../viewer/pdfjs';
import { OCG_NAME } from '../pdf/build';
import type { PageExport, StructureOp } from '../pdf/build';
import { buildPdf, restructurePdf } from '../pdf/client';

export interface PageMeta {
  /** size in pt after rotation */
  w: number;
  h: number;
  /** pdf.js viewport transform at scale 1 */
  vt: Mat;
  view: [number, number, number, number];
  rotate: number;
}

export interface FileRef {
  name: string;
  path?: string;
  /** browser File System Access handle */
  handle?: unknown;
  mtimeMs?: number;
  /** a new notebook that was never saved */
  untitled?: boolean;
}

export interface SessionEvents extends Record<string, unknown> {
  /** the page list or the underlying PDF was replaced */
  structure: undefined;
  /** the PDF is about to be replaced (page views must not render) … */
  swapping: undefined;
  /** … and the replacement finished or failed */
  swapped: undefined;
  /** file reference or title changed */
  file: undefined;
}

export interface SaveToken {
  bytes: Uint8Array;
  /** model state id the bytes contain */
  state: number;
  /** PDF version the bytes were built from */
  version: number;
}

interface State {
  bytes: Uint8Array;
  pages: AnyObj[][];
}

const fontCache = new Map<string, Uint8Array>();

async function fontBytes(o: TextObj): Promise<[string, Uint8Array]> {
  const key = fontKey(o);
  let b = fontCache.get(key);
  if (!b) {
    const res = await fetch(fontFileUrl(o.f, !!o.b, !!o.i));
    if (!res.ok) throw new Error(`Schrift ${key} konnte nicht geladen werden`);
    b = new Uint8Array(await res.arrayBuffer());
    fontCache.set(key, b);
  }
  return [key, b];
}

async function readMetas(pdf: PDFDocumentProxy): Promise<PageMeta[]> {
  const metas: PageMeta[] = new Array(pdf.numPages);
  const chunk = 40;
  for (let start = 1; start <= pdf.numPages; start += chunk) {
    const end = Math.min(pdf.numPages, start + chunk - 1);
    await Promise.all(
      Array.from({ length: end - start + 1 }, async (_, k) => {
        const p = await pdf.getPage(start + k);
        const vp = p.getViewport({ scale: 1 });
        metas[start + k - 1] = {
          w: vp.width,
          h: vp.height,
          vt: [...vp.transform] as Mat,
          view: [...p.view] as PageMeta['view'],
          rotate: p.rotate,
        };
        p.cleanup();
      }),
    );
  }
  return metas;
}

/** Hides our own baked layer so that the editable objects are not drawn twice. */
async function prepareLayers(pdf: PDFDocumentProxy) {
  const config = await pdf.getOptionalContentConfig({ intent: 'display' });
  for (const [id, group] of config) {
    if ((group as { name?: string }).name === OCG_NAME) config.setVisibility(id, false);
  }
  return config;
}

async function readNotes(pdf: PDFDocumentProxy, pageCount: number): Promise<AnyObj[][] | null> {
  const att = await pdf.getAttachments();
  if (!att) return null;
  const id = [...att.entries()].find(([, a]) => a.filename === NOTES_FILENAME)?.[0];
  if (!id) return null;
  const content = await pdf.getAttachmentContent(id);
  const notes = content ? decodeNotes(content) : null;
  if (!notes) return null;
  const pages: AnyObj[][] = Array.from({ length: pageCount }, () => []);
  for (const [key, pg] of Object.entries(notes.pages)) {
    const i = Number(key);
    if (i < pageCount) pages[i] = pg.objs.map((o) => (o.t === 'text' ? layoutText(o) : o));
  }
  return pages;
}

export type OcConfig = Awaited<ReturnType<typeof prepareLayers>>;

export class DocSession extends Emitter<SessionEvents> {
  pdf!: PDFDocumentProxy;
  metas: PageMeta[] = [];
  readonly model = new AnnotationModel();
  ocConfig!: Promise<OcConfig>;
  /** layer was present in the file as it was opened (so a re-save keeps it editable) */
  hadEditableLayer = false;
  /** the PDF is being replaced (page operation, its undo or redo) */
  swapping = false;
  /** bumped whenever the underlying PDF is replaced (page operations, undo of them) */
  private version = 0;

  private constructor(public bytes: Uint8Array, public file: FileRef, private password?: string) {
    super();
  }

  static async open(bytes: Uint8Array, file: FileRef, password?: string): Promise<DocSession> {
    const s = new DocSession(bytes, file, password);
    const pdf = await loadPdf(bytes, password);
    await s.attach(pdf);
    const notes = await readNotes(pdf, pdf.numPages);
    s.hadEditableLayer = !!notes;
    s.model.reset(notes ?? Array.from({ length: pdf.numPages }, () => []));
    return s;
  }

  get pageCount(): number {
    return this.metas.length;
  }

  get title(): string {
    return this.file.name.replace(/\.pdf$/i, '');
  }

  setFile(file: FileRef): void {
    this.file = file;
    this.emit('file', undefined);
  }

  private async attach(pdf: PDFDocumentProxy): Promise<void> {
    this.pdf = pdf;
    this.metas = await readMetas(pdf);
    this.ocConfig = prepareLayers(pdf);
    await this.ocConfig;
  }

  // ── saving ──────────────────────────────────────────────────────────

  /** Collect every page that carries annotations in the shape the PDF worker needs. */
  private exportPages(): PageExport[] {
    const out: PageExport[] = [];
    this.model.pages.forEach((objs, index) => {
      if (!objs.length) return;
      const m = this.metas[index];
      // copy: the lists keep changing while the worker builds the file
      out.push({ index, objs: objs.slice(), vt: m.vt, view: m.view, w: m.w, h: m.h });
    });
    return out;
  }

  /**
   * Produces the file contents: original PDF + baked appearance + editable data.
   * Waits for running page operations so that PDF and annotations belong together.
   */
  buildBytes(opts: { flatten?: boolean } = {}): Promise<Uint8Array> {
    return this.model.serial(() => this.buildNow(opts));
  }

  /** Like `buildBytes`, plus the state it captured, for `markSaved`. */
  buildForSave(): Promise<SaveToken> {
    return this.model.serial(async () => {
      const state = this.model.stateId;
      const version = this.version;
      return { bytes: await this.buildNow({}), state, version };
    });
  }

  private async buildNow(opts: { flatten?: boolean }): Promise<Uint8Array> {
    const pages = this.exportPages();
    const texts = new Map<string, TextObj>();
    for (const p of pages) for (const o of p.objs) if (o.t === 'text' && o.s.trim()) texts.set(fontKey(o), o);
    const fonts = Object.fromEntries(await Promise.all([...texts.values()].map(fontBytes)));
    return buildPdf({
      bytes: this.bytes.slice(),
      pageCount: this.pageCount,
      pages,
      fonts,
      flatten: !!opts.flatten,
    });
  }

  /**
   * After the file was written: the saved bytes are the new baseline, and the captured
   * state is the clean one (strokes drawn while the file was written stay unsaved).
   */
  markSaved(saved: SaveToken, file: FileRef): void {
    // pages changed meanwhile: keep the current PDF, it already contains that change
    if (saved.version === this.version) this.bytes = saved.bytes;
    this.file = file;
    this.model.markCleanAt(saved.state);
    this.emit('file', undefined);
  }

  // ── structure ───────────────────────────────────────────────────────

  private snapshot(): State {
    return { bytes: this.bytes, pages: this.model.pages.map((p) => p.slice()) };
  }

  private async restore(state: State): Promise<void> {
    const old = this.pdf;
    this.swapping = true;
    this.emit('swapping', undefined);
    try {
      const pdf = await loadPdf(state.bytes, this.password);
      this.bytes = state.bytes;
      this.version++;
      await this.attach(pdf);
      this.model.setPages(state.pages.map((p) => p.slice()));
      void old.loadingTask.destroy();
      this.emit('structure', undefined);
    } finally {
      this.swapping = false;
      this.emit('swapped', undefined);
    }
  }

  /**
   * Applies page operations to the document. Annotations travel with their pages;
   * the operation is one undo step.
   */
  applyStructure(label: string, ops: StructureOp[] | ((s: DocSession) => StructureOp[])): Promise<void> {
    return this.model.serial(() => this.model.whileSwapping(() => this.applyStructureNow(label, typeof ops === 'function' ? ops(this) : ops)));
  }

  /** Page numbers chosen before an earlier page operation finished may be out of range now. */
  private sanitize(ops: StructureOp[]): StructureOp[] {
    const n = this.pageCount;
    const valid = (pages: number[]) => [...new Set(pages)].filter((i) => Number.isInteger(i) && i >= 0 && i < n);
    const out: StructureOp[] = [];
    for (const op of ops) {
      switch (op.op) {
        case 'insertBlank':
        case 'insertPdf':
          out.push({ ...op, at: Math.max(0, Math.min(n, op.at)) });
          break;
        case 'move': {
          const pages = valid(op.pages);
          if (pages.length) out.push({ ...op, pages, to: Math.max(0, Math.min(n, op.to)) });
          break;
        }
        case 'delete': {
          const pages = valid(op.pages);
          // never delete every page
          if (pages.length && pages.length < n) out.push({ ...op, pages });
          break;
        }
        default: {
          const pages = valid(op.pages);
          if (pages.length) out.push({ ...op, pages });
        }
      }
    }
    return out;
  }

  private async applyStructureNow(label: string, requested: StructureOp[]): Promise<void> {
    const ops = this.sanitize(requested);
    if (!ops.length) return;
    const before = this.snapshot();
    const beforeMetas = this.metas;
    const newBytes = await restructurePdf(this.bytes, ops);
    let pages = before.pages.map((p) => p.slice());
    let metas = beforeMetas.slice();
    for (const op of ops) {
      switch (op.op) {
        case 'insertBlank':
          pages.splice(op.at, 0, []);
          metas.splice(op.at, 0, { ...metas[0], w: op.w, h: op.h });
          break;
        case 'delete': {
          const del = new Set(op.pages);
          pages = pages.filter((_, i) => !del.has(i));
          metas = metas.filter((_, i) => !del.has(i));
          break;
        }
        case 'rotate':
          for (const i of op.pages) {
            const m = metas[i];
            const t: Mat =
              op.delta === 90 ? [0, 1, -1, 0, m.h, 0] : op.delta === -90 ? [0, -1, 1, 0, 0, m.w] : [-1, 0, 0, -1, m.w, m.h];
            pages[i] = pages[i].map((o) => transformObj(o, t));
          }
          break;
        case 'move': {
          const moving = op.pages.map((i) => pages[i]);
          const keep = pages.filter((_, i) => !op.pages.includes(i));
          let to = op.to;
          for (const i of op.pages) if (i < op.to) to--;
          keep.splice(to, 0, ...moving);
          pages = keep;
          break;
        }
        case 'insertPdf':
          pages.splice(op.at, 0, ...op.pages.map(() => [] as AnyObj[]));
          metas.splice(op.at, 0, ...op.pages.map(() => metas[0]));
          break;
        case 'duplicate':
          for (const i of [...op.pages].sort((a, b) => b - a)) pages.splice(i + 1, 0, pages[i].map((o) => clone(o)));
          break;
      }
    }
    const after: State = { bytes: newBytes, pages };
    await this.restore(after);
    this.model.commit(label, [], {
      undo: () => this.restore(before),
      redo: () => this.restore(after),
    });
  }

  destroy(): void {
    void this.pdf?.loadingTask.destroy();
  }
}
