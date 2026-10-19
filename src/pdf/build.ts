import {
  PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, PDFStream, PDFString,
  degrees, popGraphicsState, pushGraphicsState, drawObject, rgb as pdfRgb,
} from 'pdf-lib';
import type { PDFFont, PDFImage, PDFObject } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { AnyObj, ImageObj, Mat, NoteObj, TextObj } from '../core/types';
import { NOTE_SIZE } from '../core/objects';
import { hexToRgb, invert } from '../core/geometry';
import { HAS_ITALIC, fontKey } from '../core/fontmeta';
import { NOTES_FILENAME, encodeNotes } from '../core/serialize';
import { buildContent, noteIconOps } from './content';
import type { ContentCtx, FontHandle } from './content';

export const OCG_NAME = 'Scribo Notizen';
const NM_PREFIX = 'scribo:';

export interface PageExport {
  index: number;
  objs: AnyObj[];
  /** pdf.js viewport transform at scale 1: PDF user space → page space */
  vt: Mat;
  /** page box in PDF user space (pdf.js `view`) */
  view: [number, number, number, number];
  w: number;
  h: number;
}

export interface SaveRequest {
  bytes: Uint8Array;
  pageCount: number;
  pages: PageExport[];
  /** font bytes keyed by `fontKey()` */
  fonts: Record<string, Uint8Array>;
  /** merge the layer into the page content instead of keeping it as a removable annotation */
  flatten: boolean;
}

// ── helpers around pdf-lib internals ─────────────────────────────────────

const N = (s: string) => PDFName.of(s);

function textOf(o: PDFObject | undefined): string | undefined {
  if (o instanceof PDFString || o instanceof PDFHexString) return o.decodeText();
  return undefined;
}

/** Remove everything a previous save of ours left behind: annotations and the notes attachment. */
function stripArtifacts(doc: PDFDocument): void {
  const ctx = doc.context;
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let i = annots.size() - 1; i >= 0; i--) {
      const a = ctx.lookupMaybe(annots.get(i), PDFDict);
      const nm = textOf(a?.lookup(N('NM')));
      if (nm && nm.startsWith(NM_PREFIX)) annots.remove(i);
    }
  }
  const names = doc.catalog.lookupMaybe(N('Names'), PDFDict);
  const ef = names?.lookupMaybe(N('EmbeddedFiles'), PDFDict);
  const af = doc.catalog.lookupMaybe(N('AF'), PDFArray);
  const visit = (node: PDFDict) => {
    const arr = node.lookupMaybe(N('Names'), PDFArray);
    if (arr) {
      for (let i = arr.size() - 2; i >= 0; i -= 2) {
        if (textOf(arr.lookup(i)) !== NOTES_FILENAME) continue;
        const spec = arr.get(i + 1);
        if (af && spec instanceof PDFRef) {
          for (let k = af.size() - 1; k >= 0; k--) if (af.get(k) === spec) af.remove(k);
        }
        arr.remove(i + 1);
        arr.remove(i);
      }
    }
    const kids = node.lookupMaybe(N('Kids'), PDFArray);
    if (kids) {
      for (let i = 0; i < kids.size(); i++) {
        const k = ctx.lookupMaybe(kids.get(i), PDFDict);
        if (k) visit(k);
      }
    }
  };
  if (ef) visit(ef);
}

/** Mark & sweep: drop indirect objects that are no longer reachable from the trailer. */
export function sweep(doc: PDFDocument): number {
  const ctx = doc.context;
  const seen = new Set<PDFRef>();
  const stack: PDFObject[] = [];
  const t = ctx.trailerInfo;
  for (const root of [t.Root, t.Info, t.Encrypt, t.ID]) if (root) stack.push(root);
  while (stack.length) {
    const o = stack.pop()!;
    if (o instanceof PDFRef) {
      if (seen.has(o)) continue;
      seen.add(o);
      const target = ctx.lookup(o);
      if (target) stack.push(target);
    } else if (o instanceof PDFDict) {
      for (const v of o.values()) stack.push(v);
    } else if (o instanceof PDFArray) {
      for (let i = 0; i < o.size(); i++) stack.push(o.get(i));
    } else if (o instanceof PDFStream) {
      stack.push(o.dict);
    }
  }
  let removed = 0;
  for (const [ref] of ctx.enumerateIndirectObjects()) {
    if (!seen.has(ref)) {
      ctx.delete(ref);
      removed++;
    }
  }
  return removed;
}

