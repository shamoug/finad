// Finad local server: crawls news, fetches quotes, runs the analysis, serves the dashboard, streams live processing
// events, raises alerts, syncs the phone feed and looks for app updates.
// Run alone with `node server.js` (opens the browser), or from the desktop app (desktop/main.js) via start().
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');
const { EventEmitter } = require('events');

const store = require('./lib/store');
const { SOURCES, fetchSource, tickerSource } = require('./lib/feeds');
const { fetchMany, fetchChart } = require('./lib/quotes');
const { UNIVERSE } = require('./lib/universe');
const { THEMES } = require('./lib/themes');
const { analyzeArticle, buildMatchers, aggregate, DEFAULTS, ANALYZER_VERSION } = require('./lib/analyze');
const ollama = require('./lib/ollama');
const phone = require('./lib/phone');
const updater = require('./lib/updater');

const PORT = +process.env.FINAD_PORT || 4747;
const VERSION = require('./package.json').version;
const THEME_LABEL = Object.fromEntries(THEMES.map(t => [t.id, t.label]));
const INDICES = [
  ['^GSPC', 'S&P 500'], ['^IXIC', 'Nasdaq'], ['^DJI', 'Dow'], ['^RUT', 'Russell 2000'], ['^VIX', 'VIX'],
  ['^TNX', '10Y yield'], ['CL=F', 'WTI oil'], ['GC=F', 'Gold'], ['DX-Y.NYB', 'Dollar'], ['BTC-USD', 'Bitcoin'],
];

const bus = new EventEmitter();
bus.setMaxListeners(50);

// ---------------- state ----------------
const settings = Object.assign({
  cfg: { ...DEFAULTS },
  holdings: [],          // [{sym, shares, cost}]
  custom: [],            // user-added stocks
  disabledSources: [],
  refreshMinutes: 15,
  ai: { enabled: true, model: '', perCycle: 40 },
  alerts: { minConviction: 20, desktop: true },
  phone: { enabled: false, key: null, ro: null, lastPush: 0, error: null },
}, store.load('settings', {}));
settings.cfg = { ...DEFAULTS, ...settings.cfg };
settings.ai = { enabled: true, model: '', perCycle: 40, ...settings.ai };
settings.alerts = { minConviction: 20, desktop: true, ...settings.alerts };
settings.phone = { enabled: false, key: null, ro: null, lastPush: 0, error: null, ...settings.phone };

let articles = store.load('articles', []);
let quotes = store.load('quotes', {});
let indices = store.load('indices', {});
let alerts = store.load('alerts', []);            // newest first
let lastActions = store.load('signalstate', null); // sym -> {action, conviction}
let result = null;
const live = [];                                     // ring buffer of processing events for the Live view
const meta = store.load('meta', {});
const status = {
  version: VERSION, startedAt: Date.now(), busy: false, phase: 'idle', progress: '', lastNews: meta.lastNews || 0,
  lastQuotes: meta.lastQuotes || 0, nextRun: 0, sourceStats: {}, errors: [],
  counts: { read: 0, fresh: 0, matched: 0, themed: 0 },
  ai: { available: false, model: null, analyzed: 0, queue: 0, running: false },
  update: null,
};

function stocks() {
  const seen = new Set(UNIVERSE.map(s => s.sym));
  return UNIVERSE.concat(settings.custom.filter(c => !seen.has(c.sym)));
}
let matchers = buildMatchers(stocks());

function saveSettings() { store.save('settings', settings); }
function saveMeta() { store.save('meta', { lastNews: status.lastNews, lastQuotes: status.lastQuotes }); }
function idOf(a) { return crypto.createHash('sha1').update((a.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()).digest('hex').slice(0, 14); }
function logErr(msg) { status.errors.unshift({ at: Date.now(), msg: String(msg).slice(0, 500) }); status.errors.length = Math.min(status.errors.length, 30); }

function emit(type, data = {}) {
  const ev = { type, at: Date.now(), ...data };
  if (['article', 'ai', 'phase', 'alert', 'source', 'done'].includes(type)) { live.unshift(ev); if (live.length > 300) live.length = 300; }
  bus.emit('event', ev);
}
function setPhase(phase, progress = '') {
  status.phase = phase; status.progress = progress;
  emit('status', { phase, progress, busy: status.busy });
}

function recompute() {
  result = aggregate({ articles, quotes, stocks: stocks(), cfg: settings.cfg, holdings: settings.holdings });
  result.at = Date.now();
}

function articleEvent(a) {
  const mentions = Object.entries(a.an?.mentions || {}).map(([sym, m]) => ({ sym, sent: +m.sent.toFixed(2) }));
  return { id: a.id, title: a.title, publisher: a.publisher, link: a.link, kind: a.kind, ts: a.ts,
    mentions, themes: (a.an?.themes || []).map(t => ({ id: t.id, label: THEME_LABEL[t.id], dir: t.dir })) };
}

// ---------------- pipeline ----------------
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const it = items[i++]; await fn(it); } }));
}

