import type { AnyObj, TextObj, NoteObj, ToolId } from '../core/types';
import type { PageView } from '../viewer/pageview';
import type { Viewer } from '../viewer/viewer';
import type { AnnotationModel } from '../core/model';
import type { Selection } from './selection';

/** One sample of a pointer stroke, in page space of the stroke's page. */
export interface Sample {
  x: number;
  y: number;
  /** device pressure after the sensitivity curve, 0..1 */
  p: number;
  t: number;
}

export type PointerKind = 'pen' | 'mouse' | 'touch';

export interface ToolEvent {
  page: PageView | null;
  /** position in page space (pt); meaningless when page is null */
  x: number;
  y: number;
  pressure: number;
  tiltX: number;
  tiltY: number;
  pointerType: PointerKind;
  buttons: number;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  time: number;
  clientX: number;
  clientY: number;
  /** coalesced samples since the last event */
  samples: Sample[];
  /** predicted future samples (latency hiding; never stored) */
  predicted: Sample[];
  raw: PointerEvent;
}

export interface Tool {
  readonly id: ToolId | 'pan';
  readonly cursor: string;
  /** return true to capture the pointer */
  down(e: ToolEvent): boolean;
  move(e: ToolEvent): void;
  up(e: ToolEvent): void;
  cancel(): void;
  /** pointer moving without contact (pen hover / mouse) */
  hover?(e: ToolEvent): void;
  /** radius of the hover ring in css px, or null for none */
  ring?(): number | null;
  activate?(): void;
  deactivate?(): void;
  /** double click / double tap */
  dblclick?(e: ToolEvent): void;
  /** a finger tap (touch never starts strokes unless "draw with finger" is on) */
  tap?(e: ToolEvent): void;
}

/** What tools may use from the application. */
export interface EditorApi {
  viewer: Viewer;
  readonly model: AnnotationModel;
  selection: Selection;
  setTool(id: ToolId): void;
  toast(message: string): void;
  editText(page: PageView, obj: TextObj | null, at: { x: number; y: number; w?: number }): void;
  editNote(page: PageView, obj: NoteObj | null, at: { x: number; y: number }): void;
  openLink(url: string): void;
  gotoDestination(dest: unknown): void;
  /** live lookup of objects on a page that are currently *not* lifted */
  objectsOf(page: PageView): AnyObj[];
}
