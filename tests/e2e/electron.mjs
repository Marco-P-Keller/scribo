// End-to-end smoke test of the real Electron app: open a PDF from disk, write with pen
// events, save in place with Ctrl+S, relaunch and check that the ink is still editable.
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PDFDocument, PDFName, PDFDict } from 'pdf-lib';
import { Pen, wave, circle, launchElectron, pinLayout } from './helpers.mjs';

const root = resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const dir = mkdtempSync(join(tmpdir(), 'scribo-e2e-'));
const pdf = join(dir, 'notes.pdf');
copyFileSync(join(root, 'tests/fixtures/vorlesung.pdf'), pdf);
const before = statSync(pdf).mtimeMs;

setTimeout(() => {
  console.error('✗ e2e watchdog: timed out');
  process.exit(2);
}, 150000).unref();
const log = (...a) => console.log('•', ...a);
const fail = (m) => {
  console.error('✗', m);
  process.exitCode = 1;
};
const ok = (cond, m) => (cond ? log(m) : fail(m));

async function launch() {
  log('launching Electron');
  const app = await launchElectron(root, { SCRIBO_USER_DATA: join(dir, 'ud'), SCRIBO_OPEN: pdf });
  const page = app.page;
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  log('waiting for document');
  await page.waitForFunction(() => window.__scribo?.session?.pageCount > 0, null, { timeout: 30000, polling: 100 });
  await page.waitForFunction(() => window.__scribo.viewer.realized.some((v) => v.rendered), null, { timeout: 30000, polling: 100 });
  await pinLayout(page);
  return { app, page };
}

let { app, page } = await launch();
log('opened', await page.title());
await page.waitForTimeout(400);
const cdp = await page.context().newCDPSession(page);
const pen = new Pen(cdp);
await pen.stroke(wave(300, 340, 420));
await pen.stroke(circle(820, 470, 60));
const kinds = await page.evaluate(() => window.__scribo.session.model.pages[0].map((o) => o.t));
ok(kinds.length === 2, `two objects drawn (${kinds.join(',')})`);
ok(await page.evaluate(() => window.__scribo.session.model.dirty), 'document is dirty');

// optional: pictures of the real window (CI uploads them so the Windows look can be reviewed)
const shots = process.env.SCRIBO_SCREENSHOT_DIR;
if (shots) {
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: join(shots, 'content.png') });
  await page.click('.preset.selected').catch(() => undefined);
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(shots, 'content-popover.png') });
  if (process.platform === 'win32') {
    const ps = `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[System.Windows.Forms.SystemInformation]::VirtualScreen; $bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height; $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Left,$b.Top,0,0,$bmp.Size); $bmp.Save('${join(shots, 'screen.png').replace(/'/g, "''")}')`;
    try {
      execFileSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'ignore' });
    } catch {
      log('screen capture unavailable');
    }
  }
  await page.keyboard.press('Escape');
  log('screenshots written');
}

await page.keyboard.press('Control+s');
await page.waitForFunction(() => !window.__scribo.session.model.dirty, null, { timeout: 15000, polling: 100 });
log('saved with Ctrl+S');
ok(statSync(pdf).mtimeMs > before, 'file on disk was rewritten in place');
const saved = await PDFDocument.load(readFileSync(pdf));
const annots = saved.getPage(0).node.Annots();
ok(!!annots && annots.size() >= 1, 'PDF contains the baked annotation');
const names = saved.catalog.lookup(PDFName.of('Names'), PDFDict).lookup(PDFName.of('EmbeddedFiles'), PDFDict);
ok(!!names, 'PDF contains the embedded editable data');
await app.close();

({ app, page } = await launch());
const again = await page.evaluate(() => window.__scribo.session.model.pages[0].map((o) => o.t + ':' + (o.k ?? '')));
ok(again.length === 2 && again.some((k) => k.startsWith('ink')), `ink restored and editable after relaunch (${again.join(',')})`);
// closing through the app (title bar ×, Ctrl+W) must not raise "Object has been destroyed" in the main process
await page.evaluate(() => window.__scribo.close()).catch(() => undefined);
await new Promise((r) => setTimeout(r, 1500));
ok(!/Object has been destroyed|Uncaught Exception|A JavaScript error occurred/i.test(app.log()), 'window closes without a main-process error');
await app.close();
log(process.exitCode ? 'FAILED' : 'all checks passed');
process.exit(process.exitCode ?? 0);
