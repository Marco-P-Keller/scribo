// Generates a lecture-style sample PDF used by tests and screenshots.
//   node scripts/make-sample.mjs [outfile]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] ?? join(root, 'tests/fixtures/vorlesung.pdf');
mkdirSync(dirname(out), { recursive: true });

const doc = await PDFDocument.create();
doc.registerFontkit(fontkit);
doc.setTitle('Analysis I – Vorlesung 7');
doc.setAuthor('Prof. Dr. A. Beispiel');
const sans = await doc.embedFont(readFileSync(join(root, 'public/fonts/sans-400Regular.ttf')));
const bold = await doc.embedFont(readFileSync(join(root, 'public/fonts/sans-700Bold.ttf')));
const serif = await doc.embedFont(readFileSync(join(root, 'public/fonts/serif-400Regular.ttf')));
const serifI = await doc.embedFont(readFileSync(join(root, 'public/fonts/serif-400Regular_Italic.ttf')));

const ink = rgb(0.1, 0.1, 0.12);
const grey = rgb(0.42, 0.42, 0.46);
const blue = rgb(0.04, 0.42, 0.9);

function wrap(text, font, size, width) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(t, size) > width && line) {
      lines.push(line);
      line = w;
    } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

function paragraph(page, text, x, y, width, { font, size = 11.5, lead = 1.5, color = ink } = {}) {
  // the serif face lacks some maths symbols; those paragraphs use Inter
  font ??= /[∈ℝ→≤≥ξ]/.test(text) ? sans : serif;
  for (const l of wrap(text, font, size, width)) {
    page.drawText(l, { x, y, size, font, color });
    y -= size * lead;
  }
  return y;
}

// ── page 1: title ────────────────────────────────────────────────────────
{
  const p = doc.addPage([595.28, 841.89]);
  p.drawText('Analysis I', { x: 64, y: 700, size: 44, font: bold, color: ink });
  p.drawText('Vorlesung 7 · Differenzierbarkeit', { x: 64, y: 664, size: 20, font: sans, color: blue });
  p.drawLine({ start: { x: 64, y: 640 }, end: { x: 531, y: 640 }, thickness: 0.8, color: rgb(0.85, 0.85, 0.88) });
  p.drawText('Wintersemester 2026/27', { x: 64, y: 610, size: 12, font: sans, color: grey });
  p.drawText('Prof. Dr. A. Beispiel · Institut für Mathematik', { x: 64, y: 592, size: 12, font: sans, color: grey });
  let y = 520;
  y = paragraph(
    p,
    'In dieser Vorlesung lernen wir, wie man die Änderungsrate einer Funktion präzise beschreibt. Der Begriff der Ableitung ist das zentrale Werkzeug der Analysis: Er verbindet Geometrie (Tangente), Physik (Geschwindigkeit) und Algebra (lineare Approximation).',
    64, y, 467,
  );
  y -= 14;
  p.drawText('Inhalt', { x: 64, y, size: 15, font: bold, color: ink });
  y -= 24;
  for (const [n, t] of [['7.1', 'Der Differenzenquotient'], ['7.2', 'Die Ableitung als Grenzwert'], ['7.3', 'Ableitungsregeln'], ['7.4', 'Mittelwertsatz'], ['7.5', 'Aufgaben']]) {
    p.drawText(n, { x: 64, y, size: 12, font: bold, color: blue });
    p.drawText(t, { x: 100, y, size: 12, font: sans, color: ink });
    y -= 22;
  }
}

