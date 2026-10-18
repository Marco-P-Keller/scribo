import type { AppApi } from '../app/api';
import { HIGHLIGHT_COLORS, PEN_COLORS } from '../app/settings';
import { frame, h } from './dom';
import { icon } from './icons';
import type { IconName } from './icons';
import { Popover } from './popover';
import { colorPanel } from './colorpicker';
import { addStrings, t } from './i18n';

addStrings(
  {
    'sel.cut': 'Ausschneiden', 'sel.copy': 'Kopieren', 'sel.duplicate': 'Duplizieren', 'sel.delete': 'Löschen', 'sel.color': 'Farbe',
    'sel.front': 'Nach vorne', 'sel.back': 'Nach hinten', 'sel.edit': 'Bearbeiten',
    'mark.hl': 'Markieren', 'mark.ul': 'Unterstreichen', 'mark.st': 'Durchstreichen',
    'page.prev': 'Vorherige Seite', 'page.next': 'Nächste Seite', 'zoom.in': 'Vergrößern', 'zoom.out': 'Verkleinern', 'zoom.fitWidth': 'Breite anpassen', 'zoom.fitPage': 'Ganze Seite',
  },
  {
    'sel.cut': 'Cut', 'sel.copy': 'Copy', 'sel.duplicate': 'Duplicate', 'sel.delete': 'Delete', 'sel.color': 'Color',
    'sel.front': 'Bring to front', 'sel.back': 'Send to back', 'sel.edit': 'Edit',
    'mark.hl': 'Highlight', 'mark.ul': 'Underline', 'mark.st': 'Strike through',
    'page.prev': 'Previous page', 'page.next': 'Next page', 'zoom.in': 'Zoom in', 'zoom.out': 'Zoom out', 'zoom.fitWidth': 'Fit width', 'zoom.fitPage': 'Fit page',
  },
);

function btn(name: IconName, label: string, onClick: (e: MouseEvent) => void, cls = ''): HTMLButtonElement {
  return h('button.fl-btn', { title: label, 'aria-label': label, class: cls, onclick: onClick as EventListener }, icon(name, 17));
}

