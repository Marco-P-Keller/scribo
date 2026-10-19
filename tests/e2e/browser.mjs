// Browser end-to-end test of the production build: pen input (trusted pointer events with
// pressure), pen buttons, every tool, search, page operations, touch gestures and a save roundtrip.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { PDFDocument, degrees } from 'pdf-lib';
import { fixture, openDoc, pinLayout, Pen, wave, circle } from './helpers.mjs';

const dist = join(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'), 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  const path = normalize(join(dist, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  const file = existsSync(path) && statSync(path).isDirectory() ? join(path, 'index.html') : path;
  if (!file.startsWith(dist) || !existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

setTimeout(() => {
  console.error('✗ browser e2e watchdog: timed out');
  process.exit(2);
}, 240000).unref();

let failures = 0;
const ok = (c, m) => {
  console.log(c ? '✓' : '✗', m);
  if (!c) failures++;
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 }, hasTouch: true, locale: 'de-DE' });
const page = await ctx.newPage();
page.on('pageerror', (e) => {
  console.log('✗ pageerror', e.message);
  failures++;
});
await page.goto(`${url}?e2e=1`);
await page.waitForFunction(() => window.__scribo, null, { polling: 100 });
await openDoc(page, fixture());
const cdp = await ctx.newCDPSession(page);
const pen = new Pen(cdp);
const objs = () => page.evaluate(() => window.__scribo.session.model.pages[0].map((o) => o.t + ':' + (o.k ?? (o.hl ? 'hl' : ''))));
const setting = (k, v) => page.evaluate(([k, v]) => window.__scribo.settings.set(k, v), [k, v]);