/** Find or create the optional-content group that lets viewers (and Scribo) toggle our layer. */
function ensureOcg(doc: PDFDocument): PDFRef {
  const ctx = doc.context;
  let props = doc.catalog.lookupMaybe(N('OCProperties'), PDFDict);
  if (!props) {
    props = ctx.obj({ OCGs: [], D: { Order: [] } });
    doc.catalog.set(N('OCProperties'), props);
  }
  let ocgs = props.lookupMaybe(N('OCGs'), PDFArray);
  if (!ocgs) {
    ocgs = ctx.obj([]);
    props.set(N('OCGs'), ocgs);
  }
  for (let i = 0; i < ocgs.size(); i++) {
    const ref = ocgs.get(i);
    const d = ctx.lookupMaybe(ref, PDFDict);
    if (d && textOf(d.lookup(N('Name'))) === OCG_NAME && ref instanceof PDFRef) return ref;
  }
  const ref = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFHexString.fromText(OCG_NAME), Intent: 'View' }));
  ocgs.push(ref);
  let d = props.lookupMaybe(N('D'), PDFDict);
  if (!d) {
    d = ctx.obj({});
    props.set(N('D'), d);
  }
  d.lookupMaybe(N('Order'), PDFArray)?.push(ref);
  const base = d.lookupMaybe(N('BaseState'), PDFName);
  if (base && base.decodeText() === 'OFF') {
    let on = d.lookupMaybe(N('ON'), PDFArray);
    if (!on) {
      on = ctx.obj([]);
      d.set(N('ON'), on);
    }
    on.push(ref);
  }
  return ref;
}

function attachNotes(doc: PDFDocument, data: Uint8Array): void {
  const ctx = doc.context;
  const date = new Date();
  const stream = ctx.flateStream(data, {
    Type: 'EmbeddedFile',
    Subtype: 'application/json',
    Params: { Size: data.length, ModDate: PDFString.fromDate(date) },
  });
  const spec = ctx.register(
    ctx.obj({
      Type: 'Filespec',
      F: PDFString.of(NOTES_FILENAME),
      UF: PDFHexString.fromText(NOTES_FILENAME),
      Desc: PDFHexString.fromText('Scribo – editierbare Handschrift und Anmerkungen'),
      EF: { F: ctx.register(stream) },
      AFRelationship: 'Supplement',
    }),
  );
  let names = doc.catalog.lookupMaybe(N('Names'), PDFDict);
  if (!names) {
    names = ctx.obj({});
    doc.catalog.set(N('Names'), names);
  }
  let ef = names.lookupMaybe(N('EmbeddedFiles'), PDFDict);
  if (!ef) {
    ef = ctx.obj({});
    names.set(N('EmbeddedFiles'), ef);
  }
  const key = PDFHexString.fromText(NOTES_FILENAME);
  const flat = ef.lookupMaybe(N('Names'), PDFArray);
  if (flat || !ef.has(N('Kids'))) {
    let arr = flat;
    if (!arr) {
      arr = ctx.obj([]);
      ef.set(N('Names'), arr);
    }
    arr.push(key);
    arr.push(spec);
  } else {
    // name tree with kids: add our own leaf
    const leaf = ctx.obj({ Names: [key, spec], Limits: [key, key] });
    ef.lookup(N('Kids'), PDFArray).push(ctx.register(leaf));
  }
  let af = doc.catalog.lookupMaybe(N('AF'), PDFArray);
  if (!af) {
    af = ctx.obj([]);
    doc.catalog.set(N('AF'), af);
  }
  af.push(spec);
}

// ── page layer ───────────────────────────────────────────────────────────

interface Resources {
  doc: PDFDocument;
  fonts: Map<string, { font: PDFFont; name: string }>;
  fontBytes: Record<string, Uint8Array>;
  images: Map<string, { image: PDFImage; name: string }>;
}

function dataUrlBytes(src: string): { mime: string; bytes: Uint8Array } | null {
  const m = /^data:(image\/[a-z]+);base64,(.*)$/.exec(src);
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { mime: m[1], bytes };
}