async function refreshNews() {
  const srcs = SOURCES.filter(s => !settings.disabledSources.includes(s.id));
  const tickerFeeds = [...new Set([...settings.holdings.map(h => h.sym), ...settings.custom.map(c => c.sym)])].map(tickerSource);
  const all = srcs.concat(tickerFeeds);
  const byId = new Map(articles.map(a => [a.id, a]));
  let done = 0, added = 0;
  status.counts = { read: 0, fresh: 0, matched: 0, themed: 0 };
  setPhase('news', `Reading news 0/${all.length}`);
  await pool(all, 6, async (src) => {
    let items = [];
    try {
      items = await fetchSource(src);
      if (src.ticker) items.forEach(it => it.ticker = src.ticker);
      status.sourceStats[src.id] = { name: src.name, ok: true, count: items.length, at: Date.now() };
    } catch (e) {
      status.sourceStats[src.id] = { name: src.name, ok: false, error: e.message, at: Date.now() };
    }
    // Each source is analysed as soon as it arrives, so the Live view shows stories as they are processed.
    let fresh = 0;
    for (const a of items) {
      status.counts.read++;
      a.id = idOf(a);
      const ex = byId.get(a.id);
      if (ex) { if (a.ticker && !ex.ticker) ex.ticker = a.ticker; continue; }
      if (a.ts > Date.now() + 36e5) a.ts = Date.now();
      a.seen = Date.now();
      a.an = analyzeArticle(a, matchers);
      byId.set(a.id, a); added++; fresh++; status.counts.fresh++;
      const hasM = Object.keys(a.an.mentions).length, hasT = a.an.themes.length;
      if (hasM) status.counts.matched++;
      if (hasT) status.counts.themed++;
      emit('article', { ...articleEvent(a), relevant: !!(hasM || hasT) });
    }
    emit('source', { source: src.name, ok: status.sourceStats[src.id].ok, count: items.length, fresh });
    setPhase('news', `Reading news ${++done}/${all.length}`);
  });
  const cutoff = Date.now() - 10 * 864e5;
  articles = [...byId.values()].filter(a => a.ts > cutoff).sort((x, y) => y.ts - x.ts).slice(0, 4000);
  reanalyze(false);
  status.lastNews = Date.now();
  store.save('articles', articles); saveMeta();
  return added;
}

function reanalyze(force) {
  for (const a of articles) if (force || !a.an || a.an.v !== ANALYZER_VERSION) a.an = analyzeArticle(a, matchers);
}

async function refreshQuotes() {
  setPhase('quotes', 'Fetching prices');
  const syms = stocks().map(s => s.sym);
  const { quotes: q, errors } = await fetchMany(syms, { concurrency: 8, onProgress: (d, t) => { if (d % 10 === 0 || d === t) setPhase('quotes', `Fetching prices ${d}/${t}`); } });
  Object.assign(quotes, q);
  const nErr = Object.keys(errors).length;
  if (nErr) logErr(`Price fetch failed for ${nErr} symbols: ${Object.keys(errors).slice(0, 12).join(', ')}`);
  const { quotes: iq } = await fetchMany(INDICES.map(i => i[0]), { concurrency: 5 });
  indices = Object.fromEntries(INDICES.filter(([s]) => iq[s]).map(([s, label]) => [s, { sym: s, label, price: iq[s].price, chg1d: iq[s].chg1d }]));
  status.lastQuotes = Date.now();
  store.save('quotes', quotes); store.save('indices', indices); saveMeta();
  emit('phase', { phase: 'quotes', text: `Prices updated for ${Object.keys(q).length} stocks` });
}

