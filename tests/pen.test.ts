import { describe, expect, it } from 'vitest';
import { PressureFilter, roundEnd } from '../src/core/pressure';
import { inkOutline } from '../src/core/ink';
import { penTouching } from '../src/input/pen';
import type { InkObj } from '../src/core/types';

describe('pen contact', () => {
  it('counts the tip, a side-button contact and an eraser contact as touching', () => {
    expect(penTouching({ buttons: 1, pressure: 0.4 })).toBe(true);
    expect(penTouching({ buttons: 3, pressure: 0.4 })).toBe(true);
    // Windows: tip down with the side button held reports only the second button
    expect(penTouching({ buttons: 2, pressure: 0.4 })).toBe(true);
    // eraser button / eraser end: bit 32 instead of bit 1
    expect(penTouching({ buttons: 32, pressure: 0.3 })).toBe(true);
  });

  it('treats hovering with a button held as not touching', () => {
    expect(penTouching({ buttons: 0, pressure: 0 })).toBe(false);
    expect(penTouching({ buttons: 2, pressure: 0 })).toBe(false);
    expect(penTouching({ buttons: 32, pressure: 0 })).toBe(false);
  });
});

describe('pressure filter', () => {
  it('starts near the nominal width even when the pen lands with almost no pressure', () => {
    const f = new PressureFilter(1);
    expect(f.next(0.02)).toBeGreaterThan(0.3);
  });

  it('limits the pressure range by the chosen amount', () => {
    const none = new PressureFilter(0);
    for (let i = 0; i < 30; i++) expect(none.next(i % 2 ? 1 : 0)).toBeCloseTo(0.5, 6);
    const half = new PressureFilter(0.5);
    let v = 0;
    for (let i = 0; i < 60; i++) v = half.next(1);
    expect(v).toBeCloseTo(0.75, 2);
  });

  it('smooths a single spike', () => {
    const f = new PressureFilter(1);
    for (let i = 0; i < 20; i++) f.next(0.5);
    expect(f.next(1)).toBeLessThan(0.7);
  });

  it('keeps the end of a stroke as wide as the stroke just before the lift', () => {
    const p: number[] = [];
    const pressures = [0.5, 0.55, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.5, 0.35, 0.2, 0.08];
    pressures.forEach((q, i) => p.push(i * 2, 0, q));
    const out = roundEnd(p);
    const last = out[out.length - 1];
    expect(last).toBeGreaterThanOrEqual(0.6 - 1e-9);
    expect(out.slice(0, 6)).toEqual(p.slice(0, 6));
  });
});

describe('ink nib', () => {
  it('ends round instead of in a needle tip', () => {
    const pts: number[] = [];
    for (let i = 0; i <= 40; i++) pts.push(i * 2, 0, 0.5);
    const o: InkObj = { id: 'a', t: 'ink', c: '#000', w: 4, p: pts };
    const outline = inkOutline(o);
    // a round cap reaches about one radius past the last sample; a taper ends at the sample
    expect(Math.max(...outline.map(([x]) => x))).toBeGreaterThan(81.5);
    expect(Math.min(...outline.map(([x]) => x))).toBeLessThan(-1.5);
  });
});
