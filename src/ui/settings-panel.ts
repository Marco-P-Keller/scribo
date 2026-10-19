import { getStroke } from 'perfect-freehand';
import type { AppApi } from '../app/api';
import { settings } from '../app/settings';
import type { PenAction } from '../app/settings';
import { pressureCurve, outlinePath, strokeOptions } from '../core/ink';
import { PressureFilter, roundEnd } from '../core/pressure';
import { penTouching } from '../input/pen';
import type { SnapMode } from '../core/types';
import { h } from './dom';
import { field, segmented, slider, toggle } from './popover';
import { sheet } from './dialogs';
import { addStrings, setLang, t } from './i18n';

addStrings(
  {
    'set.title': 'Einstellungen', 'set.done': 'Fertig',
    'set.appearance': 'Darstellung', 'set.theme': 'Design', 'set.themeAuto': 'System', 'set.themeLight': 'Hell', 'set.themeDark': 'Dunkel', 'set.language': 'Sprache',
    'set.input': 'Stift & Eingabe', 'set.finger': 'Mit dem Finger zeichnen', 'set.fingerHint': 'Aus: Finger scrollen und zoomen, nur der Stift schreibt.',
    'set.mouse': 'Mit der Maus zeichnen', 'set.palm': 'Handballen-Erkennung', 'set.palmHint': 'Berührungen werden ignoriert, solange der Stift am Bildschirm ist.',
    'set.pressure': 'Druckempfindlichkeit', 'set.pressureHint': 'Links: fester drücken für dicke Linien. Rechts: schon leichter Druck reicht.',
    'set.pressureWidth': 'Einfluss des Drucks auf die Strichbreite', 'set.pressureWidthHint': 'Aus: Jede Linie ist gleich breit wie mit einem Fineliner. Ein: Fester drücken gibt dickere Linien.',
    'set.pressureAmount': 'Stärke des Einflusses', 'set.pressureAmountHint': 'Links: kaum Unterschied. Rechts: kräftiger Schwung wie mit einer Füllfeder.',
    'set.smoothing': 'Glättung beim Schreiben', 'set.smoothingHint': 'Links: schwach, die Linie folgt jeder Bewegung des Stifts. Rechts: stark, ruhige und runde Linien.',
    'set.weak': 'Schwach', 'set.strong': 'Stark',
    'set.snap': 'Formerkennung', 'set.lowLatency': 'Geringere Schreib-Verzögerung', 'set.lowLatencyHint': 'Experimentell. Bei Flackern oder fehlender Tinte ausschalten.',
    'set.buttons': 'Stifttasten', 'set.btn1': 'Seitentaste (Code 2)', 'set.btn2': 'Radiertaste / Radierer-Ende (Code 32)', 'set.btn3': 'Weitere Taste (Code 4)',
    'set.buttonsHint': 'Halte den Stift über das Testfeld und drücke eine Taste: Die passende Zeile leuchtet auf.',
    'set.act.erase': 'Linie radieren', 'set.act.lasso': 'Lasso', 'set.act.select': 'Auswahl', 'set.act.none': 'Keine Aktion', 'set.swap': 'Tasten tauschen',
    'set.test': 'Stift testen', 'set.testHint': 'Schreibe hier mit deinen aktuellen Einstellungen und probiere die Tasten aus.',
    'set.testIdle': 'Stift über das Feld halten …', 'set.pressureLabel': 'Druck', 'set.pressed': 'Gedrückt', 'set.none': 'keine Taste',
    'set.save': 'Speichern', 'set.autosave': 'Automatisch speichern', 'set.autosaveHint': 'Speichert 10 Sekunden nach der letzten Änderung in dieselbe Datei.',
    'set.about': 'Über Scribo', 'set.version': 'Version {v}', 'set.privacy': 'Läuft vollständig offline. Es werden keine Daten gesendet.',
    'btn.contact': 'Seitentaste', 'btn.eraser': 'Radierertaste', 'btn.middle': 'Mitteltaste',
    'sc.title': 'Tastenkürzel', 'sc.file': 'Datei', 'sc.edit': 'Bearbeiten', 'sc.tools': 'Werkzeuge', 'sc.view': 'Ansicht',
    'sc.open': 'Öffnen', 'sc.save': 'Speichern', 'sc.saveAs': 'Speichern unter', 'sc.print': 'Drucken', 'sc.new': 'Neues Fenster', 'sc.close': 'Fenster schließen',
    'sc.undo': 'Rückgängig', 'sc.redo': 'Wiederholen', 'sc.copy': 'Kopieren / Ausschneiden / Einfügen', 'sc.dup': 'Duplizieren', 'sc.del': 'Auswahl löschen', 'sc.all': 'Alles auswählen', 'sc.nudge': 'Auswahl verschieben (Shift: 10×)',
    'sc.tools.v': 'Auswahl', 'sc.tools.p': 'Stift', 'sc.tools.h': 'Textmarker', 'sc.tools.e': 'Radierer', 'sc.tools.l': 'Lasso', 'sc.tools.t': 'Text', 'sc.tools.s': 'Formen', 'sc.tools.n': 'Notiz',
    'sc.zoom': 'Zoom', 'sc.fit': 'Breite anpassen / 100 % / Ganze Seite', 'sc.find': 'Suchen', 'sc.sidebar': 'Seitenleiste', 'sc.pan': 'Verschieben', 'sc.full': 'Vollbild',
  },
  {
    'set.title': 'Settings', 'set.done': 'Done',
    'set.appearance': 'Appearance', 'set.theme': 'Theme', 'set.themeAuto': 'System', 'set.themeLight': 'Light', 'set.themeDark': 'Dark', 'set.language': 'Language',
    'set.input': 'Pen & input', 'set.finger': 'Draw with finger', 'set.fingerHint': 'Off: fingers scroll and zoom, only the pen writes.',
    'set.mouse': 'Draw with mouse', 'set.palm': 'Palm rejection', 'set.palmHint': 'Touches are ignored while the pen is near the screen.',
    'set.pressure': 'Pressure sensitivity', 'set.pressureHint': 'Left: press harder for thick lines. Right: light pressure is enough.',
    'set.pressureWidth': 'Pressure changes the line width', 'set.pressureWidthHint': 'Off: every line has the same width, like a fineliner. On: press harder for thicker lines.',
    'set.pressureAmount': 'Strength', 'set.pressureAmountHint': 'Left: barely any difference. Right: lively swell like a fountain pen.',
    'set.smoothing': 'Smoothing while writing', 'set.smoothingHint': 'Left: weak, the line follows every movement of the pen. Right: strong, calm and round lines.',
    'set.weak': 'Weak', 'set.strong': 'Strong',
    'set.snap': 'Shape recognition', 'set.lowLatency': 'Lower writing latency', 'set.lowLatencyHint': 'Experimental. Turn off if you see flicker or missing ink.',
    'set.buttons': 'Pen buttons', 'set.btn1': 'Side button (code 2)', 'set.btn2': 'Eraser button / eraser end (code 32)', 'set.btn3': 'Other button (code 4)',
    'set.buttonsHint': 'Hold the pen over the test field and press a button: the matching row lights up.',
    'set.act.erase': 'Erase stroke', 'set.act.lasso': 'Lasso', 'set.act.select': 'Select', 'set.act.none': 'No action', 'set.swap': 'Swap buttons',
    'set.test': 'Test your pen', 'set.testHint': 'Write here with your current settings and try the buttons.',
    'set.testIdle': 'Hold the pen over the field …', 'set.pressureLabel': 'Pressure', 'set.pressed': 'Pressed', 'set.none': 'no button',
    'set.save': 'Saving', 'set.autosave': 'Save automatically', 'set.autosaveHint': 'Saves into the same file 10 seconds after the last change.',
    'set.about': 'About Scribo', 'set.version': 'Version {v}', 'set.privacy': 'Runs fully offline. No data is sent anywhere.',
    'btn.contact': 'Side button', 'btn.eraser': 'Eraser button', 'btn.middle': 'Middle button',
    'sc.title': 'Keyboard shortcuts', 'sc.file': 'File', 'sc.edit': 'Edit', 'sc.tools': 'Tools', 'sc.view': 'View',
    'sc.open': 'Open', 'sc.save': 'Save', 'sc.saveAs': 'Save as', 'sc.print': 'Print', 'sc.new': 'New window', 'sc.close': 'Close window',
    'sc.undo': 'Undo', 'sc.redo': 'Redo', 'sc.copy': 'Copy / cut / paste', 'sc.dup': 'Duplicate', 'sc.del': 'Delete selection', 'sc.all': 'Select all', 'sc.nudge': 'Nudge selection (Shift: 10×)',
    'sc.tools.v': 'Select', 'sc.tools.p': 'Pen', 'sc.tools.h': 'Highlighter', 'sc.tools.e': 'Eraser', 'sc.tools.l': 'Lasso', 'sc.tools.t': 'Text', 'sc.tools.s': 'Shapes', 'sc.tools.n': 'Note',
    'sc.zoom': 'Zoom', 'sc.fit': 'Fit width / 100 % / Fit page', 'sc.find': 'Find', 'sc.sidebar': 'Sidebar', 'sc.pan': 'Pan', 'sc.full': 'Full screen',
  },
);