// ── pen, buttons, undo ──────────────────────────────────────────────────────
// the stroke must be visible under the pen while it is drawn, not only after lifting
{
  const pts = wave(300, 330, 300);
  await pen.hover(pts[0][0], pts[0][1]);
  await pen.send('mousePressed', pts[0][0], pts[0][1], { force: pts[0][2], buttons: 1, button: 'left' });
  for (const [x, y, p] of pts.slice(1, 30)) await pen.send('mouseMoved', x, y, { force: p, buttons: 1, button: 'left' });
  await page.waitForTimeout(80);
  const live = await page.evaluate(([x, y]) => {
    const v = window.__scribo.viewer.realized[0];
    const c = v.el.querySelector('canvas.live');
    if (!c) return 0;
    // ink pixels within 6 css px of the pen position
    const r = c.getBoundingClientRect();
    const k = c.width / r.width;
    const d = c.getContext('2d').getImageData(Math.round((x - r.left - 6) * k), Math.round((y - r.top - 6) * k), Math.round(12 * k), Math.round(12 * k)).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 100) n++;
    return n;
  }, pts[29]);
  ok(live > 10, `the stroke is drawn live under the pen (${live} px)`);
  for (const [x, y, p] of pts.slice(30)) await pen.send('mouseMoved', x, y, { force: p, buttons: 1, button: 'left' });
  await pen.send('mouseReleased', pts.at(-1)[0], pts.at(-1)[1], { force: 0, buttons: 0, button: 'left' });
}
ok((await objs()).join() === 'ink:', 'pen stroke is stored');
{
  // pressure does not change the width by default; switched on, it does
  const widths = () => page.evaluate(() => { const p = window.__scribo.session.model.pages[0].at(-1).p; return new Set(p.filter((_, i) => i % 3 === 2)).size; });
  ok((await widths()) === 1, 'by default pressure does not change the line width');
  await setting('pressureWidth', true);
  await setting('smoothing', 0.9);
  await pen.stroke(wave(300, 520, 300));
  const last = await page.evaluate(() => window.__scribo.session.model.pages[0].at(-1));
  ok((await widths()) > 3 && last.sm === 0.9, 'switched on, pressure changes the width; the smoothing is stored with the stroke');
  await page.keyboard.press('Control+z');
  await setting('pressureWidth', false);
  await setting('smoothing', 0.5);
}
// eraser button (code 32, without the tip bit); CDP can't send it, so use synthetic pointer events
const synth = (kind, x, y, buttons, pressure, button = -1) => page.evaluate(([kind, x, y, buttons, pressure, button]) => {
  window.__scribo.viewer.stage.dispatchEvent(new PointerEvent(kind, { bubbles: true, cancelable: true, pointerId: 77, pointerType: 'pen', clientX: x, clientY: y, buttons, pressure, button }));
}, [kind, x, y, buttons, pressure, button]);
await synth('pointerdown', 420, 280, 32, 0.5, 5);
for (const y of [300, 330, 360, 380]) await synth('pointermove', 420, y, 32, 0.5);
await synth('pointerup', 420, 380, 0, 0, 5);
ok((await objs()).length === 0, 'the eraser button (code 32) erases the stroke it crosses');
await page.keyboard.press('Control+z');
ok((await objs()).length === 1, 'undo brings the erased stroke back');
// eraser button held in the air: the contact arrives as a move without a pointerdown
await synth('pointermove', 420, 270, 32, 0);
for (const y of [280, 300, 330, 360, 380]) await synth('pointermove', 420, y, 32, 0.5);
await synth('pointermove', 420, 390, 32, 0);
await synth('pointerleave', 420, 390, 0, 0);
ok((await objs()).length === 0, 'eraser contact without pointerdown erases too');
await page.keyboard.press('Control+z');
// side button (code 2) = lasso; Windows reports the tip contact as the second button only
const loop = [[260, 270], [640, 270], [640, 400], [260, 400], [262, 272]];
await pen.hover(260, 270, 2);
await pen.send('mousePressed', 260, 270, { force: 0.5, buttons: 2, button: 'right' });
for (const [x, y] of loop.slice(1)) for (let k = 0; k < 3; k++) await pen.send('mouseMoved', x, y, { force: 0.5, buttons: 2, button: 'right' });
await pen.send('mouseReleased', 262, 272, { force: 0, buttons: 0, button: 'right' });
ok(await page.evaluate(() => window.__scribo.editor.selection.ids.length === 1), 'side button lassos the stroke');
// the plain tip moves the lasso selection although the pen tool is active
{
  const p0 = await page.evaluate(() => window.__scribo.session.model.pages[0][0].p.slice(0, 2));
  await pen.stroke([[450, 330, 0.5], [470, 350, 0.5], [490, 370, 0.5]]);
  const p1 = await page.evaluate(() => window.__scribo.session.model.pages[0][0].p.slice(0, 2));
  ok((await objs()).length === 1 && Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) > 20, 'the pen tip drags the selection instead of writing');
  await page.keyboard.press('Control+z');
}
await page.keyboard.press('Delete');
ok((await objs()).length === 0, 'Delete removes the selection');
await page.keyboard.press('Control+z');
await page.keyboard.press('Escape');
// ── shape recognition ───────────────────────────────────────────────────────
await setting('snap', 'auto');
await pen.stroke(circle(900, 420, 70));
ok((await objs()).includes('shape:ellipse'), 'automatic shape recognition turns a circle into an ellipse');
await setting('snap', 'hold');
await pen.stroke(circle(900, 640, 50), { holdMs: 800 });
ok((await objs()).filter((o) => o === 'shape:ellipse').length === 2, 'hold-to-snap works');
await setting('snap', 'off');

// ── tools ───────────────────────────────────────────────────────────────────
await page.keyboard.press('h');
await pen.stroke([[330, 640, 0.5], [600, 642, 0.5]]);
ok((await objs()).includes('ink:hl'), 'highlighter');
await page.keyboard.press('s');
await page.mouse.move(700, 250);
await page.mouse.down();
await page.mouse.move(800, 300, { steps: 5 });
await page.mouse.move(900, 340, { steps: 5 });
await page.mouse.up();
ok((await objs()).some((o) => o.startsWith('shape:rect')), 'rectangle shape');
await page.keyboard.press('t');
await page.mouse.click(300, 560);
await page.waitForSelector('textarea.text-editor');
await page.keyboard.type('Merke: f′(x) = 2x');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
ok((await objs()).includes('text:'), 'text box');
await page.keyboard.press('n');
await page.mouse.click(1100, 300);
await page.waitForSelector('textarea.note-text');
await page.keyboard.type('Klausurrelevant!');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
ok((await objs()).includes('note:'), 'sticky note');