// ── page 2: definition + plot ────────────────────────────────────────────
{
  const p = doc.addPage([595.28, 841.89]);
  p.drawText('7.1  Der Differenzenquotient', { x: 56, y: 770, size: 20, font: bold, color: ink });
  let y = 735;
  y = paragraph(
    p,
    'Sei f : I → ℝ eine Funktion auf einem offenen Intervall I und x₀ ∈ I. Die Sekante durch die Punkte (x₀, f(x₀)) und (x, f(x)) hat die Steigung',
    56, y, 483,
  );
  p.drawText('f(x) − f(x₀)', { x: 236, y: y - 16, size: 15, font: serifI, color: ink });
  p.drawLine({ start: { x: 232, y: y - 20 }, end: { x: 322, y: y - 20 }, thickness: 0.7, color: ink });
  p.drawText('x − x₀', { x: 262, y: y - 36, size: 15, font: serifI, color: ink });
  p.drawText('=: Δf/Δx', { x: 340, y: y - 24, size: 13, font: serif, color: grey });
  y -= 70;

  p.drawRectangle({ x: 56, y: y - 78, width: 483, height: 90, color: rgb(0.93, 0.96, 1), borderColor: rgb(0.7, 0.82, 0.98), borderWidth: 0.8 });
  p.drawText('Definition 7.2', { x: 70, y: y - 8, size: 12, font: bold, color: blue });
  paragraph(
    p,
    'f heißt in x₀ differenzierbar, wenn der Grenzwert lim (x → x₀) [f(x) − f(x₀)] / (x − x₀) existiert. Dieser Grenzwert heißt Ableitung f′(x₀).',
    70, y - 28, 455, { size: 11.5 },
  );
  y -= 120;

  // plot: f(x) = x² / 2 with a tangent and a secant
  const ox = 110, oy = y - 190, sx = 38, sy = 38;
  p.drawLine({ start: { x: ox - 20, y: oy }, end: { x: ox + 290, y: oy }, thickness: 0.8, color: ink });
  p.drawLine({ start: { x: ox, y: oy - 20 }, end: { x: ox, y: oy + 170 }, thickness: 0.8, color: ink });
  p.drawText('x', { x: ox + 294, y: oy - 4, size: 11, font: serifI, color: ink });
  p.drawText('y', { x: ox - 4, y: oy + 175, size: 11, font: serifI, color: ink });
  let prev = null;
  for (let i = 0; i <= 120; i++) {
    const x = -0.4 + (i / 120) * 7.2;
    const pt = { x: ox + x * sx, y: oy + ((x * x) / 4) * sy };
    if (prev && pt.y < oy + 165) p.drawLine({ start: prev, end: pt, thickness: 1.6, color: blue });
    prev = pt;
  }
  const a = 2, b = 5;
  const P = (x) => ({ x: ox + x * sx, y: oy + ((x * x) / 4) * sy });
  p.drawLine({ start: { x: P(a).x - 60, y: P(a).y - 60 * (a / 2) * (sy / sx) }, end: { x: P(a).x + 110, y: P(a).y + 110 * (a / 2) * (sy / sx) }, thickness: 1, color: rgb(0.9, 0.2, 0.17) });
  p.drawLine({ start: P(a), end: P(b), thickness: 1, color: rgb(0.1, 0.62, 0.3), dashArray: [4, 3] });
  for (const x of [a, b]) p.drawCircle({ x: P(x).x, y: P(x).y, size: 3, color: ink });
  p.drawText('x₀', { x: P(a).x - 4, y: oy - 16, size: 11, font: serifI, color: ink });
  p.drawText('x', { x: P(b).x - 3, y: oy - 16, size: 11, font: serifI, color: ink });
  p.drawText('Tangente', { x: P(a).x + 70, y: P(a).y + 52, size: 10, font: sans, color: rgb(0.9, 0.2, 0.17) });
  p.drawText('Sekante', { x: P(b).x - 70, y: P(b).y - 22, size: 10, font: sans, color: rgb(0.1, 0.62, 0.3) });
  p.drawText('Abb. 1: Sekante und Tangente an f(x) = x²/4', { x: 140, y: oy - 42, size: 10, font: sans, color: grey });
}

// ── page 3: landscape slide ──────────────────────────────────────────────
{
  const p = doc.addPage([960, 540]);
  p.drawRectangle({ x: 0, y: 0, width: 960, height: 540, color: rgb(0.985, 0.985, 0.99) });
  p.drawRectangle({ x: 0, y: 0, width: 14, height: 540, color: blue });
  p.drawText('Ableitungsregeln', { x: 70, y: 450, size: 38, font: bold, color: ink });
  const rows = [
    ['Summenregel', '(f + g)′ = f′ + g′'],
    ['Produktregel', '(f · g)′ = f′ · g + f · g′'],
    ['Quotientenregel', '(f / g)′ = (f′ · g − f · g′) / g²'],
    ['Kettenregel', '(f(g(x)))′ = f′(g(x)) · g′(x)'],
  ];
  rows.forEach(([n, f], i) => {
    const y = 370 - i * 70;
    p.drawText(n, { x: 70, y, size: 20, font: sans, color: grey });
    p.drawText(f, { x: 330, y, size: 24, font: serifI, color: ink });
    p.drawLine({ start: { x: 70, y: y - 22 }, end: { x: 890, y: y - 22 }, thickness: 0.6, color: rgb(0.88, 0.88, 0.91) });
  });
  p.drawText('Beispiel: (x² · sin x)′ = 2x · sin x + x² · cos x', { x: 70, y: 70, size: 18, font: serif, color: ink });
}

// ── page 4: text ────────────────────────────────────────────────────────
{
  const p = doc.addPage([595.28, 841.89]);
  p.drawText('7.4  Mittelwertsatz', { x: 56, y: 770, size: 20, font: bold, color: ink });
  let y = 735;
  const texts = [
    'Satz (Mittelwertsatz der Differentialrechnung). Sei f : [a, b] → ℝ stetig und auf (a, b) differenzierbar. Dann existiert ein ξ ∈ (a, b) mit f′(ξ) = (f(b) − f(a)) / (b − a).',
    'Anschaulich bedeutet das: Zwischen zwei Punkten des Graphen gibt es mindestens eine Stelle, an der die Tangente parallel zur Sekante verläuft. Der Beweis führt den Satz auf den Satz von Rolle zurück, indem man die Hilfsfunktion g(x) = f(x) − f(a) − [(f(b) − f(a)) / (b − a)] · (x − a) betrachtet.',
    'Folgerung. Ist f′(x) = 0 für alle x ∈ I, so ist f auf dem Intervall I konstant. Ist f′(x) > 0 für alle x ∈ I, so ist f streng monoton wachsend.',
    'Aufgabe 7.4. Zeigen Sie: Für alle x, y ∈ ℝ gilt |sin x − sin y| ≤ |x − y|. Hinweis: Wenden Sie den Mittelwertsatz auf die Sinusfunktion an.',
  ];
  for (const t of texts) {
    y = paragraph(p, t, 56, y, 483) - 12;
  }
}

writeFileSync(out, await doc.save());
console.log('wrote', out);
