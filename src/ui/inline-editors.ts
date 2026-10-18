import type { TextObj } from '../core/types';
import { uid } from '../core/objects';
import { LINE_HEIGHT, TEXT_PAD } from '../core/textmetrics';
import { fontCss, ensureFont, NO_FEATURES } from '../render/fonts';
import { layoutText } from '../render/textlayout';
import { settings } from '../app/settings';
import type { PageView } from '../viewer/pageview';
import type { AnnotationModel } from '../core/model';
import type { Selection } from '../input/selection';
import { h } from './dom';

interface Deps {
  model: () => AnnotationModel;
  selection: () => Selection;
}

/** In-place text box editor. Lives in the page overlay (page units) so it scales with zoom. */
export class TextEditor {
  private ta: HTMLTextAreaElement | null = null;
  private page: PageView | null = null;
  private base: TextObj | null = null;
  private existing = false;
  private blurTimer = 0;

  constructor(private deps: Deps) {
    settings.on('change', (key) => {
      if (key === 'text' && this.ta && this.base) this.restyle();
    });
  }

  get isOpen(): boolean {
    return !!this.ta;
  }

  open(page: PageView, obj: TextObj | null, at: { x: number; y: number; w?: number }): void {
    this.close(true);
    const st = settings.get('text');
    const defaultW = Math.max(90, Math.min(260, page.meta.w - at.x - 14));
    const base: TextObj = obj
      ? { ...obj }
      : {
          id: uid(), t: 'text', x: at.x, y: at.y, w: at.w ?? defaultW, s: '', f: st.font, z: st.size, c: st.color,
          ...(st.bold ? { b: 1 as const } : {}), ...(st.italic ? { i: 1 as const } : {}), ...(st.align !== 'l' ? { a: st.align } : {}),
        };
    this.page = page;
    this.base = base;
    this.existing = !!obj;
    this.deps.selection().clear();
    if (obj) {
      page.hidden = new Set([obj.id]);
      page.redrawAnnotations();
    }
    const ta = h('textarea.text-editor', { value: base.s, spellcheck: false, rows: 1, 'aria-label': 'Text' });
    this.ta = ta;
    page.overlayEl.append(ta);
    this.restyle();
    void ensureFont(base.f, !!base.b, !!base.i).then(() => this.restyle());
    ta.addEventListener('input', () => this.autosize());
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        this.close(true);
      }
    });
    ta.addEventListener('blur', () => {
      this.blurTimer = window.setTimeout(() => this.close(true), 120);
    });
    ta.addEventListener('focus', () => clearTimeout(this.blurTimer));
    // focus now and again once the pointer sequence that opened us has finished
    ta.focus();
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
      this.autosize();
    }, 0);
  }

  /** Style changes from the text popover while editing. */
  private restyle(): void {
    const ta = this.ta;
    const b = this.base;
    if (!ta || !b) return;
    const st = settings.get('text');
    const live: TextObj = {
      ...b, f: st.font, z: st.size, c: st.color, a: st.align === 'l' ? undefined : st.align,
      b: st.bold ? 1 : undefined, i: st.italic ? 1 : undefined,
    };
    if (!live.a) delete live.a;
    if (!live.b) delete live.b;
    if (!live.i) delete live.i;
    this.base = live;
    const s = ta.style;
    s.left = `${live.x}px`;
    s.top = `${live.y}px`;
    s.width = `${live.w}px`;
    s.font = fontCss(live);
    s.fontKerning = 'none';
    s.fontVariantLigatures = 'none';
    s.fontFeatureSettings = NO_FEATURES;
    s.lineHeight = `${live.z * LINE_HEIGHT}px`;
    s.padding = `${TEXT_PAD}px`;
    s.color = live.c;
    s.textAlign = live.a === 'c' ? 'center' : live.a === 'r' ? 'right' : 'left';
    s.caretColor = live.c;
    s.transform = live.r ? `rotate(${live.r}rad)` : '';
    this.autosize();
  }

  private autosize(): void {
    const ta = this.ta;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.max(ta.scrollHeight, (this.base?.z ?? 14) * LINE_HEIGHT + TEXT_PAD * 2)}px`;
  }

  close(commit: boolean): void {
    const ta = this.ta;
    const page = this.page;
    const base = this.base;
    if (!ta || !page || !base) return;
    clearTimeout(this.blurTimer);
    this.ta = null;
    this.page = null;
    this.base = null;
    const text = ta.value;
    ta.remove();
    page.hidden.clear();
    const model = this.deps.model();
    if (!commit || !text.trim()) {
      if (this.existing && commit) model.remove('Text löschen', page.index, [base.id]);
      page.redrawAnnotations();
      return;
    }
    const obj = layoutText({ ...base, s: text });
    if (this.existing) model.replace('Text ändern', page.index, [obj]);
    else model.add('Text', page.index, obj);
    page.redrawAnnotations();
    this.deps.selection().set(page, [obj.id]);
  }

  /** Apply style changes to a not-yet-committed box (used by the popover). */
  current(): TextObj | null {
    return this.base;
  }
}
