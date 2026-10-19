/**
 * Turns raw pen pressure into a calm stroke width: the user decides how much pressure
 * matters, short spikes are smoothed away, and strokes start and end round instead of
 * as needle tips (a pen touches down and lifts off with almost no pressure).
 * The result is stored in the stroke, so screen and exported PDF look the same.
 */
export class PressureFilter {
  private v = -1;

  /** `amount` 0 = constant width, 1 = full pressure range */
  constructor(private amount: number) {}

  next(p: number): number {
    const target = 0.5 + (p - 0.5) * this.amount;
    // start near the nominal width so the first millimetre is not a hairline
    if (this.v < 0) this.v = 0.5 + (target - 0.5) * 0.35;
    else this.v += (target - this.v) * 0.3;
    return this.v;
  }
}

/**
 * The tip lifts gradually, which thins the last samples. Keep them at least as wide as
 * the stroke was just before (x, y, p triples; returns a new array).
 */
export function roundEnd(p: number[]): number[] {
  const n = p.length / 3;
  if (n < 4) return p;
  const tail = Math.min(6, Math.floor(n / 3));
  const ref = p[(n - 1 - tail) * 3 + 2];
  const out = p.slice();
  for (let i = n - tail; i < n; i++) out[i * 3 + 2] = Math.max(out[i * 3 + 2], ref);
  return out;
}
