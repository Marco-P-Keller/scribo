import { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, net, protocol, session, shell } from 'electron';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { open, rename, rm, stat, readFile } from 'node:fs/promises';
import { basename, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';

const require = createRequire(import.meta.url);
const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '..');
const TEST = !!process.env.SCRIBO_TEST;
const DEV_URL = process.env.SCRIBO_DEV_URL;
const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';
const de = () => app.getLocale().toLowerCase().startsWith('de');

if (process.env.SCRIBO_USER_DATA) app.setPath('userData', process.env.SCRIBO_USER_DATA);
if (isWin) app.setAppUserModelId('com.marcokeller.scribo');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

// ── window bookkeeping ────────────────────────────────────────────────────

/** @type {Map<number, {win: BrowserWindow, dirty: boolean, name: string, launch: string[], force: boolean}>} */
const windows = new Map();
const pendingPaths = [];

const stateFile = () => join(app.getPath('userData'), 'window-state.json');
function loadBounds() {
  try {
    return JSON.parse(readFileSync(stateFile(), 'utf8'));
  } catch {
    return {};
  }
}
function saveBounds(win) {
  if (win.isMinimized() || win.isFullScreen()) return;
  try {
    writeFileSync(stateFile(), JSON.stringify({ ...win.getNormalBounds(), max: win.isMaximized() }));
  } catch {
    /* not critical */
  }
}

const TITLE_H = 52;
const overlayFor = (dark) => ({ color: '#00000000', symbolColor: dark ? '#f5f5f7' : '#1d1d1f', height: TITLE_H });

function createWindow(paths = []) {
  const saved = loadBounds();
  const dark = nativeTheme.shouldUseDarkColors;
  const win = new BrowserWindow({
    width: saved.width ?? 1280,
    height: saved.height ?? 860,
    x: saved.x,
    y: saved.y,
    minWidth: 720,
    minHeight: 520,
    show: false,
    title: 'Scribo',
    backgroundColor: dark ? '#1e1e21' : '#f6f6f8',
    autoHideMenuBar: true,
    ...(isMac
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 18 } }
      : { titleBarStyle: 'hidden', titleBarOverlay: overlayFor(dark) }),
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      devTools: !app.isPackaged || !!process.env.SCRIBO_DEVTOOLS,
      backgroundThrottling: false,
    },
  });
  const rec = { win, dirty: false, name: '', launch: paths, force: false };
  windows.set(win.webContents.id, rec);
  if (saved.max) win.maximize();
  win.webContents.setVisualZoomLevelLimits(1, 1);

  win.once('ready-to-show', () => {
    // tests show the window without taking focus: hidden windows don't run animation frames
    if (TEST) win.showInactive();
    else win.show();
  });
  win.on('resize', () => saveBounds(win));
  win.on('move', () => saveBounds(win));
  win.on('enter-full-screen', () => win.webContents.send('fullscreen', true));
  win.on('leave-full-screen', () => win.webContents.send('fullscreen', false));
  win.on('close', (e) => {
    if (rec.dirty && !rec.force) {
      e.preventDefault();
      win.webContents.send('close-requested');
    }
  });
  win.on('closed', () => windows.delete(win.webContents.id));
  win.webContents.on('render-process-gone', () => {
    if (!win.isDestroyed()) win.reload();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://') && !(DEV_URL && url.startsWith(DEV_URL))) e.preventDefault();
  });
  void win.loadURL(DEV_URL ?? 'app://scribo/index.html');
  return win;
}

/** Windows without a document take the file; otherwise a new window opens. */
function openPaths(paths) {
  const list = paths.filter((p) => extname(p).toLowerCase() === '.pdf' && existsSync(p));
  if (!list.length) return;
  const focus = BrowserWindow.getFocusedWindow();
  const free = [...windows.values()].find((w) => !w.name && w.win === focus) ?? [...windows.values()].find((w) => !w.name);
  const [first, ...rest] = list;
  if (free) {
    free.win.webContents.send('open-paths', [first]);
    if (free.win.isMinimized()) free.win.restore();
    free.win.focus();
  } else createWindow([first]);
  for (const p of rest) createWindow([p]);
}

function pathsFromArgv(argv) {
  return argv.slice(app.isPackaged ? 1 : 2).filter((a) => !a.startsWith('-') && extname(a).toLowerCase() === '.pdf');
}

