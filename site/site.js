// Language switch, platform detection and "latest version" lookup for the landing page.
const T = {
  de: {
    'nav.features': 'Funktionen', 'nav.download': 'Download',
    'hero.eyebrow': 'Für Windows 11 · Kostenlos · Open Source',
    'hero.title': 'Schreib auf PDFs,<br />als wäre es <span class="ink-word">Papier<svg viewBox="0 0 300 30" preserveAspectRatio="none" aria-hidden="true"><path pathLength="1" d="M6 20 C 60 10, 140 6, 200 12 S 270 22, 294 9" /></svg></span>.',
    'hero.lede': 'Scribo ist der PDF-Editor für handschriftliche Notizen im Studium. Druckempfindliche Tinte, Formerkennung und deine Stifttasten – minimalistisch, schnell und komplett offline.',
    'cta.download': 'Download für Windows', 'cta.try': 'Im Browser ausprobieren',
    'hero.fine': 'Windows 10 / 11 · 64-Bit und ARM64 · kein Konto, kein Tracking',
    'chip.1': 'Druckempfindliche Tinte', 'chip.2': 'Textmarker', 'chip.3': 'Formerkennung', 'chip.4': 'Lasso & Transformieren', 'chip.5': 'Text & Notizen',
    'chip.6': 'Formen & Polygone', 'chip.7': 'Seiten verwalten', 'chip.8': 'Suche & Gliederung', 'chip.9': 'Hell & Dunkel',
    'feat.title': 'Alles, was du zum Lernen brauchst.<br /><span>Nichts, was dich ablenkt.</span>',
    'f1.t': 'Tinte mit Gefühl', 'f1.p': 'Gleichmässig wie ein Fineliner oder, auf Wunsch, druckempfindlich wie ein Füller. Die Glättung nimmt das Zittern, ohne nachzuziehen, und lässt Schleifen und Ecken in Form.',
    'f2.t': 'Formen erkennen sich selbst', 'f2.hint': 'Stift kurz ruhen lassen', 'f2.p': 'Kreis, Ellipse, Rechteck, Dreieck oder Linie: Ruhe kurz mit dem Stift, und deine Skizze rastet sauber ein. Oder sofort beim Absetzen.',
    'f3.t': 'Deine Stifttasten', 'f3.b1': 'Taste 1 · Radieren', 'f3.b2': 'Taste 2 · Lasso', 'f3.p': 'Taste 1 radiert ganze Linien, Taste 2 öffnet das Lasso. Die Belegung ist frei einstellbar, mit Live-Test für deinen Stift.',
    'f4.t': 'Auswählen, kopieren, drehen', 'f4.p': 'Umkreise Handschrift mit dem Lasso und verschiebe, skaliere, drehe, kopiere oder färbe sie um, auch hinüber auf eine andere Seite. Alles mit Rückgängig.',
    'f5.t': 'Favoriten in Reichweite', 'f5.p': 'Deine Lieblingsstifte und Textmarker liegen immer in einer ruhigen Leiste. Ein Tipp wählt, ein zweiter öffnet Farbe, Stärke und Formerkennung. Per Ziehen sortierst du um.',
    'f6.t': 'Strg + S speichert in dieselbe Datei', 'f6.p': 'Wie du es von klassischen PDF-Editoren kennst. Deine Notizen stehen danach in der PDF, sichtbar in jedem Programm und in Scribo jederzeit weiter bearbeitbar.',
    's.title': 'Formen, Text und Notizen, wenn du sie brauchst.',
    's.p': 'Linien, Pfeile, Rechtecke, Ellipsen und Polygone mit Füllfarbe, Deckkraft und Strichart. Textfelder in vier Schriften, Haftnotizen als echte PDF-Kommentare, Bilder aus der Zwischenablage, Textmarker direkt auf markiertem PDF-Text.',
    's.1': 'Leere, linierte, karierte oder gepunktete Seiten einfügen', 's.2': 'Seiten drehen, sortieren, duplizieren und löschen',
    's.3': 'Volltextsuche und Gliederung der PDF', 's.4': 'Zoom per Pinch, Touch-Scrollen, Handballen-Erkennung',
    'dl.title': 'Scribo herunterladen', 'dl.lede': 'Installation ohne Administratorrechte. Updates kommen automatisch von GitHub.',
    'dl.installer': 'Installer', 'dl.portable': 'Portable', 'dl.portableSub': 'Ohne Installation · x64',
    'dl.smart': '<b>Hinweis:</b> Scribo ist noch nicht code-signiert. Windows zeigt beim ersten Start deshalb „Der Computer wurde durch Windows geschützt“. Klicke auf <em>Weitere Informationen</em> und dann auf <em>Trotzdem ausführen</em>.',
    'dl.other': 'Du bist nicht unter Windows? Probiere Scribo direkt im Browser aus (Chrome oder Edge empfohlen).',
    'dl.all': 'Alle Versionen', 'dl.source': 'Quellcode',
    'foot.license': 'MIT-Lizenz', 'foot.privacy': 'Alles bleibt auf deinem Gerät. Keine Konten, kein Tracking.',
    'ver': 'Version {v} · Windows 10 / 11 · 64-Bit und ARM64 · kein Konto, kein Tracking',
  },
  en: {
    'nav.features': 'Features', 'nav.download': 'Download',
    'hero.eyebrow': 'For Windows 11 · Free · Open source',
    'hero.title': 'Write on PDFs<br />like it’s <span class="ink-word">paper<svg viewBox="0 0 300 30" preserveAspectRatio="none" aria-hidden="true"><path pathLength="1" d="M6 20 C 60 10, 140 6, 200 12 S 270 22, 294 9" /></svg></span>.',
    'hero.lede': 'Scribo is the PDF editor for handwritten study notes. Pressure-sensitive ink, shape recognition and your pen buttons – minimal, fast and completely offline.',
    'cta.download': 'Download for Windows', 'cta.try': 'Try it in the browser',
    'hero.fine': 'Windows 10 / 11 · 64-bit and ARM64 · no account, no tracking',
    'chip.1': 'Pressure-sensitive ink', 'chip.2': 'Highlighter', 'chip.3': 'Shape recognition', 'chip.4': 'Lasso & transform', 'chip.5': 'Text & notes',
    'chip.6': 'Shapes & polygons', 'chip.7': 'Page management', 'chip.8': 'Search & outline', 'chip.9': 'Light & dark',
    'feat.title': 'Everything you need to study.<br /><span>Nothing that distracts you.</span>',
    'f1.t': 'Ink with feeling', 'f1.p': 'Even like a fineliner or, if you like, pressure-sensitive like a fountain pen. Smoothing removes the jitter without lagging behind and keeps loops and corners in shape.',
    'f2.t': 'Shapes recognise themselves', 'f2.hint': 'Rest the pen briefly', 'f2.p': 'Circle, ellipse, rectangle, triangle or line: rest the pen for a moment and your sketch snaps clean. Or instantly when you lift.',
    'f3.t': 'Your pen buttons', 'f3.b1': 'Button 1 · Erase', 'f3.b2': 'Button 2 · Lasso', 'f3.p': 'Button 1 erases whole strokes, button 2 opens the lasso. Fully remappable, with a live test for your pen.',
    'f4.t': 'Select, copy, rotate', 'f4.p': 'Circle your handwriting with the lasso, then move, scale, rotate, copy or recolour it, even over to another page. Everything with undo.',
    'f5.t': 'Favourites within reach', 'f5.p': 'Your favourite pens and highlighters live in one calm bar. One tap selects, a second opens colour, thickness and shape recognition. Drag to reorder.',
    'f6.t': 'Ctrl + S saves into the same file', 'f6.p': 'Just like classic PDF editors. Your notes end up inside the PDF, visible in every viewer and always editable again in Scribo.',
    's.title': 'Shapes, text and notes when you need them.',
    's.p': 'Lines, arrows, rectangles, ellipses and polygons with fill colour, opacity and line style. Text boxes in four fonts, sticky notes as real PDF comments, images from the clipboard, highlighter right on selected PDF text.',
    's.1': 'Insert blank, lined, grid or dotted pages', 's.2': 'Rotate, reorder, duplicate and delete pages',
    's.3': 'Full-text search and the PDF outline', 's.4': 'Pinch zoom, touch scrolling, palm rejection',
    'dl.title': 'Download Scribo', 'dl.lede': 'Installs without administrator rights. Updates arrive automatically from GitHub.',
    'dl.installer': 'Installer', 'dl.portable': 'Portable', 'dl.portableSub': 'No installation · x64',
    'dl.smart': '<b>Note:</b> Scribo is not code-signed yet, so Windows shows “Windows protected your PC” on first launch. Click <em>More info</em>, then <em>Run anyway</em>.',
    'dl.other': 'Not on Windows? Try Scribo right in your browser (Chrome or Edge recommended).',
    'dl.all': 'All versions', 'dl.source': 'Source code',
    'foot.license': 'MIT licence', 'foot.privacy': 'Everything stays on your device. No accounts, no tracking.',
    'ver': 'Version {v} · Windows 10 / 11 · 64-bit and ARM64 · no account, no tracking',
  },
};

