import { Emitter } from '../core/emitter';
import type { FontId, Preset, ShapeTool, SnapMode, ToolId } from '../core/types';

export type PenAction = 'erase' | 'lasso' | 'select' | 'none';

export interface Settings {
  lang: 'auto' | 'de' | 'en';
  theme: 'auto' | 'light' | 'dark';
  /** touch draws instead of scrolling */
  fingerDraws: boolean;
  mouseDraws: boolean;
  /** ignore touches while the pen is near the screen */
  palmRejection: boolean;
  /** 0..1, 0.5 = linear */
  sensitivity: number;
  snap: SnapMode;
  penButtons: { barrel: PenAction; eraser: PenAction; middle: PenAction };
  eraserMode: 'stroke' | 'point';
  eraserSize: number;
  autosave: boolean;
  lowLatency: boolean;
  sidebar: boolean;
  sidebarTab: 'pages' | 'outline' | 'search' | 'notes';

  tool: ToolId;
  favorites: Preset[];
  activePreset: string;
  shape: { kind: ShapeTool; color: string; width: number; fill: string | null; fillOpacity: number; dash: 0 | 1 | 2 };
  text: { font: FontId; size: number; color: string; bold: boolean; italic: boolean; align: 'l' | 'c' | 'r' };
  note: { color: string };
}

export const PEN_COLORS = [
  '#111111', '#4a4a4f', '#1f3a8a', '#0a6cff', '#00a6c8', '#1fa24a',
  '#ff9f0a', '#e5322d', '#ff2d78', '#8e44ff', '#8a5a2b', '#a7a7ad',
];
export const HIGHLIGHT_COLORS = ['#ffe14d', '#9af26b', '#7fd8ff', '#ff9ecb', '#ffb86b', '#c9a6ff'];
export const NOTE_COLORS = ['#ffd60a', '#ff9f0a', '#30d158', '#64d2ff', '#ff6482', '#bf5af2'];

export const DEFAULTS: Settings = {
  lang: 'auto',
  theme: 'auto',
  fingerDraws: false,
  mouseDraws: true,
  palmRejection: true,
  sensitivity: 0.5,
  snap: 'auto',
  penButtons: { barrel: 'erase', eraser: 'lasso', middle: 'none' },
  eraserMode: 'stroke',
  eraserSize: 9,
  autosave: false,
  lowLatency: false,
  sidebar: false,
  sidebarTab: 'pages',

  tool: 'pen',
  favorites: [
    { id: 'p1', tool: 'pen', color: '#111111', width: 1.6 },
    { id: 'p2', tool: 'pen', color: '#0a6cff', width: 1.6 },
    { id: 'p3', tool: 'pen', color: '#e5322d', width: 1.6 },
    { id: 'h1', tool: 'highlighter', color: '#ffe14d', width: 14 },
    { id: 'h2', tool: 'highlighter', color: '#9af26b', width: 14 },
  ],
  activePreset: 'p1',
  shape: { kind: 'rect', color: '#0a6cff', width: 2, fill: null, fillOpacity: 0.2, dash: 0 },
  text: { font: 'sans', size: 14, color: '#111111', bold: false, italic: false, align: 'l' },
  note: { color: '#ffd60a' },
};

const KEY = 'scribo.settings.v1';

class Store extends Emitter<{ change: keyof Settings }> {
  private data: Settings = structuredClone(DEFAULTS);

  constructor() {
    super();
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.data = this.merge(JSON.parse(raw));
    } catch {
      /* corrupt or unavailable storage: fall back to defaults */
    }
    window.addEventListener('storage', (e) => {
      if (e.key !== KEY || !e.newValue) return;
      try {
        this.data = this.merge(JSON.parse(e.newValue));
        this.emit('change', 'theme');
      } catch {
        /* ignore */
      }
    });
  }

  private merge(saved: Partial<Settings>): Settings {
    const d = structuredClone(DEFAULTS) as Settings & Record<string, unknown>;
    for (const k of Object.keys(DEFAULTS) as (keyof Settings)[]) {
      const v = saved[k];
      if (v === undefined) continue;
      const def = DEFAULTS[k];
      if (def && typeof def === 'object' && !Array.isArray(def)) (d[k] as object) = { ...(def as object), ...(v as object) };
      else (d[k] as unknown) = v;
    }
    if (!Array.isArray(d.favorites) || !d.favorites.length) d.favorites = structuredClone(DEFAULTS.favorites);
    return d;
  }

  get<K extends keyof Settings>(key: K): Settings[K] {
    return this.data[key];
  }

  set<K extends keyof Settings>(key: K, value: Settings[K]): void {
    if (this.data[key] === value && (typeof value !== 'object' || value === null)) return;
    this.data[key] = value;
    this.save();
    this.emit('change', key);
  }

  /** Update a nested settings object and notify. */
  patch<K extends keyof Settings>(key: K, partial: Partial<Settings[K]>): void {
    this.set(key, { ...(this.data[key] as object), ...partial } as Settings[K]);
  }

  private save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* storage full / blocked: keep working in memory */
    }
  }
}

export const settings = new Store();
