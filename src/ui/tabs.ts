import { h } from './dom';
import { icon } from './icons';
import { addStrings, t } from './i18n';

addStrings(
  { 'tabs.close': 'Tab schließen (Strg+W)', 'tabs.open': 'Weiteres PDF öffnen (Strg+O)', 'tabs.unsaved': 'Nicht gespeicherte Änderungen' },
  { 'tabs.close': 'Close tab (Ctrl+W)', 'tabs.open': 'Open another PDF (Ctrl+O)', 'tabs.unsaved': 'Unsaved changes' },
);

export interface TabItem<K> {
  key: K;
  title: string;
  dirty: boolean;
}

/**
 * Open documents of the window as tabs. Shown once a second document is open;
 * tabs can be reordered by dragging and closed with the × or a middle click.
 */
export class TabBar<K> {
  readonly el = h('div.tabbar', { role: 'tablist' });
  private list = h('div.tab-list');
  private dragFrom = -1;

  constructor(private cb: { select(k: K): void; close(k: K): void; open(): void; move(from: number, to: number): void }) {
    const add = h('button.tab-add', { title: t('tabs.open'), 'aria-label': t('tabs.open'), onclick: () => this.cb.open() }, icon('plus', 16, 2));
    this.el.append(this.list, add);
    this.el.hidden = true;
  }

  render(items: TabItem<K>[], active: K | null): void {
    this.el.hidden = items.length < 2;
    this.list.replaceChildren(
      ...items.map((it, i) => {
        const close = h('button.tab-close', {
          title: t('tabs.close'),
          'aria-label': t('tabs.close'),
          onclick: (e: MouseEvent) => {
            e.stopPropagation();
            this.cb.close(it.key);
          },
        }, icon('close', 13, 2));
        const tab = h(
          'div.tab',
          {
            role: 'tab',
            title: it.dirty ? `${it.title} – ${t('tabs.unsaved')}` : it.title,
            'aria-selected': String(it.key === active),
            draggable: true,
            onpointerdown: (e: PointerEvent) => {
              if (e.button === 0 && !(e.target as HTMLElement).closest('.tab-close')) this.cb.select(it.key);
            },
            onauxclick: (e: MouseEvent) => {
              if (e.button === 1) this.cb.close(it.key);
            },
            onmousedown: (e: MouseEvent) => {
              // no autoscroll cursor on middle click
              if (e.button === 1) e.preventDefault();
            },
            ondragstart: (e: DragEvent) => {
              this.dragFrom = i;
              e.dataTransfer?.setData('application/x-scribo-tab', String(i));
              if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
            },
            ondragover: (e: DragEvent) => {
              if (this.dragFrom < 0) return;
              e.preventDefault();
              e.stopPropagation();
            },
            ondrop: (e: DragEvent) => {
              if (this.dragFrom < 0) return;
              e.preventDefault();
              e.stopPropagation();
              if (this.dragFrom !== i) this.cb.move(this.dragFrom, i);
              this.dragFrom = -1;
            },
            ondragend: () => (this.dragFrom = -1),
          },
          h('span.tab-title', null, it.title),
          it.dirty ? h('span.tab-dirty', { 'aria-label': t('tabs.unsaved') }) : null,
          close,
        );
        tab.classList.toggle('dirty', it.dirty);
        return tab;
      }),
    );
    this.list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}
