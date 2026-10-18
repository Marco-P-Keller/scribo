import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDocument, StandardFonts, PDFName, PDFDict, PDFArray, PDFString, PDFHexString } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildPdf, restructure } from '../src/pdf/build';
import type { PageExport } from '../src/pdf/build';
import { decodeNotes } from '../src/core/serialize';
import type { AnyObj, InkObj, Mat } from '../src/core/types';

const font = (name: string) => new Uint8Array(readFileSync(`public/fonts/${name}`));
const FONTS = {
  'sans-400Regular.ttf': font('sans-400Regular.ttf'),
  'sans-700Bold.ttf': font('sans-700Bold.ttf'),
  'mono-400Regular.ttf': font('mono-400Regular.ttf'),
};

async function basePdf(pages = 2): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([595.28, 841.89]);
    p.drawText(`Seite ${i + 1} – Vorlesung Analysis`, { x: 60, y: 780, size: 20, font: f });
  }
  return doc.save();
}

const VT: Mat = [1, 0, 0, -1, 0, 841.89]; // rotation 0 viewport transform, view [0,0,595.28,841.89]

const stroke = (id: string, hl = false): InkObj => ({
  id, t: 'ink', c: hl ? '#ffe14d' : '#0a84ff', w: hl ? 14 : 2.4, ...(hl ? { hl: 1 as const } : {}),
  p: Array.from({ length: 40 }, (_, i) => [100 + i * 4, 200 + Math.sin(i / 4) * 12, 0.3 + (i % 10) / 20]).flat(),
});

const objs = (): AnyObj[] => [
  stroke('a'),
  stroke('b', true),
  { id: 'c', t: 'shape', k: 'ellipse', p: [300, 400, 60, 0, 0, 40], c: '#ff3b30', w: 2 },
  { id: 'd', t: 'shape', k: 'rect', p: [100, 500, 220, 500, 220, 560, 100, 560], c: '#34c759', w: 2, fill: '#34c759', fo: 0.2 },
  { id: 'e', t: 'shape', k: 'arrow', p: [100, 600, 300, 640], c: '#000000', w: 3 },
  { id: 'f', t: 'text', x: 80, y: 100, w: 300, s: 'Ableitung f′(x) = 2x', ls: ['Ableitung f′(x) = 2x'], h: 24, f: 'sans', z: 14, c: '#111111' },
  { id: 'g', t: 'note', x: 450, y: 120, s: 'Das kommt in die Klausur!', c: '#ffd60a' },
  { id: 'h', t: 'mark', k: 'hl', q: [60, 50, 200, 22], c: '#ffe14d' },
];

function pageExport(index: number, o: AnyObj[]): PageExport {
  return { index, objs: o, vt: VT, view: [0, 0, 595.28, 841.89], w: 595.28, h: 841.89 };
}

async function annotsOf(bytes: Uint8Array, page: number) {
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(page).node.Annots();
  const out: { subtype: string; nm: string }[] = [];
  if (!annots) return out;
  for (let i = 0; i < annots.size(); i++) {
    const a = doc.context.lookup(annots.get(i), PDFDict);
    const nm = a.lookup(PDFName.of('NM'));
    out.push({
      subtype: (a.lookup(PDFName.of('Subtype')) as PDFName).decodeText(),
      nm: nm instanceof PDFString || nm instanceof PDFHexString ? nm.decodeText() : '',
    });
  }
  return out;
}

