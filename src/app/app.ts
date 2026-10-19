import { Viewer } from '../viewer/viewer';
import type { ViewState } from '../viewer/viewer';
import { pdfjsLib, PasswordRequired } from '../viewer/pdfjs';
import { DocSession } from './session';
import type { FileRef } from './session';
import { Editor } from './editor';
import type { AppApi, SidebarTab } from './api';
import type { AppHost } from '../host';
import { HostError } from '../host/types';
import type { HostFile } from '../host/types';
import { loadFonts } from '../render/fonts';
import { drawObjects, setImageLoadHandler } from '../render/draw';
import { isHighlight } from '../core/types';
import { PdfError } from '../pdf/client';
import type { BlankTemplate, StructureOp } from '../pdf/build';
import { settings } from './settings';
import { addRecent } from './recents';
import type { Recent } from './recents';
import { Toolbar } from '../ui/toolbar';
import { FloatingMenus, PageIndicator } from '../ui/floating';
import { Sidebar } from '../ui/sidebar';
import { Welcome } from '../ui/welcome';
import { showSettings, showShortcuts } from '../ui/settings-panel';
import { confirmDialog, passwordDialog, sheet, toast } from '../ui/dialogs';
import { h } from '../ui/dom';
import { segmented } from '../ui/popover';
import { pageSetup } from '../ui/paper';
import { icon } from '../ui/icons';
import { TabBar } from '../ui/tabs';
import { createBlankPdf } from '../pdf/client';
import { addStrings, lang, setLang, t } from '../ui/i18n';

addStrings(
  {
    'app.saved': 'Gespeichert', 'app.saving': 'Speichere …', 'app.saveFailed': 'Speichern fehlgeschlagen', 'app.openFailed': 'Diese Datei konnte nicht geöffnet werden.',
    'app.modifiedTitle': 'Datei wurde außerhalb geändert', 'app.modifiedMsg': '„{name}“ wurde seit dem Öffnen von einem anderen Programm verändert. Überschreiben?', 'app.overwrite': 'Überschreiben',
    'app.denied': 'Die Datei ist gesperrt oder schreibgeschützt. Speichere sie unter einem anderen Namen.', 'app.encrypted': 'Dieses PDF ist passwortgeschützt. Anmerkungen können hier nicht eingebettet werden.',
    'app.unsavedTitle': 'Änderungen speichern?', 'app.exported': 'Kopie exportiert', 'app.updateReady': 'Update bereit – jetzt neu starten',
    'app.blankTitle': 'Seite einfügen', 'app.insert': 'Einfügen', 'app.add': 'Hinzufügen', 'app.addPage': 'Seite hinzufügen', 'app.pageAdded': 'Seite hinzugefügt',
    'app.newTitle': 'Neues Notizbuch', 'app.create': 'Erstellen', 'app.newName': 'Notizen',
    'app.printTitle': 'Drucken', 'app.printAll': 'Alle Seiten', 'app.printCurrent': 'Aktuelle Seite', 'app.printRange': 'Bereich (z. B. 1-3, 5)', 'app.printGo': 'Drucken', 'app.printing': 'Bereite Druck vor …',
    'app.notPdf': 'Das ist keine PDF-Datei.', 'app.copySuffix': 'mit Notizen', 'app.flatSuffix': 'flach',
  },
  {
    'app.saved': 'Saved', 'app.saving': 'Saving …', 'app.saveFailed': 'Saving failed', 'app.openFailed': 'This file could not be opened.',
    'app.modifiedTitle': 'File was changed elsewhere', 'app.modifiedMsg': '“{name}” was modified by another program since you opened it. Overwrite?', 'app.overwrite': 'Overwrite',
    'app.denied': 'The file is locked or read-only. Save it under a different name.', 'app.encrypted': 'This PDF is password protected. Annotations cannot be embedded.',
    'app.unsavedTitle': 'Save changes?', 'app.exported': 'Copy exported', 'app.updateReady': 'Update ready – restart now',
    'app.blankTitle': 'Insert page', 'app.insert': 'Insert', 'app.add': 'Add', 'app.addPage': 'Add page', 'app.pageAdded': 'Page added',
    'app.newTitle': 'New notebook', 'app.create': 'Create', 'app.newName': 'Notes',
    'app.printTitle': 'Print', 'app.printAll': 'All pages', 'app.printCurrent': 'Current page', 'app.printRange': 'Range (e.g. 1-3, 5)', 'app.printGo': 'Print', 'app.printing': 'Preparing print …',
    'app.notPdf': 'That is not a PDF file.', 'app.copySuffix': 'with notes', 'app.flatSuffix': 'flat',
  },
);

