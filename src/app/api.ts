import type { AppHost } from '../host';
import type { Viewer } from '../viewer/viewer';
import type { Editor } from './editor';
import type { DocSession } from './session';
import type { StructureOp } from '../pdf/build';

export type SidebarTab = 'pages' | 'outline' | 'search' | 'notes';

/** What UI components may ask of the application. */
export interface AppApi {
  readonly host: AppHost;
  readonly viewer: Viewer;
  readonly editor: Editor;
  readonly session: DocSession | null;
  openDialog(): void;
  save(): Promise<void>;
  saveAs(): Promise<void>;
  exportCopy(flatten: boolean): Promise<void>;
  print(): Promise<void>;
  toggleSidebar(tab?: SidebarTab): void;
  showSettings(): void;
  showShortcuts(): void;
  insertBlankPage(): void;
  newNotebook(): void;
  applyPageOps(label: string, ops: StructureOp[] | ((s: DocSession) => StructureOp[])): Promise<void>;
  gotoDestination(dest: unknown): Promise<void>;
  toggleFullscreen(): void;
  toast(message: string, kind?: 'info' | 'error'): void;
  newWindow(): void;
  close(): void;
}
