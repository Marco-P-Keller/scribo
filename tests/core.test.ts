import { describe, expect, it } from 'vitest';
import { AnnotationModel } from '../src/core/model';
import { decodeNotes, encodeNotes } from '../src/core/serialize';
import { bounds, hitTest, objectsInPolygon, splitInk, transformObj } from '../src/core/objects';
import { decimate, inkOutline, pressureCurve } from '../src/core/ink';
import { rotateM, scaleM, translateM, mul, invert, apply } from '../src/core/geometry';
import type { AnyObj, InkObj, ShapeObj } from '../src/core/types';

const ink = (id: string, pts: [number, number][], w = 2): InkObj => ({ id, t: 'ink', c: '#112233', w, p: pts.flatMap(([x, y]) => [x, y, 0.5]) });
const line = (id: string): ShapeObj => ({ id, t: 'shape', k: 'line', p: [0, 0, 100, 0], c: '#ff0000', w: 2 });

describe('AnnotationModel history', () => {
  it('undoes and redoes add / replace / remove in order', async () => {
    const m = new AnnotationModel(2);
    const a = ink('a', [[0, 0], [10, 10]]);
    const b = line('b');
    m.add('add', 0, a, b);
    expect(m.pages[0].map((o) => o.id)).toEqual(['a', 'b']);
    m.replace('move', 0, [{ ...a, c: '#ffffff' }]);
    m.remove('del', 0, ['a']);
    expect(m.pages[0].map((o) => o.id)).toEqual(['b']);
    await m.undo();
    expect(m.pages[0].map((o) => o.id)).toEqual(['a', 'b']); // restored at its old z position
    expect((m.pages[0][0] as InkObj).c).toBe('#ffffff');
    await m.undo();
    expect((m.pages[0][0] as InkObj).c).toBe('#112233');
    await m.undo();
    expect(m.pages[0]).toHaveLength(0);
    await m.redo();
    await m.redo();
    expect(m.pages[0].map((o) => o.id)).toEqual(['a', 'b']);
  });

  it('tracks the dirty state against the saved point', async () => {
    const m = new AnnotationModel(1);
    expect(m.dirty).toBe(false);
    m.add('x', 0, line('l'));
    expect(m.dirty).toBe(true);
    m.markClean();
    expect(m.dirty).toBe(false);
    await m.undo();
    expect(m.dirty).toBe(true);
    await m.redo();
    expect(m.dirty).toBe(false);
    await m.undo();
    m.add('y', 0, line('k')); // new branch: the saved state is unreachable
    expect(m.dirty).toBe(true);
    await m.undo();
    expect(m.dirty).toBe(true);
  });
});

describe('serialization', () => {
  const objs: AnyObj[] = [
    ink('i', [[1.234, 2.345], [10.5, 20.25], [30, 40]]),
    { ...line('s'), dash: 1, fill: undefined },
    { id: 't', t: 'text', x: 10, y: 20, w: 200, s: 'Grüße ∑', f: 'serif', z: 12, c: '#000000', b: 1 },
    { id: 'n', t: 'note', x: 5, y: 6, s: 'hi', c: '#ffd60a' },
    { id: 'm', t: 'mark', k: 'hl', q: [1, 2, 3, 4], c: '#ffe14d' },
  ];

  it('round-trips every object type', () => {
    const bytes = encodeNotes([objs], [{ w: 595, h: 842 }]);
    const back = decodeNotes(bytes)!;
    expect(back.pages['0'].objs).toHaveLength(5);
    const i = back.pages['0'].objs[0] as InkObj;
    expect(i.p[0]).toBeCloseTo(1.23, 2);
    expect(i.p[3]).toBeCloseTo(10.5, 2);
    expect((back.pages['0'].objs[2] as { s: string }).s).toBe('Grüße ∑');
  });

  it('rejects hostile or malformed input instead of trusting it', () => {
    const evil = new TextEncoder().encode(
      JSON.stringify({
        v: 1, app: 'Scribo', pageCount: 1,
        pages: {
          '0': {
            w: 1, h: 1,
            objs: [
              { id: 'x', t: 'ink', c: 'red; background:url(//evil)', w: 9999, d: [0, 0, 0, 1, 1, 1] },
              { id: 'y', t: 'img', x: 0, y: 0, w: 10, h: 10, src: 'https://evil.example/x.png' },
              { id: 'z', t: 'shape', k: 'rect', p: [1, 2, 3], c: '#000000', w: 1 },
              { id: 'q', t: 'script' },
              'junk',
            ],
          },
        },
      }),
    );
    const back = decodeNotes(evil)!;
    expect(back.pages['0'].objs).toHaveLength(1);
    const o = back.pages['0'].objs[0] as InkObj;
    expect(o.c).toBe('#000000');
    expect(o.w).toBeLessThanOrEqual(200);
    expect(decodeNotes(new TextEncoder().encode('not json'))).toBeNull();
    expect(decodeNotes(new TextEncoder().encode('{"app":"other","v":1}'))).toBeNull();
  });
});

