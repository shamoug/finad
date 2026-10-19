// Keeps the desktop app up to date from the public website: downloads/desktop.json on GitHub Pages says the newest
// version, the app package's address and its SHA-256 (written by scripts/pack.ps1). A newer package is downloaded,
// checked, unpacked over the installed app's files and the app restarts. Only an installed copy updates itself
// (%LOCALAPPDATA%\Programs\Finad\resources\app); a copy run from the project folder only says that an update exists.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const INFO = process.env.FINAD_UPDATE_URL || 'https://shamoug.github.io/finad/downloads/desktop.json';
const APP_DIR = path.resolve(__dirname, '..');
const installed = () => /[\\/]Programs[\\/]Finad[\\/]resources[\\/]app$/i.test(APP_DIR);

function newer(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); }
  return false;
}

async function check(current) {
  const r = await fetch(INFO + '?t=' + Date.now(), { signal: AbortSignal.timeout(15000), headers: { 'Cache-Control': 'no-cache' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  return { latest: j.version, available: newer(j.version, current), url: j.url, sha256: j.sha256, notes: j.notes || '', installed: installed(), checkedAt: Date.now() };
}

function run(cmd, args) {
  return new Promise((res, rej) => execFile(cmd, args, { windowsHide: true }, (e, so, se) => e ? rej(new Error(se || e.message)) : res(so)));
}

// Downloads, checks and unpacks the new version over this app's files. Settings and data live in ~/.finad: untouched.
async function apply(info) {
  if (!installed()) throw new Error('Only the installed app updates itself. Download the new installer from the website.');
  const r = await fetch(info.url, { signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error('Download failed: HTTP ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  if (sha.toLowerCase() !== String(info.sha256).toLowerCase()) throw new Error('The download does not match its SHA-256; not installed.');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'finad-update-'));
  const zip = path.join(tmp, 'finad-app.zip');
  fs.writeFileSync(zip, buf);
  const out = path.join(tmp, 'app');
  await run('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${out}' -Force`]);
  if (!fs.existsSync(path.join(out, 'server.js'))) throw new Error('The package has no server.js; not installed.');
  fs.cpSync(out, APP_DIR, { recursive: true, force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
  return true;
}

module.exports = { check, apply, newer, installed };
