import { h } from './dom';
import type { Child } from './dom';
import { icon } from './icons';
import type { IconName } from './icons';

export interface PopoverOptions {
  anchor: HTMLElement | DOMRect;
  placement?: 'bottom' | 'top' | 'right' | 'left';
  align?: 'center' | 'start' | 'end';
  offset?: number;
  className?: string;
  /** don't close when the pointer goes down on the anchor (it toggles itself) */
  keepOnAnchor?: boolean;
  onClose?: () => void;
}

let current: Popover | null = null;

/** Floating panel anchored to an element: Apple-style popover with arrow, spring-in and light dismiss. */
export class Popover {
  readonly el = h('div.popover');
  private arrow = h('div.popover-arrow');
  private closed = false;
  private onDown = (e: PointerEvent) => {
    const t = e.target as Node;
    if (this.el.contains(t)) return;
    if (this.opts.keepOnAnchor !== false && this.opts.anchor instanceof HTMLElement && this.opts.anchor.contains(t)) return;
    // a popover opened from inside this one (nested) is not "outside"
    if ((t as HTMLElement).closest?.('.popover')) return;
    this.close();
  };
  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && current === this) {
      e.stopPropagation();
      this.close();
    }
  };

  constructor(readonly content: HTMLElement, private opts: PopoverOptions) {
    if (opts.className) this.el.classList.add(...opts.className.split(' '));
    this.el.append(this.arrow, content);
  }

  open(): this {
    current?.close();
    current = this;
    document.body.append(this.el);
    this.position();
    requestAnimationFrame(() => this.el.classList.add('show'));
    document.addEventListener('pointerdown', this.onDown, true);
    document.addEventListener('keydown', this.onKey, true);
    window.addEventListener('resize', this.reposition);
    return this;
  }

  private reposition = () => this.position();

  position(): void {
    const { anchor } = this.opts;
    const a = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor;
    const pref = this.opts.placement ?? 'bottom';
    const gap = (this.opts.offset ?? 10) + 4;
    const el = this.el;
    el.style.left = '0px';
    el.style.top = '0px';
    const pw = el.offsetWidth;
    const ph = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let placement = pref;
    const fits = (p: typeof pref) =>
      p === 'bottom' ? a.bottom + gap + ph < vh - 8 : p === 'top' ? a.top - gap - ph > 8 : p === 'right' ? a.right + gap + pw < vw - 8 : a.left - gap - pw > 8;
    if (!fits(placement)) {
      const alt = placement === 'bottom' ? 'top' : placement === 'top' ? 'bottom' : placement === 'right' ? 'left' : 'right';
      if (fits(alt)) placement = alt;
    }
    let x: number;
    let y: number;
    const align = this.opts.align ?? 'center';
    if (placement === 'bottom' || placement === 'top') {
      x = align === 'start' ? a.left : align === 'end' ? a.right - pw : a.left + a.width / 2 - pw / 2;
      y = placement === 'bottom' ? a.bottom + gap : a.top - gap - ph;
    } else {
      y = align === 'start' ? a.top : align === 'end' ? a.bottom - ph : a.top + a.height / 2 - ph / 2;
      x = placement === 'right' ? a.right + gap : a.left - gap - pw;
    }
    x = Math.max(8, Math.min(vw - pw - 8, x));
    y = Math.max(8, Math.min(vh - ph - 8, y));
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
    el.dataset.placement = placement;
    // arrow points at the anchor centre
    if (placement === 'bottom' || placement === 'top') {
      const ax = Math.max(18, Math.min(pw - 18, a.left + a.width / 2 - x));
      this.arrow.style.left = `${ax}px`;
      this.arrow.style.top = '';
    } else {
      const ay = Math.max(18, Math.min(ph - 18, a.top + a.height / 2 - y));
      this.arrow.style.top = `${ay}px`;
      this.arrow.style.left = '';
    }
    el.style.transformOrigin =
      placement === 'bottom' ? `${a.left + a.width / 2 - x}px 0` : placement === 'top' ? `${a.left + a.width / 2 - x}px 100%` : placement === 'right' ? '0 50%' : '100% 50%';
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (current === this) current = null;
    document.removeEventListener('pointerdown', this.onDown, true);
    document.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('resize', this.reposition);
    this.el.classList.remove('show');
    this.el.classList.add('hide');
    setTimeout(() => this.el.remove(), 160);
    this.opts.onClose?.();
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  static closeAll(): void {
    current?.close();
  }

  static get active(): Popover | null {
    return current;
  }
}