async function aiPass() {
  if (!settings.ai.enabled) { status.ai.available = false; return; }
  const model = await ollama.pickModel(settings.ai.model);
  status.ai.available = !!model; status.ai.model = model;
  if (!model) return;
  const relevant = articles.filter(a => !a.ai && a.an && (Object.keys(a.an.mentions).length || a.an.themes.length) && Date.now() - a.ts < 3 * 864e5);
  status.ai.queue = relevant.length;
  const batch = relevant.slice(0, settings.ai.perCycle);
  if (!batch.length) return;
  status.ai.running = true;
  const hint = stocks().map(s => s.sym).join(',');
  let n = 0;
  for (const a of batch) {
    setPhase('ai', `Local AI reading headlines ${++n}/${batch.length}`);
    try {
      a.ai = await ollama.analyzeWithAI(model, a, hint); status.ai.analyzed++;
      emit('ai', { id: a.id, title: a.title, publisher: a.publisher, link: a.link, impacts: a.ai.impacts.filter(i => i.conf >= 0.5) });
    } catch (e) { logErr('AI: ' + e.message); a.ai = { model, impacts: [], at: Date.now(), error: true }; if (/ECONNREFUSED|fetch failed/.test(e.message)) break; }
    if (n % 8 === 0) { recompute(); store.save('articles', articles); emit('results'); }
    status.ai.queue = Math.max(0, status.ai.queue - 1);
  }
  status.ai.running = false;
  store.save('articles', articles);
}

// A stock that newly turns SELL or BUY (or a holding that turns against you) becomes an alert.
function detectAlerts() {
  const now = {};
  for (const r of result.rows) now[r.sym] = { action: r.action, conviction: r.conviction };
  if (!lastActions) { lastActions = now; store.save('signalstate', now); return []; }   // first run: remember, don't spam
  const fresh = [];
  for (const r of result.rows) {
    const prev = lastActions[r.sym];
    const key = ['SELL', 'BUY'].includes(r.action) || (r.held && ['AVOID', 'WATCH'].includes(r.action));
    if (!key) continue;
    const changed = !prev || prev.action !== r.action;
    const jumped = prev && prev.action === r.action && r.conviction - prev.conviction >= 25;
    if (!(changed || jumped) || (r.conviction < settings.alerts.minConviction && !r.held)) continue;
    const verb = { SELL: 'Sell alert', BUY: 'Buy idea', AVOID: 'Warning', WATCH: 'Watch' }[r.action];
    fresh.push({
      id: Date.now().toString(36) + '-' + r.sym, at: Date.now(), sym: r.sym, action: r.action, conviction: r.conviction, held: !!r.held,
      title: `${verb}: ${r.sym}${r.held ? ' (you hold it)' : ''} · ${r.conviction}/100`,
      body: r.rationale.split(/(?<=\.)\s+/).slice(0, 2).join(' ').slice(0, 300),
      price: r.price, pos52: r.pos52, impact: r.impact,
    });
  }
  lastActions = now; store.save('signalstate', now);
  if (fresh.length) {
    fresh.sort((a, b) => (b.held - a.held) || b.conviction - a.conviction);
    alerts = fresh.concat(alerts).slice(0, 150);
    store.save('alerts', alerts);
    for (const a of fresh) emit('alert', a);
  }
  return fresh;
}

async function syncPhone(reason) {
  const p = settings.phone;
  if (!p.enabled || !p.key || !result) return;
  try {
    const feed = phone.buildFeed({ result, alerts, indices, articles, version: VERSION });
    await phone.push(p.key, feed);
    p.lastPush = Date.now(); p.error = null;
    emit('phase', { phase: 'phone', text: `Phone feed updated${reason ? ' (' + reason + ')' : ''}` });
  } catch (e) { p.error = e.message; logErr('Phone sync: ' + e.message); }
  saveSettings();
}

async function refreshAll({ news = true, prices = true, ai = true } = {}) {
  if (status.busy) return false;
  status.busy = true;
  emit('phase', { phase: 'start', text: 'Update started' });
  try {
    if (news) await refreshNews();
    if (prices) await refreshQuotes();
    setPhase('analysis', 'Scoring stocks');
    recompute(); emit('results');
    const fresh = detectAlerts();
    await syncPhone(fresh.length ? `${fresh.length} new alert${fresh.length > 1 ? 's' : ''}` : '');
    if (ai) { await aiPass(); recompute(); const more = detectAlerts(); emit('results'); if (more.length || status.ai.analyzed) await syncPhone(); }
  } catch (e) { logErr(e.stack || e.message); }
  finally {
    status.busy = false; status.nextRun = Date.now() + settings.refreshMinutes * 60e3;
    setPhase('idle');
    emit('done', { text: `Update finished · ${status.counts.fresh} new stories · ${result?.signals.SELL.length ?? 0} sell / ${result?.signals.BUY.length ?? 0} buy` });
  }
  return true;
}

