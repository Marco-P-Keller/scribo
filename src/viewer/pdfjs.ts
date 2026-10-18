import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export { pdfjsLib };
export type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const rel = (p: string) => new URL(p, document.baseURI).href;

export class PasswordRequired extends Error {
  constructor(readonly wrong: boolean) {
    super(wrong ? 'wrong password' : 'password required');
  }
}

/**
 * Opens a PDF. `data` is copied because pdf.js transfers (and thereby detaches)
 * the buffer it is given – the caller keeps its own bytes for saving.
 */
export async function loadPdf(data: Uint8Array, password?: string) {
  const task = pdfjsLib.getDocument({
    data: data.slice(),
    password,
    cMapUrl: rel('pdfjs/cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: rel('pdfjs/standard_fonts/'),
    wasmUrl: rel('pdfjs/wasm/'),
    iccUrl: rel('pdfjs/iccs/'),
    enableXfa: false,
  });
  // surface "needs password" as a typed error instead of hanging on the callback
  task.onPassword = (_update: (pw: string) => void, reason: number) => {
    // reason: 1 = NEED_PASSWORD, 2 = INCORRECT_PASSWORD
    void task.destroy();
    pending?.(new PasswordRequired(reason === 2));
  };
  let pending: ((e: Error) => void) | null = null;
  const failed = new Promise<never>((_, reject) => {
    pending = reject;
  });
  try {
    const pdf = await Promise.race([task.promise, failed]);
    return pdf;
  } catch (e) {
    if (e instanceof PasswordRequired) throw e;
    if ((e as { name?: string })?.name === 'PasswordException') throw new PasswordRequired((e as { code?: number }).code === 2);
    throw e;
  }
}
