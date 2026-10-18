export interface Recent {
  name: string;
  path?: string;
  opened: number;
  thumb?: string;
}

const KEY = 'scribo.recents.v1';
const MAX = 12;

export function recents(): Recent[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]') as Recent[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function save(list: Recent[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    // thumbnails can exceed the quota: retry without them
    try {
      localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX).map((r) => ({ ...r, thumb: undefined }))));
    } catch {
      /* give up silently */
    }
  }
}

export function addRecent(r: Recent): void {
  const key = r.path ?? r.name;
  save([r, ...recents().filter((x) => (x.path ?? x.name) !== key)]);
}

export function removeRecent(r: Recent): void {
  const key = r.path ?? r.name;
  save(recents().filter((x) => (x.path ?? x.name) !== key));
}

export function clearRecents(): void {
  save([]);
}