// ── single instance, file association ──────────────────────────────────────

if (!TEST && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const paths = pathsFromArgv(argv).map((p) => resolve(p));
    if (paths.length) openPaths(paths);
    else {
      const w = BrowserWindow.getAllWindows()[0];
      if (w) {
        if (w.isMinimized()) w.restore();
        w.focus();
      }
    }
  });
  app.on('open-file', (e, p) => {
    e.preventDefault();
    if (app.isReady()) openPaths([p]);
    else pendingPaths.push(p);
  });

  app.whenReady().then(async () => {
    registerAppProtocol();
    session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(['clipboard-read', 'clipboard-sanitized-write', 'fullscreen'].includes(perm)));
    buildMenu();
    const initial = [...pendingPaths, ...pathsFromArgv(process.argv).map((p) => resolve(p))];
    if (process.env.SCRIBO_OPEN) initial.push(process.env.SCRIBO_OPEN);
    if (initial.length) for (const p of initial) createWindow([p]);
    else createWindow();
    app.on('activate', () => {
      if (!BrowserWindow.getAllWindows().length) createWindow();
    });
    setupUpdates();
  });
  app.on('window-all-closed', () => {
    if (!isMac) app.quit();
  });
}

// ── app:// protocol ────────────────────────────────────────────────────────

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream',
  '.ico': 'image/x-icon', '.icc': 'application/vnd.iccprofile',
};

