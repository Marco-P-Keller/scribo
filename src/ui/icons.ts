import {
  createElement, AlignCenter, AlignLeft, AlignRight, ArrowUpRight, Bold, BringToFront, Check, ChevronDown, ChevronLeft,
  ChevronRight, ChevronUp, CircleHelp, ClipboardPaste, Copy, CopyPlus, Download, Ellipsis, Eraser, FileDown, FilePlus2, Files,
  FolderOpen, Fullscreen, Grid2x2, Hand, Highlighter, ImagePlus, Info, Italic, Keyboard, LassoSelect, Layers, Link, List, ListTree,
  Maximize, Minimize, Minus, Moon, MousePointer2, Pencil, Pentagon, Plus, Printer, Redo2, RefreshCw, RotateCcw, RotateCw,
  Save, Scissors, Search, SendToBack, Settings, Shapes, Square, Star, StickyNote, Strikethrough, Sun, Trash2, Triangle, Type,
  Underline, Undo2, X, ZoomIn, ZoomOut, PanelLeft, Spline, Circle, Slash, LayoutGrid, FileText, Share, Waypoints, Palette,
  Lock, Eye, SquarePen,
} from 'lucide';
import type { IconNode } from 'lucide';

const ICONS = {
  alignCenter: AlignCenter, alignLeft: AlignLeft, alignRight: AlignRight, arrow: ArrowUpRight, bold: Bold, front: BringToFront,
  check: Check, down: ChevronDown, left: ChevronLeft, right: ChevronRight, up: ChevronUp, help: CircleHelp, paste: ClipboardPaste,
  copy: Copy, duplicate: CopyPlus, download: Download, more: Ellipsis, eraser: Eraser, saveAs: FileDown, newPage: FilePlus2,
  pages: Files, open: FolderOpen, fullscreen: Fullscreen, grid: Grid2x2, hand: Hand, highlighter: Highlighter, image: ImagePlus,
  info: Info, italic: Italic, keyboard: Keyboard, lasso: LassoSelect, layers: Layers, link: Link, list: List, outline: ListTree,
  maximize: Maximize, minimize: Minimize, minus: Minus, moon: Moon, select: MousePointer2, pencil: Pencil, polygon: Pentagon,
  plus: Plus, print: Printer, redo: Redo2, refresh: RefreshCw, rotateLeft: RotateCcw, rotateRight: RotateCw, save: Save,
  cut: Scissors, search: Search, back: SendToBack, settings: Settings, shapes: Shapes, rect: Square, star: Star, note: StickyNote,
  strike: Strikethrough, sun: Sun, trash: Trash2, triangle: Triangle, text: Type, underline: Underline, undo: Undo2, close: X,
  zoomIn: ZoomIn, zoomOut: ZoomOut, sidebar: PanelLeft, polyline: Spline, ellipse: Circle, line: Slash, thumbs: LayoutGrid,
  file: FileText, share: Share, waypoints: Waypoints, palette: Palette, lock: Lock, eye: Eye, edit: SquarePen,
} satisfies Record<string, IconNode>;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, size = 18, stroke = 1.7): SVGElement {
  const el = createElement(ICONS[name], { width: size, height: size, 'stroke-width': stroke, 'aria-hidden': 'true' });
  el.classList.add('icon');
  return el as unknown as SVGElement;
}

const NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, ...kids: SVGElement[]): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  e.append(...kids);
  return e;
}

export type InstrumentKind = 'pen' | 'highlighter' | 'eraser' | 'lasso';

let gradientId = 0;

/**
 * Upright drawing instruments for the tool bar, like pens standing in a tray: the bar clips them at
 * its bottom edge and the selected one rises. The nib and band carry the preset colour.
 */
