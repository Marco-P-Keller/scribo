import type { TextObj } from '../core/types';
import { TEXT_PAD, lineHeightOf } from '../core/textmetrics';
import { fontCss, ensureFont } from './fonts';

export { ASCENT, LINE_HEIGHT, TEXT_PAD, lineHeightOf } from '../core/textmetrics';

let measureCtx: CanvasRenderingContext2D | null = null;
function ctx(): CanvasRenderingContext2D {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')!;
  return measureCtx;
}

/** Splits a word that is wider than `max` into character chunks; returns the unfinished tail. */
function breakLong(c: CanvasRenderingContext2D, text: string, max: number, out: string[]): string {
  let chunk = '';
  for (const ch of text) {
    if (chunk && c.measureText(chunk + ch).width > max) {
      out.push(chunk);
      chunk = ch;
    } else chunk += ch;
  }
  return chunk;
}

/** Greedy word wrap that is shared by canvas rendering and PDF export (the result is stored in the object). */
export function wrapText(o: Pick<TextObj, 's' | 'f' | 'z' | 'b' | 'i' | 'w'>): string[] {
  const c = ctx();
  c.font = fontCss(o);
  c.fontKerning = 'none';
  const max = Math.max(4, o.w - TEXT_PAD * 2);
  const fits = (s: string) => c.measureText(s.trimEnd()).width <= max;
  const out: string[] = [];
  for (const para of o.s.split('\n')) {
    let line = '';
    for (const word of para.split(/(?<=\s)/)) {
      // keep trailing spaces attached to their word
      if (!line || fits(line + word)) line += word;
      else {
        out.push(line.trimEnd());
        line = word;
      }
      if (!fits(line)) line = breakLong(c, line, max, out);
    }
    out.push(line.trimEnd());
  }
  return out;
}

export function textWidthOf(o: Pick<TextObj, 'f' | 'z' | 'b' | 'i'>, s: string): number {
  const c = ctx();
  c.font = fontCss(o);
  c.fontKerning = 'none';
  return c.measureText(s).width;
}

/** Fill in `ls` / `h` for a text object. */
export function layoutText(o: TextObj): TextObj {
  const ls = wrapText(o);
  const h = Math.max(1, ls.length) * lineHeightOf(o) + TEXT_PAD * 2;
  return { ...o, ls, h };
}

/** Make sure the right face is loaded, then lay out. */
export async function layoutTextAsync(o: TextObj): Promise<TextObj> {
  await ensureFont(o.f, !!o.b, !!o.i).catch(() => undefined);
  return layoutText(o);
}
