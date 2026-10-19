import type { AppApi, SidebarTab } from '../app/api';
import { settings } from '../app/settings';
import type { DocSession } from '../app/session';
import type { AnyObj } from '../core/types';
import { isHighlight } from '../core/types';
import { drawObjects } from '../render/draw';
import { pdfjsLib } from '../viewer/pdfjs';
import { SearchController } from './search';
import { clear, h } from './dom';
import { icon } from './icons';
import type { IconName } from './icons';
import { showMenu } from './popover';
import { confirmDialog } from './dialogs';
import { addStrings, t } from './i18n';

addStrings(
  {
    'sb.pages': 'Seiten', 'sb.outline': 'Gliederung', 'sb.search': 'Suche', 'sb.notes': 'Notizen',
    'sb.searchPlaceholder': 'Im Dokument suchen', 'sb.noResults': 'Keine Treffer', 'sb.searching': 'Suche läuft …',
    'sb.hits': '{n} Treffer', 'sb.hit1': '1 Treffer', 'sb.noOutline': 'Dieses PDF hat kein Inhaltsverzeichnis.',
    'sb.noNotes': 'Noch keine Notizen oder Textfelder.', 'sb.page': 'Seite {n}',
    'pg.rotateR': 'Nach rechts drehen', 'pg.rotateL': 'Nach links drehen', 'pg.duplicate': 'Seite duplizieren', 'pg.insert': 'Leere Seite danach einfügen',
    'pg.delete': 'Seite löschen', 'pg.deleteMany': '{n} Seiten löschen', 'pg.deleteTitle': 'Seiten löschen?', 'pg.deleteMsg': 'Die Seiten und ihre Anmerkungen werden entfernt. Rückgängig stellt sie wieder her.',
    'pg.deleteDo': 'Löschen', 'pg.rotated': 'Seite gedreht', 'pg.deleted': 'Seite gelöscht', 'pg.moved': 'Seiten verschoben',
  },
  {
    'sb.pages': 'Pages', 'sb.outline': 'Outline', 'sb.search': 'Search', 'sb.notes': 'Notes',
    'sb.searchPlaceholder': 'Search in document', 'sb.noResults': 'No results', 'sb.searching': 'Searching …',
    'sb.hits': '{n} results', 'sb.hit1': '1 result', 'sb.noOutline': 'This PDF has no table of contents.',
    'sb.noNotes': 'No notes or text boxes yet.', 'sb.page': 'Page {n}',
    'pg.rotateR': 'Rotate right', 'pg.rotateL': 'Rotate left', 'pg.duplicate': 'Duplicate page', 'pg.insert': 'Insert blank page after',
    'pg.delete': 'Delete page', 'pg.deleteMany': 'Delete {n} pages', 'pg.deleteTitle': 'Delete pages?', 'pg.deleteMsg': 'The pages and their annotations are removed. Undo brings them back.',
    'pg.deleteDo': 'Delete', 'pg.rotated': 'Page rotated', 'pg.deleted': 'Page deleted', 'pg.moved': 'Pages moved',
  },
);

const THUMB_W = 150;

const TABS: { id: SidebarTab; icon: IconName; label: string }[] = [
  { id: 'pages', icon: 'thumbs', label: 'sb.pages' },
  { id: 'outline', icon: 'outline', label: 'sb.outline' },
  { id: 'search', icon: 'search', label: 'sb.search' },
  { id: 'notes', icon: 'note', label: 'sb.notes' },
];

export class Sidebar {
  readonly el = h('aside.sidebar.keep-focus');
  readonly search: SearchController;
  private body = h('div.sb-body');
  private tabs = h('div.sb-tabs', { role: 'tablist' });
  private session: DocSession | null = null;
  private selected = new Set<number>();
  private anchor = 0;
  private thumbs: HTMLElement[] = [];
  private observer: IntersectionObserver | null = null;
  private renderQueue: number[] = [];
  private rendering = false;
  private dirtyThumbs = new Set<number>();
  private refreshTimer = 0;
  private searchInput = h('input.search-input', { type: 'search', placeholder: t('sb.searchPlaceholder'), spellcheck: false, 'aria-label': t('sb.search') });
  private searchResults = h('div.search-results');
  private searchSummary = h('div.search-summary');

