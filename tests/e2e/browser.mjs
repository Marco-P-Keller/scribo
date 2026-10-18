// Browser end-to-end test of the production build: pen input (trusted pointer events with
// pressure), pen buttons, every tool, search, page operations, touch gestures and a save roundtrip.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fixture, openDoc, Pen, wave, circle } from './helpers.mjs';

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
await pen.stroke(wave(300, 330, 300));
ok((await objs()).join() === 'ink:', 'pen stroke is stored');
await pen.stroke([[420, 280, 0.5], [420, 330, 0.5], [420, 380, 0.5]], { extraButtons: 2 });
ok((await objs()).length === 0, 'pen button 1 (barrel) erases the stroke it crosses');
await page.keyboard.press('Control+z');
ok((await objs()).length === 1, 'undo brings the erased stroke back');
await page.evaluate(() => window.__scribo.settings.patch('penButtons', { middle: 'lasso' }));
await pen.stroke([[260, 270, 0.5], [640, 270, 0.5], [640, 400, 0.5], [260, 400, 0.5], [262, 272, 0.5]], { extraButtons: 4 });
ok(await page.evaluate(() => window.__scribo.editor.selection.ids.length === 1), 'pen button mapped to lasso selects the stroke');
await page.keyboard.press('Delete');
ok((await objs()).length === 0, 'Delete removes the selection');
await page.keyboard.press('Control+z');

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

// ── save roundtrip ──────────────────────────────────────────────────────────
const back = await page.evaluate(async () => {
  const s = window.__scribo.session;
  const bytes = await s.buildBytes();
  const s2 = await s.constructor.open(bytes, { name: 'x.pdf' });
  return s2.model.pages[0].map((o) => o.t).join(',');
});
ok(back.split(',').length >= 6, `save + reopen keeps everything editable (${back})`);

await browser.close();
server.close();
console.log(failures ? `FAILED (${failures})` : 'all browser checks passed');
process.exit(failures ? 1 : 0);