// ── select, move, text mark-up ──────────────────────────────────────────────
await page.keyboard.press('v');
const rect = () => page.evaluate(() => window.__scribo.session.model.pages[0].find((o) => o.k === 'rect').p.slice(0, 2));
const r0 = await rect();
await page.mouse.move(800, 252);
await page.mouse.down();
await page.mouse.move(850, 290, { steps: 6 });
await page.mouse.up();
const r1 = await rect();
ok(Math.hypot(r1[0] - r0[0], r1[1] - r0[1]) > 20, 'dragging moves the selected shape');
await page.keyboard.press('Control+z');
// with the pen over PDF text, the select tool moves the object instead of selecting text
{
  const at = await page.evaluate(() => { const o = window.__scribo.session.model.pages[0].find((o) => o.t === 'ink'); return window.__scribo.viewer.realized[0].pageToClient(o.p[30], o.p[31]); });
  const i0 = await page.evaluate(() => window.__scribo.session.model.pages[0].find((o) => o.t === 'ink').p.slice(0, 2));
  await pen.stroke([[at.x, at.y, 0.5], [at.x + 20, at.y + 15, 0.5], [at.x + 40, at.y + 30, 0.5]]);
  const i1 = await page.evaluate(() => window.__scribo.session.model.pages[0].find((o) => o.t === 'ink').p.slice(0, 2));
  const text = await page.evaluate(() => String(window.getSelection()));
  ok(Math.hypot(i1[0] - i0[0], i1[1] - i0[1]) > 15 && !text, 'pen drag in the select tool moves the stroke, no text selection');
}
await page.keyboard.press('Control+z');
const r2 = await rect();
ok(Math.hypot(r2[0] - r0[0], r2[1] - r0[1]) < 0.01, 'undo restores the position');
await page.keyboard.press('Escape');
await page.waitForFunction(() => window.__scribo.viewer.realized[0]?.pageText()?.includes('dieser'), null, { timeout: 10000, polling: 100 });
const span = await page.evaluate(() => {
  const b = [...document.querySelectorAll('.textLayer span')].find((e) => e.textContent.includes('In dieser')).getBoundingClientRect();
  return { x: b.left, y: b.top + b.height / 2, w: b.width };
});
await page.mouse.move(span.x + 2, span.y);
await page.mouse.down();
await page.mouse.move(span.x + span.w * 0.6, span.y + 1, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(400);
await page.locator('.mark-dot').first().click();
ok((await objs()).some((o) => o.startsWith('mark:')), 'selected PDF text can be highlighted');

// ── search, pages ───────────────────────────────────────────────────────────
await page.keyboard.press('Control+f');
await page.keyboard.type('vorlesung');
await page.waitForFunction(() => document.querySelectorAll('.hit-row').length > 0, null, { timeout: 8000, polling: 100 }).catch(() => undefined);
ok((await page.evaluate(() => document.querySelectorAll('.hit-row').length)) > 0, 'full-text search finds hits');
await page.keyboard.press('Escape');
await page.evaluate(() => window.__scribo.applyPageOps('x', [{ op: 'insertBlank', at: 1, w: 595, h: 842, template: 'lined' }]));
ok((await page.evaluate(() => window.__scribo.session.pageCount)) === 5, 'blank page inserted');
await page.evaluate(() => window.__scribo.session.model.undo());
ok((await page.evaluate(() => window.__scribo.session.pageCount)) === 4, 'page insertion can be undone');
await page.evaluate(() => window.__scribo.viewer.addPageButton.click());
await page.waitForSelector('.page-setup');
await page.locator('.paper-card').nth(2).click();
await page.locator('.page-setup .seg', { hasText: 'A5' }).click();
await page.locator('.page-setup .seg', { hasText: 'Querformat' }).click();
await page.locator('.sheet .btn.primary').click();
await page.waitForFunction(() => window.__scribo.session.pageCount === 5, null, { timeout: 8000 }).catch(() => undefined);
ok((await page.evaluate(() => window.__scribo.session.pageCount)) === 5, '"add page" appends a page');
{
  const m = await page.evaluate(() => window.__scribo.session.metas[4]);
  ok(Math.abs(m.w - 595.28) < 1 && Math.abs(m.h - 419.53) < 1, `"add page" uses the chosen size and orientation (${m.w} × ${m.h})`);
  ok(await page.evaluate(() => window.__scribo.settings.get('paper') === 'grid' && window.__scribo.settings.get('pageSize') === 'A5'), 'paper and size are remembered');
}
await page.evaluate(() => window.__scribo.session.model.undo());
ok((await objs()).length >= 6, 'annotations survive page operations');

// ── touch ───────────────────────────────────────────────────────────────────
await page.evaluate(() => { window.__scribo.viewer.setZoom(1); window.__scribo.viewer.stage.scrollTo(0, 0); });
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id, force: 0.5 })) });
const top0 = await page.evaluate(() => window.__scribo.viewer.stage.scrollTop);
await touch('touchStart', [[600, 600]]);
for (let i = 1; i <= 8; i++) await touch('touchMove', [[600, 600 - i * 40]]);
await touch('touchEnd', []);
ok((await page.evaluate(() => window.__scribo.viewer.stage.scrollTop)) > top0 + 150, 'one-finger drag scrolls');
const z0 = await page.evaluate(() => window.__scribo.viewer.zoom);
await touch('touchStart', [[500, 500], [700, 500]]);
for (let i = 1; i <= 10; i++) await touch('touchMove', [[500 - i * 15, 500], [700 + i * 15, 500]]);
await touch('touchEnd', []);
await page.waitForTimeout(300);
ok((await page.evaluate(() => window.__scribo.viewer.zoom)) > z0 * 1.4, 'pinch zooms');