const ACTIONS: PenAction[] = ['erase', 'lasso', 'select', 'none'];

function row(label: string, control: HTMLElement, hint?: string): HTMLElement {
  return h('div.set-row', null, h('div.set-text', null, h('div.set-label', null, label), hint ? h('div.set-hint', null, hint) : null), control);
}

function actionSelect(value: PenAction, onChange: (v: PenAction) => void): HTMLElement {
  const sel = h('select.select', { onchange: () => onChange(sel.value as PenAction) },
    ACTIONS.map((a) => h('option', { value: a, selected: a === value }, t(`set.act.${a}`))));
  return sel;
}

/**
 * A scribble pad with the real ink pipeline (pressure curve, pressure filter, nib) that also
 * shows live pen data: pressure and which button codes arrive.
 */
function penTestPad(onButtons: (bits: number) => void): { el: HTMLElement; dispose: () => void } {
  const canvas = h('canvas.pad');
  const info = h('div.pad-info', null, t('set.testIdle'));
  const ctx = canvas.getContext('2d')!;
  const strokes: number[][][] = [];
  let cur: number[][] | null = null;
  let filter = new PressureFilter(1);
  let fade = 0;
  const names = (b: number) => {
    const out: string[] = [];
    if (b & 2) out.push(`${t('btn.contact')} (2)`);
    if (b & 32) out.push(`${t('btn.eraser')} (32)`);
    if (b & 4) out.push(`${t('btn.middle')} (4)`);
    return out.length ? out.join(' + ') : t('set.none');
  };
  const draw = () => {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(canvas.clientWidth * dpr);
    const hh = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== hh) {
      canvas.width = w;
      canvas.height = hh;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, hh);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = getComputedStyle(canvas).color;
    for (const pts of strokes) {
      if (!pts.length) continue;
      const flat = roundEnd(pts.flat());
      const tri: number[][] = [];
      for (let i = 0; i < flat.length; i += 3) tri.push([flat[i], flat[i + 1], flat[i + 2]]);
      if (tri.length === 1) tri.push([tri[0][0] + 0.01, tri[0][1], tri[0][2]]);
      ctx.fill(outlinePath(getStroke(tri, strokeOptions({ w: 3.2, sm: settings.get('smoothing') })) as [number, number][]));
    }
  };
  const pos = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const add = (ev: PointerEvent) => {
    const raw = ev.pointerType === 'pen' && settings.get('pressureWidth') ? pressureCurve(ev.pressure, settings.get('sensitivity')) : 0.5;
    cur!.push([...pos(ev), ev.pointerType === 'pen' ? filter.next(raw) : 0.5]);
  };
  const begin = (e: PointerEvent) => {
    clearTimeout(fade);
    filter = new PressureFilter(settings.get('pressureWidth') ? settings.get('pressureAmount') : 0);
    cur = [];
    strokes.push(cur);
    add(e);
    draw();
  };
  const end = () => {
    cur = null;
    clearTimeout(fade);
    fade = window.setTimeout(() => {
      strokes.length = 0;
      draw();
    }, 2500);
  };
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    onButtons(e.buttons & ~1);
    if (e.pointerType !== 'pen' || penTouching(e)) begin(e);
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    info.textContent = `${e.pointerType === 'pen' ? '✎' : e.pointerType} · ${t('set.pressureLabel')} ${Math.round(e.pressure * 100)} % · ${t('set.pressed')}: ${names(e.buttons & ~1)}`;
    onButtons(e.pointerType === 'pen' ? e.buttons & ~1 : 0);
    const touching = e.pointerType === 'pen' ? penTouching(e) : (e.buttons & 1) !== 0;
    if (touching && !cur) begin(e);
    else if (!touching && cur) end();
    else if (cur) {
      for (const ev of e.getCoalescedEvents?.() ?? [e]) add(ev);
      draw();
    }
  });
  canvas.addEventListener('pointerup', (e) => {
    onButtons(e.buttons & ~1);
    if (cur) end();
  });
  canvas.addEventListener('pointerleave', () => onButtons(0));
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  return { el: h('div.pad-wrap', null, canvas, info), dispose: () => clearTimeout(fade) };
}

