import type { FontId } from './types';

// Which text-tool styles have a real font file (see scripts/prepare-assets.mjs).

export const FONT_LABEL: Record<FontId, string> = {
  sans: 'Inter',
  serif: 'Source Serif',
  mono: 'JetBrains Mono',
  hand: 'Caveat',
};

export const HAS_ITALIC: Record<FontId, boolean> = { sans: true, serif: true, mono: false, hand: false };

export function fontFileName(id: FontId, bold: boolean, italic: boolean): string {
  const w = bold ? '700Bold' : '400Regular';
  const it = italic && HAS_ITALIC[id] ? '_Italic' : '';
  return `${id}-${w}${it}.ttf`;
}

/** Key used to hand font bytes from the UI thread to the PDF worker. */
export function fontKey(o: { f: FontId; b?: 1; i?: 1 }): string {
  return fontFileName(o.f, !!o.b, !!o.i);
}
