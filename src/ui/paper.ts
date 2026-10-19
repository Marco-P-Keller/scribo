import type { BlankTemplate } from '../pdf/build';
import { h } from './dom';
import { addStrings, t } from './i18n';

addStrings(
  {
    'paper.blank': 'Leer', 'paper.lined': 'Notizpapier', 'paper.grid': 'Häuschenpapier', 'paper.dotted': 'Punktraster',
    'paper.linedSub': 'Liniert, 8 mm', 'paper.gridSub': 'Kariert, 5 mm', 'paper.dottedSub': 'Punkte, 5 mm', 'paper.blankSub': 'Weiss',
    'paper.portrait': 'Hochformat', 'paper.landscape': 'Querformat',
  },
  {
    'paper.blank': 'Blank', 'paper.lined': 'Lined', 'paper.grid': 'Grid', 'paper.dotted': 'Dotted',
    'paper.linedSub': 'Ruled, 8 mm', 'paper.gridSub': 'Squares, 5 mm', 'paper.dottedSub': 'Dots, 5 mm', 'paper.blankSub': 'Plain',
    'paper.portrait': 'Portrait', 'paper.landscape': 'Landscape',
  },
);

export const PAPERS: BlankTemplate[] = ['lined', 'grid', 'dotted', 'blank'];

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
