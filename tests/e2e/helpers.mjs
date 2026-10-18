import { readFileSync } from 'node:fs';

export const fixture = (name = 'vorlesung.pdf') => readFileSync(new URL(`../fixtures/${name}`, import.meta.url)).toString('base64');

export async function openDoc(page, b64, name = 'Vorlesung.pdf') {
  await page.evaluate(async ([b64, name]) => {
    const bin = atob(b64);
    const data = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
    await window.__scribo.openFile({ name, data });
  }, [b64, name]);
  await page.waitForFunction(() => window.__scribo.viewer.realized.some((v) => v.rendered), null, { timeout: 15000 });
}

/** Real (trusted) pen events through the DevTools protocol. */
export class Pen {
  constructor(cdp) {
    this.cdp = cdp;
  }
  async send(type, x, y, { force = 0, buttons = 0, button = 'none', tiltX = 0, tiltY = 0 } = {}) {
    await this.cdp.send('Input.dispatchMouseEvent', { type, x, y, button, buttons, pointerType: 'pen', force, tiltX, tiltY, clickCount: type === 'mouseMoved' ? 0 : 1 });
  }
  async hover(x, y, buttons = 0) {
    await this.send('mouseMoved', x, y, { buttons });
  }
  /** pts: [x, y, pressure][]; extraButtons e.g. 2 for the barrel button */
  async stroke(pts, { extraButtons = 0, holdMs = 0 } = {}) {
    const [x0, y0, p0] = pts[0];
    await this.hover(x0, y0, extraButtons);
    await this.send('mousePressed', x0, y0, { force: p0, buttons: 1 | extraButtons, button: 'left' });
    for (const [x, y, p] of pts.slice(1)) await this.send('mouseMoved', x, y, { force: p, buttons: 1 | extraButtons, button: 'left' });
    if (holdMs) await new Promise((r) => setTimeout(r, holdMs));
    const [x1, y1, p1] = pts[pts.length - 1];
    await this.send('mouseReleased', x1, y1, { force: p1, buttons: extraButtons, button: 'left' });
  }
}

export const wave = (x0, y0, len, amp = 20, n = 60) =>
  Array.from({ length: n }, (_, i) => [x0 + (i / (n - 1)) * len, y0 + Math.sin((i / (n - 1)) * Math.PI * 3) * amp, 0.25 + 0.55 * Math.sin((i / (n - 1)) * Math.PI)]);

export const circle = (cx, cy, r, over = 0.1, n = 70) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = (i / n) * Math.PI * 2 * (1 + over);
    return [cx + r * Math.cos(a) + Math.sin(i * 0.4) * 1.2, cy + r * Math.sin(a) + Math.cos(i * 0.37) * 1.2, 0.5];
  });

// ── Electron launcher (spawn + CDP; Playwright's own electron.launch hangs on Electron 44) ──
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { chromium } from 'playwright';
import electronPath from 'electron';

function freePort() {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

export async function launchElectron(root, env = {}) {
  const port = await freePort();
  const child = spawn(electronPath, [root, `--remote-debugging-port=${port}`], {
    env: { ...process.env, SCRIBO_TEST: '1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  let browser;
  for (let i = 0; i < 80 && !browser; i++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  if (!browser) {
    child.kill();
    throw new Error(`Electron did not start:\n${log}`);
  }
  let page = browser.contexts()[0]?.pages().find((p) => p.url().startsWith('app://'));
  for (let i = 0; i < 60 && !page; i++) {
    await new Promise((r) => setTimeout(r, 250));
    page = browser.contexts()[0]?.pages().find((p) => p.url().startsWith('app://'));
  }
  return {
    page,
    log: () => log,
    async close() {
      await browser.close().catch(() => undefined);
      child.kill();
      await new Promise((r) => setTimeout(r, 500));
    },
  };
}
