import { HostError } from './types';
import type { FileRef } from '../app/session';
import type { Host, HostFile, UpdateInfo } from './types';

/** Contract between the sandboxed preload script (electron/preload.cjs) and the renderer. */
export interface NativeFile {
  name: string;
  path: string;
  data: Uint8Array;
  mtimeMs: number;
}

export interface ScriboBridge {
  readonly platform: 'win32' | 'darwin' | 'linux';
  readonly version: string;
  readonly e2e?: boolean;
  pickFiles(): Promise<NativeFile[]>;
  readFile(path: string): Promise<NativeFile>;
  pathForFile(file: File): string;
  writeFile(path: string, data: Uint8Array, opts?: { expectMtimeMs?: number; force?: boolean }): Promise<{ mtimeMs: number }>;
  pickSavePath(suggestedName: string): Promise<{ path: string; name: string } | null>;
  setDocumentState(s: { name: string; dirty: boolean }): void;
  takeLaunchPaths(): Promise<string[]>;
  onOpenPaths(cb: (paths: string[]) => void): void;
  onCloseRequested(cb: () => void): void;
  confirmDiscard(name: string): Promise<'save' | 'discard' | 'cancel'>;
  closeWindow(): void;
  newWindow(path?: string): void;
  openExternal(url: string): void;
  showInFolder(path: string): void;
  setFullscreen(on: boolean): void;
  onUpdate(cb: (u: UpdateInfo) => void): void;
  installUpdate(): void;
  addRecent(path: string): void;
  setTheme(dark: boolean): void;
  /** Test hook: absolute path of a file to open on launch (set by e2e tests only). */
  onFullscreen(cb: (on: boolean) => void): void;
}

const toHostFile = (f: NativeFile): HostFile => ({ name: f.name, path: f.path, data: f.data, mtimeMs: f.mtimeMs });

export function createElectronHost(b: ScriboBridge): Host & { launchPaths(): Promise<string[]> } {
  const platform = b.platform === 'win32' ? 'win' : b.platform === 'darwin' ? 'mac' : 'linux';
  let closeCb: (() => Promise<boolean>) | null = null;
  const openCbs: ((files: HostFile[]) => void)[] = [];

  b.onOpenPaths(async (paths) => {
    const files: HostFile[] = [];
    for (const p of paths) {
      try {
        files.push(toHostFile(await b.readFile(p)));
      } catch {
        /* unreadable file: skip */
      }
    }
    if (files.length) openCbs.forEach((cb) => cb(files));
  });
  b.onCloseRequested(async () => {
    const allow = closeCb ? await closeCb() : true;
    if (allow) b.closeWindow();
  });

  const overlay = platform !== 'mac';
  return {
    kind: 'electron',
    platform,
    appVersion: b.version,
    chrome: { overlay, leftInset: platform === 'mac' ? 78 : 0, rightInset: platform === 'win' ? 140 : 0 },

    async pickFiles() {
      return (await b.pickFiles()).map(toHostFile);
    },
    async readFromPath(path: string) {
      return toHostFile(await b.readFile(path));
    },
    pathOfFile(file: File) {
      try {
        return b.pathForFile(file) || undefined;
      } catch {
        return undefined;
      }
    },
    async write(ref: FileRef, data: Uint8Array, opts) {
      if (!ref.path) throw new HostError('failed', 'no path');
      try {
        const { mtimeMs } = await b.writeFile(ref.path, data, {
          expectMtimeMs: opts?.overwriteModified ? undefined : ref.mtimeMs,
          force: opts?.overwriteModified,
        });
        b.addRecent(ref.path);
        return { ...ref, mtimeMs };
      } catch (e) {
        const msg = (e as Error).message ?? '';
        if (msg.includes('E_MODIFIED')) throw new HostError('modified');
        if (/EACCES|EPERM|EBUSY/.test(msg)) throw new HostError('denied', msg);
        throw new HostError('failed', msg);
      }
    },
    async pickSavePath(suggestedName: string) {
      const r = await b.pickSavePath(suggestedName);
      return r ? { name: r.name, path: r.path } : null;
    },
    async writeNew(ref: FileRef, data: Uint8Array) {
      return this.write(ref, data, { overwriteModified: true });
    },
    setDocumentState: (s) => b.setDocumentState(s),
    onOpenRequest: (cb) => void openCbs.push(cb),
    onCloseRequest: (cb) => void (closeCb = cb),
    closeWindow: () => b.closeWindow(),
    newWindow: (path) => b.newWindow(path),
    setTheme: (dark) => b.setTheme(dark),
    openExternal: (url) => b.openExternal(url),
    showInFolder: (p) => b.showInFolder(p),
    onUpdate: (cb) => b.onUpdate(cb),
    installUpdate: () => b.installUpdate(),
    confirmDiscard: (name) => b.confirmDiscard(name),
    fullscreen: (on) => b.setFullscreen(on),
    launchPaths: () => b.takeLaunchPaths(),
  };
}
