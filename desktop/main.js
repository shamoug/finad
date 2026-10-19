// Finad desktop app (Electron): runs the Finad server in-process, shows it in its own window, keeps watching from the
// system tray when the window is closed, starts with Windows (hidden, in the tray), and shows a Windows notification
// for every new sell/buy alert. Installed by scripts/install.ps1 into %LOCALAPPDATA%\Programs\Finad.
const { app, BrowserWindow, Tray, Menu, Notification, nativeImage, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const HIDDEN = process.argv.includes('--hidden');
const ICON = path.join(__dirname, process.platform === 'win32' ? 'icon.ico' : 'icon.png');
let win = null, tray = null, quitting = false, server = null, ready = false, showWhenReady = false;

app.setAppUserModelId('Shamoug.Finad');
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.on('second-instance', () => (ready ? show() : (showWhenReady = true)));

const stateFile = () => path.join(app.getPath('userData'), 'window.json');
const readState = () => { try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch { return {}; } };

function createWindow() {
  const st = readState();
  win = new BrowserWindow({
    width: st.width || 1440, height: st.height || 920, x: st.x, y: st.y, minWidth: 960, minHeight: 620,
    show: false, title: 'Finad', icon: ICON, backgroundColor: '#0b1220', autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  win.removeMenu();
  if (st.maximized) win.maximize();
  win.loadURL(server.url + '/');
  win.once('ready-to-show', () => { if (!HIDDEN || showWhenReady) win.show(); });
  // Links to news articles and the website open in the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(server.url)) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); } });
  let t;
  const save = () => { clearTimeout(t); t = setTimeout(() => { if (!win || win.isDestroyed()) return; try { fs.writeFileSync(stateFile(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() })); } catch {} }, 400); };
  win.on('resize', save); win.on('move', save);
  let told = false;
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault(); win.hide();
    if (!told) { told = true; notify('Finad is still running', 'It keeps reading the news from the system tray. Right-click the tray icon to quit.'); }
  });
}

function show(hash) {
  if (!win || win.isDestroyed()) createWindow();
  if (hash) win.webContents.executeJavaScript(`window.finadGo && window.finadGo(${JSON.stringify(hash)})`).catch(() => {});
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}

// ---- start with Windows ----
const loginArgs = () => (app.isPackaged ? ['--hidden'] : [app.getAppPath(), '--hidden']);
const startsAtLogin = () => app.getLoginItemSettings({ args: loginArgs() }).openAtLogin;
function setStartAtLogin(on) { app.setLoginItemSettings({ openAtLogin: on, args: loginArgs() }); }
function firstRun() {
  const f = path.join(app.getPath('userData'), 'installed.json');
  if (fs.existsSync(f)) return;
  try { if (app.isPackaged) setStartAtLogin(true); } catch (e) { console.error('Start with Windows:', e.message); }
  try { fs.writeFileSync(f, JSON.stringify({ at: new Date().toISOString() })); } catch {}
}

// ---- tray ----
function trayMenu(counts = {}) {
  return Menu.buildFromTemplate([
    { label: 'Open Finad', click: () => show() },
    { type: 'separator' },
    { label: `Sell alerts${counts.SELL != null ? ` (${counts.SELL})` : ''}`, click: () => show('signals') },
    { label: `Buy ideas${counts.BUY != null ? ` (${counts.BUY})` : ''}`, click: () => show('signals') },
    { label: 'Live newsroom', click: () => show('live') },
    { label: 'Read the news now', click: () => server.mod.refreshAll() },
    { type: 'separator' },
    { label: 'Check for updates…', click: () => show('settings') },
    { label: 'Start with Windows', type: 'checkbox', checked: startsAtLogin(), click: (i) => { try { setStartAtLogin(i.checked); } catch (e) { notify('Could not change Start with Windows', e.message); } } },
    { label: 'Quit Finad', click: () => { quitting = true; app.quit(); } },
  ]);
}
function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'tray.png')).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip('Finad');
  tray.setContextMenu(trayMenu());
  tray.on('click', () => (win && win.isVisible() && win.isFocused() ? win.hide() : show()));
}

// ---- notifications (queued so they don't pile up) ----
const queue = []; let showing = false;
function notify(title, body, hash) {
  if (!Notification.isSupported()) return;
  queue.push({ title, body, hash });
  if (!showing) next();
}
function next() {
  const n = queue.shift();
  if (!n) { showing = false; return; }
  showing = true;
  const note = new Notification({ title: n.title, body: n.body, icon: ICON });
  let done = false;
  const fin = () => { if (!done) { done = true; setTimeout(next, 700); } };
  setTimeout(fin, 6000);
  note.on('click', () => { fin(); show(n.hash); });
  note.on('close', fin); note.on('failed', fin);
  note.show();
}

// ---- the loud alarm for urgent buys: a WAV made here, played by Windows at full scale ----
function alarmFile() {
  const f = path.join(app.getPath('userData'), 'alarm.wav');
  if (fs.existsSync(f)) return f;
  const rate = 22050, beep = 0.18, gap = 0.07, n = Math.round(rate * (beep + gap) * 12);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const t = i / rate, k = Math.floor(t / (beep + gap)), on = t - k * (beep + gap) < beep;
    const hz = k % 2 ? 1320 : 880;
    const v = on ? Math.max(-1, Math.min(1, 3 * Math.sin(2 * Math.PI * hz * t))) : 0;   // clipped sine: loud and harsh
    data.writeInt16LE(Math.round(v * 32000), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(f, Buffer.concat([h, data]));
  return f;
}
let ringing = false;
function alarm() {
  if (ringing || process.platform !== 'win32') return;
  ringing = true;
  try {
    const f = alarmFile().replace(/'/g, "''");
    require('child_process').execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$p = New-Object Media.SoundPlayer '${f}'; $p.PlaySync(); $p.PlaySync()`],
      { windowsHide: true }, () => { ringing = false; });
  } catch { ringing = false; }
}

app.whenReady().then(async () => {
  firstRun();
  try {
    const mod = require('../server.js');
    const info = await mod.start({ host: { restart: () => { quitting = true; app.relaunch(); app.exit(0); } } });
    server = { ...info, mod };
    let lastCounts = '';
    mod.bus.on('event', (ev) => {
      if (ev.type === 'alert' && mod.status) {
        if (ev.urgent) alarm();
        notify(ev.title, ev.body, ev.sym && ev.sym !== 'TEST' ? 'stock:' + ev.sym : 'signals');
      }
      if (ev.type === 'update') notify(`Finad ${ev.latest} is available`, 'Open Settings to install it. Your data and settings are kept.', 'settings');
      if (ev.type === 'done') {
        tray?.setToolTip(`Finad\n${ev.text}`);
        try {
          const counts = (ev.text.match(/(\d+) sell \/ (\d+) buy/) || []);
          const key = counts.join();
          if (key !== lastCounts) { lastCounts = key; tray?.setContextMenu(trayMenu({ SELL: counts[1], BUY: counts[2] })); }
        } catch {}
      }
    });
  } catch (e) {
    dialog.showErrorBox('Finad could not start', (e && e.code === 'EADDRINUSE')
      ? 'Another copy of Finad (or another program) is using port 4747. Close it and open Finad again.'
      : String(e && e.stack || e));
    quitting = true; app.exit(1); return;
  }
  createTray();
  createWindow();
  ready = true;
  if (showWhenReady) show();
});

app.on('window-all-closed', () => {});
app.on('before-quit', () => { quitting = true; try { server?.mod.stop(); } catch {} });
