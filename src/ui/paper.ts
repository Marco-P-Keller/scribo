import type { BlankTemplate } from '../pdf/build';
import type { PageSize } from '../app/settings';
import { h } from './dom';
import { addStrings, t } from './i18n';
import { field, segmented } from './popover';

addStrings(
  {
    'paper.blank': 'Leere Seite', 'paper.lined': 'Notizpapier', 'paper.grid': 'Blockpapier', 'paper.dotted': 'Punktraster',
    'paper.linedSub': 'Liniert, 8 mm', 'paper.gridSub': 'Kariert, 5 mm', 'paper.dottedSub': 'Punkte, 5 mm', 'paper.blankSub': 'Weiss',
    'paper.portrait': 'Hochformat', 'paper.landscape': 'Querformat',
    'paper.size': 'Grösse', 'paper.orient': 'Ausrichtung', 'paper.same': 'Wie Seite', 'paper.sameTitle': 'Gleiche Grösse wie die Seite davor',
  },
  {
    'paper.blank': 'Blank page', 'paper.lined': 'Lined', 'paper.grid': 'Grid', 'paper.dotted': 'Dotted',
    'paper.linedSub': 'Ruled, 8 mm', 'paper.gridSub': 'Squares, 5 mm', 'paper.dottedSub': 'Dots, 5 mm', 'paper.blankSub': 'Plain',
    'paper.portrait': 'Portrait', 'paper.landscape': 'Landscape',
    'paper.size': 'Size', 'paper.orient': 'Orientation', 'paper.same': 'Same', 'paper.sameTitle': 'Same size as the page before',
  },
);

export const PAPERS: BlankTemplate[] = ['blank', 'lined', 'grid', 'dotted'];

/** Paper sizes in pt, portrait. */
export const PAGE_SIZES: Record<Exclude<PageSize, 'same'>, [number, number]> = {
  A3: [841.89, 1190.55],
  A4: [595.28, 841.89],
  A5: [419.53, 595.28],
  A6: [297.64, 419.53],
  letter: [612, 792],
};

const SVG = 'http://www.w3.org/2000/svg';

/** Miniature of a sheet of paper (the same pattern the PDF gets, drawn at thumbnail scale). */
function preview(kind: BlankTemplate, landscape = false): SVGSVGElement {
  const w = landscape ? 84 : 60;
  const hh = landscape ? 60 : 84;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${hh}`);
  svg.setAttribute('class', 'paper-svg');
  const el = (name: string, attrs: Record<string, string | number>) => {
    const n = document.createElementNS(SVG, name);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    svg.append(n);
  };
  el('rect', { x: 0.5, y: 0.5, width: w - 1, height: hh - 1, rx: 2.5, class: 'paper-sheet' });
  const step = kind === 'lined' ? 5.2 : 3.4;
  if (kind === 'lined') {
    for (let y = 12; y < hh - 5; y += step) el('line', { x1: 5, x2: w - 5, y1: y, y2: y, class: 'paper-line' });
    el('line', { x1: 13, x2: 13, y1: 5, y2: hh - 5, class: 'paper-margin' });
  } else if (kind === 'grid') {
    for (let x = 5; x <= w - 5; x += step) el('line', { x1: x, x2: x, y1: 5, y2: hh - 5, class: 'paper-line thin' });
    for (let y = 5; y <= hh - 5; y += step) el('line', { x1: 5, x2: w - 5, y1: y, y2: y, class: 'paper-line thin' });
  } else if (kind === 'dotted') {
    for (let x = 5; x <= w - 5; x += step) for (let y = 5; y <= hh - 5; y += step) el('circle', { cx: x, cy: y, r: 0.45, class: 'paper-dot' });
  }
  return svg;
}

/** Big, tappable paper choice (radio group). */
export function paperPicker(value: BlankTemplate, onChange: (v: BlankTemplate) => void, landscape = false): HTMLElement {
  const root = h('div.paper-picker', { role: 'radiogroup' });
  const cards = PAPERS.map((kind) =>
    h(
      'button.paper-card',
      {
        role: 'radio',
        'aria-checked': String(kind === value),
        onclick: () => {
          for (const c of cards) c.setAttribute('aria-checked', String(c === card(kind)));
          onChange(kind);
        },
      },
      preview(kind, landscape),
      h('span.paper-name', null, t(`paper.${kind}`)),
      h('span.paper-sub', null, t(`paper.${kind}Sub`)),
    ),
  );
  const card = (kind: BlankTemplate) => cards[PAPERS.indexOf(kind)];
  root.append(...cards);
  return root;
}

export interface PageChoice {
  template: BlankTemplate;
  size: PageSize;
  orient: 'p' | 'l';
}

/**
 * Paper, size and orientation of a new page. `ref` is the size of the neighbouring page
 * (offers "same size"); without it the choice starts at A4.
 */
export function pageSetup(initial: PageChoice, ref?: { w: number; h: number }): { el: HTMLElement; value: () => PageChoice & { w: number; h: number } } {
  const c = { ...initial };
  if (c.size === 'same' && !ref) c.size = 'A4';
  // "same size" starts in the orientation of that page
  if (c.size === 'same' && ref) c.orient = ref.w > ref.h ? 'l' : 'p';
  const picker = h('div');
  const paint = () => picker.replaceChildren(paperPicker(c.template, (v) => (c.template = v), c.orient === 'l'));
  paint();
  const sizes: { value: PageSize; label: string; title?: string }[] = [
    ...(ref ? [{ value: 'same' as const, label: t('paper.same'), title: t('paper.sameTitle') }] : []),
    ...(['A3', 'A4', 'A5', 'A6'] as const).map((v) => ({ value: v, label: v })),
    { value: 'letter', label: 'Letter' },
  ];
  const size = segmented(sizes, c.size, (v) => (c.size = v));
  const orient = segmented(
    [
      { value: 'p' as const, label: t('paper.portrait') },
      { value: 'l' as const, label: t('paper.landscape') },
    ],
    c.orient,
    (v) => {
      c.orient = v;
      paint();
    },
  );
  const el = h('div.page-setup', null, picker, h('div.page-setup-row', null, field(t('paper.size'), size), field(t('paper.orient'), orient)));
  const value = () => {
    let [w, hh] = c.size === 'same' ? [ref!.w, ref!.h] : PAGE_SIZES[c.size];
    if ((c.orient === 'l') !== (w > hh)) [w, hh] = [hh, w];
    return { ...c, w, h: hh };
  };
  return { el, value };
}
