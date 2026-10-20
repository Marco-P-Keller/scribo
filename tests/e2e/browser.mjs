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
}, 300000).unref();

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
  await pen.stroke(wave(300, 520, 300));
  const last = await page.evaluate(() => window.__scribo.session.model.pages[0].at(-1));
  ok((await widths()) > 3 && last.v === 2 && last.sm === undefined, 'switched on, pressure changes the width; strokes are stored already smoothed');
  await page.keyboard.press('Control+z');
  await setting('pressureWidth', false);
}
{
  // a shaky straight line: smoothing calms it, and "Smooth strokes" calms an existing stroke
  const shaky = Array.from({ length: 90 }, (_, i) => [300 + i * 3, 560 + (i % 2 ? 1.6 : -1.6) + (i % 7 === 3 ? 1.4 : 0), 0.5]);
  const wobble = () => page.evaluate(() => {
    const p = window.__scribo.session.model.pages[0].at(-1).p;
    const ys = p.filter((_, i) => i % 3 === 1).slice(3, -3);
    const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
    return Math.max(...ys.map((y) => Math.abs(y - mean)));
  });
  // shape recognition would turn the line into a straight one
  await setting('snap', 'off');
  await setting('smoothing', 0);
  await pen.stroke(shaky);
  const rough = await wobble();
  await page.keyboard.press('Control+z');
  await setting('smoothing', 1);
  await pen.stroke(shaky);
  const calm = await wobble();
  ok(calm < rough * 0.35, `smoothing calms a shaky line (${rough.toFixed(2)} → ${calm.toFixed(2)} pt)`);
  await page.keyboard.press('Control+z');
  await setting('smoothing', 0);
  await pen.stroke(shaky);
  await setting('smoothing', 0.6);
  await page.keyboard.press('v');
  const at = await page.evaluate(() => { const o = window.__scribo.session.model.pages[0].at(-1); return window.__scribo.viewer.realized[0].pageToClient(o.p[90], o.p[91]); });
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(150);
  const button = page.locator('.sel-menu button[aria-label="Striche glätten"]');
  ok((await button.count()) === 1, 'selected ink offers "Smooth strokes"');
  if (await button.count()) await button.click();
  ok((await wobble()) < rough * 0.6, 'the button smooths the selected stroke');
  await page.keyboard.press('Control+z');
  ok(Math.abs((await wobble()) - rough) < 1e-6, 'undo brings the shaky stroke back');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Escape');
  await page.keyboard.press('p');
  await setting('snap', 'auto');
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

// ── tabs ────────────────────────────────────────────────────────────────────
{
  const state = () => page.evaluate(() => {
    const a = window.__scribo;
    return { n: a.tabs.length, cur: a.tabs.indexOf(a.session), name: a.session?.file.name ?? null, objs: a.session ? a.session.model.pages[0].length : -1 };
  });
  let st = await state();
  ok(st.n === 4 && st.cur === 3 && (await page.locator('.tabbar').isVisible()) && (await page.locator('.tab').count()) === 4, `every opened document gets its own tab (${st.n} tabs)`);
  await page.locator('.tab').nth(0).click();
  st = await state();
  ok(st.name === 'Vorlesung.pdf' && st.objs >= 6, `clicking a tab shows that document with its annotations (${st.name}, ${st.objs})`);
  await page.evaluate(() => { const v = window.__scribo.viewer; v.setZoom(2); v.scrollToPage(2); });
  await page.waitForTimeout(200);
  const view = () => page.evaluate(() => { const v = window.__scribo.viewer; return { zoom: v.zoom, page: v.currentPage, top: v.stage.scrollTop }; });
  const before = await view();
  await page.keyboard.press('Control+Tab');
  ok((await state()).cur === 1, 'Ctrl+Tab shows the next tab');
  await page.keyboard.press('Control+Shift+Tab');
  await page.waitForTimeout(200);
  const after = await view();
  ok((await state()).cur === 0 && after.zoom === before.zoom && after.page === before.page && Math.abs(after.top - before.top) < 2, `a tab keeps its zoom and position (${JSON.stringify(before)} → ${JSON.stringify(after)})`);
  // the pen writes into the document of the shown tab only
  await page.locator('.tab').nth(3).click();
  await page.waitForTimeout(300);
  const counts = () => page.evaluate(() => window.__scribo.tabs.map((s) => s.model.pages.flat().length));
  const c0 = await counts();
  await page.keyboard.press('p');
  await pen.stroke(wave(300, 520, 300));
  const c1 = await counts();
  ok(c1[3] === c0[3] + 1 && c1.slice(0, 3).join() === c0.slice(0, 3).join(), `ink lands in the shown tab only (${c0} → ${c1})`);
  ok(await page.locator('.tab').nth(3).evaluate((el) => el.classList.contains('dirty')), 'a tab with unsaved changes shows a dot');
  // closing an unsaved tab asks first
  page.once('dialog', (d) => d.dismiss());
  await page.locator('.tab').nth(1).hover();
  await page.locator('.tab').nth(1).locator('.tab-close').click();
  await page.waitForTimeout(200);
  st = await state();
  ok(st.n === 4 && st.cur === 3, 'closing an unsaved tab can be cancelled');
  page.once('dialog', (d) => d.accept());
  await page.locator('.tab').nth(1).hover();
  await page.locator('.tab').nth(1).locator('.tab-close').click();
  await page.waitForTimeout(200);
  st = await state();
  ok(st.n === 3 && st.cur === 2 && st.name === 'Vorlesung.pdf', `the closed tab is gone and the tab you were on is shown again (${st.n}, ${st.cur}, ${st.name})`);
  const accept = (d) => d.accept();
  page.on('dialog', accept);
  await page.locator('.tab').nth(0).click({ button: 'middle' });
  await page.waitForTimeout(200);
  ok((await state()).n === 2, 'a middle click closes a tab');
  await page.keyboard.press('Control+w');
  await page.waitForTimeout(200);
  ok((await state()).n === 1 && !(await page.locator('.tabbar').isVisible()), 'Ctrl+W closes the tab; with one document the tab bar hides');
  await page.keyboard.press('Control+w');
  await page.waitForTimeout(300);
  st = await state();
  ok(st.n === 0 && st.name === null && (await page.locator('.welcome.show').count()) === 1 && (await page.title()) === 'Scribo', 'closing the last tab shows the start screen');
  page.off('dialog', accept);
  await openDoc(page, fixture());
  ok((await state()).n === 1 && (await objs()).length === 0, 'a document opens again after all tabs were closed');
}

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

// ── eraser and pictures, finger taps, mouse placement, fills, polyline, moving across pages ──
{
  const ctx3 = await browser.newContext({ viewport: { width: 1360, height: 860 }, hasTouch: true, locale: 'de-DE' });
  const p3 = await ctx3.newPage();
  p3.on('pageerror', (e) => {
    console.log('✗ pageerror', e.message);
    failures++;
  });
  await p3.goto(`${url}?e2e=1`);
  await p3.waitForFunction(() => window.__scribo, null, { polling: 100 });
  await openDoc(p3, fixture());
  const cdp3 = await ctx3.newCDPSession(p3);
  const pen3 = new Pen(cdp3);
  const set3 = (k, v) => p3.evaluate(([k, v]) => window.__scribo.settings.set(k, v), [k, v]);
  const pageOf = (id) => p3.evaluate((id) => window.__scribo.session.model.pages.findIndex((l) => l.some((o) => o.id === id)), id);
  const find = (id) => p3.evaluate((id) => window.__scribo.session.model.pages.flat().find((o) => o.id === id), id);
  const at = (i, x, y) => p3.evaluate(([i, x, y]) => window.__scribo.viewer.viewFor(i).pageToClient(x, y), [i, x, y]);
  const undo = () => p3.evaluate(() => window.__scribo.session.model.undo());
  const tap3 = async (x, y) => {
    await cdp3.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1, force: 0.5 }] });
    await cdp3.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p3.waitForTimeout(150);
  };
  await p3.evaluate(() => {
    const m = window.__scribo.session.model;
    m.add('box', 0, { id: 'box', t: 'shape', k: 'rect', p: [100, 100, 200, 100, 200, 160, 100, 160], c: '#0a6cff', w: 2 });
    m.add('pic', 0, {
      id: 'pic', t: 'img', x: 260, y: 100, w: 80, h: 60,
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    });
  });

  // the eraser leaves pictures alone; they are deleted by selecting them
  await p3.keyboard.press('e');
  {
    const a = await at(0, 240, 130);
    const b = await at(0, 360, 130);
    await pen3.stroke(Array.from({ length: 12 }, (_, i) => [a.x + ((b.x - a.x) * i) / 11, a.y, 0.5]));
    ok((await pageOf('pic')) === 0, 'the eraser does not remove a picture');
    const c = await at(0, 100, 90);
    const d = await at(0, 100, 170);
    await pen3.stroke(Array.from({ length: 12 }, (_, i) => [c.x, c.y + ((d.y - c.y) * i) / 11, 0.5]));
    ok((await pageOf('box')) === -1, 'the eraser still removes shapes');
    await undo();
  }

  // a finger tap selects an annotation while the pen tool is on and fingers don't draw; a finger moves it
  await p3.keyboard.press('p');
  await p3.waitForTimeout(800); // palm rejection ignores touches right after the pen
  {
    const e = await at(0, 100, 130);
    await tap3(e.x, e.y);
    ok(await p3.evaluate(() => window.__scribo.editor.selection.ids.join() === 'box'), 'a finger tap selects the annotation under it');
    const top = await p3.evaluate(() => window.__scribo.viewer.stage.scrollTop);
    const s = await at(0, 150, 130);
    await cdp3.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: s.x, y: s.y, id: 1, force: 0.5 }] });
    for (let i = 1; i <= 8; i++) await cdp3.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: s.x + i * 8, y: s.y + i * 5, id: 1, force: 0.5 }] });
    await cdp3.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const box = await find('box');
    const still = await p3.evaluate(() => window.__scribo.viewer.stage.scrollTop);
    ok(box.p[0] > 120 && box.p[1] > 115 && still === top, `a finger drags the selection instead of scrolling (${box.p[0].toFixed(1)}, ${box.p[1].toFixed(1)})`);
    await undo();
    const f = await at(0, 450, 250);
    await tap3(f.x, f.y);
    ok(await p3.evaluate(() => !window.__scribo.editor.selection.active), 'a finger tap on empty paper drops the selection');
  }

  // with "draw with mouse" off the mouse still places text and notes with a click
  await set3('mouseDraws', false);
  {
    const n0 = await p3.evaluate(() => window.__scribo.session.model.pages[0].length);
    await p3.keyboard.press('t');
    const a = await at(0, 120, 300);
    await p3.mouse.click(a.x, a.y);
    const text = await p3.waitForSelector('textarea.text-editor', { timeout: 3000 }).catch(() => null);
    if (text) {
      await p3.keyboard.type('Hallo');
      await p3.keyboard.press('Escape');
    }
    await p3.waitForTimeout(200);
    await p3.keyboard.press('n');
    const b = await at(0, 400, 300);
    await p3.mouse.click(b.x, b.y);
    const note = await p3.waitForSelector('textarea.note-text', { timeout: 3000 }).catch(() => null);
    if (note) {
      await p3.keyboard.type('Notiz');
      await p3.keyboard.press('Escape');
    }
    await p3.waitForTimeout(300);
    const kinds = await p3.evaluate(() => window.__scribo.session.model.pages[0].map((o) => o.t));
    ok(!!text && !!note && kinds.includes('text') && kinds.includes('note') && kinds.length === n0 + 2, 'with "draw with mouse" off, a click places text and notes');
    await undo();
    await undo();
  }
  await set3('mouseDraws', true);

  // fill colour and fill opacity of a selected shape; a slider drag is one undo step
  await p3.keyboard.press('v');
  {
    const e = await at(0, 100, 130);
    await p3.mouse.click(e.x, e.y);
    await p3.waitForTimeout(150);
    const fillBtn = p3.locator('.sel-menu button[aria-label="Füllung"]');
    ok((await fillBtn.count()) === 1, 'a selected rectangle offers "Füllung"');
    await fillBtn.click();
    await p3.locator('.fill-popover .swatch').nth(3).click();
    let box = await find('box');
    ok(!!box.fill && box.fo === 0.2, `a fill colour can be picked (${box.fill}, ${box.fo})`);
    await p3.locator('.fill-popover input.slider').evaluate((input) => {
      for (const v of [30, 45, 60, 75]) {
        input.value = String(v);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    box = await find('box');
    ok(box.fo === 0.75 && (await p3.locator('.fill-popover').count()) === 1, `the fill opacity follows the slider and the panel stays open (${box.fo})`);
    await undo();
    box = await find('box');
    ok(box.fo === 0.2 && !!box.fill, `one undo takes back the whole slider drag (${box.fo})`);
    await p3.locator('.fill-popover .swatch.none').click();
    box = await find('box');
    ok(!box.fill && box.fo === undefined, 'the fill can be removed again');
    await p3.keyboard.press('Escape');
    await p3.keyboard.press('Escape');
  }

  // polyline: choosing the last point again ends it, no quick double click needed
  await p3.keyboard.press('s');
  await p3.evaluate(() => window.__scribo.settings.patch('shape', { kind: 'polyline' }));
  {
    const n0 = await p3.evaluate(() => window.__scribo.session.model.pages[0].length);
    for (const [x, y] of [[100, 260], [200, 300], [300, 260]]) {
      const c = await at(0, x, y);
      await p3.mouse.click(c.x, c.y);
      await p3.waitForTimeout(450);
    }
    const last = await at(0, 300, 260);
    await p3.mouse.click(last.x + 7, last.y + 5);
    await p3.waitForTimeout(150);
    const objs3 = await p3.evaluate(() => window.__scribo.session.model.pages[0]);
    const line = objs3.at(-1);
    ok(objs3.length === n0 + 1 && line.k === 'polyline' && line.p.length === 6, `a click on the last point again finishes the polyline (${line.k}, ${line.p.length / 2} points)`);
    await undo();
    await p3.evaluate(() => window.__scribo.settings.patch('shape', { kind: 'rect' }));
  }

  // drag and drop onto another page, both visible
  await p3.keyboard.press('v');
  await p3.evaluate(() => { const v = window.__scribo.viewer; v.setZoom(0.5); v.stage.scrollTop = 0; });
  await p3.waitForFunction(() => window.__scribo.viewer.viewFor(1)?.rendered, null, { timeout: 10000 });
  {
    const a = await at(0, 100, 130);
    const b = await at(1, 100, 200);
    await p3.mouse.move(a.x, a.y);
    await p3.mouse.down();
    await p3.mouse.move(b.x, b.y, { steps: 14 });
    await p3.mouse.up();
    await p3.waitForTimeout(150);
    const box = await find('box');
    const sel = await p3.evaluate(() => { const s = window.__scribo.editor.selection; return { page: s.page?.index, ids: s.ids.join() }; });
    ok((await pageOf('box')) === 1 && Math.abs(box.p[0] - 100) < 2 && Math.abs(box.p[1] - 170) < 2, `dragging an annotation onto the next page moves it there (${box.p[0].toFixed(1)}, ${box.p[1].toFixed(1)})`);
    ok(sel.page === 1 && sel.ids === 'box', 'the selection follows it to the new page');
    // below 100 % the ink bitmap is smaller than the page in points; it must still be cleared completely
    const ghost = await p3.evaluate(() => {
      const v = window.__scribo.viewer.viewFor(0);
      const q = v.pageToClient(101, 130);
      const c = v.el.querySelector('canvas.ink');
      const r = c.getBoundingClientRect();
      const k = c.width / r.width;
      const d = c.getContext('2d').getImageData(Math.round((q.x - r.left) * k) - 3, Math.round((q.y - r.top) * k) - 3, 6, 6).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 20) n++;
      return n;
    });
    ok(ghost === 0, `no trace of it is left on the old page (${ghost} px)`);
    await undo();
    const back = await find('box');
    ok((await pageOf('box')) === 0 && back.p[0] === 100 && back.p[1] === 100, 'undo puts it back on its page');
  }

  // held at the bottom edge, the document scrolls and the annotation travels to a page out of view
  await pinLayout(p3);
  {
    const a = await at(0, 100, 130);
    const bottom = await p3.evaluate(() => window.__scribo.viewer.stage.getBoundingClientRect().bottom);
    await p3.mouse.move(a.x, a.y);
    await p3.mouse.down();
    await p3.mouse.move(a.x, bottom - 6, { steps: 16 });
    await p3.waitForTimeout(2200);
    await p3.mouse.up();
    await p3.waitForTimeout(200);
    const top = await p3.evaluate(() => window.__scribo.viewer.stage.scrollTop);
    const i = await pageOf('box');
    ok(top > 1000 && i > 0, `holding a drag at the edge scrolls and drops on a later page (page ${i + 1}, scrolled ${Math.round(top)} px)`);
  }
  await ctx3.close();
}

await browser.close();
server.close();
console.log(failures ? `FAILED (${failures})` : 'all browser checks passed');
process.exit(failures ? 1 : 0);
