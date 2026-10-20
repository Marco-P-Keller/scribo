import type { Preset, ShapeTool, SnapMode, ToolId, FontId } from '../core/types';
import { FONT_LABEL } from '../core/fontmeta';
import { settings, PEN_COLORS, HIGHLIGHT_COLORS, NOTE_COLORS } from '../app/settings';
import { addPreset, currentPreset, favorites, movePreset, removePreset, selectPreset, updatePreset } from '../app/presets';
import type { AppApi } from '../app/api';
import { h } from './dom';
import { icon, instrument } from './icons';
import type { IconName } from './icons';
import { Popover, field, segmented, showMenu, slider } from './popover';
import { colorPanel } from './colorpicker';
import { fillControls } from './fill';
import { smoothingLabel } from './smooth-preview';
import { FONT_FAMILY } from '../render/fonts';
import { confirmDialog } from './dialogs';
import { addStrings, t } from './i18n';

addStrings(
  {
    'tool.select': 'Auswahl', 'tool.pen': 'Stift', 'tool.highlighter': 'Textmarker', 'tool.eraser': 'Radierer', 'tool.lasso': 'Lasso',
    'tool.text': 'Text', 'tool.shape': 'Formen', 'tool.note': 'Notiz', 'tool.image': 'Bild einfügen',
    'fav.add': 'Stift hinzufügen', 'fav.addPen': 'Neuer Stift', 'fav.addHl': 'Neuer Textmarker', 'fav.remove': 'Entfernen', 'fav.duplicate': 'Duplizieren',
    'pop.width': 'Stärke', 'pop.color': 'Farbe', 'pop.opacity': 'Deckkraft', 'pop.snap': 'Formerkennung', 'pop.smooth': 'Glättung',
    'snap.off': 'Aus', 'snap.hold': 'Halten', 'snap.auto': 'Auto',
    'snap.hint': 'Halten: Stift am Strichende ruhen lassen. Auto: sofort beim Absetzen.',
    'eraser.mode': 'Modus', 'eraser.stroke': 'Linie', 'eraser.point': 'Punkt', 'eraser.size': 'Größe', 'eraser.clearPage': 'Seite leeren',
    'eraser.clearTitle': 'Alle Anmerkungen dieser Seite löschen?', 'eraser.clearMsg': 'Du kannst das mit Rückgängig wiederherstellen.', 'eraser.clearDo': 'Seite leeren',
    'shape.line': 'Linie', 'shape.arrow': 'Pfeil', 'shape.rect': 'Rechteck', 'shape.ellipse': 'Ellipse', 'shape.poly': 'Polygon', 'shape.polyline': 'Linienzug',
    'shape.fill': 'Füllung', 'shape.dash': 'Linienart', 'shape.solid': 'Durchgezogen', 'shape.dashed': 'Gestrichelt', 'shape.dotted': 'Gepunktet',
    'shape.polyHint': 'Punkte antippen · letzten Punkt nochmals antippen oder Enter beendet',
    'text.font': 'Schrift', 'text.size': 'Größe', 'text.style': 'Stil', 'text.align': 'Ausrichtung',
    'note.color': 'Farbe der Notiz',
    'tb.undo': 'Rückgängig', 'tb.redo': 'Wiederholen', 'tb.search': 'Suchen', 'tb.save': 'Speichern', 'tb.more': 'Mehr', 'tb.sidebar': 'Seitenleiste',
    'tb.saved': 'Gespeichert', 'tb.edited': 'Nicht gespeichert', 'tb.new': 'Neu – noch nicht gespeichert', 'tb.untitled': 'Kein Dokument',
    'tb.width': 'Stärke',
  },
  {
    'tool.select': 'Select', 'tool.pen': 'Pen', 'tool.highlighter': 'Highlighter', 'tool.eraser': 'Eraser', 'tool.lasso': 'Lasso',
    'tool.text': 'Text', 'tool.shape': 'Shapes', 'tool.note': 'Note', 'tool.image': 'Insert image',
    'fav.add': 'Add pen', 'fav.addPen': 'New pen', 'fav.addHl': 'New highlighter', 'fav.remove': 'Remove', 'fav.duplicate': 'Duplicate',
    'pop.width': 'Thickness', 'pop.color': 'Color', 'pop.opacity': 'Opacity', 'pop.snap': 'Shape recognition', 'pop.smooth': 'Smoothing',
    'snap.off': 'Off', 'snap.hold': 'Hold', 'snap.auto': 'Auto',
    'snap.hint': 'Hold: rest the pen at the end of a stroke. Auto: snaps as soon as you lift.',
    'eraser.mode': 'Mode', 'eraser.stroke': 'Stroke', 'eraser.point': 'Point', 'eraser.size': 'Size', 'eraser.clearPage': 'Clear page',
    'eraser.clearTitle': 'Delete all annotations on this page?', 'eraser.clearMsg': 'You can bring them back with Undo.', 'eraser.clearDo': 'Clear page',
    'shape.line': 'Line', 'shape.arrow': 'Arrow', 'shape.rect': 'Rectangle', 'shape.ellipse': 'Ellipse', 'shape.poly': 'Polygon', 'shape.polyline': 'Polyline',
    'shape.fill': 'Fill', 'shape.dash': 'Line style', 'shape.solid': 'Solid', 'shape.dashed': 'Dashed', 'shape.dotted': 'Dotted',
    'shape.polyHint': 'Tap points · tap the last point again or press Enter to finish',
    'text.font': 'Font', 'text.size': 'Size', 'text.style': 'Style', 'text.align': 'Alignment',
    'note.color': 'Note color',
    'tb.undo': 'Undo', 'tb.redo': 'Redo', 'tb.search': 'Search', 'tb.save': 'Save', 'tb.more': 'More', 'tb.sidebar': 'Sidebar',
    'tb.saved': 'Saved', 'tb.edited': 'Unsaved changes', 'tb.new': 'New – not saved yet', 'tb.untitled': 'No document',
    'tb.width': 'Thickness',
  },
);