async function buildLayer(
  doc: PDFDocument,
  p: PageExport,
  res: Resources,
): Promise<{ form: PDFRef; noteForms: { note: NoteObj; rect: [number, number, number, number]; ref: PDFRef }[] } | null> {
  const ctx = doc.context;
  const T = invert(p.vt);
  if (!T) return null;

  const gsDict = ctx.obj({});
  const gsNames = new Map<string, string>();
  const fontDict = ctx.obj({});
  const xoDict = ctx.obj({});

  // fonts / images must be embedded before the content is generated (async)
  const texts = p.objs.filter((o): o is TextObj => o.t === 'text' && o.s.trim().length > 0);
  for (const t of texts) {
    const key = fontKey(t);
    if (!res.fonts.has(key)) {
      const bytes = res.fontBytes[key];
      if (!bytes) throw new Error(`Font ${key} fehlt`);
      // full embedding: fontkit's subsetter drops glyphs of some of our fonts (Inter, Caveat)
      const font = await doc.embedFont(bytes, { subset: false, features: { calt: false, clig: false, liga: false, rlig: false, dlig: false } });
      res.fonts.set(key, { font, name: `F${res.fonts.size + 1}` });
    }
    const f = res.fonts.get(key)!;
    fontDict.set(N(f.name), f.font.ref);
  }
  const imgs = p.objs.filter((o): o is ImageObj => o.t === 'img');
  for (const im of imgs) {
    if (!res.images.has(im.id)) {
      const d = dataUrlBytes(im.src);
      if (!d) continue;
      const image = d.mime === 'image/jpeg' ? await doc.embedJpg(d.bytes) : await doc.embedPng(d.bytes);
      res.images.set(im.id, { image, name: `Im${res.images.size + 1}` });
    }
    const e = res.images.get(im.id);
    if (e) xoDict.set(N(e.name), e.image.ref);
  }

  const cctx: ContentCtx = {
    T,
    gs({ alpha = 1, blend }) {
      const key = `${alpha}|${blend ?? ''}`;
      let name = gsNames.get(key);
      if (!name) {
        name = `G${gsNames.size + 1}`;
        gsNames.set(key, name);
        gsDict.set(
          N(name),
          ctx.obj({ Type: 'ExtGState', ca: alpha, CA: alpha, BM: blend ?? 'Normal', AIS: false }),
        );
      }
      return name;
    },
    font(o: TextObj): FontHandle {
      const e = res.fonts.get(fontKey(o))!;
      return {
        name: e.name,
        widthOf: (text, size) => e.font.widthOfTextAtSize(text, size),
        encode: (text) => e.font.encodeText(text).toString(),
        fakeItalic: !!o.i && !HAS_ITALIC[o.f],
      };
    },
    image(o: ImageObj) {
      const e = res.images.get(o.id);
      return e ? { name: e.name } : null;
    },
  };

  const [x0, y0, x1, y1] = p.view;
  const resources = ctx.obj({ ExtGState: gsDict, Font: fontDict, XObject: xoDict });
  const content = buildContent(p.objs, cctx);
  const form = ctx.register(
    ctx.flateStream(content, { Type: 'XObject', Subtype: 'Form', BBox: [x0, y0, x1, y1], Resources: resources }),
  );

  // notes get their own small appearance streams
  const noteForms: { note: NoteObj; rect: [number, number, number, number]; ref: PDFRef }[] = [];
  for (const o of p.objs) {
    if (o.t !== 'note') continue;
    const c = [[o.x, o.y], [o.x + NOTE_SIZE, o.y], [o.x + NOTE_SIZE, o.y + NOTE_SIZE], [o.x, o.y + NOTE_SIZE]].map(([x, y]) => ({
      x: T[0] * x + T[2] * y + T[4],
      y: T[1] * x + T[3] * y + T[5],
    }));
    const rect: [number, number, number, number] = [
      Math.min(...c.map((q) => q.x)), Math.min(...c.map((q) => q.y)),
      Math.max(...c.map((q) => q.x)), Math.max(...c.map((q) => q.y)),
    ];
    const ref = ctx.register(
      ctx.flateStream(noteIconOps(o, T, NOTE_SIZE), { Type: 'XObject', Subtype: 'Form', BBox: rect, Resources: ctx.obj({}) }),
    );
    noteForms.push({ note: o, rect, ref });
  }
  return { form, noteForms };
}

