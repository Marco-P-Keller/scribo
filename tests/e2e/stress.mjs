// Randomised stress test of the production build: hundreds of pen strokes, button erasing / lasso,
// selection drags, zoom, scrolling, page operations, undo / redo, switching tabs (also while a page
// operation runs), opening and closing tabs. Fails on any page error, on a
// stuck input / render state, and if undo-all, redo and a save roundtrip don't give back the same document.
// Usage: npm run test:stress -- <seed> <actions>   (TRACE=n prints the history for the last n actions)
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fixture, openDoc, Pen, wave, circle } from './helpers.mjs';
const dist = join(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'), 'dist');
const server = createServer((req, res) => {
  const path = normalize(join(dist, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  const file = existsSync(path) && statSync(path).isDirectory() ? join(path, 'index.html') : path;
  if (!existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' }[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
let seed = Number(process.argv[2] ?? 1);
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 1.5 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.stack));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('dialog', (d) => d.accept());
await page.goto(`http://127.0.0.1:${server.address().port}/?e2e=1`);
await page.waitForFunction(() => window.__scribo);
await openDoc(page, fixture());
// a second tab to switch to; the checks at the end run on the first one
await openDoc(page, fixture(), 'B.pdf');
await page.evaluate(() => window.__scribo.activate(window.__scribo.tabs[0]));
await page.waitForTimeout(500);
const pen = new Pen(await ctx.newCDPSession(page));
const snap = () => page.evaluate(() => JSON.stringify({ n: window.__scribo.session.pageCount, p: window.__scribo.session.model.pages }));
const start = await snap();
const P = () => [200 + rnd() * 800, 150 + rnd() * 600];
const actions = {
  async stroke() { const [x, y] = P(); await pen.stroke(wave(x, y, 40 + rnd() * 200, 5 + rnd() * 20, 20)); },
  async circle() { const [x, y] = P(); await pen.stroke(circle(x, y, 20 + rnd() * 60)); },
  async eraseBtn() { const [x, y] = P(); await page.evaluate(([x, y]) => { const s = window.__scribo.viewer.stage; const f = (k, yy, b, p) => s.dispatchEvent(new PointerEvent(k, { bubbles: true, cancelable: true, pointerId: 9, pointerType: 'pen', clientX: x, clientY: yy, buttons: b, pressure: p, button: k === 'pointermove' ? -1 : 5 })); f('pointerdown', y, 32, .5); for (let i = 1; i < 8; i++) f('pointermove', y + i * 12, 32, .5); f('pointerup', y + 96, 0, 0); }, [x, y]); },
  async lassoBtn() { const [x, y] = P(); const w = 100 + rnd() * 250, h = 80 + rnd() * 200; await pen.hover(x, y, 2); await pen.send('mousePressed', x, y, { force: .5, buttons: 2, button: 'right' }); for (const [a, b] of [[x + w, y], [x + w, y + h], [x, y + h], [x + 2, y + 2]]) await pen.send('mouseMoved', a, b, { force: .5, buttons: 2, button: 'right' }); await pen.send('mouseReleased', x + 2, y + 2, { force: 0, buttons: 0, button: 'right' }); },
  async dragSel() { const b = await page.evaluate(() => window.__scribo.editor.selection.clientBounds()); if (!b) return; const x = b.x + b.w / 2, y = b.y + b.h / 2; await pen.stroke([[x, y, .5], [x + 15, y + 10, .5], [x + 30 + rnd() * 40, y + 20, .5]]); },
  async rotateSel() { await page.evaluate((a) => { const s = window.__scribo.editor.selection; const b = s.bounds(); if (!b || !s.canTransform()) return; s.begin('rotate', b.x + b.w / 2, b.y - 20); s.update(b.x + b.w + 30, b.y + b.h * a); s.end(); }, rnd()); },
  async scaleSel() { await page.evaluate((k) => { const s = window.__scribo.editor.selection; const b = s.bounds(); if (!b || !s.canTransform()) return; s.begin('se', b.x + b.w, b.y + b.h); s.update(b.x + b.w * k, b.y + b.h * k); s.end(); }, 0.5 + rnd() * 1.5); },
  async del() { await page.keyboard.press('Delete'); },
  async dup() { await page.keyboard.press('Control+d'); },
  async undo() { await page.keyboard.press('Control+z'); },
  async redo() { await page.keyboard.press('Control+y'); },
  async tool() { await page.keyboard.press(pick(['p', 'h', 'e', 'l', 'v', 's', 'p', 'p'])); },
  async zoom() { await page.evaluate((z) => window.__scribo.viewer.setZoom(z), 0.5 + rnd() * 2.5); },
  async scroll() { await page.evaluate(([dx, dy]) => window.__scribo.viewer.panBy(dx, dy), [rnd() * 400 - 200, rnd() * 1600 - 800]); },
  async escape() { await page.keyboard.press('Escape'); },
  async addPage() { await page.evaluate(() => window.__scribo.viewer.addPageButton.click()); await page.waitForSelector('.page-setup'); await page.keyboard.press('Enter'); await page.waitForTimeout(400); },
  async rotatePage() { await page.evaluate(() => window.__scribo.applyPageOps('r', [{ op: 'rotate', pages: [window.__scribo.viewer.currentPage], delta: 90 }])); await page.waitForTimeout(400); },
  async switchTab() { await page.keyboard.press('Control+Tab'); },
  async opSwitch() { await page.evaluate(() => void window.__scribo.applyPageOps('r', [{ op: 'rotate', pages: [window.__scribo.viewer.currentPage], delta: 90 }])); await page.keyboard.press('Control+Tab'); await page.waitForTimeout(400); },
  async openClose() { await page.evaluate(async (b64) => { const bin = atob(b64); const data = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i); await window.__scribo.openFile({ name: 'C.pdf', data }); }, fixture()); await page.waitForTimeout(100); await page.keyboard.press('Control+w'); await page.waitForTimeout(200); },
  async mouseDraw() { const [x, y] = P(); await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 60, y + 30, { steps: 4 }); await page.mouse.up(); },
};
const names = Object.keys(actions);
const weights = { stroke: 6, circle: 2, lassoBtn: 3, dragSel: 3, undo: 3, redo: 2, tool: 3, zoom: 2, scroll: 2 };
const bag = names.flatMap((n) => Array(weights[n] ?? 1).fill(n));
const N = Number(process.argv[3] ?? 250);
const done = []; const doneN = [];
for (let i = 0; i < N; i++) {
  const a = pick(bag);
  done.push(a);
  try { await actions[a](); } catch (e) { errors.push(`${a}: ${e.message.split('\n')[0]}`); }
  if (process.env.TRACE && i >= N - Number(process.env.TRACE)) console.log(i, a, await page.evaluate(() => { const m = window.__scribo.session.model; return JSON.stringify({ u: m.undoStack.slice(-4).map((e) => e.id + ':' + e.label), r: m.redoStack.map((e) => e.id + ':' + e.label), p0: m.pages[0][0]?.p.slice(0, 2).map(Math.round), n: window.__scribo.session.pageCount }); }));
  await page.waitForTimeout(15);
  if (errors.length) break;
}
await page.waitForTimeout(500);
const tabs = await page.evaluate(() => window.__scribo.tabs.map((s) => s.file.name).join());
if (tabs !== 'Vorlesung.pdf,B.pdf') errors.push(`unexpected tabs at the end: ${tabs}`);
await page.evaluate(() => window.__scribo.activate(window.__scribo.tabs[0]));
await page.evaluate(() => Promise.all(window.__scribo.tabs.map((s) => s.model.serial(async () => undefined))));
const busy = await page.evaluate(() => window.__scribo.editor.controller.busy || window.__scribo.viewer.paused);
if (busy) errors.push('controller still busy / rendering paused after all actions');
// undo everything, compare with start; redo everything
const end = await snap();
await page.keyboard.press('Escape');
let undone = 0;
for (; undone < 1000 && await page.evaluate(() => window.__scribo.session.model.canUndo); undone++) await page.evaluate(() => window.__scribo.session.model.undo());
const back = await snap();
if (back !== start) errors.push('undo all does not restore the original document');
// exactly as many steps as were undone: redo entries pending at the end must not be applied
for (let k = 0; k < undone; k++) await page.evaluate(() => window.__scribo.session.model.redo());
const fwd = await snap();
if (fwd !== end) {
  const E = JSON.parse(end), F = JSON.parse(fwd);
  const sum = (X) => X.p.map((pg) => pg.map((o) => o.id.slice(0, 4) + ':' + o.t).join(' ')).join(' | ');
  let diff = '';
  E.p.forEach((pg, i) => pg.forEach((o, k) => { const f = F.p[i]?.[k]; if (!diff && JSON.stringify(o) !== JSON.stringify(f)) diff = `page ${i} #${k}\n  end ${JSON.stringify(o).slice(0, 300)}\n  fwd ${JSON.stringify(f).slice(0, 300)}`; }));
  errors.push('redo all does not reach the final state: ' + diff);
}
// save roundtrip keeps everything
const rt = await page.evaluate(async () => { const s = window.__scribo.session; const b = await s.buildBytes(); const s2 = await s.constructor.open(b, { name: 'x.pdf' }); return JSON.stringify({ n: s2.pageCount, c: s2.model.pages.map((p) => p.length) }); });
const exp = JSON.stringify({ n: JSON.parse(end).n, c: JSON.parse(end).p.map((p) => p.length) });
if (rt !== exp) errors.push(`save roundtrip differs: ${rt} vs ${exp}`);
console.log(`seed ${process.argv[2] ?? 1}: ${done.length} actions, ${JSON.parse(end).p.flat().length} objects, ${JSON.parse(end).n} pages`);
console.log(errors.length ? '✗ ' + errors.slice(0, 8).join('\n✗ ') + '\nlast actions: ' + done.slice(-8).join(', ') : '✓ no errors, undo/redo/save consistent');
await browser.close(); server.close();
process.exit(errors.length ? 1 : 0);