const SHAPES: { kind: ShapeTool; icon: IconName }[] = [
  { kind: 'line', icon: 'line' },
  { kind: 'arrow', icon: 'arrow' },
  { kind: 'rect', icon: 'rect' },
  { kind: 'ellipse', icon: 'ellipse' },
  { kind: 'poly', icon: 'polygon' },
  { kind: 'polyline', icon: 'waypoints' },
];

const SNAP_OPTIONS: { value: SnapMode; label: string }[] = [
  { value: 'off', label: 'snap.off' },
  { value: 'hold', label: 'snap.hold' },
  { value: 'auto', label: 'snap.auto' },
];

/** Opens its popover on the first click for tools whose first action is picking a style. */
const OPEN_ON_SELECT = new Set<ToolId>(['shape', 'text']);

export class Toolbar {
  readonly el = h('header.titlebar');
  private tray = h('div.tray.keep-focus');
  private nameEl = h('span.doc-name');
  private statusEl = h('span.doc-status');
  private undoBtn!: HTMLButtonElement;
  private redoBtn!: HTMLButtonElement;
  private saveBtn!: HTMLButtonElement;
  private pop: Popover | null = null;
  private dragging = false;

  constructor(private app: AppApi) {
    this.build();
    settings.on('change', (key) => {
      if (['favorites', 'activePreset', 'tool', 'shape', 'text', 'note'].includes(key)) this.renderTray();
    });
    app.editor.on('tool', () => this.renderTray());
  }

  // ── structure ─────────────────────────────────────────────────────────

  private build(): void {
    const toggleBtn = this.iconButton('sidebar', t('tb.sidebar'), () => this.app.toggleSidebar());
    toggleBtn.classList.add('sidebar-toggle', 'doc-only');
    const left = h('div.tb-left.no-drag', null, toggleBtn, h('div.doc-info', null, this.nameEl, this.statusEl));

    this.undoBtn = this.iconButton('undo', t('tb.undo'), () => void this.app.editor.model.undo(), 'Ctrl+Z');
    this.redoBtn = this.iconButton('redo', t('tb.redo'), () => void this.app.editor.model.redo(), 'Ctrl+Y');
    this.saveBtn = h('button.tb-btn.save.doc-only', { title: `${t('tb.save')} (Ctrl+S)`, 'aria-label': t('tb.save'), onclick: () => void this.app.save() }, icon('save', 18));
    const searchBtn = this.iconButton('search', t('tb.search'), () => this.app.toggleSidebar('search'), 'Ctrl+F');
    searchBtn.classList.add('doc-only');
    const moreBtn = this.iconButton('more', t('tb.more'), () => this.openMore(moreBtn));
    const right = h('div.tb-right.no-drag', null, h('div.btn-group.doc-only', null, this.undoBtn, this.redoBtn), searchBtn, this.saveBtn, moreBtn);

    const center = h('div.tb-center.no-drag.doc-only', null, this.tray);
    this.el.append(left, center, right);
    this.renderTray();
    this.setDocument(null);
  }