async function checkUpdate() {
  try { status.update = await updater.check(VERSION); if (status.update.available) emit('update', status.update); }
  catch (e) { status.update = { error: e.message, checkedAt: Date.now() }; }
}

let timer;
function schedule() {
  clearInterval(timer);
  timer = setInterval(() => refreshAll(), Math.max(5, settings.refreshMinutes) * 60e3);
  status.nextRun = Date.now() + settings.refreshMinutes * 60e3;
}

// ---------------- API ----------------
function slimRow(r) {
  const { hist, ...rest } = r;
  rest.spark = (hist || []).filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 50)) === 0).map(p => p[1]);
  return rest;
}

let host = { restart: null };   // set by the desktop app

async function api(req, res, url, body) {
  const p = url.pathname;
  if (p === '/api/events') return sse(req, res);
  if (p === '/api/status') return json(res, { ...status, articles: articles.length, stocks: stocks().length, quotes: Object.keys(quotes).length, dataDir: store.DIR, desktop: !!host.restart });
  if (p === '/api/live') return json(res, { events: live.slice(0, +url.searchParams.get('limit') || 150), counts: status.counts });
  if (p === '/api/alerts') return json(res, { alerts: alerts.slice(0, 100) });
  if (p === '/api/state') {
    if (!result) recompute();
    return json(res, {
      at: result.at, cfg: result.cfg, indices,
      signals: Object.fromEntries(Object.entries(result.signals).map(([k, v]) => [k, v.map(slimRow)])),
      rows: result.rows.map(r => { const { hist, evidence, rationale, ...rest } = r; return rest; }),
      themes: result.themes,
      holdings: settings.holdings,
      alerts: alerts.slice(0, 20),
    });
  }
  if (p.startsWith('/api/stock/')) {
    if (!result) recompute();
    const sym = decodeURIComponent(p.split('/').pop()).toUpperCase();
    const row = result.rows.find(r => r.sym === sym);
    if (!row) return json(res, { error: 'unknown symbol' }, 404);
    const related = articles.filter(a => a.an?.mentions[sym] || a.ai?.impacts?.some(i => i.sym === sym)).slice(0, 40)
      .map(a => ({ id: a.id, title: a.title, link: a.link, publisher: a.publisher, ts: a.ts, sent: a.an.mentions[sym]?.sent, ai: a.ai?.impacts?.find(i => i.sym === sym) }));
    return json(res, { ...row, related });
  }
  if (p === '/api/news') {
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const filter = url.searchParams.get('filter') || 'relevant';
    const theme = url.searchParams.get('theme');
    const limit = Math.min(500, +url.searchParams.get('limit') || 200);
    let list = articles;
    if (filter === 'relevant') list = list.filter(a => a.an && (Object.keys(a.an.mentions).length || a.an.themes.length || a.ai?.impacts?.length));
    if (filter === 'market' || filter === 'world') list = list.filter(a => a.kind === filter);
    if (theme) list = list.filter(a => a.an?.themes.some(t => t.id === theme));
    if (q) list = list.filter(a => (a.title + ' ' + a.summary + ' ' + a.publisher).toLowerCase().includes(q) || Object.keys(a.an?.mentions || {}).some(s => s.toLowerCase() === q));
    return json(res, {
      total: list.length,
      items: list.slice(0, limit).map(a => ({
        id: a.id, title: a.title, summary: a.summary, link: a.link, publisher: a.publisher, kind: a.kind, ts: a.ts,
        sentiment: a.an?.sentiment, mentions: a.an?.mentions, themes: a.an?.themes, ai: a.ai?.impacts || null,
      })),
    });
  }
  if (p === '/api/meta') {
    return json(res, {
      sources: SOURCES.map(s => ({ ...s, enabled: !settings.disabledSources.includes(s.id), stat: status.sourceStats[s.id] || null })),
      themes: THEMES.map(t => ({ id: t.id, label: t.label, type: t.type, impacts: t.impacts })),
      tags: [...new Set(UNIVERSE.flatMap(s => s.tags))].sort(),
      sectors: [...new Set(UNIVERSE.map(s => s.sector))].sort(),
      universe: stocks().map(s => ({ sym: s.sym, name: s.name, sector: s.sector, tags: s.tags, custom: !!s.custom })),
    });
  }
  if (p === '/api/settings' && req.method === 'GET') return json(res, publicSettings());
  if (p === '/api/settings' && req.method === 'POST') {
    const b = body || {};
    if (b.cfg) settings.cfg = { ...settings.cfg, ...sanitizeCfg(b.cfg) };
    if (b.refreshMinutes) { settings.refreshMinutes = Math.max(5, Math.min(240, +b.refreshMinutes)); schedule(); }
    if (b.ai) settings.ai = { ...settings.ai, ...b.ai };
    if (b.alerts) settings.alerts = { ...settings.alerts, ...b.alerts };
    if (Array.isArray(b.disabledSources)) settings.disabledSources = b.disabledSources;
    saveSettings(); recompute(); emit('results');
    return json(res, publicSettings());
  }
  if (p === '/api/holdings' && req.method === 'POST') {
    settings.holdings = (body?.holdings || []).map(h => ({ sym: String(h.sym).toUpperCase().trim(), shares: +h.shares || 0, cost: +h.cost || 0 })).filter(h => h.sym);
    saveSettings(); recompute(); emit('results');
    return json(res, { ok: true, holdings: settings.holdings, missing: settings.holdings.filter(h => !stocks().some(s => s.sym === h.sym)).map(h => h.sym) });
  }
  if (p === '/api/custom' && req.method === 'POST') return addCustom(res, body);
  if (p === '/api/custom' && req.method === 'DELETE') {
    const sym = String(body?.sym || '').toUpperCase();
    settings.custom = settings.custom.filter(c => c.sym !== sym);
    delete quotes[sym];
    matchers = buildMatchers(stocks()); reanalyze(true); saveSettings(); recompute(); emit('results');
    return json(res, { ok: true });
  }
  if (p === '/api/refresh' && req.method === 'POST') {
    const started = !status.busy;
    refreshAll(body || {});
    return json(res, { started });
  }
  if (p === '/api/reanalyze' && req.method === 'POST') { reanalyze(true); recompute(); store.save('articles', articles); emit('results'); return json(res, { ok: true }); }
  if (p === '/api/ai/reset' && req.method === 'POST') { articles.forEach(a => delete a.ai); store.save('articles', articles); recompute(); return json(res, { ok: true }); }
  if (p === '/api/ai/models') return json(res, { models: (await ollama.listModels()) || [], available: !!(await ollama.listModels()) });

  // phone link
  if (p === '/api/phone' && req.method === 'GET') return json(res, phoneInfo());
  if (p === '/api/phone/enable' && req.method === 'POST') {
    const ph = settings.phone;
    if (!ph.key || body?.newKey) { ph.key = phone.newKey(); ph.ro = null; }
    ph.enabled = true;
    if (!result) recompute();
    try {
      await phone.push(ph.key, phone.buildFeed({ result, alerts, indices, articles, version: VERSION }));
      ph.lastPush = Date.now(); ph.error = null;
      if (!ph.ro) ph.ro = await phone.readOnlyId(ph.key);
    } catch (e) { ph.error = e.message; }
    saveSettings();
    return json(res, phoneInfo());
  }
  if (p === '/api/phone/disable' && req.method === 'POST') { settings.phone.enabled = false; saveSettings(); return json(res, phoneInfo()); }
  if (p === '/api/phone/test' && req.method === 'POST') {
    const a = { id: Date.now().toString(36) + '-test', at: Date.now(), sym: 'TEST', action: 'INFO', conviction: 0, held: false, title: 'Finad test notification', body: 'Your phone is linked to Finad on your computer. New sell and buy alerts will show here.' };
    alerts.unshift(a); store.save('alerts', alerts); emit('alert', a);
    await syncPhone('test');
    return json(res, phoneInfo());
  }

  // updates
  if (p === '/api/update' && req.method === 'GET') return json(res, status.update || {});
  if (p === '/api/update/check' && req.method === 'POST') { await checkUpdate(); return json(res, status.update); }
  if (p === '/api/update/apply' && req.method === 'POST') {
    if (!status.update?.available) return json(res, { error: 'No update available' }, 400);
    try {
      await updater.apply(status.update);
      json(res, { ok: true, restarting: !!host.restart });
      if (host.restart) setTimeout(() => host.restart(), 800);
    } catch (e) { json(res, { error: e.message }, 400); }
    return;
  }
  return json(res, { error: 'not found' }, 404);
}