/** Position `el` (absolute inside `host`) above or below a client rect, kept inside the host. */
function placeNear(el: HTMLElement, host: HTMLElement, r: { x: number; y: number; w: number; h: number }): void {
  const hb = host.getBoundingClientRect();
  const w = el.offsetWidth;
  const hgt = el.offsetHeight;
  let x = r.x + r.w / 2 - hb.left - w / 2;
  let y = r.y - hb.top - hgt - 12;
  if (y < 8) y = r.y + r.h - hb.top + 12;
  x = Math.max(8, Math.min(hb.width - w - 8, x));
  y = Math.max(8, Math.min(hb.height - hgt - 8, y));
  el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

/** Cut / copy / colour / delete pill that follows the current selection, and the mark-up menu for selected PDF text. */
export class FloatingMenus {
  private selMenu = h('div.floating.sel-menu.keep-focus');
  private textMenu = h('div.floating.text-menu.keep-focus');
  private update = frame(() => this.layout());
  private colorPop: Popover | null = null;

  constructor(private app: AppApi) {
    const host = app.viewer.overlay;
    host.append(this.selMenu, this.textMenu);
    app.editor.on('selection', () => this.rebuildSelection());
    app.viewer.on('view', () => this.update());
    app.viewer.on('zoom', () => this.update());
    app.editor.on('tool', () => this.update());
    document.addEventListener('selectionchange', () => this.update());
    app.viewer.stage.addEventListener('pointerup', () => setTimeout(() => this.update(), 30));
    this.rebuildSelection();
  }

  private rebuildSelection(): void {
    const sel = this.app.editor.selection;
    this.colorPop?.close();
    this.selMenu.replaceChildren();
    if (!sel.active) {
      this.selMenu.classList.remove('show');
      return;
    }
    const objs = sel.objects();
    const colorable = objs.some((o) => o.t !== 'img');
    const colorBtn = btn('palette', t('sel.color'), () => this.openColor(colorBtn));
    const single = objs.length === 1 ? objs[0] : null;
    const parts: (Node | null)[] = [
      btn('cut', t('sel.cut'), () => this.app.editor.cutSelection()),
      btn('copy', t('sel.copy'), () => this.app.editor.copySelection()),
      btn('duplicate', t('sel.duplicate'), () => sel.duplicate()),
      single && (single.t === 'text' || single.t === 'note')
        ? btn('edit', t('sel.edit'), () => {
            if (single.t === 'text') this.app.editor.editText(sel.page!, single, { x: single.x, y: single.y });
            else this.app.editor.editNote(sel.page!, single, { x: single.x, y: single.y });
          })
        : null,
      colorable ? colorBtn : null,
      btn('front', t('sel.front'), () => sel.arrange(true)),
      h('span.fl-sep'),
      btn('trash', t('sel.delete'), () => sel.delete(), 'danger'),
    ];
    this.selMenu.append(...parts.filter((p): p is Node => !!p));
    this.update();
  }

  private openColor(anchor: HTMLElement): void {
    this.colorPop?.close();
    const sel = this.app.editor.selection;
    const content = h('div.panel', null, colorPanel({ colors: PEN_COLORS, value: null, onPick: (c) => c && sel.recolor(c) }));
    this.colorPop = new Popover(content, { anchor, className: 'tool-popover keep-focus' }).open();
  }

  private layout(): void {
    const host = this.app.viewer.overlay;
    // selection pill
    const sel = this.app.editor.selection;
    const sb = sel.active && !sel.dragging ? sel.clientBounds() : null;
    this.selMenu.classList.toggle('show', !!sb);
    if (sb) placeNear(this.selMenu, host, sb);

    // text mark-up menu (native text selection in the select tool)
    const s = window.getSelection();
    let rect: DOMRect | null = null;
    if (this.app.editor.tool === 'select' && this.app.editor.hasTextSelection() && s) {
      const rects = [...s.getRangeAt(0).getClientRects()].filter((r) => r.width > 1);
      if (rects.length) {
        const first = rects[0];
        const last = rects[rects.length - 1];
        rect = new DOMRect(first.left, first.top, Math.max(60, last.right - first.left), last.bottom - first.top);
      }
    }
    if (!this.textMenu.childElementCount) this.buildTextMenu();
    this.textMenu.classList.toggle('show', !!rect);
    if (rect) placeNear(this.textMenu, host, { x: rect.x, y: rect.y, w: rect.width, h: rect.height });
  }

  private buildTextMenu(): void {
    const mk = (kind: 'hl' | 'ul' | 'st', ic: IconName, label: string, color: () => string) =>
      btn(ic, label, () => {
        if (this.app.editor.markSelection(kind, color())) this.update();
      });
    const colorDots = h('div.mark-colors');
    const renderDots = () => {
      colorDots.replaceChildren(
        ...HIGHLIGHT_COLORS.slice(0, 5).map((c) =>
          h('button.mark-dot', {
            style: `--c:${c}`,
            title: t('mark.hl'),
            'aria-label': t('mark.hl'),
            onclick: () => {
              this.app.editor.markSelection('hl', c);
              renderDots();
              this.update();
            },
          }),
        ),
      );
    };
    renderDots();
    this.textMenu.append(
      colorDots,
      h('span.fl-sep'),
      mk('ul', 'underline', t('mark.ul'), () => '#e5322d'),
      mk('st', 'strike', t('mark.st'), () => '#e5322d'),
      btn('copy', t('sel.copy'), () => {
        document.execCommand('copy');
      }),
    );
  }
}

/** Page number + zoom pill in the lower right corner. */
export class PageIndicator {
  readonly el = h('div.page-pill.keep-focus');
  private label = h('button.pill-label', { title: 'Seite', 'aria-label': 'Seite' });
  private zoomLabel = h('button.pill-zoom');
  private fade = 0;

  constructor(private app: AppApi) {
    const v = app.viewer;
    const prev = btn('left', t('page.prev'), () => v.scrollToPage(v.currentPage - 1, { smooth: true }));
    const next = btn('right', t('page.next'), () => v.scrollToPage(v.currentPage + 1, { smooth: true }));
    const out = btn('minus', t('zoom.out'), () => v.zoomStep(-1));
    const inn = btn('plus', t('zoom.in'), () => v.zoomStep(1));
    const fit = btn('maximize', t('zoom.fitWidth'), () => (v.fit === 'width' ? v.fitPage() : v.fitWidth()));
    this.zoomLabel.onclick = () => v.setZoom(1);
    this.zoomLabel.title = '100 %';
    this.label.onclick = () => this.goto();
    this.el.append(prev, this.label, next, h('span.fl-sep'), out, this.zoomLabel, inn, fit);
    v.on('page', () => this.refresh());
    v.on('zoom', () => this.refresh());
    v.on('view', () => this.wake());
    this.el.addEventListener('pointerenter', () => this.wake(true));
    this.refresh();
  }

  private goto(): void {
    const v = this.app.viewer;
    const input = h('input.page-input', { type: 'number', min: '1', max: String(v.pageCount), value: String(v.currentPage + 1) });
    this.label.replaceChildren(input);
    input.focus();
    input.select();
    const done = (go: boolean) => {
      if (go) v.scrollToPage(Number(input.value) - 1);
      this.refresh();
    };
    input.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') done(true);
      else if (e.key === 'Escape') done(false);
    };
    input.onblur = () => done(false);
  }

  refresh(): void {
    const v = this.app.viewer;
    if (!this.app.session) {
      this.el.classList.remove('show');
      return;
    }
    this.el.classList.add('show');
    this.label.textContent = `${v.currentPage + 1} / ${v.pageCount}`;
    this.zoomLabel.textContent = `${Math.round(v.zoom * 100)} %`;
    this.wake();
  }

  private wake(hold = false): void {
    this.el.classList.add('awake');
    clearTimeout(this.fade);
    if (!hold) this.fade = window.setTimeout(() => this.el.classList.remove('awake'), 2400);
  }
}
