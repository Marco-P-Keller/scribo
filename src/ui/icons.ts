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

/** Pen / highlighter illustrations for the favourites bar; the nib colour is the preset colour. */
export function toolGlyph(kind: 'pen' | 'highlighter', color: string): SVGElement {
  const svg = el('svg', { viewBox: '0 0 32 32', width: 30, height: 30, 'aria-hidden': 'true', class: `glyph glyph-${kind}` });
  const g = el('g', { transform: 'rotate(40 16 16)' });
  const outline = { stroke: 'rgba(0,0,0,0.32)', 'stroke-width': 0.9, 'stroke-linejoin': 'round' };
  if (kind === 'pen') {
    g.append(
      // barrel
      el('path', { d: 'M12.2 3.6a3.8 3.8 0 0 1 7.6 0V20h-7.6z', fill: color, ...outline }),
      // sheen
      el('path', { d: 'M13.6 4.4a2.4 2.4 0 0 1 1.2-1.5v16.4h-1.2z', fill: 'rgba(255,255,255,0.28)' }),
      // ferrule
      el('rect', { x: 12.2, y: 17.2, width: 7.6, height: 2.6, fill: 'rgba(255,255,255,0.55)' }),
      // cone
      el('path', { d: 'M12.2 20h7.6l-2.9 7.2a1 1 0 0 1-1.8 0z', fill: '#e9e9ee', ...outline }),
      el('path', { d: 'M14.5 24.6h3l-1.05 2.7a.5.5 0 0 1-.9 0z', fill: color }),
    );
  } else {
    g.append(
      // body
      el('path', { d: 'M10.6 3.2a2.6 2.6 0 0 1 2.6-2.6h5.6a2.6 2.6 0 0 1 2.6 2.6V17h-10.8z', fill: '#f1f1f4', ...outline }),
      el('rect', { x: 10.6, y: 8.4, width: 10.8, height: 5.2, fill: color, stroke: 'rgba(0,0,0,0.2)', 'stroke-width': 0.6 }),
      // neck
      el('path', { d: 'M10.6 17h10.8l-1.6 3.4h-7.6z', fill: '#d9d9de', ...outline }),
      // chisel tip
      el('path', { d: 'M12.2 20.4h7.6l1.4 6.2-3.2 2.4h-4l-3.2-2.4z', fill: color, ...outline }),
      el('path', { d: 'M13.2 21.4h2.2l-.4 6.4h-1.1z', fill: 'rgba(255,255,255,0.3)' }),
    );
  }
  svg.append(g);
  return svg;
}

export function eraserGlyph(): SVGElement {
  const svg = el('svg', { viewBox: '0 0 32 32', width: 30, height: 30, 'aria-hidden': 'true', class: 'glyph glyph-eraser' });
  const g = el('g', { transform: 'rotate(40 16 16)' });
  const outline = { stroke: 'rgba(0,0,0,0.32)', 'stroke-width': 0.9, 'stroke-linejoin': 'round' };
  g.append(
    el('rect', { x: 9.6, y: 5, width: 12.8, height: 22, rx: 3, fill: '#f7a5b8', ...outline }),
    el('path', { d: 'M9.6 17h12.8v7a3 3 0 0 1-3 3h-6.8a3 3 0 0 1-3-3z', fill: '#f2f2f5', ...outline }),
    el('rect', { x: 9.6, y: 15.6, width: 12.8, height: 2.2, fill: 'rgba(0,0,0,0.12)' }),
  );
  svg.append(g);
  return svg;
}