function phoneInfo() {
  const ph = settings.phone;
  const link = ph.ro ? `https://shamoug.github.io/finad/open.html#feed=${ph.ro}` : null;
  return { enabled: ph.enabled, paired: !!ph.ro, ro: ph.ro, link, lastPush: ph.lastPush, error: ph.error, store: phone.BASE };
}
function publicSettings() { const { phone: ph, ...rest } = settings; return { ...rest, phone: { enabled: ph.enabled, lastPush: ph.lastPush } }; }

function sanitizeCfg(c) {
  const out = {};
  const num = (k, lo, hi) => { if (c[k] != null && !isNaN(+c[k])) out[k] = Math.max(lo, Math.min(hi, +c[k])); };
  num('highZone', 0.5, 0.99); num('lowZone', 0.01, 0.5); num('minImpact', 0, 1); num('halfLifeHours', 2, 240); num('themeWeight', 0, 2); num('maxAgeDays', 1, 10);
  return out;
}

async function addCustom(res, body) {
  const sym = String(body?.sym || '').toUpperCase().trim();
  if (!/^[A-Z0-9.^=-]{1,12}$/.test(sym)) return json(res, { error: 'Invalid symbol' }, 400);
  if (stocks().some(s => s.sym === sym)) return json(res, { error: sym + ' is already tracked' }, 400);
  try {
    const q = await fetchChart(sym);
    const name = body.name || q.name || sym;
    const short = name.replace(/,?\s+(Inc\.?|Corp(oration)?\.?|Co\.?|Ltd\.?|plc|Holdings?|Group|Company|S\.A\.|N\.V\.|AG)\b.*$/i, '').trim();
    const aliases = [...new Set([short, ...(body.aliases || [])].filter(a => a && a.length > 2))];
    settings.custom.push({ sym, name, sector: body.sector || 'Other', aliases, tags: body.tags || [], custom: true });
    quotes[sym] = q;
    matchers = buildMatchers(stocks()); reanalyze(true); saveSettings(); recompute(); emit('results');
    store.save('quotes', quotes);
    return json(res, { ok: true, stock: settings.custom[settings.custom.length - 1] });
  } catch (e) { return json(res, { error: `Could not find ${sym}: ${e.message}` }, 400); }
}

