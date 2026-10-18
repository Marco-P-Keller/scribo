// Tiny i18n: strings live next to the UI that uses them and are registered with addStrings().

type Dict = Record<string, string>;
export type Lang = 'de' | 'en';

const dicts: Record<Lang, Dict> = { de: {}, en: {} };
let current: Lang = navigator.language?.toLowerCase().startsWith('de') ? 'de' : 'en';
const listeners = new Set<() => void>();

export function addStrings(de: Dict, en: Dict): void {
  Object.assign(dicts.de, de);
  Object.assign(dicts.en, en);
}

export function setLang(l: Lang | 'auto'): void {
  const next: Lang = l === 'auto' ? (navigator.language?.toLowerCase().startsWith('de') ? 'de' : 'en') : l;
  if (next === current) return;
  current = next;
  document.documentElement.lang = next;
  listeners.forEach((fn) => fn());
}

export function lang(): Lang {
  return current;
}

export function onLangChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function t(key: string, vars?: Record<string, string | number>): string {
  let s = dicts[current][key] ?? dicts.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}