  private iconButton(name: IconName, label: string, onClick: () => void, shortcut?: string): HTMLButtonElement {
    return h('button.tb-btn', { title: shortcut ? `${label} (${shortcut})` : label, 'aria-label': label, onclick: onClick }, icon(name, 18));
  }

  // ── document state ────────────────────────────────────────────────────

  setDocument(name: string | null): void {
    this.nameEl.textContent = name ?? t('tb.untitled');
    this.el.classList.toggle('no-doc', !name);
    this.refreshState(false);
  }

  refreshState(dirty: boolean): void {
    const model = this.app.session?.model;
    this.undoBtn.disabled = !model?.canUndo;
    this.redoBtn.disabled = !model?.canRedo;
    this.undoBtn.title = model?.canUndo ? `${t('tb.undo')}: ${model.undoLabel} (Ctrl+Z)` : t('tb.undo');
    this.redoBtn.title = model?.canRedo ? `${t('tb.redo')}: ${model.redoLabel} (Ctrl+Y)` : t('tb.redo');
    this.saveBtn.disabled = !this.app.session;
    this.saveBtn.classList.toggle('dirty', dirty);
    const s = this.app.session;
    this.statusEl.textContent = s ? (dirty ? t('tb.edited') : s.file.untitled ? t('tb.new') : t('tb.saved')) : '';
    this.statusEl.classList.toggle('dirty', dirty);
    this.el.classList.toggle('dirty', dirty);
  }

  // ── tray ──────────────────────────────────────────────────────────────

  private renderTray(): void {
    if (this.dragging) return;
    const cur = settings.get('tool');
    const activePreset = currentPreset();
    const tray = this.tray;
    tray.replaceChildren();

    tray.append(this.fixedTool('select', 'select', 'V'));
    tray.append(h('span.sep'));

    const favs = h('div.favorites');
    for (const p of favorites()) favs.append(this.presetButton(p, (cur === 'pen' || cur === 'highlighter') && p.id === activePreset.id));
    favs.append(
      h('button.tool.add', { title: t('fav.add'), 'aria-label': t('fav.add'), onclick: (e: Event) => this.openAdd(e.currentTarget as HTMLElement) }, icon('plus', 15, 2)),
    );
    tray.append(favs, h('span.sep'));

    tray.append(this.fixedTool('eraser', 'eraser', 'E'), this.fixedTool('lasso', 'lasso', 'L'), h('span.sep'));
    tray.append(
      this.fixedTool('text', 'text', 'T'),
      this.fixedTool('shape', 'shapes', 'S'),
      this.fixedTool('note', 'note', 'N'),
      this.fixedTool('image', 'image', ''),
    );
  }

  private fixedTool(id: ToolId, ic: IconName, key: string): HTMLButtonElement {
    const cur = settings.get('tool');
    const label = t(`tool.${id}`);
    const upright = id === 'eraser' || id === 'lasso';
    const btn = h(
      upright ? 'button.tool.instrument' : 'button.tool',
      {
        title: key ? `${label} (${key})` : label,
        'aria-label': label,
        'aria-pressed': String(cur === id),
        class: cur === id ? 'selected' : '',
        'data-tool': id,
      },
      upright ? instrument(id) : icon(ic, 20, 1.6),
    );
    btn.addEventListener('click', () => this.onToolClick(id));
    return btn;
  }