export async function showSettings(app: AppApi): Promise<void> {
  const s = settings;
  const buttons = h('div.group');
  const rows: [number, HTMLElement][] = [];
  const pad = penTestPad((bits) => {
    for (const [code, el] of rows) el.classList.toggle('pressed', (bits & code) !== 0);
  });
  const buttonRow = (code: number, label: string, el: HTMLElement) => {
    const r = row(label, el);
    r.prepend(h('span.btn-led'));
    rows.push([code, r]);
    return r;
  };
  const paintButtons = () => {
    const m = s.get('penButtons');
    rows.length = 0;
    buttons.replaceChildren(
      buttonRow(32, t('set.btn2'), actionSelect(m.eraser, (v) => { s.patch('penButtons', { eraser: v }); })),
      buttonRow(2, t('set.btn1'), actionSelect(m.barrel, (v) => { s.patch('penButtons', { barrel: v }); })),
      buttonRow(4, t('set.btn3'), actionSelect(m.middle, (v) => { s.patch('penButtons', { middle: v }); })),
      h('button.set-row.set-action', {
        onclick: () => {
          const mm = s.get('penButtons');
          s.patch('penButtons', { barrel: mm.eraser, eraser: mm.barrel });
          paintButtons();
        },
      }, t('set.swap')),
    );
  };
  paintButtons();

  // amount and sensitivity only matter while pressure changes the width
  const pressureFields = [
    field(t('set.pressureAmount'), slider({ min: 0, max: 1, step: 0.05, value: s.get('pressureAmount'), format: (v) => `${Math.round(v * 100)} %`, onInput: (v) => s.set('pressureAmount', v) }), t('set.pressureAmountHint')),
    field(t('set.pressure'), slider({ min: 0, max: 1, step: 0.05, value: s.get('sensitivity'), format: (v) => `${Math.round(v * 100)} %`, onInput: (v) => s.set('sensitivity', v) }), t('set.pressureHint')),
  ];
  const paintPressure = () => {
    const on = s.get('pressureWidth');
    for (const f of pressureFields) {
      f.classList.toggle('off', !on);
      f.querySelector('input')!.disabled = !on;
    }
  };
  paintPressure();
  const smoothing = (v: number) => (v <= 0.2 ? t('set.weak') : v >= 0.8 ? t('set.strong') : `${Math.round(v * 100)} %`);

  const section = (title: string, group: HTMLElement, foot?: string) =>
    h('section', null, h('h3', null, title), group, foot ? h('div.group-foot', null, foot) : null);
  const group = (...kids: HTMLElement[]) => h('div.group', null, kids);

  const body = h(
    'div.settings',
    null,
    section(t('set.appearance'), group(
      row(t('set.theme'), segmented(
        [
          { value: 'auto' as const, label: t('set.themeAuto') },
          { value: 'light' as const, label: t('set.themeLight') },
          { value: 'dark' as const, label: t('set.themeDark') },
        ],
        s.get('theme'),
        (v) => s.set('theme', v),
      )),
      row(t('set.language'), segmented(
        [
          { value: 'auto' as const, label: 'Auto' },
          { value: 'de' as const, label: 'Deutsch' },
          { value: 'en' as const, label: 'English' },
        ],
        s.get('lang'),
        (v) => {
          s.set('lang', v);
          setLang(v);
        },
      )),
    )),
    section(t('set.input'), group(
      row(t('set.finger'), toggle(s.get('fingerDraws'), (v) => s.set('fingerDraws', v)), t('set.fingerHint')),
      row(t('set.mouse'), toggle(s.get('mouseDraws'), (v) => s.set('mouseDraws', v))),
      row(t('set.palm'), toggle(s.get('palmRejection'), (v) => s.set('palmRejection', v)), t('set.palmHint')),
      field(t('set.smoothing'), slider({ min: 0, max: 1, step: 0.05, value: s.get('smoothing'), format: smoothing, onInput: (v) => s.set('smoothing', v) }), t('set.smoothingHint')),
      row(t('set.pressureWidth'), toggle(s.get('pressureWidth'), (v) => { s.set('pressureWidth', v); paintPressure(); }), t('set.pressureWidthHint')),
      ...pressureFields,
      field(t('set.snap'), segmented(
        [
          { value: 'off' as SnapMode, label: t('snap.off') },
          { value: 'hold' as SnapMode, label: t('snap.hold') },
          { value: 'auto' as SnapMode, label: t('snap.auto') },
        ],
        s.get('snap'),
        (v) => s.set('snap', v),
      ), t('snap.hint')),
      row(t('set.lowLatency'), toggle(s.get('lowLatency'), (v) => s.set('lowLatency', v)), t('set.lowLatencyHint')),
    )),
    section(t('set.buttons'), buttons, t('set.buttonsHint')),
    section(t('set.test'), group(pad.el), t('set.testHint')),
    section(t('set.save'), group(
      row(t('set.autosave'), toggle(s.get('autosave'), (v) => s.set('autosave', v)), t('set.autosaveHint')),
    )),
    h('section.about', null,
      h('img', { src: 'icon.svg', alt: '', width: 56, height: 56, draggable: false }),
      h('div.about-name', null, 'Scribo'),
      h('p.set-hint', null, t('set.version', { v: app.host.appVersion })),
      h('p.set-hint', null, t('set.privacy')),
    ),
  );
  await sheet({ title: t('set.title'), body, buttons: [{ label: t('set.done'), value: true, primary: true }], cancelValue: true, wide: true });
  pad.dispose();
}