describe('PDF save pipeline', () => {
  it('bakes annotations, hides them behind an optional-content layer and embeds editable data', async () => {
    const base = await basePdf();
    const out = await buildPdf({ bytes: base, pageCount: 2, pages: [pageExport(0, objs())], fonts: FONTS, flatten: false });

    // standard annotations written
    const annots = await annotsOf(out, 0);
    expect(annots.map((a) => a.subtype).sort()).toEqual(['Stamp', 'Text']);
    expect(annots.every((a) => a.nm.startsWith('scribo:'))).toBe(true);
    expect((await annotsOf(out, 1)).length).toBe(0);

    // readable by pdf.js, attachment + layer present
    const task = pdfjs.getDocument({ data: out.slice(), verbosity: 0 });
    const pdf = await task.promise;
    const att = await pdf.getAttachments();
    const id = [...(att?.entries() ?? [])].find(([, a]) => a.filename === 'scribo-notes.json')?.[0];
    expect(id).toBeDefined();
    const notes = decodeNotes((await pdf.getAttachmentContent(id!))!);
    expect(notes?.pages['0'].objs.length).toBe(8);
    const ink = notes!.pages['0'].objs[0] as InkObj;
    expect(ink.p.length).toBe(120);
    expect(ink.p[0]).toBeCloseTo(100, 1);
    expect(ink.p[2]).toBeCloseTo(0.3, 1);

    const oc = await pdf.getOptionalContentConfig();
    const names = [...oc].map(([, g]) => (g as { name: string }).name);
    expect(names).toContain('Scribo Notizen');

    const page = await pdf.getPage(1);
    const anns = await page.getAnnotations();
    expect(anns.length).toBe(2);
    await task.destroy();
  });

  it('replaces previous annotations on re-save and does not grow without bound', async () => {
    const base = await basePdf();
    const first = await buildPdf({ bytes: base, pageCount: 2, pages: [pageExport(0, objs())], fonts: FONTS, flatten: false });
    const second = await buildPdf({ bytes: first, pageCount: 2, pages: [pageExport(0, objs())], fonts: FONTS, flatten: false });
    const third = await buildPdf({ bytes: second, pageCount: 2, pages: [pageExport(0, objs().slice(0, 2))], fonts: FONTS, flatten: false });
    expect((await annotsOf(second, 0)).length).toBe(2);
    expect((await annotsOf(third, 0)).length).toBe(1); // only ink layer left, no note
    expect(Math.abs(second.length - first.length)).toBeLessThan(first.length * 0.02);
    expect(third.length).toBeLessThan(first.length);
    // OCG reused, not duplicated
    const doc = await PDFDocument.load(third);
    const ocgs = doc.catalog.lookup(PDFName.of('OCProperties'), PDFDict).lookup(PDFName.of('OCGs'), PDFArray);
    expect(ocgs.size()).toBe(1);
  });

  it('removes the attachment and layer when everything was erased', async () => {
    const base = await basePdf();
    const first = await buildPdf({ bytes: base, pageCount: 2, pages: [pageExport(0, objs())], fonts: FONTS, flatten: false });
    const cleared = await buildPdf({ bytes: first, pageCount: 2, pages: [], fonts: FONTS, flatten: false });
    expect((await annotsOf(cleared, 0)).length).toBe(0);
    const task = pdfjs.getDocument({ data: cleared.slice(), verbosity: 0 });
    expect(await (await task.promise).getAttachments()).toBeNull();
    await task.destroy();
    expect(cleared.length).toBeLessThan(first.length);
  });

  it('flatten merges the layer into the page content (no annotations, no data)', async () => {
    const base = await basePdf();
    const flat = await buildPdf({ bytes: base, pageCount: 2, pages: [pageExport(0, objs())], fonts: FONTS, flatten: true });
    expect((await annotsOf(flat, 0)).length).toBe(0);
    const task = pdfjs.getDocument({ data: flat.slice(), verbosity: 0 });
    expect(await (await task.promise).getAttachments()).toBeNull();
    await task.destroy();
    expect(flat.length).toBeGreaterThan(base.length);
  });

  it('applies page structure edits', async () => {
    const base = await basePdf(3);
    let out = await restructure(base, [{ op: 'insertBlank', at: 1, w: 595.28, h: 841.89, template: 'lined' }]);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(4);
    out = await restructure(out, [{ op: 'delete', pages: [0] }]);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(3);
    out = await restructure(out, [{ op: 'rotate', pages: [0], delta: 90 }]);
    expect((await PDFDocument.load(out)).getPage(0).getRotation().angle).toBe(90);
    out = await restructure(out, [{ op: 'move', pages: [0], to: 3 }]);
    const doc = await PDFDocument.load(out);
    expect(doc.getPage(2).getRotation().angle).toBe(90);
    out = await restructure(out, [{ op: 'duplicate', pages: [1] }]);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(4);
  });
});
