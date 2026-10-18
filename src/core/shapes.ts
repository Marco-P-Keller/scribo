import type { ShapeObj } from './types';

/** The two barbs of an arrow head at the end of a line, as [x0,y0,tipx,tipy,x1,y1]. */
export function arrowHead(p: number[], w: number): number[] {
  const n = p.length;
  const tx = p[n - 2];
  const ty = p[n - 1];
  const fx = p[n - 4];
  const fy = p[n - 3];
  const ang = Math.atan2(ty - fy, tx - fx);
  const len = Math.max(10, w * 4.5);
  const spread = (28 * Math.PI) / 180;
  return [
    tx - len * Math.cos(ang - spread), ty - len * Math.sin(ang - spread),
    tx, ty,
    tx - len * Math.cos(ang + spread), ty - len * Math.sin(ang + spread),
  ];
}

export function dashPattern(o: Pick<ShapeObj, 'dash' | 'w'>): number[] {
  if (o.dash === 1) return [o.w * 3.2, o.w * 2.4];
  if (o.dash === 2) return [0.01, o.w * 2.2];
  return [];
}

/** Build a rectangle shape from two opposite corners. */
export function rectPoints(x0: number, y0: number, x1: number, y1: number): number[] {
  return [x0, y0, x1, y0, x1, y1, x0, y1];
}

/** Ellipse inscribed in the box given by two corners. */
export function ellipsePoints(x0: number, y0: number, x1: number, y1: number): number[] {
  return [(x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0) / 2, 0, 0, Math.abs(y1 - y0) / 2];
}
