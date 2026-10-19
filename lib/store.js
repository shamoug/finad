// Tiny JSON persistence in ~/.finad (like Mandata's ~/.mandata folder).
const fs = require('fs');
const path = require('path');
const os = require('os');

const DIR = process.env.FINAD_HOME || path.join(os.homedir(), '.finad');
fs.mkdirSync(DIR, { recursive: true });

function file(name) { return path.join(DIR, name + '.json'); }

function load(name, fallback) {
  try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); }
  catch { return fallback; }
}

function save(name, data) {
  const tmp = file(name) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file(name));
}

module.exports = { DIR, load, save };