  constructor(private app: AppApi) {
    this.search = new SearchController(app.viewer);
    this.el.append(this.tabs, this.body);
    settings.on('change', (k) => {
      if (k === 'sidebar' || k === 'sidebarTab') this.sync();
    });
    app.viewer.on('page', (i) => this.markCurrent(i));
    this.search.on('change', () => this.paintSearch());
    this.searchInput.addEventListener('input', () => void this.search.search(this.searchInput.value));
    this.searchInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') (e.shiftKey ? this.search.prev() : this.search.next());
      if (e.key === 'Escape') {
        this.searchInput.value = '';
        this.search.clear();
        app.viewer.stage.focus();
      }
    });
    this.sync();
  }

  get visible(): boolean {
    return settings.get('sidebar');
  }

  focusSearch(): void {
    this.searchInput.focus();
    this.searchInput.select();
  }

  setSession(session: DocSession | null): void {
    this.session = session;
    this.selected.clear();
    this.search.setSession(session);
    this.searchInput.value = '';
    if (session) {
      session.model.on('change', ({ pages }) => {
        for (const p of pages) this.dirtyThumbs.add(p);
        clearTimeout(this.refreshTimer);
        this.refreshTimer = window.setTimeout(() => this.refreshDirty(), 350);
        if (settings.get('sidebarTab') === 'notes' && this.visible) this.renderNotes();
      });
      session.on('structure', () => this.renderTab());
    }
    this.renderTab();
  }

  private sync(): void {
    const open = settings.get('sidebar');
    this.el.classList.toggle('open', open);
    const active = settings.get('sidebarTab');
    this.tabs.replaceChildren(
      ...TABS.map((tb) =>
        h(
          'button.sb-tab',
          {
            role: 'tab',
            title: t(tb.label),
            'aria-label': t(tb.label),
            'aria-selected': String(tb.id === active),
            onclick: () => settings.set('sidebarTab', tb.id),
          },
          icon(tb.icon, 17),
        ),
      ),
    );
    if (open) this.renderTab();
  }

  private renderTab(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.renderQueue = [];
    clear(this.body);
    if (!this.session) return;
    const tab = settings.get('sidebarTab');
    if (tab === 'pages') this.renderThumbs();
    else if (tab === 'outline') void this.renderOutline();
    else if (tab === 'search') this.renderSearch();
    else this.renderNotes();
  }

  // ── thumbnails ──────────────────────────────────────────────────────

  private renderThumbs(): void {
    const s = this.session!;
    const list = h('div.thumbs');
    this.thumbs = [];
    s.metas.forEach((m, i) => {
      const w = THUMB_W;
      const hgt = Math.round((m.h / m.w) * w);
      const canvas = h('canvas.thumb-canvas', { style: `width:${w}px;height:${hgt}px` });
      const item = h(
        'div.thumb',
        { dataset: { page: String(i) }, role: 'button', tabindex: '0', 'aria-label': t('sb.page', { n: i + 1 }) },
        h('div.thumb-frame', { style: `width:${w}px;height:${hgt}px` }, canvas),
        h('div.thumb-label', null, String(i + 1)),
      );
      item.addEventListener('click', (e) => this.onThumbClick(e, i));
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (!this.selected.has(i)) {
          this.selected = new Set([i]);
          this.paintSelection();
        }
        this.pageMenu(item, e);
      });
      this.enableDrag(item, i);
      this.thumbs.push(item);
      list.append(item);
    });
    this.body.append(list);
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          const i = Number((en.target as HTMLElement).dataset.page);
          this.observer?.unobserve(en.target);
          this.queueThumb(i);
        }
      },
      { root: this.body, rootMargin: '300px' },
    );
    this.thumbs.forEach((el) => this.observer!.observe(el));
    this.markCurrent(this.app.viewer.currentPage);
    this.paintSelection();
  }

  private queueThumb(i: number): void {
    if (!this.renderQueue.includes(i)) this.renderQueue.push(i);
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.rendering) return;
    this.rendering = true;
    try {
      while (this.renderQueue.length) {
        const i = this.renderQueue.shift()!;
        await this.drawThumb(i);
        await new Promise((r) => setTimeout(r, 0));
      }
    } finally {
      this.rendering = false;
    }
  }

  private async drawThumb(i: number): Promise<void> {
    const s = this.session;
    const el = this.thumbs[i];
    if (!s || !el) return;
    const canvas = el.querySelector('canvas')!;
    const dpr = window.devicePixelRatio || 1;
    const page = await s.pdf.getPage(i + 1);
    const k = (THUMB_W * dpr) / s.metas[i].w;
    const vp = page.getViewport({ scale: k });
    const tmp = document.createElement('canvas');
    tmp.width = Math.ceil(vp.width);
    tmp.height = Math.ceil(vp.height);
    try {
      await page.render({
        canvas: tmp,
        viewport: vp,
        background: '#ffffff',
        annotationMode: pdfjsLib.AnnotationMode.ENABLE,
        optionalContentConfigPromise: s.ocConfig,
      }).promise;
    } catch {
      return;
    }
    const ctx = tmp.getContext('2d')!;
    const objs: AnyObj[] = s.model.pages[i] ?? [];
    if (objs.length) {
      ctx.setTransform(k, 0, 0, k, 0, 0);
      drawObjects(ctx, objs.filter(isHighlight));
      drawObjects(ctx, objs.filter((o) => !isHighlight(o)));
    }
    canvas.width = tmp.width;
    canvas.height = tmp.height;
    canvas.getContext('2d')!.drawImage(tmp, 0, 0);
    page.cleanup();
  }

  private refreshDirty(): void {
    if (settings.get('sidebarTab') !== 'pages' || !this.visible) {
      this.dirtyThumbs.clear();
      return;
    }
    for (const i of this.dirtyThumbs) if (this.thumbs[i]) this.queueThumb(i);
    this.dirtyThumbs.clear();
  }

  private markCurrent(cur: number): void {
    this.thumbs.forEach((el, i) => el.classList.toggle('current', i === cur));
    const el = this.thumbs[cur];
    if (el && this.visible && settings.get('sidebarTab') === 'pages') el.scrollIntoView({ block: 'nearest' });
  }

  private paintSelection(): void {
    this.thumbs.forEach((el, i) => el.classList.toggle('selected', this.selected.has(i)));
  }

  private onThumbClick(e: MouseEvent, i: number): void {
    if (e.shiftKey) {
      const [a, b] = [Math.min(this.anchor, i), Math.max(this.anchor, i)];
      this.selected = new Set(Array.from({ length: b - a + 1 }, (_, k) => a + k));
    } else if (e.ctrlKey || e.metaKey) {
      if (this.selected.has(i)) this.selected.delete(i);
      else this.selected.add(i);
      this.anchor = i;
    } else {
      this.selected = new Set([i]);
      this.anchor = i;
      this.app.viewer.scrollToPage(i);
    }
    this.paintSelection();
  }

  private pageMenu(anchorEl: HTMLElement, e: MouseEvent): void {
    const pages = [...this.selected].sort((a, b) => a - b);
    const many = pages.length > 1;
    const rect = new DOMRect(e.clientX, e.clientY, 1, 1);
    void anchorEl;
    showMenu(rect, [
      { label: t('pg.rotateR'), icon: 'rotateRight', onClick: () => void this.app.applyPageOps(t('pg.rotated'), [{ op: 'rotate', pages, delta: 90 }]) },
      { label: t('pg.rotateL'), icon: 'rotateLeft', onClick: () => void this.app.applyPageOps(t('pg.rotated'), [{ op: 'rotate', pages, delta: -90 }]) },
      { label: t('pg.duplicate'), icon: 'duplicate', onClick: () => void this.app.applyPageOps(t('pg.duplicate'), [{ op: 'duplicate', pages }]) },
      {
        label: t('pg.insert'),
        icon: 'newPage',
        onClick: () => {
          const m = this.session!.metas[pages[pages.length - 1]];
          void this.app.applyPageOps(t('pg.insert'), [{ op: 'insertBlank', at: pages[pages.length - 1] + 1, w: m.w, h: m.h, template: settings.get('paper') }]);
        },
      },
      { separator: true },
      {
        label: many ? t('pg.deleteMany', { n: pages.length }) : t('pg.delete'),
        icon: 'trash',
        danger: true,
        disabled: pages.length >= this.session!.pageCount,
        onClick: async () => {
          if (await confirmDialog({ title: t('pg.deleteTitle'), message: t('pg.deleteMsg'), confirm: t('pg.deleteDo'), danger: true })) {
            this.selected.clear();
            await this.app.applyPageOps(t('pg.deleted'), [{ op: 'delete', pages }]);
          }
        },
      },
    ]);
  }

  /** Drag thumbnails to reorder pages. */
  private enableDrag(item: HTMLElement, i: number): void {
    item.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.pointerType === 'touch') return;
      const startY = e.clientY;
      let dragging = false;
      const line = h('div.drop-line');
      const move = (ev: PointerEvent) => {
        if (!dragging && Math.abs(ev.clientY - startY) > 8) {
          dragging = true;
          item.setPointerCapture(ev.pointerId);
          item.classList.add('lifting');
          this.body.append(line);
        }
        if (!dragging) return;
        const target = this.dropIndex(ev.clientY);
        const ref = this.thumbs[Math.min(target, this.thumbs.length - 1)];
        const br = this.body.getBoundingClientRect();
        const rr = ref.getBoundingClientRect();
        const y = (target >= this.thumbs.length ? rr.bottom : rr.top) - br.top + this.body.scrollTop - 6;
        line.style.top = `${y}px`;
      };
      const up = (ev: PointerEvent) => {
        item.removeEventListener('pointermove', move);
        item.removeEventListener('pointerup', up);
        item.removeEventListener('pointercancel', up);
        line.remove();
        item.classList.remove('lifting');
        if (!dragging) return;
        const target = this.dropIndex(ev.clientY);
        const pages = this.selected.has(i) ? [...this.selected].sort((a, b) => a - b) : [i];
        if (target !== i && target !== i + 1) {
          this.selected = new Set();
          void this.app.applyPageOps(t('pg.moved'), [{ op: 'move', pages, to: target }]);
        }
      };
      item.addEventListener('pointermove', move);
      item.addEventListener('pointerup', up);
      item.addEventListener('pointercancel', up);
    });
  }

  private dropIndex(clientY: number): number {
    for (let k = 0; k < this.thumbs.length; k++) {
      const r = this.thumbs[k].getBoundingClientRect();
      if (clientY < r.top + r.height / 2) return k;
    }
    return this.thumbs.length;
  }

  // ── outline ─────────────────────────────────────────────────────────

  private async renderOutline(): Promise<void> {
    const s = this.session!;
    const outline = await s.pdf.getOutline().catch(() => null);
    if (this.session !== s || settings.get('sidebarTab') !== 'outline') return;
    clear(this.body);
    if (!outline?.length) {
      this.body.append(h('div.sb-empty', null, t('sb.noOutline')));
      return;
    }
    const build = (items: typeof outline, depth: number): HTMLElement => {
      const ul = h('ul.outline');
      for (const it of items) {
        const kids = it.items?.length ? build(it.items as typeof outline, depth + 1) : null;
        const toggle = kids ? h('button.o-toggle', { 'aria-label': 'toggle', onclick: (e: Event) => { e.stopPropagation(); li.classList.toggle('open'); } }, icon('right', 12, 2.2)) : h('span.o-toggle.empty');
        const row = h(
          'div.o-row',
          { style: `padding-left:${8 + depth * 14}px`, onclick: () => void this.app.gotoDestination(it.dest) },
          toggle,
          h('span.o-title', { style: it.bold ? 'font-weight:600' : '' }, it.title || '—'),
        );
        const li = h('li', null, row, kids);
        if (depth === 0 && kids) li.classList.add('open');
        ul.append(li);
      }
      return ul;
    };
    this.body.append(build(outline, 0));
  }

  // ── search ──────────────────────────────────────────────────────────

  private renderSearch(): void {
    this.body.append(h('div.search-box', null, icon('search', 15), this.searchInput), this.searchSummary, this.searchResults);
    this.paintSearch();
  }

  private paintSearch(): void {
    if (settings.get('sidebarTab') !== 'search') return;
    const { hits, query, searching, current } = this.search;
    this.searchSummary.textContent = !query ? '' : searching ? t('sb.searching') : hits.length === 0 ? t('sb.noResults') : hits.length === 1 ? t('sb.hit1') : t('sb.hits', { n: hits.length });
    // keep it light: show at most 300 rows
    const rows = hits.slice(0, 300).map((hit, i) =>
      h(
        'button.hit-row',
        { class: i === current ? 'current' : '', onclick: () => this.search.go(i) },
        h('span.hit-text', null, hit.snippet.before, h('mark', null, hit.snippet.match), hit.snippet.after),
        h('span.hit-page', null, String(hit.page + 1)),
      ),
    );
    this.searchResults.replaceChildren(...rows);
  }

  // ── notes ───────────────────────────────────────────────────────────

  private renderNotes(): void {
    const s = this.session;
    if (!s) return;
    clear(this.body);
    const rows: HTMLElement[] = [];
    s.model.pages.forEach((objs, page) => {
      for (const o of objs) {
        if (o.t !== 'note' && o.t !== 'text') continue;
        const text = (o.s || '').trim();
        if (!text) continue;
        rows.push(
          h(
            'button.note-row',
            {
              onclick: () => {
                this.app.viewer.scrollToPage(page, { offsetPt: Math.max(0, o.y - 30) });
                const pv = this.app.viewer.viewFor(page);
                if (pv) this.app.editor.selection.set(pv, [o.id]);
              },
            },
            h('span.note-chip', { style: `background:${o.t === 'note' ? o.c : 'var(--text-3)'}` }, icon(o.t === 'note' ? 'note' : 'text', 12, 2)),
            h('span.note-body', null, h('span.note-text', null, text.slice(0, 140)), h('span.note-page', null, t('sb.page', { n: page + 1 }))),
          ),
        );
      }
    });
    this.body.append(rows.length ? h('div.notes-list', null, rows) : h('div.sb-empty', null, t('sb.noNotes')));
  }
}