// ── very high zoom ──────────────────────────────────────────────────────────
await page.evaluate(() => window.__scribo.viewer.setZoom(6));
await page.waitForTimeout(2500);
const px = await page.evaluate(() => {
  const v = window.__scribo.viewer.realized[0];
  const c = v.el.querySelector('canvas.pdf');
  return v.rendered ? c.width * c.height : -1;
});
ok(px > 0 && px < 16_000_000, `zoom 600% stays within the bitmap budget (${px} px)`);
await page.evaluate(() => window.__scribo.viewer.setZoom(1));


// ── export geometry on rotated / cropped pages ──────────────────────────────
// A red box is placed in page space on pages with /Rotate 0, 90, 180, 270 and an offset crop box.
// The baked appearance written into the PDF must land on exactly the same spot.
{
  const doc = await PDFDocument.create();
  for (const [i, rot] of [0, 90, 180, 270].entries()) {
    const p = doc.addPage([400, 300]);
    p.setRotation(degrees(rot));
    if (i === 3) p.setCropBox(20, 30, 330, 240);
  }
  const b64 = Buffer.from(await doc.save()).toString('base64');
  await openDoc(page, b64, 'rot.pdf');
  const res = await page.evaluate(async () => {
    const app = window.__scribo;
    const s = app.session;
    const out = [];
    for (let i = 0; i < s.pageCount; i++) {
      const m = s.metas[i];
      s.model.add('box', i, { id: `g${i}`, t: 'shape', k: 'rect', p: [50, 40, 150, 40, 150, 100, 50, 100], c: '#ff0000', w: 1, fill: '#ff0000', fo: 1 });
    }
    const bytes = await s.buildBytes();
    const s2 = await s.constructor.open(bytes, { name: 'rot2.pdf' });
    // baked layer visible (default optional-content state) vs hidden (what Scribo shows)
    const visible = await s2.pdf.getOptionalContentConfig();
    for (let i = 0; i < s2.pageCount; i++) {
      const page = await s2.pdf.getPage(i + 1);
      const render = async (cfg) => {
        const vp = page.getViewport({ scale: 1 });
        const c = document.createElement('canvas');
        c.width = Math.ceil(vp.width);
        c.height = Math.ceil(vp.height);
        await page.render({ canvas: c, viewport: vp, background: '#fff', annotationMode: 1, optionalContentConfigPromise: Promise.resolve(cfg) }).promise;
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
        for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
          const k = (y * c.width + x) * 4;
          if (d[k] > 200 && d[k + 1] < 60 && d[k + 2] < 60) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
        }
        return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
      };
      out.push({ page: i, baked: await render(visible), hidden: await render(await s2.ocConfig), size: [s2.metas[i].w, s2.metas[i].h] });
    }
    return out;
  });
  for (const r of res) {
    const near = r.baked && [50, 40, 150, 100].every((v, k) => Math.abs(r.baked[k] - v) <= 2);
    ok(near, `baked ink sits on the editable position on page ${r.page + 1} (${JSON.stringify(r.baked)})`);
    ok(r.hidden === null, `baked layer is hidden for Scribo on page ${r.page + 1}`);
  }
}