// ── menus ──────────────────────────────────────────────────────────────────

export type MenuItem =
  | { label: string; icon?: IconName; shortcut?: string; onClick: () => void; disabled?: boolean; danger?: boolean; checked?: boolean }
  | { separator: true }
  | { heading: string };

export function menuContent(items: MenuItem[], close: () => void): HTMLElement {
  const list = h('div.menu', { role: 'menu' });
  for (const it of items) {
    if ('separator' in it) list.append(h('div.menu-sep'));
    else if ('heading' in it) list.append(h('div.menu-heading', null, it.heading));
    else {
      const b = h(
        'button.menu-item',
        {
          role: 'menuitem',
          disabled: it.disabled,
          class: it.danger ? 'danger' : '',
          onclick: () => {
            close();
            it.onClick();
          },
        },
        h('span.menu-icon', null, it.checked ? icon('check', 16) : it.icon ? icon(it.icon, 16) : null),
        h('span.menu-label', null, it.label),
        it.shortcut ? h('span.menu-shortcut', null, it.shortcut) : null,
      );
      list.append(b);
    }
  }
  return list;
}

export function showMenu(anchor: HTMLElement | DOMRect, items: MenuItem[], opts: Partial<PopoverOptions> = {}): Popover {
  let pop: Popover;
  const content = menuContent(items, () => pop.close());
  pop = new Popover(content, { anchor, className: 'menu-popover', ...opts });
  return pop.open();
}

export function field(label: string, control: Child, hint?: string): HTMLElement {
  return h('div.field', null, h('div.field-label', null, label), control, hint ? h('div.field-hint', null, hint) : null);
}

/** iOS-style segmented control. */
export function segmented<T extends string | number>(
  options: { value: T; label: Child; title?: string }[],
  value: T,
  onChange: (v: T) => void,
): HTMLElement {
  const root = h('div.segmented', { role: 'radiogroup' });
  const buttons = options.map((o) =>
    h(
      'button.seg',
      {
        role: 'radio',
        title: o.title,
        'aria-checked': String(o.value === value),
        onclick: () => {
          buttons.forEach((b, i) => b.setAttribute('aria-checked', String(options[i].value === o.value)));
          onChange(o.value);
        },
      },
      o.label,
    ),
  );
  root.append(...buttons);
  return root;
}

/** Styled range input with live value read-out. */
export function slider(opts: {
  min: number;
  max: number;
  step: number;
  value: number;
  format?: (v: number) => string;
  onInput: (v: number) => void;
  onChange?: (v: number) => void;
}): HTMLElement {
  const out = h('span.slider-value', null, (opts.format ?? String)(opts.value));
  const input = h('input.slider', {
    type: 'range',
    min: opts.min,
    max: opts.max,
    step: opts.step,
    value: String(opts.value),
  });
  const paint = () => {
    const pct = ((Number(input.value) - opts.min) / (opts.max - opts.min)) * 100;
    input.style.setProperty('--pct', `${pct}%`);
  };
  paint();
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = (opts.format ?? String)(v);
    paint();
    opts.onInput(v);
  });
  input.addEventListener('change', () => opts.onChange?.(Number(input.value)));
  return h('div.slider-row', null, input, out);
}

export function toggle(value: boolean, onChange: (v: boolean) => void): HTMLElement {
  const b = h('button.switch', {
    role: 'switch',
    'aria-checked': String(value),
    onclick: () => {
      const next = b.getAttribute('aria-checked') !== 'true';
      b.setAttribute('aria-checked', String(next));
      onChange(next);
    },
  }, h('span.knob'));
  return b;
}