  private presetButton(p: Preset, selected: boolean): HTMLButtonElement {
    const label = `${t(p.tool === 'pen' ? 'tool.pen' : 'tool.highlighter')} · ${p.width} pt`;
    const btn = h(
      'button.tool.preset.instrument',
      {
        title: label,
        'aria-label': label,
        'aria-pressed': String(selected),
        class: selected ? 'selected' : '',
        dataset: { id: p.id },
      },
      instrument(p.tool, p.color),
    );
    btn.addEventListener('click', () => {
      if (this.dragging) return;
      const was = selected;
      selectPreset(p.id);
      if (was) this.openPresetPopover(p.id);
      else this.closePop();
    });
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.openPresetMenu(p, btn);
    });
    this.enableReorder(btn, p);
    return btn;
  }

  /** Drag a favourite sideways to reorder; long-press opens the menu (touch). */
  private enableReorder(btn: HTMLElement, p: Preset): void {
    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const startX = e.clientX;
      let moved = false;
      const siblings = () => [...this.tray.querySelectorAll<HTMLElement>('.preset')];
      const press = window.setTimeout(() => {
        if (!moved) {
          cleanup();
          this.openPresetMenu(p, btn);
        }
      }, 650);
      const move = (ev: PointerEvent) => {
        if (!moved && Math.abs(ev.clientX - startX) > 8) {
          moved = true;
          clearTimeout(press);
          this.dragging = true;
          btn.classList.add('lifting');
          btn.setPointerCapture(ev.pointerId);
        }
        if (moved) btn.style.transform = `translateX(${ev.clientX - startX}px)`;
      };
      const cleanup = () => {
        clearTimeout(press);
        btn.removeEventListener('pointermove', move);
        btn.removeEventListener('pointerup', up);
        btn.removeEventListener('pointercancel', up);
      };
      const up = (ev: PointerEvent) => {
        cleanup();
        if (!moved) return;
        const list = siblings();
        let idx = list.findIndex((el) => el === btn);
        for (let i = 0; i < list.length; i++) {
          const r = list[i].getBoundingClientRect();
          if (ev.clientX < r.left + r.width / 2) {
            idx = i;
            break;
          }
          idx = i + 1;
        }
        const from = list.indexOf(btn);
        const to = idx > from ? idx - 1 : idx;
        btn.classList.remove('lifting');
        btn.style.transform = '';
        this.dragging = false;
        if (to !== from) movePreset(p.id, to);
        else this.renderTray();
        setTimeout(() => (this.dragging = false), 0);
      };
      btn.addEventListener('pointermove', move);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
    });
  }

  private onToolClick(id: ToolId): void {
    const was = settings.get('tool') === id;
    this.app.editor.setTool(id);
    if (id === 'select' || id === 'lasso' || id === 'image') {
      this.closePop();
      return;
    }
    if (was || OPEN_ON_SELECT.has(id)) {
      if (this.pop?.isOpen && was) this.closePop();
      else this.openToolPopover(id);
    } else this.closePop();
  }

  // ── popovers ──────────────────────────────────────────────────────────

  private closePop(): void {
    this.pop?.close();
    this.pop = null;
  }

  private openPop(content: HTMLElement, anchor: HTMLElement, cls = ''): void {
    this.closePop();
    this.pop = new Popover(content, { anchor, className: `tool-popover keep-focus ${cls}` }).open();
  }

  /** The tray is rebuilt whenever a setting changes, so anchors are looked up fresh. */
  private anchor(selector: string): HTMLElement {
    return this.tray.querySelector<HTMLElement>(selector) ?? this.tray;
  }

  private openToolPopover(id: ToolId): void {
    const anchor = this.anchor(`[data-tool="${id}"]`);
    if (id === 'eraser') this.openPop(this.eraserPanel(), anchor);
    else if (id === 'shape') this.openPop(this.shapePanel(), anchor, 'wide');
    else if (id === 'text') this.openPop(this.textPanel(), anchor, 'wide');
    else if (id === 'note') this.openPop(this.notePanel(), anchor);
  }

  private openPresetPopover(id: string): void {
    const p = favorites().find((x) => x.id === id);
    if (p) this.openPop(this.penPanel(p), this.anchor(`[data-id="${id}"]`), 'wide');
  }

  private openAdd(anchor: HTMLElement): void {
    showMenu(anchor, [
      { label: t('fav.addPen'), icon: 'pencil', onClick: () => addPreset({ tool: 'pen', color: PEN_COLORS[3], width: 1.6 }) },
      { label: t('fav.addHl'), icon: 'highlighter', onClick: () => addPreset({ tool: 'highlighter', color: HIGHLIGHT_COLORS[1], width: 14 }) },
    ]);
  }

  private openPresetMenu(p: Preset, anchor: HTMLElement): void {
    showMenu(anchor, [
      { label: t('fav.duplicate'), icon: 'duplicate', onClick: () => addPreset({ tool: p.tool, color: p.color, width: p.width, opacity: p.opacity }) },
      { label: t('fav.remove'), icon: 'trash', danger: true, disabled: favorites().length <= 1, onClick: () => removePreset(p.id) },
    ]);
  }

  // ── panels ────────────────────────────────────────────────────────────

  private penPanel(initial: Preset): HTMLElement {
    const hl = initial.tool === 'highlighter';
    let p = { ...initial };
    const preview = h('div.stroke-preview');
    const paint = () => {
      const w = Math.max(1, p.width * (hl ? 1 : 1.6));
      preview.replaceChildren(strokePreview(p, w));
    };
    paint();
    const apply = (partial: Partial<Preset>) => {
      p = { ...p, ...partial };
      updatePreset(p.id, partial);
      paint();
    };
    const width = hl
      ? slider({ min: 6, max: 36, step: 1, value: p.width, format: (v) => `${v} pt`, onInput: (v) => apply({ width: v }) })
      : slider({ min: 0.4, max: 10, step: 0.1, value: p.width, format: (v) => `${v.toFixed(1)} pt`, onInput: (v) => apply({ width: Math.round(v * 10) / 10 }) });
    const quick = (hl ? [8, 14, 22] : [1.2, 1.6, 3.5]).map((w) =>
      h('button.size-dot', { title: `${w} pt`, onclick: () => { apply({ width: w }); (width.querySelector('input') as HTMLInputElement).value = String(w); width.querySelector('input')!.dispatchEvent(new Event('input')); } },
        h('span', { style: `width:${Math.min(22, 4 + w * (hl ? 0.7 : 4))}px;height:${Math.min(22, 4 + w * (hl ? 0.7 : 4))}px` })),
    );
    const colors = colorPanel({
      colors: hl ? HIGHLIGHT_COLORS : PEN_COLORS,
      value: p.color,
      onPick: (c) => c && apply({ color: c }),
    });
    const body = h(
      'div.panel',
      null,
      preview,
      field(t('pop.width'), h('div.width-row', null, width, h('div.size-dots', null, quick))),
      field(t('pop.color'), colors),
    );
    if (hl) {
      body.append(field(t('pop.opacity'), slider({ min: 30, max: 100, step: 5, value: Math.round((p.opacity ?? 1) * 100), format: (v) => `${v} %`, onInput: (v) => apply({ opacity: v / 100 }) })));
    }
    body.append(
      field(t('pop.smooth'), slider({ min: 0, max: 1, step: 0.05, value: settings.get('smoothing'), format: smoothingLabel, onInput: (v) => settings.set('smoothing', v) })),
      field(
        t('pop.snap'),
        segmented(
          SNAP_OPTIONS.map((o) => ({ value: o.value, label: t(o.label) })),
          settings.get('snap'),
          (v) => settings.set('snap', v),
        ),
        t('snap.hint'),
      ),
    );
    return body;
  }

  private eraserPanel(): HTMLElement {
    return h(
      'div.panel',
      null,
      field(
        t('eraser.mode'),
        segmented(
          [
            { value: 'stroke' as const, label: t('eraser.stroke') },
            { value: 'point' as const, label: t('eraser.point') },
          ],
          settings.get('eraserMode'),
          (v) => settings.set('eraserMode', v),
        ),
      ),
      field(t('eraser.size'), slider({ min: 4, max: 36, step: 1, value: settings.get('eraserSize'), format: (v) => `${v} px`, onInput: (v) => settings.set('eraserSize', v) })),
      h(
        'button.btn.danger.block',
        {
          onclick: async () => {
            this.closePop();
            const page = this.app.viewer.currentPage;
            const objs = this.app.session?.model.pages[page] ?? [];
            if (!objs.length) return;
            if (await confirmDialog({ title: t('eraser.clearTitle'), message: t('eraser.clearMsg'), confirm: t('eraser.clearDo'), danger: true })) {
              this.app.session!.model.remove('Seite leeren', page, objs.map((o) => o.id));
            }
          },
        },
        icon('trash', 15),
        t('eraser.clearPage'),
      ),
    );
  }

  private shapePanel(): HTMLElement {
    const st = () => settings.get('shape');
    const ed = this.app.editor;
    const grid = h('div.shape-grid');
    const renderGrid = () => {
      grid.replaceChildren(
        ...SHAPES.map((s) =>
          h('button.shape-btn', {
            title: t(`shape.${s.kind}`),
            'aria-label': t(`shape.${s.kind}`),
            'aria-pressed': String(st().kind === s.kind),
            onclick: () => {
              settings.patch('shape', { kind: s.kind });
              renderGrid();
            },
          }, icon(s.icon, 20)),
        ),
      );
    };
    renderGrid();
    const restyle = (partial: Record<string, unknown>, merge?: string) => ed.restyleSelectedShapes(partial, merge);
    const fill = fillControls({
      fill: st().fill,
      opacity: st().fillOpacity,
      onFill: (c) => {
        settings.patch('shape', { fill: c });
        restyle(c ? { fill: c, fo: st().fillOpacity } : { fill: undefined });
      },
      onOpacity: (v) => {
        settings.patch('shape', { fillOpacity: v });
        restyle({ fo: v }, 'fill-opacity');
      },
    });
    return h(
      'div.panel',
      null,
      grid,
      st().kind === 'poly' || st().kind === 'polyline' ? h('div.hint', null, t('shape.polyHint')) : null,
      field(t('pop.color'), colorPanel({ colors: PEN_COLORS, value: st().color, onPick: (c) => { if (!c) return; settings.patch('shape', { color: c }); restyle({ c }); } })),
      field(t('pop.width'), slider({ min: 0.5, max: 12, step: 0.5, value: st().width, format: (v) => `${v} pt`, onInput: (v) => { settings.patch('shape', { width: v }); restyle({ w: v }, 'shape-width'); } })),
      fill,
      field(
        t('shape.dash'),
        segmented(
          [
            { value: 0 as const, label: '───', title: t('shape.solid') },
            { value: 1 as const, label: '– – –', title: t('shape.dashed') },
            { value: 2 as const, label: '· · ·', title: t('shape.dotted') },
          ],
          st().dash,
          (v) => {
            settings.patch('shape', { dash: v });
            restyle({ dash: v });
          },
        ),
      ),
    );
  }

  private textPanel(): HTMLElement {
    const st = () => settings.get('text');
    const ed = this.app.editor;
    const apply = (partial: Partial<ReturnType<typeof st>>, objPartial: Record<string, unknown>) => {
      settings.patch('text', partial);
      ed.restyleSelectedText(objPartial);
    };
    const fontIds: FontId[] = ['sans', 'serif', 'mono', 'hand'];
    const fonts = segmented(
      fontIds.map((f) => ({ value: f, label: h('span.font-sample', { style: `font-family:"${FONT_FAMILY[f]}"` }, 'Aa'), title: FONT_LABEL[f] })),
      st().font,
      (f) => apply({ font: f }, { f }),
    );
    const styleBtn = (key: 'bold' | 'italic', ic: IconName, objKey: 'b' | 'i') => {
      const b = h('button.tool-toggle', {
        title: key === 'bold' ? 'Bold' : 'Italic',
        'aria-pressed': String(st()[key]),
        onclick: () => {
          const on = !st()[key];
          b.setAttribute('aria-pressed', String(on));
          apply({ [key]: on } as never, { [objKey]: on ? 1 : undefined });
        },
      }, icon(ic, 16));
      return b;
    };
    const align = segmented(
      [
        { value: 'l' as const, label: icon('alignLeft', 16) },
        { value: 'c' as const, label: icon('alignCenter', 16) },
        { value: 'r' as const, label: icon('alignRight', 16) },
      ],
      st().align,
      (a) => apply({ align: a }, { a: a === 'l' ? undefined : a }),
    );
    return h(
      'div.panel',
      null,
      field(t('text.font'), fonts),
      field(t('text.size'), slider({ min: 8, max: 72, step: 1, value: st().size, format: (v) => `${v} pt`, onInput: (v) => apply({ size: v }, { z: v }) })),
      field(t('text.style'), h('div.style-row', null, styleBtn('bold', 'bold', 'b'), styleBtn('italic', 'italic', 'i'), align)),
      field(t('pop.color'), colorPanel({ colors: PEN_COLORS, value: st().color, onPick: (c) => c && apply({ color: c }, { c }) })),
    );
  }

  private notePanel(): HTMLElement {
    return h(
      'div.panel',
      null,
      field(
        t('note.color'),
        colorPanel({ colors: NOTE_COLORS, value: settings.get('note').color, onPick: (c) => c && settings.patch('note', { color: c }) }),
      ),
    );
  }

  // ── more menu ─────────────────────────────────────────────────────────

  private openMore(anchor: HTMLElement): void {
    const a = this.app;
    const has = !!a.session;
    showMenu(anchor, [
      { label: lbl('Öffnen …', 'Open …'), icon: 'open', shortcut: 'Ctrl+O', onClick: () => a.openDialog() },
      { label: lbl('Neues Notizbuch …', 'New notebook …'), icon: 'newPage', onClick: () => a.newNotebook() },
      { label: lbl('Speichern', 'Save'), icon: 'save', shortcut: 'Ctrl+S', disabled: !has, onClick: () => void a.save() },
      { label: lbl('Speichern unter …', 'Save as …'), icon: 'saveAs', shortcut: 'Ctrl+Shift+S', disabled: !has, onClick: () => void a.saveAs() },
      { label: lbl('Flache Kopie exportieren …', 'Export flattened copy …'), icon: 'download', disabled: !has, onClick: () => void a.exportCopy(true) },
      { label: lbl('Drucken …', 'Print …'), icon: 'print', shortcut: 'Ctrl+P', disabled: !has, onClick: () => void a.print() },
      { separator: true },
      { label: lbl('Seite einfügen …', 'Insert page …'), icon: 'plus', disabled: !has, onClick: () => a.insertBlankPage() },
      { label: lbl('Bild einfügen …', 'Insert image …'), icon: 'image', disabled: !has, onClick: () => a.editor.pickImage() },
      { separator: true },
      { label: lbl('Neues Fenster', 'New window'), icon: 'file', shortcut: 'Ctrl+N', onClick: () => a.newWindow() },
      { label: lbl('Vollbild', 'Full screen'), icon: 'fullscreen', shortcut: 'F11', onClick: () => a.toggleFullscreen() },
      { label: lbl('Tastenkürzel', 'Keyboard shortcuts'), icon: 'keyboard', shortcut: 'Ctrl+/', onClick: () => a.showShortcuts() },
      { label: lbl('Einstellungen …', 'Settings …'), icon: 'settings', shortcut: 'Ctrl+,', onClick: () => a.showSettings() },
    ], { align: 'end' });
  }
}

function lbl(de: string, en: string): string {
  return t('lang.is') === 'de' ? de : en;
}
addStrings({ 'lang.is': 'de' }, { 'lang.is': 'en' });

/** A wavy sample line in the nib's colour and width. */
function strokePreview(p: Preset, w: number): SVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 240 56');
  svg.setAttribute('width', '240');
  svg.setAttribute('height', '56');
  if (p.tool === 'highlighter') {
    const bg = document.createElementNS(ns, 'text');
    bg.setAttribute('x', '14');
    bg.setAttribute('y', '35');
    bg.setAttribute('font-size', '20');
    bg.setAttribute('font-family', 'serif');
    bg.setAttribute('fill', 'currentColor');
    bg.textContent = 'Differenzierbarkeit';
    svg.append(bg);
  }
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M14 32 C 50 6, 74 6, 104 30 S 168 52, 226 24');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', p.color);
  path.setAttribute('stroke-width', String(Math.min(w, 34)));
  path.setAttribute('stroke-linecap', p.tool === 'highlighter' ? 'butt' : 'round');
  path.setAttribute('opacity', String(p.opacity ?? 1));
  if (p.tool === 'highlighter') path.setAttribute('style', 'mix-blend-mode:multiply');
  svg.append(path);
  return svg;
}
