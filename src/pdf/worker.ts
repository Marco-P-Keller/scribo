/// <reference lib="webworker" />
import { buildPdf, createBlank, restructure } from './build';
import type { BlankTemplate, SaveRequest, StructureOp } from './build';

// All heavy pdf-lib work runs here so that saving a 200 page script never
// freezes the pen.

export interface WorkerRequest {
  id: number;
  method: 'build' | 'restructure' | 'create';
  args: unknown[];
}

export type WorkerResponse =
  | { id: number; ok: true; result: Uint8Array }
  | { id: number; ok: false; error: string; code?: 'encrypted' };

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const { id, method, args } = ev.data;
  try {
    let result: Uint8Array;
    if (method === 'build') result = await buildPdf(args[0] as SaveRequest);
    else if (method === 'create') result = await createBlank(args[0] as number, args[1] as number, args[2] as BlankTemplate, args[3] as number);
    else result = await restructure(args[0] as Uint8Array, args[1] as StructureOp[]);
    const res: WorkerResponse = { id, ok: true, result };
    (self as unknown as Worker).postMessage(res, [result.buffer]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const res: WorkerResponse = { id, ok: false, error: msg, code: /encrypted/i.test(msg) ? 'encrypted' : undefined };
    (self as unknown as Worker).postMessage(res);
  }
};