const SAFE_URL = /^(https?:|mailto:)/i;

export class App implements AppApi {
  readonly viewer = new Viewer();
  readonly editor: Editor;
  /** exposed for end-to-end tests */
  readonly settings = settings;
  /** the document shown; one of `tabs` */
  session: DocSession | null = null;
  /** open documents in tab order */
  readonly tabs: DocSession[] = [];

  private toolbar: Toolbar;
  private tabBar: TabBar<DocSession>;
  /** zoom and position of the tabs in the background */
  private views = new Map<DocSession, ViewState>();
  private sidebar: Sidebar;
  private welcome: Welcome;
  private pill: PageIndicator;
  private autosaveTimers = new Map<DocSession, number>();
  private saving = new Set<DocSession>();
  private opening = false;
  private updatePill = h('button.update-pill', { onclick: () => this.host.installUpdate?.() });

  constructor(root: HTMLElement, readonly host: AppHost) {
    this.editor = new Editor(this.viewer);
    this.applyTheme();
    setLang(settings.get('lang'));
    document.documentElement.dataset.platform = host.platform;
    document.documentElement.dataset.host = host.kind;

    this.toolbar = new Toolbar(this);
    this.sidebar = new Sidebar(this);
    this.welcome = new Welcome(this, (r) => void this.openRecent(r));
    this.pill = new PageIndicator(this);
    new FloatingMenus(this);
    this.tabBar = new TabBar<DocSession>({
      select: (s) => this.activate(s),
      close: (s) => void this.closeTab(s),
      open: () => this.openDialog(),
      move: (from, to) => {
        const [s] = this.tabs.splice(from, 1);
        this.tabs.splice(to, 0, s);
        this.renderTabs();
      },
    });

    const main = h('main.main', null, this.viewer.el, this.welcome.el, this.pill.el);
    root.append(h('div.window', null, this.toolbar.el, this.tabBar.el, h('div.body', null, this.sidebar.el, main)), this.updatePill);
    this.welcome.show(true);
    this.layoutChrome();

    setImageLoadHandler(() => this.viewer.invalidate(this.viewer.realized.map((v) => v.index)));
    const add = this.viewer.addPageButton;
    add.title = t('app.addPage');
    add.onclick = () => this.appendPage();
    this.wireEvents();
  }

  // ── startup ───────────────────────────────────────────────────────────

  async start(): Promise<void> {
    await loadFonts();
    const launch = await this.host.launchPaths?.();
    if (launch?.length && this.host.readFromPath) {
      for (const p of launch) {
        try {
          await this.openFile(await this.host.readFromPath(p));
        } catch {
          this.toast(t('app.openFailed'), 'error');
        }
      }
    }
  }

  private wireEvents(): void {
    const ed = this.editor;
    ed.on('toast', (m) => this.toast(m));
    ed.on('link', (url) => {
      if (SAFE_URL.test(url)) this.host.openExternal(url);
    });
    ed.on('goto', (d) => void this.gotoDestination(d));
    settings.on('change', (k) => {
      if (k === 'theme') this.applyTheme();
      if (k === 'lang') {
        this.toolbar.setDocument(this.session ? this.session.title : null);
        this.refreshAddPage();
      }
      if (k === 'autosave' && !settings.get('autosave')) for (const id of this.autosaveTimers.values()) clearTimeout(id);
    });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.applyTheme());

    document.addEventListener('keydown', (e) => this.onKey(e));
    document.addEventListener('keyup', (e) => ed.onKeyUp(e));
    document.addEventListener('copy', (e) => {
      if (this.typing(e) || !ed.selection?.active) return;
      ed.copySelection(e);
    });
    document.addEventListener('cut', (e) => {
      if (this.typing(e) || !ed.selection?.active) return;
      ed.cutSelection(e);
    });
    document.addEventListener('paste', (e) => {
      if (this.typing(e) || !this.session) return;
      void ed.paste(e);
    });
    // keep the text caret when clicking toolbar chrome
    document.addEventListener('mousedown', (e) => {
      const el = e.target as HTMLElement;
      if (el.closest?.('.keep-focus') && !el.closest('input,textarea,select')) e.preventDefault();
    });

