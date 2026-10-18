import type { AnyObj } from '../core/types';
import { decodeNotes, encodeNotes } from '../core/serialize';
import { uid } from '../core/objects';

// Handwriting / shapes copied inside Scribo travel through localStorage (shared by all
// windows of the app); the system clipboard only carries a small marker so that a later
// copy from another program wins over an older Scribo copy.

const KEY = 'scribo.clipboard.v1';
export const MARKER = 'scribo-clip:';

export function writeClip(objs: AnyObj[]): string {
  const id = uid();
  const bytes = encodeNotes([objs], [{ w: 0, h: 0 }]);
  try {
    localStorage.setItem(KEY, JSON.stringify({ id, data: new TextDecoder().decode(bytes) }));
  } catch {
    /* quota: clipboard unavailable */
  }
  return MARKER + id;
}

export function readClip(marker: string): AnyObj[] | null {
  if (!marker.startsWith(MARKER)) return null;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { id: string; data: string } | null;
    if (!raw || raw.id !== marker.slice(MARKER.length)) return null;
    const notes = decodeNotes(new TextEncoder().encode(raw.data));
    return notes?.pages['0']?.objs ?? null;
  } catch {
    return null;
  }
}