// ── new notebook ────────────────────────────────────────────────────────────
page.once('dialog', (d) => d.accept());
await page.evaluate(() => window.__scribo.newNotebook());
await page.waitForSelector('.paper-picker');
ok((await page.locator('.page-setup .seg', { hasText: 'Wie Seite' }).count()) === 0, 'a new notebook offers no "same size"');
await page.locator('.paper-card').nth(2).click();
await page.locator('.page-setup .seg', { hasText: 'A3' }).click();
await page.locator('.page-setup .seg', { hasText: 'Hochformat' }).click();
await page.locator('.sheet .btn.primary').click();
await page.waitForFunction(() => window.__scribo.session?.file.untitled, null, { timeout: 10000 }).catch(() => undefined);
ok(await page.evaluate(() => window.__scribo.session.pageCount === 1 && window.__scribo.session.file.untitled === true), 'a new notebook opens with one page');
ok(await page.evaluate(() => window.__scribo.settings.get('paper') === 'grid'), 'the chosen paper is remembered');
ok(await page.evaluate(() => { const m = window.__scribo.session.metas[0]; return Math.abs(m.w - 841.89) < 1 && Math.abs(m.h - 1190.55) < 1; }), 'the notebook has the chosen size (A3 portrait)');

// ── saving while drawing / while a page operation runs ─────────────────────
{
  const r = await page.evaluate(async () => {
    const app = window.__scribo;
    const s = app.session;
    const n0 = s.pageCount;
    // a page operation and a save started right after each other must not mix
    const op = app.applyPageOps('x', (d) => [{ op: 'insertBlank', at: d.pageCount, w: 300, h: 300, template: 'blank' }]);
    const saving = s.buildForSave();
    await op;
    // the build has captured the document once the page operation is done; draw now
    await new Promise((r) => setTimeout(r, 0));
    s.model.add('late', 0, { id: 'late', t: 'shape', k: 'line', p: [10, 10, 50, 50], c: '#000', w: 1 });
    const built = await saving;
    s.markSaved(built, s.file);
    const reopened = await s.constructor.open(built.bytes, { name: 'y.pdf' });
    return { pages: reopened.pageCount, expected: n0 + 1, dirty: s.model.dirty, late: reopened.model.pages[0].some((o) => o.id === 'late') };
  });
  ok(r.pages === r.expected, `a save waits for the running page operation (${r.pages}/${r.expected} pages)`);
  ok(r.dirty && !r.late, 'a stroke drawn while saving stays unsaved, so closing still asks');
  await page.evaluate(() => window.__scribo.session.model.undo());
  await page.evaluate(() => window.__scribo.session.model.undo());
}

// ── save roundtrip ──────────────────────────────────────────────────────────
await openDoc(page, fixture());
await page.keyboard.press('p');
await pen.stroke(wave(300, 330, 300));
const back = await page.evaluate(async () => {
  const s = window.__scribo.session;
  const bytes = await s.buildBytes();
  const s2 = await s.constructor.open(bytes, { name: 'x.pdf' });
  return s2.model.pages[0].map((o) => o.t).join(',');
});
ok(back === 'ink', `save + reopen keeps the stroke editable (${back})`);

