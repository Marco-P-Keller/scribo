// Renders the marketing screenshots from the real app (starts its own Vite dev server).
//   node scripts/make-screenshots.mjs
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'site/assets');
mkdirSync(out, { recursive: true });
const pdf = readFileSync(join(root, 'tests/fixtures/vorlesung.pdf')).toString('base64');

const server = await createServer({ root, server: { port: 5199, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch();

async function scene(theme, name) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2, colorScheme: theme, locale: 'de-DE' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto('http://localhost:5199/?e2e=1');
  await page.waitForFunction(() => window.__scribo);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.__scribo);
  await page.evaluate(async (b64) => {
    const bin = atob(b64);
    const data = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
    await window.__scribo.openFile({ name: 'Analysis I – Vorlesung 7.pdf', data });
  }, pdf);
  await page.waitForFunction(() => window.__scribo.viewer.realized.some((v) => v.rendered), null, { timeout: 20000 });

  // look at the landscape slide with the page list open
  await page.evaluate(async () => {
    const app = window.__scribo;
    const { settings } = await import('/src/app/settings.ts');
    settings.set('sidebar', true);
    settings.set('sidebarTab', 'pages');
    app.viewer.scrollToPage(2);
    app.viewer.setZoom(0.97);
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__scribo.viewer.scrollToPage(2));
  await page.waitForTimeout(800);

  // hand-made looking annotations, added straight to the model in page units
  await page.evaluate(async () => {
    const { uid } = await import('/src/core/objects.ts');
    const { layoutText } = await import('/src/render/textlayout.ts');
    const app = window.__scribo;
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
    const stroke = (pts, color, w, extra = {}) => ({ id: uid(), t: 'ink', c: color, w, p: pts.flat().map((v, i) => (i % 3 === 2 ? v : Math.round(v * 100) / 100)), ...extra });
    // pressure profile: light start, firm middle, light lift
    const pr = (i, n) => 0.28 + 0.5 * Math.sin((i / (n - 1)) * Math.PI) + rnd() * 0.06;

    const objs = [];
    // red loop around the product rule
    const loop = [];
    const n = 90;
    for (let i = 0; i <= n; i++) {
      const a = -2.6 + (i / n) * Math.PI * 2.16;
      loop.push([495 + Math.cos(a) * 292 + rnd() * 1.6, 237 + Math.sin(a) * 31 + rnd() * 1.6 + Math.sin(a * 2) * 2, pr(i, n + 1)]);
    }
    objs.push(stroke(loop, '#e5322d', 2.4));
    // wavy blue underline below the quotient rule
    const ul = [];
    for (let i = 0; i <= 60; i++) ul.push([330 + (i / 60) * 330, 321 + Math.sin(i / 5) * 1.6 + rnd() * 0.8, pr(i, 61)]);
    objs.push(stroke(ul, '#0a6cff', 2.4));
    // highlighter over the worked example
    const hl = [];
    for (let i = 0; i <= 40; i++) hl.push([74 + (i / 40) * 600, 467 + rnd() * 1.2, 0.5]);
    objs.push(stroke(hl, '#ffe14d', 20, { hl: 1, sim: 1 }));
    // arrow and handwritten-style note
    objs.push({ id: uid(), t: 'shape', k: 'arrow', p: [742, 214, 690, 235], c: '#e5322d', w: 2.4 });
    objs.push(layoutText({ id: uid(), t: 'text', x: 748, y: 176, w: 150, s: 'wichtig!', f: 'hand', z: 34, c: '#e5322d', b: 1 }));
    // check mark next to the chain rule
    const chk = [[64, 392, 0.3], [70, 399, 0.6], [80, 381, 0.5]];
    objs.push(stroke([[28, 377, 0.3], [36, 386, 0.7], [52, 364, 0.4]], '#1fa24a', 3.2));
    void chk;
    objs.push({ id: uid(), t: 'note', x: 880, y: 70, s: 'Kommt in der Klausur!', c: '#ffd60a' });
    app.session.model.add('demo', 2, ...objs);
    app.session.model.markClean();
  });
  await page.waitForTimeout(1200);
  await page.mouse.move(270, 990);
  await page.screenshot({ path: join(out, `hero-${name}.png`) });

  if (name === 'light') {
    // pen popover – shown over a clean blank page
    await page.evaluate(async () => {
      const { settings } = await import('/src/app/settings.ts');
      settings.set('sidebar', false);
      window.__scribo.editor.setTool('pen');
      const s = window.__scribo.session;
      await window.__scribo.applyPageOps('blank', [{ op: 'insertBlank', at: 0, w: 595, h: 842, template: 'blank' }]);
      window.__scribo.viewer.scrollToPage(0);
      void s;
    });
    await page.waitForTimeout(1200);
    await page.click('.preset.selected');
    await page.waitForTimeout(500);
    const pop = await page.locator('.popover').boundingBox();
    await page.screenshot({ path: join(out, 'pop-pen.png'), clip: { x: Math.max(0, pop.x - 30), y: 0, width: pop.width + 60, height: pop.y + pop.height + 30 } });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    await page.click('[data-tool="shape"]');
    await page.waitForTimeout(600);
    const pop2 = await page.locator('.popover').boundingBox();
    await page.screenshot({ path: join(out, 'pop-shape.png'), clip: { x: Math.max(0, pop2.x - 30), y: 0, width: pop2.width + 60, height: pop2.y + pop2.height + 30 } });
    await page.keyboard.press('Escape');
    // welcome screen
  }
  await ctx.close();
}

await scene('light', 'light');
await scene('dark', 'dark');
await browser.close();
await server.close();
console.log('screenshots written to', out);