export function instrument(kind: InstrumentKind, color = '#111111'): SVGElement {
  const wide = kind === 'highlighter';
  const w = wide ? 26 : 22;
  const cx = w / 2;
  const id = `ins${++gradientId}`;
  const svg = el('svg', { viewBox: `0 0 ${w} 64`, width: w, height: 64, 'aria-hidden': 'true', class: `ins ins-${kind}` });
  // a turned, satin-white barrel: light from the upper left
  const body = el(
    'linearGradient',
    { id: `${id}b`, x1: 0, y1: 0, x2: 1, y2: 0 },
    el('stop', { offset: 0, 'stop-color': '#dedee3' }),
    el('stop', { offset: 0.28, 'stop-color': '#ffffff' }),
    el('stop', { offset: 0.62, 'stop-color': '#f6f6f8' }),
    el('stop', { offset: 1, 'stop-color': '#cfcfd6' }),
  );
  svg.append(el('defs', {}, body));
  const fill = `url(#${id}b)`;
  const edge = { stroke: 'rgba(0,0,0,0.16)', 'stroke-width': 0.7, 'stroke-linejoin': 'round' };
  const shade = 'rgba(0,0,0,0.05)';
  const x0 = wide ? 3 : 3;
  const x1 = w - x0;

  if (kind === 'pen' || kind === 'lasso') {
    svg.append(
      el('rect', { x: x0, y: 24, width: x1 - x0, height: 44, fill, ...edge }),
      el('path', { d: `M${x0} 24 L${cx - 1.4} 6.6 Q${cx} 3.2 ${cx + 1.4} 6.6 L${x1} 24 Z`, fill, ...edge }),
      el('path', { d: `M${x0} 24 L${cx - 1.4} 6.6 Q${cx} 3.2 ${cx + 1.4} 6.6 L${x1} 24 Z`, fill: shade }),
    );
    const nib = kind === 'pen' ? color : '#3a3a40';
    svg.append(el('path', { d: `M${cx - 2.9} 10.5 L${cx - 1.4} 6.6 Q${cx} 3.2 ${cx + 1.4} 6.6 L${cx + 2.9} 10.5 Z`, fill: nib }));
    if (kind === 'pen') svg.append(el('rect', { x: x0, y: 28, width: x1 - x0, height: 4.5, fill: color }));
    else svg.append(el('line', { x1: x0 + 0.6, x2: x1, y1: 30.25, y2: 30.25, style: 'stroke: var(--accent)', 'stroke-width': 4.5, 'stroke-dasharray': '2.6 1.8' }));
  } else if (kind === 'highlighter') {
    svg.append(
      el('rect', { x: x0, y: 26, width: x1 - x0, height: 42, fill, ...edge }),
      el('path', { d: `M${x0} 26 L${x0 + 3.5} 15 H${x1 - 3.5} L${x1} 26 Z`, fill, ...edge }),
      el('path', { d: `M${x0} 26 L${x0 + 3.5} 15 H${x1 - 3.5} L${x1} 26 Z`, fill: shade }),
      el('path', { d: `M${cx - 4.5} 15 V7.6 L${cx + 4.5} 4.4 V15 Z`, fill: color, ...edge }),
      el('path', { d: `M${cx - 4.5} 15 V7.6 L${cx - 2.2} 6.8 V15 Z`, fill: 'rgba(255,255,255,0.32)' }),
      el('rect', { x: x0, y: 30, width: x1 - x0, height: 5, fill: color }),
    );
  } else {
    const cap = el(
      'linearGradient',
      { id: `${id}c`, x1: 0, y1: 0, x2: 1, y2: 0 },
      el('stop', { offset: 0, 'stop-color': '#e9a3b1' }),
      el('stop', { offset: 0.3, 'stop-color': '#f8c9d2' }),
      el('stop', { offset: 1, 'stop-color': '#dc8e9e' }),
    );
    svg.querySelector('defs')!.append(cap);
    svg.append(
      el('rect', { x: x0, y: 22, width: x1 - x0, height: 46, fill, ...edge }),
      el('path', { d: `M${x0} 22 V13 Q${x0} 5 ${cx} 5 Q${x1} 5 ${x1} 13 V22 Z`, fill: `url(#${id}c)`, ...edge }),
      el('rect', { x: x0, y: 21, width: x1 - x0, height: 3.6, fill: '#c4c4cb' }),
    );
  }
  // a soft specular line along the barrel
  svg.append(el('rect', { x: x0 + 3, y: wide ? 36 : 34, width: 1.6, height: 30, rx: 0.8, fill: 'rgba(255,255,255,0.7)' }));
  return svg;
}