function sse(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  res.write(`data: ${JSON.stringify({ type: 'hello', status: { phase: status.phase, busy: status.busy, progress: status.progress } })}\n\n`);
  const on = (ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  bus.on('event', on);
  req.on('close', () => { clearInterval(ping); bus.off('event', on); });
}

function json(res, data, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const PUB = path.join(__dirname, 'public');

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', async () => {
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { return json(res, { error: 'bad json' }, 400); }
      try { await api(req, res, url, body); } catch (e) { logErr(e.stack); if (!res.headersSent) json(res, { error: e.message }, 500); }
    });
    return;
  }
  const file = path.normalize(path.join(PUB, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

function openBrowser(link) {
  const cmd = process.platform === 'win32' ? `start "" "${link}"` : process.platform === 'darwin' ? `open ${link}` : `xdg-open ${link}`;
  exec(cmd);
}

// Starts the server. opts.openBrowser: open the dashboard in the default browser (standalone mode).
function start(opts = {}) {
  if (opts.host) host = { ...host, ...opts.host };
  return new Promise((resolve, reject) => {
    server.once('error', (e) => {
      if (e.code === 'EADDRINUSE') {
        if (opts.openBrowser) { console.log(`Finad already running on port ${PORT} — opening it.`); openBrowser(`http://localhost:${PORT}`); setTimeout(() => process.exit(0), 500); }
        reject(e);
      } else reject(e);
    });
    server.listen(PORT, '127.0.0.1', () => {
      const link = `http://localhost:${PORT}`;
      console.log(`\n  Finad ${VERSION} running at ${link}\n  Data folder: ${store.DIR}\n`);
      if (articles.length) { reanalyze(false); recompute(); }
      if (opts.openBrowser) openBrowser(link);
      const stale = Date.now() - status.lastNews > 10 * 60e3;
      refreshAll({ news: stale || !articles.length, prices: true, ai: true });
      schedule();
      checkUpdate(); setInterval(checkUpdate, 6 * 3600e3);
      resolve({ port: PORT, url: link });
    });
  });
}
function stop() { try { server.close(); } catch {} clearInterval(timer); }

module.exports = { start, stop, bus, status, PORT, VERSION, refreshAll };

if (require.main === module) start({ openBrowser: !process.argv.includes('--no-open') }).catch(() => {});
