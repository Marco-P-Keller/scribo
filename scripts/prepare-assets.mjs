// Copies runtime data from node_modules into public/ so it is bundled by Vite
// without being checked into the repository (pdf.js data, UI/text fonts).
import { cpSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = join(root, 'node_modules');
const pub = join(root, 'public');

const pdfjs = join(pub, 'pdfjs');
if (!existsSync(join(pdfjs, 'cmaps'))) {
  rmSync(pdfjs, { recursive: true, force: true });
  mkdirSync(pdfjs, { recursive: true });
  for (const dir of ['cmaps', 'standard_fonts', 'iccs', 'wasm']) {
    cpSync(join(nm, 'pdfjs-dist', dir), join(pdfjs, dir), { recursive: true });
  }
}

// family folder, file prefix, weights/styles that the text tool offers
const fonts = {
  sans: ['inter', 'Inter', ['400Regular', '700Bold', '400Regular_Italic', '700Bold_Italic']],
  serif: ['source-serif-4', 'SourceSerif4', ['400Regular', '700Bold', '400Regular_Italic', '700Bold_Italic']],
  mono: ['jetbrains-mono', 'JetBrainsMono', ['400Regular', '700Bold']],
  hand: ['caveat', 'Caveat', ['400Regular', '700Bold']],
};
const out = join(pub, 'fonts');
mkdirSync(out, { recursive: true });
for (const [id, [pkg, prefix, styles]] of Object.entries(fonts)) {
  for (const style of styles) {
    const src = join(nm, '@expo-google-fonts', pkg, style, `${prefix}_${style}.ttf`);
    if (!existsSync(src)) throw new Error(`Missing font file: ${src}`);
    cpSync(src, join(out, `${id}-${style}.ttf`));
  }
}
console.log('assets prepared');
