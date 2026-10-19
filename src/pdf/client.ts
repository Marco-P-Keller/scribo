import type { BlankTemplate, SaveRequest, StructureOp } from './build';
import type { WorkerRequest, WorkerResponse } from './worker';

export class PdfError extends Error {
  constructor(message: string, readonly code?: 'encrypted') {
    super(message);
  }
}

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: Uint8Array) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
    const r = ev.data;
    const p = pending.get(r.id);
    if (!p) return;
    pending.delete(r.id);
    if (r.ok) p.resolve(r.result);
    else p.reject(new PdfError(r.error, r.code));
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new PdfError(e.message || 'Worker-Fehler'));
    pending.clear();
    worker = null;
  };
  return worker;
}

function call(method: WorkerRequest['method'], args: unknown[]): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    // never transfer: the caller keeps its copy of the document bytes
    getWorker().postMessage({ id, method, args } satisfies WorkerRequest);
  });
}

export function buildPdf(req: SaveRequest): Promise<Uint8Array> {
  return call('build', [req]);
}

export function restructurePdf(bytes: Uint8Array, ops: StructureOp[]): Promise<Uint8Array> {
  return call('restructure', [bytes, ops]);
}

export function createBlankPdf(w: number, h: number, template: BlankTemplate, count = 1): Promise<Uint8Array> {
  return call('create', [w, h, template, count]);
}
