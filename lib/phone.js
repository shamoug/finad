// Phone link through textdb.dev, a free public JSON/text store (no account): Finad writes its feed (signals, alerts,
// world drivers, latest news) under a secret key that only this computer knows; the phone app gets the store's
// read-only link (from the QR code in Settings > Phone) and can read it but never change it.
const crypto = require('crypto');

const BASE = 'https://textdb.dev';
const UA = 'Finad (+https://shamoug.github.io/finad/)';

function newKey() { return 'finad-' + crypto.randomUUID(); }

async function push(key, feed) {
  const r = await fetch(`${BASE}/api/data/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify(feed),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error('textdb HTTP ' + r.status);
}

// textdb shows the read-only id on the data page of a key.
async function readOnlyId(key) {
  const r = await fetch(`${BASE}/data/${encodeURIComponent(key)}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  const html = await r.text();
  const m = html.match(/class="uuid">([0-9A-F]{64})</) || html.match(/\/data\/([0-9A-F]{64})"/);
  if (!m) throw new Error('textdb did not return a read-only link');
  return m[1];
}

const short = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
const r2 = (x, d = 4) => x == null ? null : +(+x).toFixed(d);

function compactRow(r) {
  const spark = (r.hist || []).filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 40)) === 0).map(p => p[1]);
  return {
    sym: r.sym, name: r.name, sector: r.sector, action: r.action, conviction: r.conviction, held: !!r.held,
    price: r2(r.price, 2), chg1d: r2(r.chg1d), pos52: r2(r.pos52, 3), hi52: r2(r.hi52, 2), lo52: r2(r.lo52, 2),
    impact: r2(r.impact, 3), toMid: r2(r.toMid), rationale: short(r.rationale, 600), spark,
    drivers: (r.evidence?.themes || []).filter(t => Math.sign(t.c) === Math.sign(r.impact)).slice(0, 3).map(t => t.label),
    stories: (r.evidence?.direct || []).slice(0, 3).map(e => ({ title: short(e.title, 160), link: e.link, publisher: e.publisher, c: r2(e.c, 3) })),
  };
}

function buildFeed({ result, alerts, indices, articles, version }) {
  const pick = (k, n) => (result.signals[k] || []).slice(0, n).map(compactRow);
  return {
    app: 'finad', v: 1, version, updatedAt: Date.now(),
    counts: Object.fromEntries(Object.entries(result.signals).map(([k, v]) => [k, v.length])),
    indices: Object.values(indices || {}),
    signals: { SELL: pick('SELL', 20), BUY: pick('BUY', 20), AVOID: pick('AVOID', 10), HOLD: pick('HOLD', 10) },
    held: result.rows.filter(r => r.held).map(compactRow),
    themes: result.themes.slice(0, 10).map(t => ({ id: t.id, label: t.label, type: t.type, intensity: r2(t.intensity, 3), n: t.n, winners: t.winners, losers: t.losers, top: t.articles.slice(0, 2).map(a => ({ title: short(a.title, 160), link: a.link, publisher: a.publisher })) })),
    alerts: alerts.slice(0, 40),
    news: articles.filter(a => a.an && (Object.keys(a.an.mentions).length || a.an.themes.length)).slice(0, 30).map(a => ({
      title: short(a.title, 180), link: a.link, publisher: a.publisher, ts: a.ts,
      tickers: Object.entries(a.an.mentions).slice(0, 5).map(([s, m]) => [s, r2(m.sent, 2)]), themes: a.an.themes.map(t => [t.id, t.dir]),
    })),
  };
}

module.exports = { newKey, push, readOnlyId, buildFeed, BASE };
