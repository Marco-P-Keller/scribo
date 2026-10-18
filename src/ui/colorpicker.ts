import { h } from './dom';
import { icon } from './icons';
import { hexToHsv, hsvToHex, clamp } from '../core/geometry';
import { addStrings, t } from './i18n';

addStrings(
  { 'color.more': 'Weitere Farben', 'color.back': 'Zurück', 'color.hex': 'Hex', 'color.none': 'Keine Füllung' },
  { 'color.more': 'More colors', 'color.back': 'Back', 'color.hex': 'Hex', 'color.none': 'No fill' },
);

const RECENT_KEY = 'scribo.recentColors';

function recentColors(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function remember(c: string): void {
  try {
    const list = [c, ...recentColors().filter((x) => x !== c)].slice(0, 6);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export interface ColorPanelOptions {
  colors: string[];
  value: string | null;
  onPick: (color: string | null) => void;
  /** show a "no colour" swatch first (fills) */
  allowNone?: boolean;
}

export function colorPanel(opts: ColorPanelOptions): HTMLElement {
  const root = h('div.color-panel');
  let value = opts.value;

  const grid = h('div.swatches');
  const render = () => {
    grid.replaceChildren();
    if (opts.allowNone) {
      grid.append(
        h('button.swatch.none', {
          title: t('color.none'),
          'aria-pressed': String(value === null),
          onclick: () => {
            value = null;
            opts.onPick(null);
            render();
          },
        }),
      );
    }
    for (const c of opts.colors) grid.append(swatch(c));
    const extra = recentColors().filter((c) => !opts.colors.includes(c));
    for (const c of extra.slice(0, 2)) grid.append(swatch(c));
    grid.append(
      h('button.swatch.custom', {
        title: t('color.more'),
        'aria-label': t('color.more'),
        onclick: () => showCustom(),
      }),
    );
  };
  const swatch = (c: string) =>
    h('button.swatch', {
      style: `--c:${c}`,
      title: c,
      'aria-label': c,
      'aria-pressed': String(!!value && value.toLowerCase() === c.toLowerCase()),
      onclick: () => {
        value = c;
        opts.onPick(c);
        render();
      },
    });

  const showCustom = () => {
    root.replaceChildren(customPicker(value ?? opts.colors[0], (c) => {
      value = c;
      opts.onPick(c);
    }, () => {
      root.replaceChildren(grid);
      render();
    }));
  };

  render();
  root.append(grid);
  return root;
}

function customPicker(start: string, onChange: (c: string) => void, back: () => void): HTMLElement {
  let [hue, sat, val] = hexToHsv(start);
  const W = 216;
  const H = 132;
  const cv = h('canvas.sv', { width: W * 2, height: H * 2, style: `width:${W}px;height:${H}px` });
  const ctx = cv.getContext('2d')!;
  const knob = h('div.sv-knob');
  const hueInput = h('input.hue', { type: 'range', min: '0', max: '359', step: '1', value: String(Math.round(hue)) });
  const hex = h('input.hex', { type: 'text', value: start.toUpperCase(), maxLength: 7, spellcheck: false });
  const chip = h('div.chip');

  const drawSV = () => {
    ctx.save();
    ctx.scale(2, 2);
    ctx.fillStyle = hsvToHex(hue, 1, 1);
    ctx.fillRect(0, 0, W, H);
    const g1 = ctx.createLinearGradient(0, 0, W, 0);
    g1.addColorStop(0, '#fff');
    g1.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, W, H);
    const g2 = ctx.createLinearGradient(0, 0, 0, H);
    g2.addColorStop(0, 'rgba(0,0,0,0)');
    g2.addColorStop(1, '#000');
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  };
  const sync = (emit: boolean) => {
    const c = hsvToHex(hue, sat, val);
    knob.style.left = `${sat * W}px`;
    knob.style.top = `${(1 - val) * H}px`;
    knob.style.background = c;
    chip.style.background = c;
    hex.value = c.toUpperCase();
    hueInput.style.setProperty('--hue', String(hue));
    if (emit) {
      onChange(c);
      remember(c);
    }
  };
  const pick = (e: PointerEvent) => {
    const r = cv.getBoundingClientRect();
    sat = clamp((e.clientX - r.left) / r.width, 0, 1);
    val = 1 - clamp((e.clientY - r.top) / r.height, 0, 1);
    sync(true);
  };
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    pick(e);
    const move = (ev: PointerEvent) => pick(ev);
    const up = () => {
      cv.removeEventListener('pointermove', move);
      cv.removeEventListener('pointerup', up);
    };
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up);
  });
  hueInput.addEventListener('input', () => {
    hue = Number(hueInput.value);
    drawSV();
    sync(true);
  });
  hex.addEventListener('change', () => {
    const v = hex.value.trim().replace(/^#?/, '#');
    if (/^#[0-9a-fA-F]{6}$/.test(v)) {
      [hue, sat, val] = hexToHsv(v);
      hueInput.value = String(Math.round(hue));
      drawSV();
      sync(true);
    } else sync(false);
  });

  drawSV();
  sync(false);
  return h(
    'div.custom-color',
    null,
    h('button.back', { onclick: back }, icon('left', 14), t('color.back')),
    h('div.sv-wrap', null, cv, knob),
    hueInput,
    h('div.hex-row', null, chip, hex),
  );
}
