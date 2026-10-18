import type { FontId } from '../core/types';
import { FONT_LABEL, HAS_ITALIC, fontFileName } from '../core/fontmeta';

export { FONT_LABEL };

// Text tool fonts. The TTFs ship with the app (copied from npm packages by
// scripts/prepare-assets.mjs) and are used both for on-screen rendering and
// for embedding into the saved PDF, so text looks identical everywhere.

export const FONT_FAMILY: Record<FontId, string> = {
  sans: 'Scribo Sans',
  serif: 'Scribo Serif',
  mono: 'Scribo Mono',
  hand: 'Scribo Hand',
};

export function fontFileUrl(id: FontId, bold: boolean, italic: boolean): string {
  return new URL(`fonts/${fontFileName(id, bold, italic)}`, document.baseURI).href;
}

/** True when the italic style is a real design (otherwise it is synthesised by shearing). */
export function hasRealItalic(id: FontId): boolean {
  return HAS_ITALIC[id];
}

export const NO_FEATURES = '"calt" 0, "clig" 0, "liga" 0, "rlig" 0, "dlig" 0';

const loaded = new Map<string, Promise<void>>();

export function ensureFont(id: FontId, bold: boolean, italic: boolean): Promise<void> {
  const file = fontFileName(id, bold, italic);
  let p = loaded.get(file);
  if (!p) {
    const face = new FontFace(FONT_FAMILY[id], `url(${fontFileUrl(id, bold, italic)})`, {
      weight: bold ? '700' : '400',
      style: italic && HAS_ITALIC[id] ? 'italic' : 'normal',
      // no ligatures / contextual alternates: the PDF writer can't reproduce substituted glyph widths,
      // so the screen must not use them either (keeps text identical in the saved file)
      featureSettings: NO_FEATURES,
    });
    p = face.load().then((f) => {
      document.fonts.add(f);
    });
    p.catch(() => loaded.delete(file));
    loaded.set(file, p);
  }
  return p;
}

/** Preload the regular + bold styles of every family so measuring never races font loading. */
export async function loadFonts(): Promise<void> {
  const jobs: Promise<void>[] = [];
  for (const id of Object.keys(FONT_FAMILY) as FontId[]) {
    jobs.push(ensureFont(id, false, false), ensureFont(id, true, false));
  }
  await Promise.allSettled(jobs);
}

export function fontCss(o: { f: FontId; z: number; b?: 1; i?: 1 }): string {
  return `${o.i ? 'italic ' : ''}${o.b ? 700 : 400} ${o.z}px "${FONT_FAMILY[o.f]}", system-ui, sans-serif`;
}