function registerAppProtocol() {
  const dist = join(root, 'dist');
  protocol.handle('app', async (req) => {
    const url = new URL(req.url);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = normalize(join(dist, rel));
    if (file !== dist && !file.startsWith(dist + sep)) return new Response('forbidden', { status: 403 });
    try {
      const res = await net.fetch(pathToFileURL(file).toString());
      const headers = new Headers(res.headers);
      const type = MIME[extname(file).toLowerCase()];
      if (type) headers.set('content-type', type);
      return new Response(res.body, { status: res.status, headers });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });
}

// ── IPC ────────────────────────────────────────────────────────────────────

const recOf = (e) => windows.get(e.sender.id);
const isPdf = (p) => typeof p === 'string' && extname(p).toLowerCase() === '.pdf';

async function readNative(p) {
  const [data, st] = await Promise.all([readFile(p), stat(p)]);
  return { name: basename(p), path: p, data, mtimeMs: st.mtimeMs };
}

ipcMain.on('app:info', (e) => {
  e.returnValue = { platform: process.platform, version: app.getVersion(), e2e: TEST };
});

ipcMain.handle('file:pick', async (e) => {
  const win = recOf(e)?.win;
  const r = await dialog.showOpenDialog(win, {
    title: de() ? 'PDF öffnen' : 'Open PDF',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (r.canceled) return [];
  return Promise.all(r.filePaths.filter(isPdf).map(readNative));
});

ipcMain.handle('file:read', async (_e, p) => {
  if (!isPdf(p)) throw new Error('not a pdf');
  return readNative(p);
});

ipcMain.handle('file:pickSave', async (e, suggested) => {
  const win = recOf(e)?.win;
  const r = await dialog.showSaveDialog(win, {
    title: de() ? 'Speichern unter' : 'Save as',
    defaultPath: String(suggested || 'Dokument.pdf'),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (r.canceled || !r.filePath) return null;
  const p = isPdf(r.filePath) ? r.filePath : `${r.filePath}.pdf`;
  return { path: p, name: basename(p) };
});

/** Atomic in-place save: write next to the file, then replace it. */
ipcMain.handle('file:write', async (_e, p, data, opts) => {
  if (!isPdf(p)) throw new Error('not a pdf');
  if (opts?.expectMtimeMs && !opts.force) {
    try {
      const st = await stat(p);
      if (Math.abs(st.mtimeMs - opts.expectMtimeMs) > 2) throw new Error('E_MODIFIED');
    } catch (err) {
      if (err.message === 'E_MODIFIED') throw err;
      /* file vanished: just write it again */
    }
  }
  const buf = Buffer.from(data.buffer ?? data, data.byteOffset ?? 0, data.byteLength ?? data.length);
  const tmp = `${p}.${randomBytes(4).toString('hex')}.scribo-tmp`;
  try {
    const fh = await open(tmp, 'w');
    try {
      await fh.writeFile(buf);
      await fh.sync();
    } finally {
      await fh.close();
    }
    try {
      await rename(tmp, p);
    } catch (err) {
      // another program (or a sync client) holds the file: fall back to overwriting in place
      if (!['EPERM', 'EBUSY', 'EXDEV', 'EACCES'].includes(err.code)) throw err;
      const fh2 = await open(p, 'w');
      try {
        await fh2.writeFile(buf);
        await fh2.sync();
      } finally {
        await fh2.close();
      }
      await rm(tmp, { force: true });
    }
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
  return { mtimeMs: (await stat(p)).mtimeMs };
});

ipcMain.on('win:state', (e, s) => {
  const rec = recOf(e);
  if (!rec) return;
  rec.dirty = !!s.dirty;
  rec.name = String(s.name ?? '');
  rec.win.setTitle(rec.name ? `${rec.dirty ? '• ' : ''}${rec.name} – Scribo` : 'Scribo');
  if (isMac) rec.win.setDocumentEdited(rec.dirty);
});

ipcMain.handle('win:launch', (e) => {
  const rec = recOf(e);
  const paths = rec?.launch ?? [];
  if (rec) rec.launch = [];
  return paths;
});

ipcMain.handle('win:confirmDiscard', async (e, name) => {
  const win = recOf(e)?.win;
  const g = de();
  const r = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: g ? ['Speichern', 'Nicht speichern', 'Abbrechen'] : ['Save', "Don't save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    message: g ? `Möchtest du die Änderungen an „${name}“ speichern?` : `Do you want to save the changes to “${name}”?`,
    detail: g ? 'Wenn du nicht speicherst, gehen deine Anmerkungen verloren.' : 'If you don’t save, your annotations will be lost.',
  });
  return r.response === 0 ? 'save' : r.response === 1 ? 'discard' : 'cancel';
});

ipcMain.on('win:close', (e) => {
  const rec = recOf(e);
  if (!rec) return;
  rec.force = true;
  rec.win.close();
});
ipcMain.on('win:new', (_e, p) => createWindow(isPdf(p) ? [p] : []));
ipcMain.on('win:fullscreen', (e, on) => recOf(e)?.win.setFullScreen(on));
ipcMain.on('win:theme', (e, dark) => {
  const rec = recOf(e);
  if (!rec) return;
  rec.win.setBackgroundColor(dark ? '#1e1e21' : '#f6f6f8');
  if (!isMac) {
    try {
      rec.win.setTitleBarOverlay(overlayFor(dark));
    } catch {
      /* not supported on this platform */
    }
  }
});
ipcMain.handle('win:print', (e) => {
  const wc = e.sender;
  return new Promise((resolve) => {
    wc.print({ printBackground: true, silent: false }, (success) => resolve(success));
  });
});
ipcMain.on('shell:open', (_e, url) => {
  if (typeof url === 'string' && /^(https?:|mailto:)/i.test(url)) shell.openExternal(url);
});
ipcMain.on('shell:show', (_e, p) => {
  if (typeof p === 'string') shell.showItemInFolder(p);
});
ipcMain.on('app:recent', (_e, p) => {
  if (isPdf(p)) app.addRecentDocument(p);
});

// ── menu (macOS needs one for the standard shortcuts; Windows uses the in-app UI) ──

function buildMenu() {
  if (!isMac) {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      { label: 'Datei', submenu: [{ role: 'close' }] },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]),
  );
}

// ── auto update (installed Windows builds only) ────────────────────────────

function setupUpdates() {
  if (!app.isPackaged || !isWin || process.env.PORTABLE_EXECUTABLE_FILE || TEST) return;
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    const broadcast = (u) => windows.forEach((w) => w.win.webContents.send('update', u));
    autoUpdater.on('update-downloaded', (i) => broadcast({ state: 'downloaded', version: i.version }));
    autoUpdater.on('update-available', (i) => broadcast({ state: 'available', version: i.version }));
    autoUpdater.on('error', () => undefined);
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => undefined), 6000);
    ipcMain.on('update:install', () => autoUpdater.quitAndInstall());
  } catch {
    /* updater unavailable: the app works without it */
  }
}
