import type { Preset, ToolId } from '../core/types';
import { uid } from '../core/objects';
import { settings } from './settings';

// The favourites bar *is* the pen box: selecting a favourite selects its tool, editing
// colour / width edits that favourite in place (like the Apple tool picker).

export function favorites(): Preset[] {
  return settings.get('favorites');
}

export function currentPreset(): Preset {
  const favs = favorites();
  return favs.find((p) => p.id === settings.get('activePreset')) ?? favs[0];
}

export function selectPreset(id: string): void {
  const p = favorites().find((x) => x.id === id);
  if (!p) return;
  settings.set('activePreset', id);
  settings.set('tool', p.tool);
}

export function updatePreset(id: string, partial: Partial<Preset>): void {
  settings.set(
    'favorites',
    favorites().map((p) => (p.id === id ? { ...p, ...partial } : p)),
  );
}

export function addPreset(base: Omit<Preset, 'id'>): Preset {
  const p: Preset = { ...base, id: uid() };
  settings.set('favorites', [...favorites(), p]);
  selectPreset(p.id);
  return p;
}

export function removePreset(id: string): void {
  const favs = favorites();
  if (favs.length <= 1) return;
  const next = favs.filter((p) => p.id !== id);
  settings.set('favorites', next);
  if (settings.get('activePreset') === id) selectPreset(next[0].id);
}

export function movePreset(id: string, toIndex: number): void {
  const favs = [...favorites()];
  const from = favs.findIndex((p) => p.id === id);
  if (from < 0) return;
  const [p] = favs.splice(from, 1);
  favs.splice(Math.max(0, Math.min(favs.length, toIndex)), 0, p);
  settings.set('favorites', favs);
}

/** Choose the most recently used favourite of the given kind (keyboard shortcuts). */
export function selectToolKind(tool: 'pen' | 'highlighter'): void {
  const cur = currentPreset();
  if (cur.tool === tool) return;
  const p = favorites().find((x) => x.tool === tool);
  if (p) selectPreset(p.id);
  else {
    addPreset(tool === 'pen' ? { tool, color: '#111111', width: 1.6 } : { tool, color: '#ffe14d', width: 14 });
  }
}

export function activeToolId(): ToolId {
  return settings.get('tool');
}
