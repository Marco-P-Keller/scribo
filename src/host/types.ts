import type { FileRef } from '../app/session';

export interface HostFile extends FileRef {
  data: Uint8Array;
}

export type HostErrorCode = 'modified' | 'denied' | 'failed' | 'cancelled';

export class HostError extends Error {
  constructor(readonly code: HostErrorCode, message?: string) {
    super(message ?? code);
  }
}

export interface UpdateInfo {
  state: 'available' | 'downloaded' | 'error';
  version?: string;
}

/**
 * Everything the app needs from its environment. Implemented by the Electron
 * preload bridge (real files, native dialogs) and by the browser build
 * (File System Access API).
 */
export interface Host {
  readonly kind: 'electron' | 'web';
  readonly platform: 'win' | 'mac' | 'linux' | 'other';
  readonly appVersion: string;

  pickFiles(): Promise<HostFile[]>;
  /** Electron only: read a path chosen by drag & drop, recents or the command line. */
  readFromPath?(path: string): Promise<HostFile>;
  pathOfFile?(file: File): string | undefined;
  /** Replace the contents of an existing file (Ctrl+S). Throws HostError('modified') if it changed on disk. */
  write(ref: FileRef, data: Uint8Array, opts?: { overwriteModified?: boolean }): Promise<FileRef>;
  /** Ask where to save; does not write anything. */
  pickSavePath(suggestedName: string): Promise<FileRef | null>;
  writeNew(ref: FileRef, data: Uint8Array): Promise<FileRef>;

  setDocumentState(s: { name: string; dirty: boolean }): void;
  /** Files opened from outside (second instance, "open with", dock). */
  onOpenRequest(cb: (files: HostFile[]) => void): void;
  /** The window is about to close; resolve true to allow it. */
  onCloseRequest(cb: () => Promise<boolean>): void;
  closeWindow(): void;
  newWindow?(path?: string): void;
  setTheme?(dark: boolean): void;
  /** Show the system print dialog for the current (print-styled) page. */
  print?(): Promise<boolean>;
  openExternal(url: string): void;
  showInFolder?(path: string): void;
  onUpdate?(cb: (u: UpdateInfo) => void): void;
  installUpdate?(): void;
  /** Titlebar geometry for the custom window chrome. */
  readonly chrome: { overlay: boolean; leftInset: number; rightInset: number };

  confirmDiscard(name: string): Promise<'save' | 'discard' | 'cancel'>;
  fullscreen(on: boolean): void;
}
