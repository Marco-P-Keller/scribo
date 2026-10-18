// Layout constants shared by the canvas renderer and the PDF exporter so that
// text sits on the same baseline in the app and in the saved file.

export const LINE_HEIGHT = 1.32;
/** distance from the top of a line box to its baseline, in em */
export const ASCENT = 1.04;
export const TEXT_PAD = 3;

export function lineHeightOf(o: { z: number }): number {
  return o.z * LINE_HEIGHT;
}