export async function buildPdf(req: SaveRequest): Promise<Uint8Array> {
  const doc = await PDFDocument.load(req.bytes, { updateMetadata: false, throwOnInvalidObject: false });
  doc.registerFontkit(fontkit);
  const ctx = doc.context;

  stripArtifacts(doc);
  sweep(doc);

  const res: Resources = { doc, fonts: new Map(), fontBytes: req.fonts, images: new Map() };
  const pages = doc.getPages();
  const ocg = req.flatten ? null : ensureOcg(doc);
  const now = PDFString.fromDate(new Date());

  for (const p of req.pages) {
    const page = pages[p.index];
    if (!page || !p.objs.length) continue;
    const layer = await buildLayer(doc, p, res);
    if (!layer) continue;
    const [x0, y0, x1, y1] = p.view;

    if (req.flatten) {
      const name = page.node.newXObject('ScriboLayer', layer.form);
      page.pushOperators(pushGraphicsState(), drawObject(name.decodeText()), popGraphicsState());
      for (const nf of layer.noteForms) {
        const nm = page.node.newXObject('ScriboNote', nf.ref);
        page.pushOperators(pushGraphicsState(), drawObject(nm.decodeText()), popGraphicsState());
      }
      continue;
    }

    const hasInk = p.objs.some((o) => o.t !== 'note');
    if (hasInk) {
      const annot = ctx.register(
        ctx.obj({
          Type: 'Annot',
          Subtype: 'Stamp',
          Rect: [x0, y0, x1, y1],
          F: 4 | 128,
          Border: [0, 0, 0],
          NM: PDFString.of(`${NM_PREFIX}layer:${p.index}`),
          T: PDFHexString.fromText('Scribo'),
          Contents: PDFHexString.fromText('Scribo – Handschrift und Anmerkungen'),
          M: now,
          AP: { N: layer.form },
          OC: ocg!,
        }),
      );
      page.node.addAnnot(annot);
    }
    for (const nf of layer.noteForms) {
      const [r, g, b] = hexToRgb(nf.note.c);
      const annot = ctx.register(
        ctx.obj({
          Type: 'Annot',
          Subtype: 'Text',
          Rect: nf.rect,
          F: 4,
          Name: 'Note',
          C: [r / 255, g / 255, b / 255],
          NM: PDFString.of(`${NM_PREFIX}note:${nf.note.id}`),
          T: PDFHexString.fromText('Scribo'),
          Contents: PDFHexString.fromText(nf.note.s),
          M: now,
          AP: { N: nf.ref },
          OC: ocg!,
        }),
      );
      page.node.addAnnot(annot);
    }
  }

  if (!req.flatten) {
    const lists: AnyObj[][] = Array.from({ length: req.pageCount }, () => []);
    const sizes = Array.from({ length: req.pageCount }, () => ({ w: 0, h: 0 }));
    for (const p of req.pages) {
      lists[p.index] = p.objs;
      sizes[p.index] = { w: p.w, h: p.h };
    }
    if (req.pages.some((p) => p.objs.length)) attachNotes(doc, encodeNotes(lists, sizes));
  }

  doc.setModificationDate(new Date());
  return doc.save({ useObjectStreams: true, addDefaultPage: false });
}

// ── structural edits ─────────────────────────────────────────────────────

export type BlankTemplate = 'blank' | 'lined' | 'grid' | 'dotted';

export type StructureOp =
  | { op: 'insertBlank'; at: number; w: number; h: number; template: BlankTemplate }
  | { op: 'delete'; pages: number[] }
  | { op: 'rotate'; pages: number[]; delta: 90 | -90 | 180 }
  | { op: 'move'; pages: number[]; to: number }
  | { op: 'insertPdf'; at: number; bytes: Uint8Array; pages: number[] }
  | { op: 'duplicate'; pages: number[] };

/** Spacing of the paper patterns in pt: lined ≈ 8 mm, grid and dots 5 mm ("Häuschenpapier"). */
export const PAPER_STEP = { lined: 22.68, grid: 14.17, dotted: 14.17 } as const;

/**
 * Paper pattern of a blank page, centred so that the margins are equal on all sides.
 * Lined paper has a header area and a margin line like a school notebook.
 */