let lang = (localStorage.getItem('scribo.site.lang') || (navigator.language || 'de').slice(0, 2)) === 'de' ? 'de' : 'en';
let version = null;

function apply() {
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = T[lang][el.dataset.i18n] ?? el.textContent;
  for (const el of document.querySelectorAll('[data-i18n-html]')) el.innerHTML = T[lang][el.dataset.i18nHtml] ?? el.innerHTML;
  document.getElementById('lang').textContent = lang === 'de' ? 'EN' : 'DE';
  if (version) document.getElementById('version-line').textContent = T[lang].ver.replace('{v}', version);
}

document.getElementById('lang').addEventListener('click', () => {
  lang = lang === 'de' ? 'en' : 'de';
  try { localStorage.setItem('scribo.site.lang', lang); } catch { /* private mode */ }
  apply();
});

// Windows on ARM gets the ARM64 installer as the main button
const ua = navigator.userAgent;
const isWindows = /Windows/i.test(ua);
document.getElementById('not-windows').hidden = isWindows;
if (navigator.userAgentData?.getHighEntropyValues) {
  navigator.userAgentData.getHighEntropyValues(['architecture']).then((v) => {
    if (isWindows && v.architecture === 'arm') {
      document.getElementById('cta-main').href = document.getElementById('dl-arm').href;
      document.getElementById('dl-arm').classList.add('primary');
      document.getElementById('dl-x64').classList.remove('primary');
    }
  }).catch(() => {});
}

// show the real latest version if the GitHub API answers
fetch('https://api.github.com/repos/Marco-P-Keller/scribo/releases/latest', { headers: { Accept: 'application/vnd.github+json' } })
  .then((r) => (r.ok ? r.json() : null))
  .then((r) => {
    if (r?.tag_name) {
      version = String(r.tag_name).replace(/^v/, '');
      apply();
    }
  })
  .catch(() => {});

apply();
