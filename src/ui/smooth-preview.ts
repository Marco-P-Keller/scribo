import { outlineOf, outlinePath } from '../core/ink';
import { smoothStroke, type SmoothOptions } from '../core/smooth';
import { h } from './dom';
import { addStrings, t } from './i18n';

addStrings(
  { 'smooth.off': 'Aus', 'smooth.weak': 'Leicht', 'smooth.medium': 'Mittel', 'smooth.strong': 'Stark' },
  { 'smooth.off': 'Off', 'smooth.weak': 'Light', 'smooth.medium': 'Medium', 'smooth.strong': 'Strong' },
);

/** Smoothing strength as a word plus percent: "Aus", "Leicht · 25 %", … */
export function smoothingLabel(v: number): string {
  if (v <= 0) return t('smooth.off');
  const word = v < 0.375 ? t('smooth.weak') : v < 0.7 ? t('smooth.medium') : t('smooth.strong');
  return `${word} · ${Math.round(v * 100)} %`;
}

type Pt = [number, number];

/** Handwriting with loops of two sizes, a zigzag with sharp corners and a long underline. */
function sample(): Pt[][] {
  const loops: Pt[] = [];
  for (let t = Math.PI; t <= Math.PI * 9; t += 0.02) {
    const r = 9.5 + 3.5 * Math.cos(t / 2);
    loops.push([3.3 * t - 0.75 * r * Math.sin(t), -r * Math.cos(t) - r + 26]);
  }
  const zig: Pt[] = [[104, 12], [110, 26], [116, 12], [122, 26], [128, 12]].map(([x, y]) => [x + 8, y]);
  const under: Pt[] = [[2, 34], [70, 33], [140, 32.5]];
  return [loops, zig, under];
}

/** Dense polyline in canvas pixels. */
function densify(pts: Pt[], f: number, ox: number, oy: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const n = Math.max(1, Math.ceil((Math.hypot(bx - ax, by - ay) * f) / 0.1));
    for (let j = 0; j < n; j++) out.push([ox + (ax + ((bx - ax) * j) / n) * f, oy + (ay + ((by - ay) * j) / n) * f]);
  }
  const [lx, ly] = pts[pts.length - 1];
  out.push([ox + lx * f, oy + ly * f]);
  return out;
}

/**
 * What a real pen reports for a dense line: samples every 0.5–1.4 px (closer in tight turns),
 * fine jitter, a slow tremor and a small hook where the tip touches down. Seeded, so moving
 * the slider only changes the smoothing.
 */
function penSamples(line: Pt[], seed: number): number[] {
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());
  const out: number[] = [];
  let ph = rnd() * 6;
  for (let i = 0; i < line.length; ) {
    const a = line[Math.max(0, i - 25)];
    const b = line[i];
    const c = line[Math.min(line.length - 1, i + 25)];
    const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1];
    const l = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    const turn = l ? Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / l))) : 0;
    const step = (0.5 + rnd() * 0.9) * (1 - 0.7 * Math.min(1, turn / 1.2));
    ph += step * 0.3;
    out.push(
      b[0] + gauss() * 0.42 + 0.38 * Math.sin(ph) + 0.2 * Math.sin(ph * 2.3 + 1),
      b[1] + gauss() * 0.42 + 0.38 * Math.cos(ph * 1.3) + 0.2 * Math.sin(ph * 1.7 + 2),
      0.5,
    );
    i += Math.max(1, Math.round(step / 0.1));
  }
  const [lx, ly] = line[line.length - 1];
  out.push(lx, ly, 0.5);
  out[0] += 1.6;
  out[1] -= 1.2;
  out[3] += 0.7;
  out[4] -= 0.5;
  return out;
}

/** A sheet of paper that shows the current smoothing on a sample of shaky handwriting. */
export function smoothPreview(opts: () => Omit<SmoothOptions, 'unit'>): { el: HTMLElement; paint: () => void } {
  const canvas = h('canvas.pad.smooth-demo');
  const ctx = canvas.getContext('2d')!;
  let strokes: number[][] = [];
  let size = '';
  const paint = () => {
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (!cw || !ch) return;
    if (size !== `${cw}x${ch}x${dpr}`) {
      size = `${cw}x${ch}x${dpr}`;
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
      // the sample spans 2..148 × 0..36 units
      const f = Math.min((cw - 32) / 146, (ch - 24) / 36);
      const ox = (cw - 146 * f) / 2 - 2 * f;
      const oy = (ch - 36 * f) / 2;
      strokes = sample().map((pts, i) => penSamples(densify(pts, f, ox, oy), 1234 + i * 77));
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const o = { ...opts(), unit: 1 };
    ctx.fillStyle = 'rgba(17, 17, 17, 0.9)';
    for (const raw of strokes) ctx.fill(outlinePath(outlineOf(smoothStroke(raw, o), { w: 2.4, v: 2 })));
  };
  return { el: canvas, paint };
}