export async function showShortcuts(): Promise<void> {
  const mac = /Mac/.test(navigator.platform);
  const c = mac ? '⌘' : 'Ctrl';
  const group = (title: string, rows: [string, string][]) =>
    h('section', null, h('h3', null, title), h('dl.keys', null, rows.map(([k, d]) => [h('dt', null, h('kbd', null, k)), h('dd', null, d)]).flat()));
  const body = h('div.shortcuts', null,
    group(t('sc.file'), [[`${c}+O`, t('sc.open')], [`${c}+S`, t('sc.save')], [`${c}+⇧+S`, t('sc.saveAs')], [`${c}+P`, t('sc.print')], [`${c}+N`, t('sc.new')], [`${c}+W`, t('sc.close')]]),
    group(t('sc.edit'), [[`${c}+Z`, t('sc.undo')], [`${c}+Y`, t('sc.redo')], [`${c}+C / X / V`, t('sc.copy')], [`${c}+D`, t('sc.dup')], ['Entf', t('sc.del')], [`${c}+A`, t('sc.all')], ['← ↑ → ↓', t('sc.nudge')]]),
    group(t('sc.tools'), (['v', 'p', 'h', 'e', 'l', 't', 's', 'n'] as const).map((k) => [k.toUpperCase(), t(`sc.tools.${k}`)] as [string, string])),
    group(t('sc.view'), [[`${c}+ / ${c}−`, t('sc.zoom')], [`${c}+0 / 1 / 2`, t('sc.fit')], [`${c}+F`, t('sc.find')], [`${c}+B`, t('sc.sidebar')], ['Space', t('sc.pan')], ['F11', t('sc.full')]]),
  );
  await sheet({ title: t('sc.title'), body, buttons: [{ label: t('set.done'), value: true, primary: true }], cancelValue: true, wide: true });
}