describe('objects', () => {
  it('hit-tests ink by distance to the stroke', () => {
    const o = ink('a', [[0, 0], [100, 0]], 4);
    expect(hitTest(o, 50, 1, 2)).toBe(true);
    expect(hitTest(o, 50, 12, 2)).toBe(false);
  });

  it('transforms ink and scales its width', () => {
    const o = ink('a', [[0, 0], [10, 0]], 2);
    const t = transformObj(o, scaleM(2, 2)) as InkObj;
    expect(t.p[3]).toBeCloseTo(20);
    expect(t.w).toBeCloseTo(4);
    const r = transformObj(o, rotateM(Math.PI / 2)) as InkObj;
    expect(r.p[3]).toBeCloseTo(0, 5);
    expect(r.p[4]).toBeCloseTo(10, 5);
    expect(bounds(t).w).toBeGreaterThan(20);
  });

  it('keeps ellipse axes consistent under affine maps', () => {
    const e: ShapeObj = { id: 'e', t: 'shape', k: 'ellipse', p: [10, 10, 5, 0, 0, 3], c: '#000000', w: 1 };
    const t = transformObj(e, mul(translateM(5, 5), scaleM(2, 1))) as ShapeObj;
    expect(t.p.slice(0, 2)).toEqual([25, 15]);
    expect(t.p[2]).toBeCloseTo(10);
    expect(t.p[5]).toBeCloseTo(3);
  });

  it('lasso selects objects that are mostly inside', () => {
    const a = ink('in', [[10, 10], [20, 20], [30, 30]]);
    const b = ink('out', [[200, 200], [210, 210]]);
    const poly = [0, 0, 100, 0, 100, 100, 0, 100];
    expect(objectsInPolygon([a, b], poly).map((o) => o.id)).toEqual(['in']);
  });

  it('point erasing cuts a stroke in two', () => {
    const pts: [number, number][] = Array.from({ length: 21 }, (_, i) => [i * 5, 0]);
    const pieces = splitInk(ink('a', pts), 50, 0, 6)!;
    expect(pieces).toHaveLength(2);
    expect(pieces[0].p[pieces[0].p.length - 3]).toBeLessThan(50);
    expect(pieces[1].p[0]).toBeGreaterThan(50);
    expect(splitInk(ink('a', pts), 50, 40, 6)).toBeNull();
  });
});

describe('ink helpers', () => {
  it('maps pressure through the sensitivity curve monotonically', () => {
    expect(pressureCurve(0.5, 0.5)).toBeCloseTo(0.5);
    expect(pressureCurve(0.3, 1)).toBeGreaterThan(pressureCurve(0.3, 0));
    expect(pressureCurve(2)).toBe(1);
  });

  it('decimates dense input but keeps the end points', () => {
    const p: number[] = [];
    for (let i = 0; i < 200; i++) p.push(i * 0.05, 0, 0.5);
    const d = decimate(p, 0.5);
    expect(d.length).toBeLessThan(p.length / 3);
    expect(d[d.length - 3]).toBeCloseTo(199 * 0.05);
  });

  it('produces an outline for a stroke', () => {
    expect(inkOutline(ink('a', [[0, 0], [10, 5], [20, 0]], 3)).length).toBeGreaterThan(6);
  });
});

describe('geometry', () => {
  it('inverts matrices', () => {
    const m = mul(translateM(3, 4), rotateM(0.7));
    const q = apply(invert(m)!, ...Object.values(apply(m, 5, 6)) as [number, number]);
    expect(q.x).toBeCloseTo(5);
    expect(q.y).toBeCloseTo(6);
  });
});