    let dragDepth = 0;
    window.addEventListener('dragenter', (e) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      dragDepth++;
      this.welcome.dropHint(true);
    });
    window.addEventListener('dragleave', () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) this.welcome.dropHint(false);
    });
    window.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    });
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      dragDepth = 0;
      this.welcome.dropHint(false);
      void this.onDrop([...(e.dataTransfer?.files ?? [])]);
    });

    this.host.onOpenRequest((files) => void this.openFiles(files));
    this.host.onCloseRequest(() => this.confirmCloseAll());
    this.host.onUpdate?.((u) => {
      if (u.state === 'downloaded') {
        this.updatePill.textContent = t('app.updateReady');
        this.updatePill.classList.add('show');
      }
    });

    this.viewer.on('page', () => this.rememberView());
    this.viewer.on('zoom', () => this.rememberView());
    new ResizeObserver(() => this.layoutChrome()).observe(document.body);
    const wco = (navigator as unknown as { windowControlsOverlay?: EventTarget }).windowControlsOverlay;
    wco?.addEventListener('geometrychange', () => this.layoutChrome());
  }

  /** Reserve space for the native window buttons in the custom title bar. */
  private layoutChrome(): void {
    const { chrome } = this.host;
    let right = chrome.rightInset;
    let left = chrome.leftInset;
    const wco = (navigator as unknown as { windowControlsOverlay?: { visible: boolean; getTitlebarAreaRect(): DOMRect } }).windowControlsOverlay;
    if (wco?.visible) {
      const r = wco.getTitlebarAreaRect();
      right = Math.max(0, window.innerWidth - r.right);
      left = Math.max(0, r.left);
    }
    const st = document.documentElement.style;
    st.setProperty('--tb-right-inset', `${right}px`);
    st.setProperty('--tb-left-inset', `${left}px`);
  }

  private applyTheme(): void {
    const pref = settings.get('theme');
    const dark = pref === 'dark' || (pref === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    this.host.setTheme?.(dark);
  }

  private typing(e: Event): boolean {
    const el = e.target as HTMLElement | null;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  }

  // ── keyboard ──────────────────────────────────────────────────────────

  private onKey(e: KeyboardEvent): void {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod) {
      const handled = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      switch (k) {
        case 'o': return handled(() => this.openDialog());
        case 's': return handled(() => void (e.shiftKey ? this.saveAs() : this.save()));
        case 'p': return handled(() => void this.print());
        case 'n': return handled(() => this.newWindow());
        case 'w': return handled(() => this.close());
        case 'tab': if (this.tabs.length > 1) return handled(() => this.cycleTab(e.shiftKey ? -1 : 1)); break;
        case 'pagedown': if (this.tabs.length > 1) return handled(() => this.cycleTab(1)); break;
        case 'pageup': if (this.tabs.length > 1) return handled(() => this.cycleTab(-1)); break;
        case ',': return handled(() => this.showSettings());
        case '/': return handled(() => this.showShortcuts());
        case 'f': if (this.session) return handled(() => this.toggleSidebar('search')); break;
        case 'b': return handled(() => this.toggleSidebar());
        case '0': if (this.session) return handled(() => this.viewer.fitWidth()); break;
        case '1': if (this.session) return handled(() => this.viewer.setZoom(1)); break;
        case '2': if (this.session) return handled(() => this.viewer.fitPage()); break;
        case '=': case '+': if (this.session) return handled(() => this.viewer.zoomStep(1)); break;
        case '-': case '_': if (this.session) return handled(() => this.viewer.zoomStep(-1)); break;
      }
    }
    if (e.key === 'F11') {
      e.preventDefault();
      this.toggleFullscreen();
      return;
    }
    if (!this.session || this.typing(e)) return;
    const v = this.viewer;
    const page = v.stage.clientHeight * 0.9;
    switch (e.key) {
      case 'PageDown': e.preventDefault(); v.stage.scrollBy({ top: page, behavior: 'smooth' }); return;
      case 'PageUp': e.preventDefault(); v.stage.scrollBy({ top: -page, behavior: 'smooth' }); return;
      case 'Home': if (!mod) { e.preventDefault(); v.scrollToPage(0); } return;
      case 'End': if (!mod) { e.preventDefault(); v.scrollToPage(v.pageCount - 1); } return;
    }
    if (this.editor.onKeyDown(e)) return;
    if (!this.editor.selection.active) {
      const step = 60;
      if (e.key === 'ArrowDown') v.stage.scrollBy({ top: step });
      else if (e.key === 'ArrowUp') v.stage.scrollBy({ top: -step });
      else if (e.key === 'ArrowRight') v.stage.scrollBy({ left: step });
      else if (e.key === 'ArrowLeft') v.stage.scrollBy({ left: -step });
    }
  }

  // ── opening ───────────────────────────────────────────────────────────

  openDialog(): void {
    void this.host.pickFiles().then((files) => this.openFiles(files));
  }

  private async openRecent(r: Recent): Promise<void> {
    if (!r.path || !this.host.readFromPath) return;
    try {
      await this.openFiles([await this.host.readFromPath(r.path)]);
    } catch {
      this.toast(t('app.openFailed'), 'error');
    }
  }

  /** Every file opens in its own tab. */
  async openFiles(files: HostFile[]): Promise<void> {
    for (const f of files) await this.openFile(f);
  }

  private async onDrop(files: File[]): Promise<void> {
    const pdfs = files.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (images.length && this.session && !pdfs.length) {
      for (const img of images) await this.editor.insertImage(img);
      return;
    }
    if (!pdfs.length) {
      if (files.length) this.toast(t('app.notPdf'), 'error');
      return;
    }
    const out: HostFile[] = [];
    for (const f of pdfs) {
      const path = this.host.pathOfFile?.(f);
      if (path && this.host.readFromPath) out.push(await this.host.readFromPath(path));
      else out.push({ name: f.name, data: new Uint8Array(await f.arrayBuffer()), mtimeMs: f.lastModified });
    }
    await this.openFiles(out);
  }

  async openFile(file: HostFile): Promise<void> {
    // a file that is already open: show its tab instead of opening it twice
    const open = file.path ? this.tabs.find((s) => s.file.path === file.path) : undefined;
    if (open) {
      this.activate(open);
      return;
    }
    if (this.opening) return;
    this.opening = true;
    try {
      let password: string | undefined;
      let session: DocSession | null = null;
      for (let attempt = 0; attempt < 6 && !session; attempt++) {
        try {
          session = await DocSession.open(file.data, { name: file.name, path: file.path, handle: file.handle, mtimeMs: file.mtimeMs }, password);
        } catch (e) {
          if (e instanceof PasswordRequired) {
            const pw = await passwordDialog(e.wrong);
            if (pw === null) return;
            password = pw;
          } else throw e;
        }
      }
      if (!session) return;
      this.addTab(session);
      void this.remember(session, file);
    } catch (e) {
      console.error(e);
      this.toast(t('app.openFailed'), 'error');
    } finally {
      this.opening = false;
    }
  }

  /** A newly opened document: a tab right after the current one. */
  private addTab(session: DocSession): void {
    const at = this.session ? this.tabs.indexOf(this.session) + 1 : this.tabs.length;
    this.tabs.splice(at, 0, session);
    const shown = () => this.session === session;
    session.model.on('change', ({ pages }) => {
      if (shown()) this.viewer.invalidate(pages);
    });
    session.model.on('history', () => this.onHistory(session));
    session.on('swapping', () => {
      if (shown()) this.viewer.setPaused(true, 'swap');
    });
    session.on('swapped', () => {
      if (shown()) this.viewer.setPaused(false, 'swap');
    });
    session.on('structure', () => {
      if (!shown()) return;
      // the page views are rebuilt: end any stroke or drag that runs on the old ones
      this.editor.controller.cancelActive();
      this.editor.selection.clear();
      this.viewer.setSession(session, { keepView: true });
      this.onHistory(session);
    });
    session.on('file', () => this.onHistory(session));
    this.activate(session);
    this.restoreView(session);
  }

  /** Shows a tab; the one in the background keeps its zoom and position. */
  activate(session: DocSession): void {
    if (this.session === session || !this.tabs.includes(session)) return;
    const old = this.session;
    if (old) this.views.set(old, this.viewer.viewState());
    this.session = session;
    this.editor.attach(session);
    this.viewer.setPaused(session.swapping, 'swap');
    const view = this.views.get(session);
    this.viewer.setSession(session, view ? { view } : {});
    this.sidebar.setSession(session);
    this.toolbar.setDocument(session.title);
    this.welcome.show(false);
    this.refreshAddPage();
    this.onHistory(session);
    this.pill.refresh();
  }

  private cycleTab(dir: 1 | -1): void {
    const n = this.tabs.length;
    const i = this.session ? this.tabs.indexOf(this.session) : 0;
    this.activate(this.tabs[(i + dir + n) % n]);
  }

  /** Closes a tab after asking about unsaved changes; the last one leaves the start screen. */
  async closeTab(session: DocSession): Promise<void> {
    // a tab closed in the background is shown only while asking; afterwards the user's tab returns
    const was = this.session !== session ? this.session : null;
    if (!(await this.confirmDiscard(session))) {
      if (was && this.tabs.includes(was)) this.activate(was);
      return;
    }
    const i = this.tabs.indexOf(session);
    if (i < 0) return;
    this.tabs.splice(i, 1);
    this.views.delete(session);
    clearTimeout(this.autosaveTimers.get(session));
    this.autosaveTimers.delete(session);
    if (this.session === session) {
      this.session = null;
      const next = was && this.tabs.includes(was) ? was : (this.tabs[i] ?? this.tabs[i - 1]);
      if (next) this.activate(next);
      else this.showStart();
    }
    session.destroy();
    this.renderTabs();
    this.publishState();
  }

  private showStart(): void {
    this.session = null;
    this.editor.attach(null);
    this.viewer.setPaused(false, 'swap');
    this.viewer.clear();
    this.sidebar.setSession(null);
    this.toolbar.setDocument(null);
    this.welcome.show(true);
    this.refreshAddPage();
    this.pill.refresh();
  }

  private renderTabs(): void {
    this.tabBar.render(this.tabs.map((s) => ({ key: s, title: s.title, dirty: s.model.dirty })), this.session);
  }

  /** Window title shows the current document; closing the window asks while any tab is unsaved. */
  private publishState(): void {
    this.host.setDocumentState({ name: this.session?.file.name ?? '', dirty: this.tabs.some((s) => s.model.dirty) });
  }

  private viewKey(): string | null {
    const f = this.session?.file;
    return f ? `scribo.view.${f.path ?? f.name}` : null;
  }

  private rememberView(): void {
    const key = this.viewKey();
    if (!key || !this.session) return;
    try {
      localStorage.setItem(key, JSON.stringify({ page: this.viewer.currentPage, zoom: this.viewer.zoom, fit: this.viewer.fit }));
    } catch {
      /* ignore */
    }
  }

  private restoreView(session: DocSession): void {
    const key = this.viewKey();
    if (!key) return;
    try {
      const v = JSON.parse(localStorage.getItem(key) ?? 'null') as { page: number; zoom: number; fit: 'width' | 'page' | 'none' } | null;
      if (!v || v.page >= session.pageCount) return;
      requestAnimationFrame(() => {
        if (v.fit === 'none') this.viewer.setZoom(v.zoom);
        this.viewer.scrollToPage(v.page);
      });
    } catch {
      /* ignore */
    }
  }

  /** Recents entry with a first-page thumbnail. */
  private async remember(session: DocSession, file: HostFile): Promise<void> {
    try {
      const page = await session.pdf.getPage(1);
      const w = 200;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const vp = page.getViewport({ scale: (w * dpr) / session.metas[0].w });
      const c = document.createElement('canvas');
      c.width = Math.ceil(vp.width);
      c.height = Math.ceil(vp.height);
      await page.render({ canvas: c, viewport: vp, background: '#fff', annotationMode: pdfjsLib.AnnotationMode.ENABLE, optionalContentConfigPromise: session.ocConfig }).promise;
      const objs = session.model.pages[0] ?? [];
      if (objs.length) {
        const ctx = c.getContext('2d')!;
        ctx.setTransform(vp.scale, 0, 0, vp.scale, 0, 0);
        drawObjects(ctx, objs.filter(isHighlight));
        drawObjects(ctx, objs.filter((o) => !isHighlight(o)));
      }
      addRecent({ name: file.name, path: file.path, opened: Date.now(), thumb: c.toDataURL('image/jpeg', 0.7) });
      page.cleanup();
    } catch {
      addRecent({ name: file.name, path: file.path, opened: Date.now() });
    }
  }

  // ── history / dirty ───────────────────────────────────────────────────

  private onHistory(s: DocSession | null = this.session): void {
    if (!s) return;
    const dirty = s.model.dirty;
    if (s === this.session) this.toolbar.refreshState(dirty);
    this.publishState();
    this.renderTabs();
    clearTimeout(this.autosaveTimers.get(s));
    if (dirty && settings.get('autosave') && (s.file.path || s.file.handle)) {
      this.autosaveTimers.set(s, window.setTimeout(() => void this.save(true, s), 10_000));
    }
  }

  // ── saving ────────────────────────────────────────────────────────────

  async save(silent = false, s = this.session): Promise<void> {
    if (!s || this.saving.has(s)) return;
    if (!s.file.path && !s.file.handle) {
      if (s === this.session) await this.saveAs();
      return;
    }
    if (!s.model.dirty) {
      if (!silent) this.toast(t('app.saved'), 'info', 1000);
      return;
    }
    this.saving.add(s);
    try {
      if (!silent) this.toast(t('app.saving'), 'info', 900);
      const built = await s.buildForSave();
      const bytes = built.bytes;
      let ref: FileRef;
      try {
        ref = await this.host.write(s.file, bytes);
      } catch (e) {
        if (e instanceof HostError && e.code === 'modified') {
          const ok = await confirmDialog({ title: t('app.modifiedTitle'), message: t('app.modifiedMsg', { name: s.file.name }), confirm: t('app.overwrite'), danger: true });
          if (!ok) return;
          ref = await this.host.write(s.file, bytes, { overwriteModified: true });
        } else throw e;
      }
      s.markSaved(built, ref);
      this.toast(t('app.saved'), 'info', 1400);
    } catch (e) {
      this.reportSaveError(e);
    } finally {
      this.saving.delete(s);
    }
  }

  private reportSaveError(e: unknown): void {
    console.error(e);
    if (e instanceof PdfError && e.code === 'encrypted') this.toast(t('app.encrypted'), 'error', 6000);
    else if (e instanceof HostError && e.code === 'denied') this.toast(t('app.denied'), 'error', 6000);
    else this.toast(`${t('app.saveFailed')}: ${(e as Error).message ?? ''}`, 'error', 6000);
  }

  async saveAs(): Promise<void> {
    const s = this.session;
    if (!s || this.saving.has(s)) return;
    const ref = await this.host.pickSavePath(s.file.name);
    if (!ref) return;
    this.saving.add(s);
    try {
      const built = await s.buildForSave();
      const saved = await this.host.writeNew(ref, built.bytes);
      s.markSaved(built, saved);
      addRecent({ name: saved.name, path: saved.path, opened: Date.now() });
      this.toast(t('app.saved'), 'info', 1400);
    } catch (e) {
      this.reportSaveError(e);
    } finally {
      this.saving.delete(s);
    }
  }

  async exportCopy(flatten: boolean): Promise<void> {
    const s = this.session;
    if (!s || this.saving.has(s)) return;
    const base = s.file.name.replace(/\.pdf$/i, '');
    const ref = await this.host.pickSavePath(`${base} (${flatten ? t('app.flatSuffix') : t('app.copySuffix')}).pdf`);
    if (!ref) return;
    this.saving.add(s);
    try {
      const bytes = await s.buildBytes({ flatten });
      await this.host.writeNew(ref, bytes);
      this.toast(t('app.exported'));
    } catch (e) {
      this.reportSaveError(e);
    } finally {
      this.saving.delete(s);
    }
  }

  /** Save / don't save / cancel for one document; shows its tab while asking. */
  private async confirmDiscard(s: DocSession): Promise<boolean> {
    if (!s.model.dirty) return true;
    this.activate(s);
    const r = await this.host.confirmDiscard(s.file.name);
    if (r === 'cancel') return false;
    if (r === 'discard') return true;
    await this.save(false, s);
    return !s.model.dirty;
  }

  /** The window closes: ask for every unsaved tab. */
  private async confirmCloseAll(): Promise<boolean> {
    for (const s of [...this.tabs]) if (!(await this.confirmDiscard(s))) return false;
    return true;
  }

  /** Ctrl+W: closes the current tab, or the window when no document is open. */
  close(): void {
    if (this.session) void this.closeTab(this.session);
    else this.host.closeWindow();
  }

  newWindow(): void {
    if (this.host.newWindow) this.host.newWindow();
    else window.open(location.href, '_blank');
  }

  // ── page operations ───────────────────────────────────────────────────

  async applyPageOps(label: string, ops: StructureOp[] | ((s: DocSession) => StructureOp[])): Promise<void> {
    const s = this.session;
    if (!s) return;
    try {
      await s.applyStructure(label, ops);
    } catch (e) {
      console.error(e);
      this.toast(e instanceof PdfError && e.code === 'encrypted' ? t('app.encrypted') : `${(e as Error).message}`, 'error', 5000);
    }
  }

  /**
   * Asks for paper, size and orientation of a new page. `ref` is the page next to it
   * (offers "same size"). The choice is remembered for the next page.
   */
  private async askPage(title: string, confirm: string, ref?: { w: number; h: number }): Promise<{ template: BlankTemplate; w: number; h: number } | null> {
    const setup = pageSetup({ template: settings.get('paper'), size: settings.get('pageSize'), orient: settings.get('pageOrient') }, ref);
    const ok = await sheet<boolean>({
      title,
      body: setup.el,
      buttons: [
        { label: t('dlg.cancel'), value: false },
        { label: confirm, value: true, primary: true },
      ],
      cancelValue: false,
      wide: true,
    });
    if (!ok) return null;
    const v = setup.value();
    settings.set('paper', v.template);
    settings.set('pageOrient', v.orient);
    // a notebook offers no "same size": its A4 fallback must not replace "same" for inserted pages
    if (ref || v.size !== 'A4' || settings.get('pageSize') !== 'same') settings.set('pageSize', v.size);
    return { template: v.template, w: v.w, h: v.h };
  }

  /** New page after `after` (default: the current page). */
  insertBlankPage(after?: number): void {
    const s = this.session;
    if (!s) return;
    const cur = Math.min(after ?? this.viewer.currentPage, s.pageCount - 1);
    void this.askPage(t('app.blankTitle'), t('app.insert'), s.metas[cur]).then((p) => {
      if (!p || this.session !== s) return;
      void this.applyPageOps(t('app.blankTitle'), [{ op: 'insertBlank', at: cur + 1, w: p.w, h: p.h, template: p.template }]).then(() => this.viewer.scrollToPage(cur + 1, { smooth: true }));
    });
  }

  /** "+" under the last page: a new page at the end, on the paper of choice. */
  appendPage(): void {
    const s = this.session;
    if (!s) return;
    void this.askPage(t('app.addPage'), t('app.add'), s.metas[s.pageCount - 1]).then((p) => {
      if (!p || this.session !== s) return;
      let at = 0;
      // computed when it runs: a second page added right after must land behind the first
      void this.applyPageOps(t('app.addPage'), (doc) => {
        at = doc.pageCount;
        return [{ op: 'insertBlank', at, w: p.w, h: p.h, template: p.template }];
      }).then(() => this.viewer.scrollToPage(at, { smooth: true }));
    });
  }

  private refreshAddPage(): void {
    const b = this.viewer.addPageButton;
    b.replaceChildren(icon('plus', 16, 2), h('span', null, t('app.addPage')));
    b.hidden = !this.session;
  }

  /** A new, empty notebook on the paper, size and orientation of choice. Saving asks for a file name. */
  newNotebook(): void {
    void this.askPage(t('app.newTitle'), t('app.create')).then(async (p) => {
      if (!p) return;
      try {
        const data = await createBlankPdf(p.w, p.h, p.template, 1);
        await this.openFile({ name: `${t('app.newName')}.pdf`, data });
        if (this.session) {
          this.session.file = { ...this.session.file, untitled: true };
          this.onHistory();
        }
      } catch (e) {
        console.error(e);
        this.toast(t('app.openFailed'), 'error');
      }
    });
  }

  // ── navigation ────────────────────────────────────────────────────────

  async gotoDestination(dest: unknown): Promise<void> {
    const s = this.session;
    if (!s) return;
    try {
      let d = dest;
      if (typeof d === 'string') d = await s.pdf.getDestination(d);
      if (!Array.isArray(d)) return;
      const ref = d[0];
      const idx = typeof ref === 'object' && ref !== null ? await s.pdf.getPageIndex(ref as never) : Number(ref);
      const meta = s.metas[idx];
      if (!meta) return;
      let off = 0;
      if (d[1]?.name === 'XYZ' && typeof d[3] === 'number') {
        const left = typeof d[2] === 'number' ? d[2] : 0;
        off = Math.max(0, meta.vt[1] * left + meta.vt[3] * d[3] + meta.vt[5] - 24);
      }
      this.viewer.scrollToPage(idx, { offsetPt: off, smooth: true });
    } catch {
      /* broken destination */
    }
  }

  toggleSidebar(tab?: SidebarTab): void {
    const open = settings.get('sidebar');
    if (tab) {
      if (open && settings.get('sidebarTab') === tab && tab !== 'search') settings.set('sidebar', false);
      else {
        settings.set('sidebarTab', tab);
        settings.set('sidebar', true);
        if (tab === 'search') {
          this.sidebar.focusSearch();
          setTimeout(() => this.sidebar.focusSearch(), 80);
        }
      }
    } else settings.set('sidebar', !open);
  }

  // ── printing ──────────────────────────────────────────────────────────

  async print(): Promise<void> {
    const s = this.session;
    if (!s) return;
    let mode = 'all' as 'all' | 'current' | 'range';
    const range = h('input.text-input', { type: 'text', placeholder: '1-3, 5', 'aria-label': t('app.printRange') });
    const seg = segmented(
      [
        { value: 'all' as const, label: t('app.printAll') },
        { value: 'current' as const, label: t('app.printCurrent') },
        { value: 'range' as const, label: t('app.printRange') },
      ],
      mode,
      (v) => {
        mode = v;
        range.style.display = v === 'range' ? '' : 'none';
      },
    );
    range.style.display = 'none';
    const ok = await sheet<boolean>({
      title: t('app.printTitle'),
      body: [seg, range],
      buttons: [
        { label: t('dlg.cancel'), value: false },
        { label: t('app.printGo'), value: true, primary: true },
      ],
      cancelValue: false,
    });
    if (!ok) return;
    let pages: number[] = Array.from({ length: s.pageCount }, (_, i) => i);
    if (mode === 'current') pages = [this.viewer.currentPage];
    if (mode === 'range') {
      const set = new Set<number>();
      for (const part of range.value.split(',')) {
        const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(part);
        if (!m) continue;
        const a = Number(m[1]);
        const b = Number(m[2] ?? m[1]);
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) if (i >= 1 && i <= s.pageCount) set.add(i - 1);
      }
      pages = [...set].sort((a, b) => a - b);
      if (!pages.length) return;
    }
    this.toast(t('app.printing'), 'info', 2500);
    const root = h('div');
    root.id = 'print-root';
    document.body.append(root);
    document.body.classList.add('printing');
    try {
      for (const i of pages) {
        const page = await s.pdf.getPage(i + 1);
        const k = 200 / 72; // 200 dpi
        const vp = page.getViewport({ scale: k });
        const c = document.createElement('canvas');
        c.width = Math.ceil(vp.width);
        c.height = Math.ceil(vp.height);
        await page.render({ canvas: c, viewport: vp, background: '#fff', annotationMode: pdfjsLib.AnnotationMode.ENABLE, optionalContentConfigPromise: s.ocConfig }).promise;
        const objs = s.model.pages[i] ?? [];
        if (objs.length) {
          const ctx = c.getContext('2d')!;
          ctx.setTransform(k, 0, 0, k, 0, 0);
          drawObjects(ctx, objs.filter(isHighlight));
          drawObjects(ctx, objs.filter((o) => !isHighlight(o)));
        }
        const img = h('img.print-page', { src: c.toDataURL('image/jpeg', 0.92) });
        img.style.aspectRatio = `${s.metas[i].w} / ${s.metas[i].h}`;
        root.append(img);
        page.cleanup();
      }
      await Promise.all([...root.querySelectorAll('img')].map((im) => (im as HTMLImageElement).decode().catch(() => undefined)));
      if (this.host.print) await this.host.print();
      else window.print();
    } finally {
      document.body.classList.remove('printing');
      root.remove();
    }
  }

  // ── misc UI ───────────────────────────────────────────────────────────

  showSettings(): void {
    void showSettings(this);
  }

  showShortcuts(): void {
    void showShortcuts();
  }

  toggleFullscreen(): void {
    const on = !document.fullscreenElement && !this.fs;
    this.fs = on;
    this.host.fullscreen(on);
  }
  private fs = false;

  toast(message: string, kind: 'info' | 'error' = 'info', ms?: number): void {
    toast(message, kind, ms);
  }

  get language(): string {
    return lang();
  }
}
