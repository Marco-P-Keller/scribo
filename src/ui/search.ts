import { Emitter } from '../core/emitter';
import type { DocSession } from '../app/session';
import type { Viewer } from '../viewer/viewer';

export interface Hit {
  page: number;
  /** index of this hit within its page */
  k: number;
  snippet: { before: string; match: string; after: string };
}

interface Events extends Record<string, unknown> {
  change: undefined;
}

function findAll(text: string, q: string): number[] {
  const out: number[] = [];
  if (!q) return out;
  let i = 0;
  while ((i = text.indexOf(q, i)) !== -1) {
    out.push(i);
    i += Math.max(1, q.length);
  }
  return out;
}

/** Full-document text search with on-page highlighting. */
export class SearchController extends Emitter<Events> {
  query = '';
  hits: Hit[] = [];
  current = -1;
  searching = false;
  private texts = new Map<number, string>();
  private session: DocSession | null = null;
  private run = 0;

  constructor(private viewer: Viewer) {
    super();
    viewer.on('pages', () => this.paint());
    viewer.on('textready', (i) => this.paintPage(i, true));
  }

  setSession(s: DocSession | null): void {
    this.session = s;
    this.texts.clear();
    this.clear();
  }

  clear(): void {
    this.query = '';
    this.hits = [];
    this.current = -1;
    this.run++;
    this.searching = false;
    this.paint();
    this.emit('change', undefined);
  }

  /** Pages were inserted, removed or moved: cached texts belong to old page numbers. */
  invalidate(): void {
    this.texts.clear();
    if (this.query) void this.search(this.query);
  }

  private async pageText(i: number): Promise<string> {
    let t = this.texts.get(i);
    if (t === undefined) {
      const pdf = this.session!.pdf;
      try {
        const page = await pdf.getPage(i + 1);
        const tc = await page.getTextContent();
        t = tc.items.map((it) => ('str' in it ? it.str : '')).join('').toLowerCase();
        page.cleanup();
      } catch {
        return ''; // restructured while searching; the search is re-run
      }
      if (this.session?.pdf === pdf) this.texts.set(i, t);
    }
    return t;
  }

  async search(query: string): Promise<void> {
    const q = query.toLowerCase();
    const id = ++this.run;
    this.query = q;
    this.hits = [];
    this.current = -1;
    if (!this.session || !q) {
      this.searching = false;
      this.paint();
      this.emit('change', undefined);
      return;
    }
    this.searching = true;
    this.emit('change', undefined);
    const n = this.session.pageCount;
    for (let i = 0; i < n; i++) {
      const text = await this.pageText(i);
      if (id !== this.run) return;
      const idx = findAll(text, q);
      idx.forEach((start, k) => {
        const a = Math.max(0, start - 26);
        this.hits.push({
          page: i,
          k,
          snippet: {
            before: text.slice(a, start).replace(/\s+/g, ' '),
            match: text.slice(start, start + q.length),
            after: text.slice(start + q.length, start + q.length + 40).replace(/\s+/g, ' '),
          },
        });
      });
      if (this.hits.length > 2000) break;
      if (i % 8 === 7) {
        this.emit('change', undefined);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    if (id !== this.run) return;
    this.searching = false;
    if (this.hits.length && this.current < 0) this.go(this.firstFromView(), false);
    else this.paint();
    this.emit('change', undefined);
  }

  private firstFromView(): number {
    const p = this.viewer.currentPage;
    const i = this.hits.findIndex((h) => h.page >= p);
    return i < 0 ? 0 : i;
  }

  next(): void {
    if (this.hits.length) this.go((this.current + 1) % this.hits.length);
  }

  prev(): void {
    if (this.hits.length) this.go((this.current - 1 + this.hits.length) % this.hits.length);
  }

  go(i: number, focus = true): void {
    if (i < 0 || i >= this.hits.length) return;
    this.current = i;
    const h = this.hits[i];
    if (focus || !this.viewer.viewFor(h.page)) this.viewer.scrollToPage(h.page);
    this.paint();
    this.emit('change', undefined);
    this.revealCurrent();
  }

  /** Scroll so that the current hit sits comfortably in view once its text layer exists. */
  private revealCurrent(): void {
    const h = this.hits[this.current];
    if (!h) return;
    const pv = this.viewer.viewFor(h.page);
    const text = pv?.pageText();
    if (!pv || text == null) return;
    const idx = findAll(text.toLowerCase(), this.query)[h.k];
    if (idx === undefined) return;
    const r = pv.textRects(idx, idx + this.query.length)[0];
    if (!r) return;
    const stage = this.viewer.stage;
    const y = this.viewer.pageTop(h.page) + r.y * this.viewer.scale;
    if (y < stage.scrollTop + 60 || y > stage.scrollTop + stage.clientHeight - 100) {
      stage.scrollTo({ top: y - stage.clientHeight / 3, behavior: 'smooth' });
    }
  }

  private paint(): void {
    for (const pv of this.viewer.realized) this.paintPage(pv.index, false);
  }

  private paintPage(i: number, textJustReady: boolean): void {
    const pv = this.viewer.viewFor(i);
    if (!pv) return;
    const text = pv.pageText();
    if (!this.query || text == null) {
      pv.setSearch([], -1);
      return;
    }
    const starts = findAll(text.toLowerCase(), this.query);
    const cur = this.current >= 0 && this.hits[this.current]?.page === i ? this.hits[this.current].k : -1;
    pv.setSearch(starts.map((s) => ({ start: s, end: s + this.query.length })), cur);
    if (textJustReady && cur >= 0) this.revealCurrent();
  }
}
