import { h } from './dom';
import type { Child } from './dom';
import { addStrings, t } from './i18n';

addStrings(
  { 'dlg.ok': 'OK', 'dlg.cancel': 'Abbrechen', 'dlg.password.title': 'Passwort erforderlich', 'dlg.password.wrong': 'Falsches Passwort – bitte erneut versuchen.', 'dlg.password.msg': 'Dieses PDF ist geschützt. Gib das Passwort zum Öffnen ein.', 'dlg.open': 'Öffnen' },
  { 'dlg.ok': 'OK', 'dlg.cancel': 'Cancel', 'dlg.password.title': 'Password required', 'dlg.password.wrong': 'Wrong password – please try again.', 'dlg.password.msg': 'This PDF is protected. Enter the password to open it.', 'dlg.open': 'Open' },
);

export interface DialogButton<T> {
  label: string;
  value: T;
  primary?: boolean;
  danger?: boolean;
}

/** Apple-style sheet: centred card over a dimmed, blurred backdrop. */
export function sheet<T>(opts: {
  title: string;
  body?: Child;
  buttons: DialogButton<T>[];
  cancelValue: T;
  wide?: boolean;
  onMount?: (card: HTMLElement) => void;
}): Promise<T> {
  return new Promise((resolve) => {
    const previous = document.activeElement as HTMLElement | null;
    const finish = (v: T) => {
      document.removeEventListener('keydown', onKey, true);
      backdrop.classList.remove('show');
      setTimeout(() => backdrop.remove(), 180);
      previous?.focus?.();
      resolve(v);
    };
    const btns = opts.buttons.map((b) =>
      h('button.btn', { class: b.primary ? 'primary' : b.danger ? 'danger' : '', onclick: () => finish(b.value) }, b.label),
    );
    const card = h(
      'div.sheet',
      { role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title, class: opts.wide ? 'wide' : '' },
      h('h2.sheet-title', null, opts.title),
      opts.body ? h('div.sheet-body', null, opts.body) : null,
      h('div.sheet-actions', null, btns),
    );
    const backdrop = h('div.backdrop', { onpointerdown: (e: Event) => { if (e.target === backdrop) finish(opts.cancelValue); } }, card);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        finish(opts.cancelValue);
      } else if (e.key === 'Enter' && !(e.target as HTMLElement).closest('textarea')) {
        const primary = opts.buttons.find((b) => b.primary);
        if (primary) {
          e.preventDefault();
          e.stopPropagation();
          finish(primary.value);
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    document.body.append(backdrop);
    requestAnimationFrame(() => {
      backdrop.classList.add('show');
      (card.querySelector('input,textarea,.btn.primary') as HTMLElement | null)?.focus();
    });
    opts.onMount?.(card);
  });
}

export function confirmDialog(opts: { title: string; message?: string; confirm: string; cancel?: string; danger?: boolean }): Promise<boolean> {
  return sheet<boolean>({
    title: opts.title,
    body: opts.message ? h('p', null, opts.message) : null,
    buttons: [
      { label: opts.cancel ?? t('dlg.cancel'), value: false },
      { label: opts.confirm, value: true, primary: !opts.danger, danger: opts.danger },
    ],
    cancelValue: false,
  });
}

export async function passwordDialog(wrong: boolean): Promise<string | null> {
  const input = h('input.text-input', { type: 'password', autocomplete: 'off', 'aria-label': t('dlg.password.title') });
  const ok = await sheet<boolean>({
    title: t('dlg.password.title'),
    body: [h('p', null, wrong ? t('dlg.password.wrong') : t('dlg.password.msg')), input],
    buttons: [
      { label: t('dlg.cancel'), value: false },
      { label: t('dlg.open'), value: true, primary: true },
    ],
    cancelValue: false,
  });
  return ok ? input.value : null;
}

// ── toasts ──────────────────────────────────────────────────────────────

let host: HTMLElement | null = null;

export function toast(message: string, kind: 'info' | 'error' = 'info', ms = 3200): void {
  if (!host) {
    host = h('div.toasts', { role: 'status', 'aria-live': 'polite' });
    document.body.append(host);
  }
  const el = h('div.toast', { class: kind }, message);
  host.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 220);
  }, ms);
}