// ── ink lands under the pen in every view state (Windows-like 150 % display scaling) ──
{
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 1.5 });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', (e) => {
    console.log('✗ pageerror', e.message);
    failures++;
  });
  await p2.goto(`${url}?e2e=1`);
  await p2.waitForFunction(() => window.__scribo, null, { polling: 100 });
  await openDoc(p2, fixture());
  await p2.waitForTimeout(500);
  const pen2 = new Pen(await ctx2.newCDPSession(p2));
  const inkAt = (sel, x, y) => p2.evaluate(([sel, x, y]) => {
    let n = 0;
    for (const c of document.querySelectorAll(sel)) {
      const r = c.getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
      const kx = c.width / r.width, ky = c.height / r.height;
      const d = c.getContext('2d').getImageData(Math.round((x - r.left - 4) * kx), Math.round((y - r.top - 4) * ky), Math.max(1, Math.round(8 * kx)), Math.max(1, Math.round(8 * ky))).data;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 90) n++;
    }
    return n;
  }, [sel, x, y]);
  const settle = () => p2.waitForFunction(() => window.__scribo.viewer.realized.every((v) => v.isCurrent()), null, { timeout: 10000 }).catch(() => undefined).then(() => p2.waitForTimeout(150));
  const probe = async (label, x, y) => {
    await pen2.hover(x - 60, y);
    await pen2.send('mousePressed', x - 60, y, { force: 0.5, buttons: 1, button: 'left' });
    for (let i = 1; i <= 12; i++) await pen2.send('mouseMoved', x - 60 + i * 5, y, { force: 0.5, buttons: 1, button: 'left' });
    await p2.waitForTimeout(60);
    const live = await inkAt('canvas.live', x - 20, y);
    await pen2.send('mouseReleased', x, y, { force: 0, buttons: 0, button: 'left' });
    await p2.waitForTimeout(60);
    const done = await inkAt('canvas.ink', x - 20, y);
    ok(live > 5 && done > 5, `ink under the pen while drawing and after lifting: ${label} (${live}/${done})`);
  };
  const zoom = (z) => p2.evaluate((z) => window.__scribo.viewer.setZoom(z), z);
  // a mixed document (portrait pages and a landscape slide): fit width keeps every page inside the
  // window, whichever page is current
  {
    const fitFrom = (i) => p2.evaluate(async (i) => {
      const v = window.__scribo.viewer;
      v.scrollToPage(i);
      await new Promise((r) => setTimeout(r, 150));
      v.fitWidth();
      await new Promise((r) => setTimeout(r, 150));
      const widths = window.__scribo.session.metas.map((m) => m.w);
      return { zoom: v.zoom, overflow: v.stage.scrollWidth - v.stage.clientWidth, mixed: new Set(widths.map(Math.round)).size > 1 };
    }, i);
    const a = await fitFrom(0);
    const b = await fitFrom(2);
    ok(a.mixed, 'fixture mixes page widths');
    ok(a.overflow <= 1 && b.overflow <= 1 && Math.abs(a.zoom - b.zoom) < 1e-6, `fit width keeps every page in the window (overflow ${a.overflow}/${b.overflow}, zoom ${a.zoom.toFixed(3)}/${b.zoom.toFixed(3)})`);
    const opened = await p2.evaluate(async () => {
      const app = window.__scribo;
      const data = await app.session.buildBytes({ flatten: false });
      await app.openFile({ name: 'again.pdf', data });
      await new Promise((r) => setTimeout(r, 300));
      const v = app.viewer;
      return { fit: v.fit, overflow: v.stage.scrollWidth - v.stage.clientWidth };
    });
    ok(opened.fit === 'width' && opened.overflow <= 1, `a mixed document opens fitted to its widest page (${opened.fit}, overflow ${opened.overflow})`);
    await pinLayout(p2);
    await settle();
  }
  await probe('initial', 600, 400);
  await zoom(1.7); await settle();
  await probe('after zooming in', 600, 420);
  await zoom(0.7); await settle();
  await probe('after zooming out', 640, 300);
  await zoom(1.25);
  await probe('while the re-render is pending', 600, 380);
  await settle();
  await zoom(4); await settle();
  await p2.evaluate(() => window.__scribo.viewer.panBy(700, 900)); await settle();
  await probe('at 400 % with a partial bitmap', 620, 450);
  await p2.evaluate(() => window.__scribo.viewer.fitWidth()); await settle();
  await p2.setViewportSize({ width: 1000, height: 760 }); await settle();
  await probe('after resizing the window', 500, 400);
  await p2.keyboard.press('l');
  await p2.keyboard.press('p');
  ok(await p2.evaluate(() => window.__scribo.editor.tool === 'pen'), 'P returns to the pen after another tool');

  // a selection survives its page being scrolled away and rebuilt
  await p2.evaluate(() => window.__scribo.viewer.setZoom(2));
  await settle();
  await p2.evaluate(() => window.__scribo.viewer.scrollToPage(0));
  await settle();
  await pen2.stroke([[300, 300, 0.5], [360, 320, 0.5], [420, 300, 0.5]]);
  const id = await p2.evaluate(() => window.__scribo.session.model.pages[0].at(-1).id);
  await p2.evaluate((id) => window.__scribo.editor.selection.set(window.__scribo.viewer.realized[0], [id]), id);
  await p2.evaluate(() => window.__scribo.viewer.scrollToPage(3)); await settle();
  await p2.evaluate(() => window.__scribo.viewer.scrollToPage(0)); await settle();
  const linked = await p2.evaluate(() => { const s = window.__scribo.editor.selection; return s.page === window.__scribo.viewer.viewFor(0); });
  const p0 = await p2.evaluate((id) => window.__scribo.session.model.pages[0].find((o) => o.id === id).p.slice(0, 2), id);
  await pen2.stroke([[360, 318, 0.5], [380, 340, 0.5], [400, 360, 0.5]]);
  const p1 = await p2.evaluate((id) => window.__scribo.session.model.pages[0].find((o) => o.id === id).p.slice(0, 2), id);
  ok(linked && Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) > 10, 'a selection still works after its page was scrolled away and back');
  await ctx2.close();
}

await browser.close();
server.close();
console.log(failures ? `FAILED (${failures})` : 'all browser checks passed');
process.exit(failures ? 1 : 0);
