import type { FileRef } from '../app/session';
import { HostError } from './types';
import type { Host, HostFile } from './types';

// Browser host: File System Access API where available (Chrome / Edge), plain
// download fallback elsewhere. Used by the GitHub Pages demo and for tests.

type FsHandle = {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(d: BufferSource): Promise<void>; close(): Promise<void> }>;
  requestPermission?(o: { mode: 'readwrite' }): Promise<PermissionState>;
};

type W = Window & {
  showOpenFilePicker?: (o: unknown) => Promise<FsHandle[]>;
  showSaveFilePicker?: (o: unknown) => Promise<FsHandle>;
};

const w = window as W;

async function fromHandle(h: FsHandle): Promise<HostFile> {
  const f = await h.getFile();
  return { name: f.name, data: new Uint8Array(await f.arrayBuffer()), handle: h, mtimeMs: f.lastModified };
}

function download(name: string, data: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function createWebHost(): Host {
  let closeCb: (() => Promise<boolean>) | null = null;
  let dirty = false;
  const platform: Host['platform'] = /Win/i.test(navigator.platform) ? 'win' : /Mac/i.test(navigator.platform) ? 'mac' : 'other';

  window.addEventListener('beforeunload', (e) => {
    if (dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  return {
    kind: 'web',
    platform,
    appVersion: __APP_VERSION__,
    chrome: { overlay: false, leftInset: 0, rightInset: 0 },

    async pickFiles() {
      if (w.showOpenFilePicker) {
        try {
          const hs = await w.showOpenFilePicker({
            multiple: true,
            types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }],
          });
          return Promise.all(hs.map(fromHandle));
        } catch (e) {
          if ((e as Error).name === 'AbortError') return [];
          throw e;
        }
      }
      return new Promise<HostFile[]>((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/pdf,.pdf';
        input.multiple = true;
        input.onchange = async () => {
          const files = [...(input.files ?? [])];
          resolve(await Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) }))));
        };
        input.oncancel = () => resolve([]);
        input.click();
      });
    },

    async write(ref: FileRef, data: Uint8Array) {
      const h = ref.handle as FsHandle | undefined;
      if (!h) {
        download(ref.name, data);
        return ref;
      }
      try {
        if ((await h.requestPermission?.({ mode: 'readwrite' })) === 'denied') throw new HostError('denied');
        const ws = await h.createWritable();
        await ws.write(data as BufferSource);
        await ws.close();
        const f = await h.getFile();
        return { ...ref, mtimeMs: f.lastModified };
      } catch (e) {
        if (e instanceof HostError) throw e;
        throw new HostError('failed', (e as Error).message);
      }
    },

    async pickSavePath(suggestedName: string) {
      if (!w.showSaveFilePicker) return { name: suggestedName };
      try {
        const h = await w.showSaveFilePicker({
          suggestedName,
          types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }],
        });
        return { name: h.name, handle: h };
      } catch (e) {
        if ((e as Error).name === 'AbortError') return null;
        throw e;
      }
    },

    async writeNew(ref, data) {
      return this.write(ref, data);
    },

    setDocumentState(s) {
      dirty = s.dirty;
      document.title = `${s.dirty ? '• ' : ''}${s.name} – Scribo`;
    },
    onOpenRequest() {
      /* files arrive through drag & drop only */
    },
    onCloseRequest(cb) {
      closeCb = cb;
    },
    closeWindow() {
      void closeCb;
      window.close();
    },
    openExternal(url: string) {
      window.open(url, '_blank', 'noopener');
    },
    async confirmDiscard() {
      return window.confirm('Änderungen verwerfen?') ? 'discard' : 'cancel';
    },
    fullscreen(on: boolean) {
      if (on) void document.documentElement.requestFullscreen?.();
      else void document.exitFullscreen?.();
    },
  };
}
