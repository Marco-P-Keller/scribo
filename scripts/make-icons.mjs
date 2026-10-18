// Renders public/icon.svg into the PNG sizes needed by electron-builder and the website.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'public/icon.svg'), 'utf8');
mkdirSync(join(root, 'build'), { recursive: true });
mkdirSync(join(root, 'site/assets'), { recursive: true });
const browser = await chromium.launch();
for (const [size, out] of [[1024, 'build/icon.png'], [256, 'site/assets/icon-256.png'], [512, 'site/assets/icon-512.png'], [180, 'site/assets/apple-touch-icon.png'], [32, 'site/assets/favicon-32.png']]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: join(root, out), omitBackground: true });
  await page.close();
}
await browser.close();
console.log('icons written');