function drawTemplate(doc: PDFDocument, index: number, w: number, h: number, template: BlankTemplate): void {
  if (template === 'blank') return;
  const page = doc.getPage(index);
  const rgb = (hex: string) => {
    const [r, g, b] = hexToRgb(hex);
    return pdfRgb(r / 255, g / 255, b / 255);
  };
  const step = PAPER_STEP[template];
  // 10 mm margin, then as many whole cells as fit, centred
  const fit = (len: number) => {
    const n = Math.floor((len - 2 * 28.35) / step);
    return { n, o: (len - n * step) / 2 };
  };
  const X = fit(w);
  const Y = fit(h);
  if (template === 'lined') {
    const line = rgb('#b9c9e2');
    const top = 62;
    for (let y = top; y <= h - 34; y += step) {
      page.drawLine({ start: { x: 28.35, y: h - y }, end: { x: w - 28.35, y: h - y }, thickness: 0.55, color: line });
    }
    page.drawLine({ start: { x: 70.9, y: h - 28 }, end: { x: 70.9, y: 28 }, thickness: 0.6, color: rgb('#f2a7a7') });
  } else if (template === 'grid') {
    const line = rgb('#c6d4ea');
    const x1 = X.o + X.n * step;
    const y1 = Y.o + Y.n * step;
    for (let i = 0; i <= X.n; i++) {
      const x = X.o + i * step;
      page.drawLine({ start: { x, y: h - Y.o }, end: { x, y: h - y1 }, thickness: 0.4, color: line });
    }
    for (let j = 0; j <= Y.n; j++) {
      const y = Y.o + j * step;
      page.drawLine({ start: { x: X.o, y: h - y }, end: { x: x1, y: h - y }, thickness: 0.4, color: line });
    }
  } else {
    const dot = rgb('#9fb0c8');
    for (let i = 0; i <= X.n; i++) {
      for (let j = 0; j <= Y.n; j++) page.drawCircle({ x: X.o + i * step, y: h - (Y.o + j * step), size: 0.6, color: dot, borderWidth: 0 });
    }
  }
}

/** A new document of `count` blank pages with the given paper. */
export async function createBlank(w: number, h: number, template: BlankTemplate, count = 1): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('Notizen');
  doc.setCreator('Scribo');
  doc.setProducer('Scribo');
  for (let i = 0; i < count; i++) {
    doc.addPage([w, h]);
    drawTemplate(doc, i, w, h, template);
  }
  return doc.save({ useObjectStreams: true, addDefaultPage: false });
}

/** Applies page-structure edits and returns the new file. */
export async function restructure(bytes: Uint8Array, ops: StructureOp[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false });
  for (const op of ops) {
    switch (op.op) {
      case 'insertBlank': {
        doc.insertPage(op.at, [op.w, op.h]);
        drawTemplate(doc, op.at, op.w, op.h, op.template);
        break;
      }
      case 'delete':
        for (const i of [...op.pages].sort((a, b) => b - a)) doc.removePage(i);
        break;
      case 'rotate':
        for (const i of op.pages) {
          const p = doc.getPage(i);
          p.setRotation(degrees((((p.getRotation().angle + op.delta) % 360) + 360) % 360));
        }
        break;
      case 'move': {
        const all = doc.getPages();
        const moving = op.pages.map((i) => all[i]);
        for (const i of [...op.pages].sort((a, b) => b - a)) doc.removePage(i);
        let to = op.to;
        for (const i of op.pages) if (i < op.to) to--;
        moving.forEach((p, k) => doc.insertPage(to + k, p));
        break;
      }
      case 'insertPdf': {
        const other = await PDFDocument.load(op.bytes, { updateMetadata: false, throwOnInvalidObject: false });
        stripArtifacts(other);
        const copied = await doc.copyPages(other, op.pages);
        copied.forEach((p, k) => doc.insertPage(op.at + k, p));
        break;
      }
      case 'duplicate': {
        const sorted = [...op.pages].sort((a, b) => b - a);
        for (const i of sorted) {
          const [copy] = await doc.copyPages(doc, [i]);
          doc.insertPage(i + 1, copy);
        }
        break;
      }
    }
  }
  sweep(doc);
  return doc.save({ useObjectStreams: true, addDefaultPage: false });
}

