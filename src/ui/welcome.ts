import type { AppApi } from '../app/api';
import { clearRecents, recents, removeRecent } from '../app/recents';
import type { Recent } from '../app/recents';
import { h } from './dom';
import { icon } from './icons';
import { addStrings, lang, t } from './i18n';

addStrings(
  {
    'welcome.title': 'Scribo', 'welcome.tagline': 'PDFs beschriften wie auf Papier.', 'welcome.open': 'PDF öffnen',
    'welcome.hint': 'oder eine Datei hierher ziehen · Strg+O', 'welcome.recent': 'Zuletzt geöffnet', 'welcome.clear': 'Liste leeren',
    'welcome.drop': 'PDF hier ablegen', 'welcome.remove': 'Aus Liste entfernen', 'welcome.new': 'Neues Notizbuch',
    'welcome.feat1': 'Druckempfindliche Tinte', 'welcome.feat2': 'Stift-Tasten: Radieren & Lasso', 'welcome.feat3': 'Strg+S speichert im PDF',
  },
  {
    'welcome.title': 'Scribo', 'welcome.tagline': 'Mark up PDFs like paper.', 'welcome.open': 'Open PDF',
    'welcome.hint': 'or drop a file here · Ctrl+O', 'welcome.recent': 'Recent', 'welcome.clear': 'Clear list',
    'welcome.drop': 'Drop PDF here', 'welcome.remove': 'Remove from list', 'welcome.new': 'New notebook',
    'welcome.feat1': 'Pressure-sensitive ink', 'welcome.feat2': 'Pen buttons: erase & lasso', 'welcome.feat3': 'Ctrl+S saves into the PDF',
  },
);

function ago(ms: number): string {
  const d = Math.round((Date.now() - ms) / 60000);
  const rtf = new Intl.RelativeTimeFormat(lang(), { numeric: 'auto' });
  if (d < 60) return rtf.format(-Math.max(d, 0), 'minute');
  if (d < 60 * 24) return rtf.format(-Math.round(d / 60), 'hour');
  return rtf.format(-Math.round(d / 1440), 'day');
}

export class Welcome {
  readonly el = h('div.welcome');
  private drop = h('div.drop-overlay', null, h('div.drop-card', null, icon('download', 28, 1.5), h('span', null, t('welcome.drop'))));

  constructor(private app: AppApi, private openRecent: (r: Recent) => void) {
    this.render();
    document.body.append(this.drop);
  }

  render(): void {
    const list = recents().filter((r) => this.app.host.kind === 'electron' ? !!r.path : true);
    const logo = h('img.logo', { src: 'icon.svg', alt: '', width: 96, height: 96, draggable: false });
    const recent = list.length
      ? h(
          'section.recent',
          null,
          h('div.recent-head', null, h('h3', null, t('welcome.recent')), h('button.link', { onclick: () => { clearRecents(); this.render(); } }, t('welcome.clear'))),
          h(
            'div.recent-grid',
            null,
            list.map((r) =>
              h(
                'button.recent-card',
                { title: r.path ?? r.name, onclick: () => this.openRecent(r), oncontextmenu: (e: Event) => { e.preventDefault(); removeRecent(r); this.render(); } },
                h('div.rc-thumb', null, r.thumb ? h('img', { src: r.thumb, alt: '', draggable: false }) : icon('file', 28, 1.3)),
                h('div.rc-name', null, r.name.replace(/\.pdf$/i, '')),
                h('div.rc-when', null, ago(r.opened)),
              ),
            ),
          ),
        )
      : null;
    this.el.replaceChildren(
      h(
        'div.welcome-inner',
        null,
        logo,
        h('h1', null, t('welcome.title')),
        h('p.tagline', null, t('welcome.tagline')),
        h('div.welcome-actions', null,
          h('button.btn.primary.big', { onclick: () => this.app.openDialog() }, icon('open', 18), t('welcome.open')),
          h('button.btn.big.secondary', { onclick: () => this.app.newNotebook() }, icon('newPage', 18), t('welcome.new')),
        ),
        h('p.hint', null, t('welcome.hint')),
        h('ul.feats', null, [t('welcome.feat1'), t('welcome.feat2'), t('welcome.feat3')].map((f) => h('li', null, icon('check', 14, 2.2), f))),
        recent,
      ),
    );
  }

  show(on: boolean): void {
    this.el.classList.toggle('show', on);
    if (on) this.render();
  }

  dropHint(on: boolean): void {
    this.drop.classList.toggle('show', on);
  }
}
