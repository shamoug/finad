// Finad dashboard (vanilla JS, no build step).
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = async (p, opts) => {
  const r = await fetch('/api/' + p, opts && { method: opts.method || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opts.body || {}) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
};
const pct = (x, d = 1) => x == null || isNaN(x) ? '–' : (x >= 0 ? '+' : '') + (x * 100).toFixed(d) + '%';
const num = (x, d = 2) => x == null || isNaN(x) ? '–' : (+x).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
const cls = (x) => x > 0 ? 'up' : x < 0 ? 'down' : '';
const ago = (ts) => { const m = Math.round((Date.now() - ts) / 60000); return m < 1 ? 'just now' : m < 60 ? m + 'm ago' : m < 1440 ? Math.round(m / 60) + 'h ago' : Math.round(m / 1440) + 'd ago'; };
const hhmm = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const COLORS = { SELL: '--sell', BUY: '--buy', AVOID: '--avoid', HOLD: '--hold', WATCH: '--muted', NONE: '--muted' };
const ACTION_LABEL = { SELL: 'SELL', BUY: 'BUY', AVOID: 'AVOID', HOLD: 'HOLD', WATCH: 'WATCH', NONE: '—', INFO: 'INFO' };
const TITLES = { signals: 'Signals', live: 'Live newsroom', alerts: 'Alerts', map: 'Market map', themes: 'World drivers', news: 'News', portfolio: 'Portfolio', phone: 'Phone', settings: 'Settings' };

let S = { state: null, meta: null, settings: null, status: null, newsFilter: 'relevant', sort: { k: 'conviction', d: -1 }, live: [], view: 'signals' };

// ---------- theme ----------
(function initTheme() {
  let t = null; try { t = localStorage.getItem('finad-theme'); } catch {}
  if (t) document.documentElement.dataset.theme = t;
  $('#themeToggle').onclick = () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    const next = cur === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('finad-theme', next); } catch {}
    if (S.state) { renderMap(); renderSignals(); }
  };
})();

// ---------- navigation ----------
function show(view) {
  if (!TITLES[view]) view = 'signals';
  S.view = view;
  $$('#nav button').forEach(b => b.classList.toggle('on', b.dataset.view === view));
  $$('.view').forEach(v => v.classList.toggle('on', v.id === 'view-' + view));
  $('#pageTitle').textContent = TITLES[view];
  $('#side').classList.remove('open');
  try { localStorage.setItem('finad-view', view); } catch {}
  if (view === 'news') loadNews();
  if (view === 'map') renderMap();
  if (view === 'settings') renderSettings();
  if (view === 'phone') renderPhone();
  if (view === 'alerts') loadAlerts();
  if (view === 'live') renderLive();
  scrollTo(0, 0);
}
$$('#nav button').forEach(b => b.onclick = () => show(b.dataset.view));
document.addEventListener('click', (e) => { const g = e.target.closest('[data-go]'); if (g) { e.preventDefault(); show(g.dataset.go); } });
$('#menuBtn').onclick = () => $('#side').classList.toggle('open');
// Used by the desktop app's tray menu and notifications.
window.finadGo = (where) => { if (String(where).startsWith('stock:')) openStock(where.slice(6)); else show(where); };

// ---------- data ----------
async function loadAll() {
  const [state, meta, settings] = await Promise.all([api('state'), api('meta'), api('settings')]);
  S.state = state; S.meta = meta; S.settings = settings;
  S.bySym = Object.fromEntries(state.rows.map(r => [r.sym, r]));
  renderAll();
}
function renderAll() {
  renderTape(); renderSignals(); renderTable(); renderThemes(); renderPortfolio(); renderMiniAlerts(S.state.alerts);
  if (S.view === 'map') renderMap();
  fillSectors();
  $('#nav-signals').textContent = S.state.signals.SELL.length + S.state.signals.BUY.length || '';
}
let reloadT;
function reloadSoon(ms = 1200) { clearTimeout(reloadT); reloadT = setTimeout(() => loadAll().catch(() => {}), ms); }

// ---------- status ----------
async function pollStatus() {
  try { S.status = await api('status'); renderStatus(); }
  catch { $('#phaseText').textContent = 'Finad server not reachable'; }
}
function renderStatus() {
  const st = S.status; if (!st) return;
  const busy = st.busy;
  $('#phaseDot').className = 'pdot ' + (busy ? 'busy' : 'ok');
  $('#liveDot').classList.toggle('on', !!busy);
  const PH = { news: 'Reading the news', quotes: 'Fetching prices', analysis: 'Scoring stocks', ai: 'Local AI reading', idle: 'Up to date' };
  $('#phaseText').textContent = busy ? (PH[st.phase] || 'Updating') : 'Up to date';
  const next = st.nextRun ? Math.max(0, Math.round((st.nextRun - Date.now()) / 60000)) : null;
  $('#phaseSub').textContent = busy ? st.progress : `Updated ${ago(Math.max(st.lastNews, st.lastQuotes))}${next != null ? ` · next in ${next} min` : ''}`;
  const m = String(st.progress || '').match(/(\d+)\/(\d+)/);
  $('#phaseBar').style.width = busy ? (m ? (100 * m[1] / m[2]) : 50) + '%' : '100%';
  $('#verText').textContent = 'Finad ' + st.version;
  $('#refresh').disabled = !!busy;
  renderUpdateBanner();
  if (S.view === 'live') renderPipeline();
}
$('#refresh').onclick = async () => { await api('refresh', { body: {} }); pollStatus(); };

// ---------- live events (Server-Sent Events) ----------
function connectEvents() {
  const es = new EventSource('/api/events');
  es.onmessage = (m) => {
    let ev; try { ev = JSON.parse(m.data); } catch { return; }
    if (ev.type === 'hello') { if (S.status) { Object.assign(S.status, ev.status); renderStatus(); } return; }
    if (ev.type === 'status') { if (S.status) { Object.assign(S.status, { phase: ev.phase, progress: ev.progress, busy: ev.busy }); renderStatus(); } return; }
    if (ev.type === 'results') { reloadSoon(); return; }
    if (ev.type === 'done') { pollStatus(); reloadSoon(300); }
    if (ev.type === 'update') pollStatus();
    if (['article', 'ai', 'source', 'phase', 'alert', 'done'].includes(ev.type)) pushLive(ev);
    if (ev.type === 'alert') {
      toast(ev);
      if (S.state) { S.state.alerts = [ev, ...(S.state.alerts || [])].slice(0, 20); renderMiniAlerts(S.state.alerts); }
      if (S.view === 'alerts') loadAlerts();
    }
  };
  es.onerror = () => { es.close(); setTimeout(connectEvents, 4000); };
}
function pushLive(ev) {
  S.live.unshift(ev); if (S.live.length > 400) S.live.length = 400;
  if (ev.type === 'article' && S.status) {
    const c = S.status.counts ||= { read: 0, fresh: 0, matched: 0, themed: 0 };
    c.fresh++; if (ev.mentions?.length) c.matched++; if (ev.themes?.length) c.themed++;
  }
  const relOnly = $('#liveOnlyRelevant').checked;
  if (ev.type === 'article' || ev.type === 'ai') {
    if (S.view === 'live' && (!relOnly || ev.type === 'ai' || ev.relevant)) prepend('#liveStream', storyItem(ev), 150);
    if (ev.type === 'ai' || ev.relevant) prepend('#miniLive', storyItem(ev, true), 14);
  } else if (S.view === 'live') prepend('#liveLog', logItem(ev), 200);
  if (S.view === 'live') renderPipeline();
}
function prepend(sel, html, max) {
  const el = $(sel); if (!el) return;
  el.querySelectorAll('.empty, .muted.small').forEach(x => x.remove());
  el.insertAdjacentHTML('afterbegin', html);
  while (el.children.length > max) el.lastElementChild.remove();
}
function tickerChips(ev) {
  const m = (ev.mentions || []).map(x => `<span class="chip ${x.sent > 0.05 ? 'pos' : x.sent < -0.05 ? 'neg' : ''}" data-ticker="${esc(x.sym)}">${esc(x.sym)} ${x.sent > 0.05 ? '▲' : x.sent < -0.05 ? '▼' : '•'}</span>`);
  const t = (ev.themes || []).map(x => `<span class="chip">${esc(x.label || x.id)} ${x.dir > 0 ? '↑' : '↓'}</span>`);
  const ai = (ev.impacts || []).map(x => `<span class="chip ai ${x.dir > 0 ? 'pos' : 'neg'}" data-ticker="${esc(x.sym)}" title="${esc(x.reason)}">AI: ${esc(x.sym)} ${x.dir > 0 ? '▲' : '▼'}</span>`);
  return [...m, ...ai, ...t].join('');
}
function storyItem(ev) {
  const isAi = ev.type === 'ai';
  const chips = tickerChips(ev);
  return `<div class="sitem ${isAi ? 'aiitem rel' : ev.relevant ? 'rel' : 'irr'}">
    <div class="meta"><span>${hhmm(ev.at)}</span><span>${esc(ev.publisher || '')}</span>${isAi ? '<span>· read by local AI</span>' : ev.relevant ? '' : '<span>· no market link found</span>'}</div>
    <a class="t" href="${esc(ev.link)}" target="_blank" rel="noopener">${esc(ev.title)}</a>
    ${chips ? `<div class="chips">${chips}</div>` : ''}</div>`;
}
function logItem(ev) {
  let text = '', k = '';
  if (ev.type === 'source') { text = `${esc(ev.source)}: ${ev.ok ? `${ev.count} stories, ${ev.fresh} new` : 'could not be read'}`; k = ev.ok ? '' : 'alert'; }
  else if (ev.type === 'phase') { text = esc(ev.text); k = 'ok'; }
  else if (ev.type === 'alert') { text = `🔔 ${esc(ev.title)}`; k = 'alert'; }
  else if (ev.type === 'done') { text = `✓ ${esc(ev.text)}`; k = 'ok'; }
  return `<div><time>${hhmm(ev.at)}</time><span class="${k}">${text}</span></div>`;
}
async function renderLive() {
  if (!S.liveLoaded) {
    const j = await api('live?limit=300');
    const seen = new Set(S.live.map(e => e.type + e.at + (e.id || '')));
    S.live = S.live.concat(j.events.filter(e => !seen.has(e.type + e.at + (e.id || '')))).sort((a, b) => b.at - a.at);
    S.liveLoaded = true;
  }
  const relOnly = $('#liveOnlyRelevant').checked;
  const stories = S.live.filter(e => e.type === 'ai' || (e.type === 'article' && (!relOnly || e.relevant))).slice(0, 150);
  $('#liveStream').innerHTML = stories.map(e => storyItem(e)).join('') || '<div class="empty">Nothing processed yet. Stories show up here as soon as Finad reads them; click "Read the news now" to start.</div>';
  $('#liveLog').innerHTML = S.live.filter(e => !['article', 'ai'].includes(e.type)).slice(0, 200).map(logItem).join('') || '<div class="muted">No activity yet.</div>';
  renderPipeline();
}
$('#liveOnlyRelevant').onchange = renderLive;
function renderPipeline() {
  const st = S.status || {}; const c = st.counts || {};
  const ph = st.busy ? st.phase : '';
  const stage = (label, val, sub, on) => `<div class="stage ${on ? 'active' : ''}"><span>${label}</span><b>${val}</b><small>${sub}</small></div>`;
  const sig = S.state?.signals || { SELL: [], BUY: [] };
  $('#pipeline').innerHTML = [
    stage('1 · Read', c.fresh ?? 0, `new stories, ${c.read ?? 0} read`, ph === 'news'),
    stage('2 · Companies', c.matched ?? 0, 'stories naming a tracked stock', ph === 'news'),
    stage('3 · World drivers', c.themed ?? 0, 'stories moving a macro theme', ph === 'news'),
    stage('4 · Local AI', st.ai?.analyzed ?? 0, st.ai?.available ? `${st.ai.queue ?? 0} waiting · ${esc(st.ai.model)}` : 'Ollama not found', ph === 'ai'),
    stage('5 · Signals', `${sig.SELL.length} / ${sig.BUY.length}`, 'sell / buy · prices ' + (st.lastQuotes ? ago(st.lastQuotes) : '–'), ph === 'quotes' || ph === 'analysis'),
    stage('6 · Phone', S.phone?.enabled ? '✓' : '–', S.phone?.lastPush ? 'feed sent ' + ago(S.phone.lastPush) : 'not linked', false),
  ].join('');
}

// ---------- toasts ----------
function toast(a) {
  const el = document.createElement('div');
  el.className = 'toast ' + (a.action || '');
  el.innerHTML = `<b>${esc(a.title)}</b>${esc(a.body || '')}`;
  el.onclick = () => { el.remove(); if (a.sym && a.sym !== 'TEST') openStock(a.sym); };
  $('#toasts').prepend(el);
  setTimeout(() => el.remove(), 9000);
}

// ---------- tape ----------
function renderTape() {
  const ix = Object.values(S.state.indices || {});
  $('#tape').innerHTML = ix.map(i => `<span><b>${esc(i.label)}</b>${num(i.price, i.price > 1000 ? 0 : 2)} <span class="${cls(i.chg1d)}">${pct(i.chg1d, 2)}</span></span>`).join('') || '<span class="muted">Index data appears after the first price refresh.</span>';
}

// ---------- shared bits ----------
function rangeBar(r) {
  if (r.pos52 == null) return '';
  return `<div class="rangewrap" title="52-week range"><span>${num(r.lo52)}</span><div class="range"><i style="left:${(r.pos52 * 100).toFixed(1)}%"></i></div><span>${num(r.hi52)}</span></div>`;
}
function meter(v, label = 'News') {
  const c = v < 0 ? 'var(--sell)' : 'var(--buy)';
  return `<span class="meter" title="News impact: ${v.toFixed(2)} (−1 to +1)">${label} <s style="--w:${Math.min(100, Math.abs(v) * 100)}%;--c:${c}"></s><b class="${cls(v)}">${v > 0 ? '+' : ''}${v.toFixed(2)}</b></span>`;
}
function spark(r) {
  const v = r.spark || []; if (v.length < 2) return '';
  const W = 120, H = 44, lo = Math.min(r.lo52 ?? Infinity, ...v), hi = Math.max(r.hi52 ?? -Infinity, ...v);
  const x = i => i / (v.length - 1) * W, y = p => 3 + (1 - (p - lo) / (hi - lo || 1)) * (H - 6);
  const d = v.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p).toFixed(1)}`).join('');
  const c = css(COLORS[r.action] === '--muted' ? '--accent' : COLORS[r.action]);
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><line x1="0" x2="${W}" y1="${y(hi)}" y2="${y(hi)}" stroke="${css('--sell')}" stroke-dasharray="2 3" opacity=".6"/><line x1="0" x2="${W}" y1="${y(lo)}" y2="${y(lo)}" stroke="${css('--buy')}" stroke-dasharray="2 3" opacity=".6"/><path d="${d}" fill="none" stroke="${c}" stroke-width="1.8"/><circle cx="${x(v.length - 1)}" cy="${y(v[v.length - 1])}" r="2.5" fill="${c}"/></svg>`;
}
function driverChips(r, n = 3) {
  const ev = r.evidence;
  if (!ev) return '';
  const items = [
    ...ev.themes.filter(t => Math.sign(t.c) === Math.sign(r.impact)).slice(0, n).map(t => `<span class="chip ${t.c > 0 ? 'pos' : 'neg'}">${esc(t.label)}</span>`),
    ...ev.direct.filter(d => Math.sign(d.c) === Math.sign(r.impact)).slice(0, 1).map(() => `<span class="chip ${r.impact > 0 ? 'pos' : 'neg'}">Company news</span>`),
  ];
  return `<div class="chips">${items.join('')}</div>`;
}
function card(r) {
  return `<div class="card ${r.action}" data-sym="${esc(r.sym)}">
    <div class="r1"><span class="sym">${esc(r.sym)}</span><span class="badge ${r.action}">${ACTION_LABEL[r.action]}</span>${r.held ? '<span class="badge held">You hold</span>' : ''}
      <span class="name">${esc(r.name)} · ${esc(r.sector)}</span><span class="px">${num(r.price)} <small class="${cls(r.chg1d)}">${pct(r.chg1d)}</small></span></div>
    <div class="body"><div class="why">${esc(r.rationale)}</div>${spark(r)}</div>
    <div class="r3">${rangeBar(r)}${meter(r.impact)}<span title="Signal strength: news impact × how far into the zone × amount of evidence">Conviction <b>${r.conviction}</b></span></div>
    <div class="r3">${driverChips(r)}<span style="margin-left:auto">To 52w mid <b class="${cls(r.toMid)}">${pct(r.toMid)}</b></span></div>
  </div>`;
}
function miniItem(r) {
  return `<div class="item" data-sym="${esc(r.sym)}"><b>${esc(r.sym)}</b><span>${esc(r.name)}</span><span class="${cls(r.impact)}">news ${r.impact > 0 ? '+' : ''}${r.impact.toFixed(2)}</span><span class="muted">${(r.pos52 * 100).toFixed(0)}% of range</span></div>`;
}
document.addEventListener('click', (e) => {
  const ch = e.target.closest('[data-ticker]');
  if (ch && !e.target.closest('a[data-rm]')) { e.preventDefault(); e.stopPropagation(); openStock(ch.dataset.ticker); return; }
  const el = e.target.closest('[data-sym]');
  if (el && el.dataset.sym && !e.target.closest('input,button,a,form')) openStock(el.dataset.sym);
});

// ---------- signals ----------
function renderSignals() {
  const sg = S.state.signals;
  const topThemes = S.state.themes.filter(t => Math.abs(t.intensity) > 0.15).slice(0, 3);
  const heldSell = sg.SELL.filter(r => r.held).length;
  const rows = S.state.rows;
  $('#kpis').innerHTML = `
    <div class="kpi sell"><span>Sell alerts</span><b class="down">${sg.SELL.length}</b><small>${heldSell ? `${heldSell} you hold` : 'near 52w high, bad news'}</small></div>
    <div class="kpi buy"><span>Buy ideas</span><b class="up">${sg.BUY.length}</b><small>near 52w low, good news</small></div>
    <div class="kpi"><span>Near 52w high / low</span><b>${rows.filter(r => r.zone === 'high').length} / ${rows.filter(r => r.zone === 'low').length}</b><small>of ${rows.length} stocks tracked</small></div>
    <div class="kpi wide2"><span>Top world drivers</span><div class="chips" style="margin-top:6px">${topThemes.map(t => `<span class="chip ${t.intensity > 0 ? 'pos' : 'neg'}" data-go="themes">${esc(t.label)} ${dirWord(t)}</span>`).join(' ') || '<span class="muted">none strong yet</span>'}</div></div>`;
  $('#sellList').innerHTML = sg.SELL.slice(0, 25).map(card).join('') || '<div class="empty">No sell alerts. No stock near its 52-week high has clearly negative news right now.</div>';
  $('#buyList').innerHTML = sg.BUY.slice(0, 25).map(card).join('') || '<div class="empty">No buy ideas. No stock near its 52-week low has clearly positive news right now.</div>';
  $('#avoidList').innerHTML = sg.AVOID.slice(0, 12).map(miniItem).join('') || '<div class="empty">None</div>';
  $('#holdList').innerHTML = sg.HOLD.slice(0, 12).map(miniItem).join('') || '<div class="empty">None</div>';
  if (!S.miniLoaded) {
    S.miniLoaded = true;
    api('live?limit=80').then(j => {
      const items = j.events.filter(e => e.type === 'ai' || (e.type === 'article' && e.relevant)).slice(0, 14);
      $('#miniLive').innerHTML = items.map(e => storyItem(e)).join('') || '<div class="muted small">Stories appear here as they are processed.</div>';
    }).catch(() => {});
  }
}
function dirWord(t) {
  if (t.type === 'event') return t.intensity > 0 ? '↑ escalating' : '↓ easing';
  return t.intensity > 0 ? '↑ rising' : '↓ falling';
}

// ---------- alerts ----------
function alertItem(a) {
  const ic = a.action === 'INFO' ? 'i' : a.action;
  return `<div class="alertitem" ${a.sym && a.sym !== 'TEST' ? `data-sym="${esc(a.sym)}"` : ''}><div class="ic ${esc(a.action)}">${esc(ic)}</div><div><b>${esc(a.title)}</b><p>${esc(a.body)}</p></div><time>${ago(a.at)}</time></div>`;
}
function renderMiniAlerts(list) {
  $('#miniAlerts').innerHTML = (list || []).slice(0, 6).map(alertItem).join('') || '<div class="muted small">No alerts yet. Finad raises one when a stock newly turns SELL or BUY.</div>';
  const fresh = (list || []).filter(a => Date.now() - a.at < 24 * 3600e3).length;
  const n = $('#nav-alerts'); n.textContent = fresh || ''; n.classList.toggle('hot', fresh > 0);
}
async function loadAlerts() {
  const j = await api('alerts');
  $('#alertList').innerHTML = j.alerts.map(alertItem).join('') || '<div class="empty">No alerts yet. The first update only records where every stock stands. From then on, Finad raises an alert whenever a stock newly turns SELL or BUY.</div>';
}

// ---------- map ----------
function fillSectors() {
  const sel = $('#sectorFilter'), cur = sel.value;
  const secs = [...new Set(S.state.rows.map(r => r.sector))].sort();
  sel.innerHTML = '<option value="">All sectors</option>' + secs.map(s => `<option ${s === cur ? 'selected' : ''}>${esc(s)}</option>`).join('');
}
$('#sectorFilter').onchange = renderMap;
function renderMap() {
  if (!S.state) return;
  const svg = $('#scatter'), W = 1000, H = 560, L = 60, R = 20, T = 20, B = 44;
  const sec = $('#sectorFilter').value;
  const rows = S.state.rows.filter(r => r.pos52 != null && (!sec || r.sector === sec));
  const cfg = S.state.cfg;
  const maxI = Math.max(0.3, ...rows.map(r => Math.abs(r.impact)));
  const x = (p) => L + p * (W - L - R), y = (v) => T + (1 - (v + maxI) / (2 * maxI)) * (H - T - B);
  const zoneHi = x(cfg.highZone), zoneLo = x(cfg.lowZone);
  const g = [];
  g.push(`<rect x="${L}" y="${T}" width="${zoneLo - L}" height="${y(cfg.minImpact) - T}" fill="${css('--buy')}" opacity=".09"/>`);
  g.push(`<rect x="${zoneHi}" y="${y(-cfg.minImpact)}" width="${W - R - zoneHi}" height="${H - B - y(-cfg.minImpact)}" fill="${css('--sell')}" opacity=".09"/>`);
  g.push(`<rect x="${L}" y="${y(-cfg.minImpact)}" width="${zoneLo - L}" height="${H - B - y(-cfg.minImpact)}" fill="${css('--avoid')}" opacity=".07"/>`);
  g.push(`<rect x="${zoneHi}" y="${T}" width="${W - R - zoneHi}" height="${y(cfg.minImpact) - T}" fill="${css('--hold')}" opacity=".07"/>`);
  g.push(`<line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" stroke="${css('--line')}"/>`);
  [0, .25, .5, .75, 1].forEach(p => g.push(`<line x1="${x(p)}" x2="${x(p)}" y1="${T}" y2="${H - B}" stroke="${css('--line')}" stroke-dasharray="2 4"/><text x="${x(p)}" y="${H - B + 16}" text-anchor="middle">${p === 0 ? '52w low' : p === 1 ? '52w high' : (p * 100) + '%'}</text>`));
  [-maxI, -maxI / 2, 0, maxI / 2, maxI].forEach(v => g.push(`<text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v > 0 ? '+' : ''}${v.toFixed(2)}</text>`));
  g.push(`<text x="${(L + W - R) / 2}" y="${H - 6}" text-anchor="middle">Position in 52-week range →</text>`);
  g.push(`<text transform="translate(14 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle">News impact (− hurt · + helped)</text>`);
  g.push(`<text class="ql" x="${L + 8}" y="${T + 18}" style="fill:${css('--buy')}">BUY zone</text>`);
  g.push(`<text class="ql" x="${W - R - 8}" y="${H - B - 10}" text-anchor="end" style="fill:${css('--sell')}">SELL zone</text>`);
  g.push(`<text class="ql" x="${L + 8}" y="${H - B - 10}" style="fill:${css('--avoid')}">AVOID</text>`);
  g.push(`<text class="ql" x="${W - R - 8}" y="${T + 18}" text-anchor="end" style="fill:${css('--hold')}">HOLD</text>`);
  for (const r of rows.slice().sort((a, b) => Math.abs(a.impact) - Math.abs(b.impact))) {
    const c = css(COLORS[r.action] || '--muted');
    const rad = 4 + Math.min(8, r.stories);
    g.push(`<circle data-sym="${esc(r.sym)}" cx="${x(r.pos52).toFixed(1)}" cy="${y(r.impact).toFixed(1)}" r="${rad}" fill="${c}" fill-opacity="${r.action === 'NONE' ? .35 : .85}"${r.held ? ` stroke="${css('--text')}" stroke-width="2"` : ''}/>`);
    if (r.action !== 'NONE' || r.held) g.push(`<text class="lbl" x="${(x(r.pos52) + rad + 2).toFixed(1)}" y="${(y(r.impact) + 3).toFixed(1)}">${esc(r.sym)}</text>`);
  }
  svg.innerHTML = g.join('');
  const tip = $('#tip');
  svg.onmousemove = (e) => {
    const c = e.target.closest('circle');
    if (!c) { tip.style.display = 'none'; return; }
    const r = S.bySym[c.dataset.sym];
    tip.innerHTML = `<b>${esc(r.sym)}</b> ${esc(r.name)}<br>${num(r.price)} · ${(r.pos52 * 100).toFixed(0)}% of 52w range<br>News impact <b class="${cls(r.impact)}">${r.impact.toFixed(2)}</b> · ${r.stories} stories<br><span class="badge ${r.action}">${ACTION_LABEL[r.action]}</span>`;
    const box = svg.parentElement.getBoundingClientRect();
    tip.style.display = 'block';
    tip.style.left = Math.min(box.width - 290, e.clientX - box.left + 14) + 'px';
    tip.style.top = (e.clientY - box.top + 14) + 'px';
  };
  svg.onmouseleave = () => tip.style.display = 'none';
}

// ---------- table ----------
const COLS = [
  ['sym', 'Symbol'], ['name', 'Name'], ['sector', 'Sector'], ['action', 'Signal'], ['conviction', 'Conviction', 1], ['price', 'Price', 1],
  ['chg1d', '1D', 1], ['chg1m', '1M', 1], ['pos52', '52w pos', 1], ['offHigh', 'vs high', 1], ['offLow', 'vs low', 1], ['impact', 'News impact', 1], ['direct', 'Company', 1], ['thematic', 'World', 1], ['stories', 'Stories', 1],
];
function renderTable() {
  const q = $('#tableSearch').value.toLowerCase();
  const { k, d } = S.sort;
  const rows = S.state.rows.filter(r => !q || (r.sym + ' ' + r.name + ' ' + r.sector).toLowerCase().includes(q))
    .sort((a, b) => { const x = a[k], y = b[k]; return (typeof x === 'string' ? x.localeCompare(y) : (x ?? -9) - (y ?? -9)) * d; });
  $('#allTable').innerHTML = `<thead><tr>${COLS.map(([key, l, n]) => `<th class="${n ? 'num' : ''}" data-k="${key}">${l}${k === key ? (d > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
  <tbody>${rows.map(r => `<tr data-sym="${esc(r.sym)}"><td><b>${esc(r.sym)}</b>${r.held ? ' <span class="badge held">held</span>' : ''}</td><td>${esc(r.name)}</td><td class="muted">${esc(r.sector)}</td>
    <td><span class="badge ${r.action}">${ACTION_LABEL[r.action]}</span></td><td class="num">${r.conviction || ''}</td><td class="num">${num(r.price)}</td>
    <td class="num ${cls(r.chg1d)}">${pct(r.chg1d)}</td><td class="num ${cls(r.chg1m)}">${pct(r.chg1m)}</td><td class="num">${r.pos52 == null ? '–' : (r.pos52 * 100).toFixed(0) + '%'}</td>
    <td class="num">${pct(r.offHigh)}</td><td class="num">${pct(r.offLow)}</td><td class="num ${cls(r.impact)}">${r.impact.toFixed(2)}</td>
    <td class="num ${cls(r.direct)}">${r.direct.toFixed(2)}</td><td class="num ${cls(r.thematic)}">${r.thematic.toFixed(2)}</td><td class="num">${r.stories}</td></tr>`).join('')}</tbody>`;
  $$('#allTable th').forEach(th => th.onclick = () => { const key = th.dataset.k; S.sort = { k: key, d: S.sort.k === key ? -S.sort.d : -1 }; renderTable(); });
}
$('#tableSearch').oninput = renderTable;

// ---------- themes ----------
function renderThemes() {
  const th = S.state.themes;
  $('#themeGrid').innerHTML = th.map(t => {
    const w = Math.abs(t.intensity) * 50, c = t.intensity > 0 ? 'var(--buy)' : 'var(--sell)';
    const bar = `<div class="ibar"><i style="left:${t.intensity >= 0 ? 50 : 50 - w}%;width:${w}%;background:${c}"></i></div>`;
    const chips = (list, k) => list.map(s => `<span class="chip ${k}" data-ticker="${esc(s)}">${esc(s)}</span>`).join('');
    return `<div class="theme">
      <div class="t1"><div><h3>${esc(t.label)}</h3><div class="lab">${t.type === 'event' ? 'World event' : 'Market factor'} · ${t.n} articles (${t.up}↑ ${t.down}↓)</div></div><span class="dir ${t.intensity > 0 ? 'up' : 'down'}">${dirWord(t)}</span></div>
      ${bar}
      ${t.winners.length ? `<div><span class="muted small">Helped:</span> <div class="chips">${chips(t.winners, 'pos')}</div></div>` : ''}
      ${t.losers.length ? `<div><span class="muted small">Hurt:</span> <div class="chips">${chips(t.losers, 'neg')}</div></div>` : ''}
      <ul>${t.articles.slice(0, 4).map(a => `<li><a href="${esc(a.link)}" target="_blank" rel="noopener">${esc(a.title)}</a> <span class="muted">· ${esc(a.publisher)} · ${ago(a.ts)}</span></li>`).join('')}</ul>
    </div>`;
  }).join('') || '<div class="empty">No world drivers detected yet. Refresh to read the news.</div>';
}

// ---------- news ----------
$$('#newsFilter button').forEach(b => b.onclick = () => { S.newsFilter = b.dataset.f; $$('#newsFilter button').forEach(x => x.classList.toggle('on', x === b)); loadNews(); });
let newsT; $('#newsSearch').oninput = () => { clearTimeout(newsT); newsT = setTimeout(loadNews, 250); };
async function loadNews() {
  const q = $('#newsSearch').value.trim();
  const j = await api(`news?filter=${S.newsFilter}&limit=200&q=${encodeURIComponent(q)}`);
  const themeLabel = Object.fromEntries((S.meta?.themes || []).map(t => [t.id, t.label]));
  $('#newsList').innerHTML = `<p class="muted">${j.total} articles${j.total > 200 ? ' (showing the newest 200)' : ''}</p>` + j.items.map(a => {
    const m = Object.entries(a.mentions || {}).map(([s, v]) => `<span class="chip ${v.sent > 0.05 ? 'pos' : v.sent < -0.05 ? 'neg' : ''}" data-ticker="${esc(s)}" title="Mentioned in ${esc(v.where)}; tone ${v.sent}">${esc(s)} ${v.sent > 0.05 ? '▲' : v.sent < -0.05 ? '▼' : '•'}</span>`);
    const ai = (a.ai || []).filter(x => !(a.mentions || {})[x.sym] && x.conf >= 0.5).map(x => `<span class="chip ai ${x.dir > 0 ? 'pos' : 'neg'}" data-ticker="${esc(x.sym)}" title="Local AI: ${esc(x.reason)}">AI: ${esc(x.sym)} ${x.dir > 0 ? '▲' : '▼'}</span>`);
    const th = (a.themes || []).map(t => `<span class="chip" title="${esc(t.sentence)}">${esc(themeLabel[t.id] || t.id)} ${t.dir > 0 ? '↑' : '↓'}</span>`);
    return `<div class="nitem"><div class="meta"><span>${esc(a.publisher)}</span><span>${ago(a.ts)}</span><span>${a.kind === 'world' ? 'World' : 'Markets'}</span></div>
      <a class="t" href="${esc(a.link)}" target="_blank" rel="noopener">${esc(a.title)}</a>${a.summary ? `<div class="s">${esc(a.summary)}</div>` : ''}
      ${m.length + ai.length + th.length ? `<div class="chips">${[...m, ...ai, ...th].join('')}</div>` : ''}</div>`;
  }).join('');
}

// ---------- drawer ----------
async function openStock(sym) {
  const d = await api('stock/' + encodeURIComponent(sym)).catch(() => null);
  if (!d) { toast({ title: `${sym} is not tracked`, body: "Add it under Portfolio → Stocks I'm interested in." }); return; }
  const ev = d.evidence, held = d.held;
  $('#drawerBody').innerHTML = `
    <div class="dhead"><span class="sym">${esc(d.sym)}</span><span class="badge ${d.action}">${ACTION_LABEL[d.action]}</span>${held ? '<span class="badge held">You hold</span>' : ''}
      <span class="muted">${esc(d.name)} · ${esc(d.sector)}</span><span class="px">${num(d.price)} <small class="${cls(d.chg1d)}">${pct(d.chg1d)}</small></span></div>
    <div class="verdict ${d.action}">${d.action === 'NONE' ? '<b>No signal.</b> ' : `<b>${ACTION_LABEL[d.action]} · conviction ${d.conviction}/100.</b> `}${esc(d.rationale)}</div>
    ${chart(d)}
    <div class="stats">
      <div><span>52-week high</span><b>${num(d.hi52)}</b></div><div><span>52-week low</span><b>${num(d.lo52)}</b></div>
      <div><span>Position in range</span><b>${d.pos52 == null ? '–' : (d.pos52 * 100).toFixed(0) + '%'}</b></div><div><span>To 52w midpoint</span><b class="${cls(d.toMid)}">${pct(d.toMid)}</b></div>
      <div><span>1 month</span><b class="${cls(d.chg1m)}">${pct(d.chg1m)}</b></div><div><span>3 months</span><b class="${cls(d.chg3m)}">${pct(d.chg3m)}</b></div>
      <div><span>News impact</span><b class="${cls(d.impact)}">${d.impact.toFixed(2)}</b></div><div><span>Company / World</span><b><span class="${cls(d.direct)}">${d.direct.toFixed(2)}</span> / <span class="${cls(d.thematic)}">${d.thematic.toFixed(2)}</span></b></div>
      ${held ? `<div><span>Your shares</span><b>${num(held.shares, 0)}</b></div><div><span>Your P/L</span><b class="${cls(d.price - held.cost)}">${held.cost ? pct((d.price - held.cost) / held.cost) : '–'}</b></div>` : ''}
    </div>
    <h4>World drivers affecting ${esc(d.sym)}</h4>
    ${ev.themes.length ? `<ul class="ev">${ev.themes.map(t => `<li><span class="c ${cls(t.c)}">${t.c > 0 ? '+' : ''}${t.c.toFixed(2)}</span><div><b>${esc(t.label)}</b> ${t.dir > 0 ? '↑' : '↓'} <span class="muted">(${t.n} articles)</span><small>${esc(t.sens > 0 ? 'This business gains when it rises.' : 'This business is hurt when it rises.')} Lead story: <a href="${esc(t.link)}" target="_blank" rel="noopener">${esc(t.title)}</a></small></div></li>`).join('')}</ul>` : '<p class="muted">No active world driver touches this stock.</p>'}
    <h4>Company news</h4>
    ${ev.direct.length ? `<ul class="ev">${ev.direct.map(e => `<li><span class="c ${cls(e.c)}">${e.c > 0 ? '+' : ''}${e.c.toFixed(2)}</span><div><a href="${esc(e.link)}" target="_blank" rel="noopener">${esc(e.title)}</a><small>${esc(e.publisher)} · ${ago(e.ts)} · read by ${esc(e.why)}${e.reason ? ' — AI: ' + esc(e.reason) : ''}</small></div></li>`).join('')}</ul>` : '<p class="muted">No company-specific stories with a clear tone in the last few days.</p>'}
    ${d.related.length ? `<h4>All recent mentions</h4><ul class="ev">${d.related.slice(0, 20).map(a => `<li><span class="c ${cls(a.sent)}">${a.sent == null ? 'AI' : (a.sent > 0 ? '+' : '') + a.sent.toFixed(2)}</span><div><a href="${esc(a.link)}" target="_blank" rel="noopener">${esc(a.title)}</a><small>${esc(a.publisher)} · ${ago(a.ts)}</small></div></li>`).join('')}</ul>` : ''}
    <p class="muted small">Tags: ${d.tags.map(t => `<code>${esc(t)}</code>`).join(' ') || 'none'}</p>`;
  $('#drawer').classList.add('on'); $('#scrim').classList.add('on'); $('#drawer').setAttribute('aria-hidden', 'false');
}
function closeDrawer() { $('#drawer').classList.remove('on'); $('#scrim').classList.remove('on'); $('#drawer').setAttribute('aria-hidden', 'true'); }
$('#drawerClose').onclick = closeDrawer; $('#scrim').onclick = closeDrawer;
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });

function chart(d) {
  const h = d.hist || [];
  if (h.length < 2) return '';
  const W = 660, H = 220, L = 8, R = 62, T = 12, B = 22;
  const vals = h.map(p => p[1]);
  const lo = Math.min(d.lo52, ...vals), hi = Math.max(d.hi52, ...vals);
  const x = i => L + i / (h.length - 1) * (W - L - R), y = v => T + (1 - (v - lo) / (hi - lo || 1)) * (H - T - B);
  const path = h.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p[1]).toFixed(1)}`).join('');
  const area = path + `L${x(h.length - 1)} ${H - B}L${x(0)} ${H - B}Z`;
  const c = css(COLORS[d.action] === '--muted' ? '--accent' : COLORS[d.action]);
  const mid = (d.hi52 + d.lo52) / 2;
  const line = (v, label, col) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${col}" stroke-dasharray="4 4" opacity=".8"/><text x="${W - R + 4}" y="${y(v) + 4}">${label}</text>`;
  const months = []; let lastM = -1;
  h.forEach((p, i) => { const m = new Date(p[0]).getMonth(); if (m !== lastM && i > 3 && i < h.length - 3) months.push(`<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${new Date(p[0]).toLocaleString(undefined, { month: 'short' })}</text>`); lastM = m; });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="One-year price chart">
    <path d="${area}" fill="${c}" opacity=".12"/><path d="${path}" fill="none" stroke="${c}" stroke-width="2"/>
    ${line(d.hi52, '52w hi', css('--sell'))}${line(d.lo52, '52w lo', css('--buy'))}${line(mid, 'mid', css('--muted'))}
    <circle cx="${x(h.length - 1)}" cy="${y(vals[vals.length - 1])}" r="4" fill="${c}"/>${months.join('')}</svg>`;
}

// ---------- portfolio ----------
function renderPortfolio() {
  const hs = S.state.holdings;
  let value = 0, cost = 0;
  const rows = hs.map((h, i) => {
    const r = S.bySym[h.sym];
    const px = r?.price; const v = px != null ? px * h.shares : null;
    if (v != null) { value += v; cost += h.cost * h.shares; }
    return `<tr data-sym="${r ? esc(h.sym) : ''}"><td><b>${esc(h.sym)}</b></td><td>${esc(r?.name || 'Not tracked yet')}</td>
      <td><span class="badge ${r?.action || 'NONE'}">${ACTION_LABEL[r?.action || 'NONE']}</span></td>
      <td class="num"><input type="number" step="any" value="${h.shares}" data-i="${i}" data-f="shares"></td><td class="num"><input type="number" step="any" value="${h.cost}" data-i="${i}" data-f="cost"></td>
      <td class="num">${num(px)}</td><td class="num">${v == null ? '–' : num(v, 0)}</td><td class="num ${cls(px - h.cost)}">${px != null && h.cost ? pct((px - h.cost) / h.cost) : '–'}</td>
      <td class="num">${r?.pos52 == null ? '–' : (r.pos52 * 100).toFixed(0) + '%'}</td><td class="num ${cls(r?.impact)}">${r ? r.impact.toFixed(2) : '–'}</td>
      <td><button class="btn small" data-del="${i}">Remove</button></td></tr>`;
  });
  $('#pfTable').innerHTML = hs.length ? `<thead><tr><th>Symbol</th><th>Name</th><th>Signal</th><th class="num">Shares</th><th class="num">Avg cost</th><th class="num">Price</th><th class="num">Value</th><th class="num">P/L</th><th class="num">52w pos</th><th class="num">News</th><th></th></tr></thead><tbody>${rows.join('')}</tbody>` : '<tbody><tr><td class="muted">No holdings yet. Add one below.</td></tr></tbody>';
  const sells = hs.filter(h => S.bySym[h.sym]?.action === 'SELL').length, watch = hs.filter(h => ['WATCH', 'AVOID'].includes(S.bySym[h.sym]?.action)).length;
  $('#pfSummary').innerHTML = hs.length ? `<div class="kpi"><span>Market value</span><b>${num(value, 0)}</b></div><div class="kpi"><span>Total P/L</span><b class="${cls(value - cost)}">${cost ? pct((value - cost) / cost) : '–'}</b></div><div class="kpi sell"><span>Holdings flagged SELL</span><b class="down">${sells}</b></div><div class="kpi"><span>Holdings to watch</span><b>${watch}</b></div>` : '';
  $$('#pfTable input').forEach(inp => inp.onchange = () => { hs[+inp.dataset.i][inp.dataset.f] = +inp.value; saveHoldings(hs); });
  $$('#pfTable [data-del]').forEach(b => b.onclick = (e) => { e.stopPropagation(); hs.splice(+b.dataset.del, 1); saveHoldings(hs); });
  $('#tagList').innerHTML = (S.meta?.tags || []).map(t => `<option value="${esc(t)}">`).join('');
  const custom = (S.meta?.universe || []).filter(u => u.custom);
  $('#customList').innerHTML = custom.map(c => `<span class="chip" data-ticker="${esc(c.sym)}" title="${esc(c.tags.join(' '))}">${esc(c.sym)} · ${esc(c.name)} <a href="#" data-rm="${esc(c.sym)}">×</a></span>`).join('') || '<span class="muted small">None added yet.</span>';
  $$('#customList [data-rm]').forEach(a => a.onclick = async (e) => { e.preventDefault(); e.stopPropagation(); await api('custom', { method: 'DELETE', body: { sym: a.dataset.rm } }); loadAll(); });
}
async function saveHoldings(hs) {
  const j = await api('holdings', { body: { holdings: hs } });
  if (j.missing?.length) {
    for (const sym of j.missing) await api('custom', { body: { sym } }).catch(() => {});
    api('refresh', { body: { prices: false, ai: false } });
  }
  await loadAll();
}
$('#pfAdd').onsubmit = async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const hs = S.state.holdings.slice();
  const sym = f.get('sym').toUpperCase().trim();
  const i = hs.findIndex(h => h.sym === sym);
  const h = { sym, shares: +f.get('shares') || 0, cost: +f.get('cost') || 0 };
  if (i >= 0) hs[i] = h; else hs.push(h);
  e.target.reset();
  await saveHoldings(hs);
};
$('#customAdd').onsubmit = async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  $('#customMsg').textContent = 'Looking up…';
  try {
    const j = await api('custom', { body: { sym: f.get('sym'), tags: String(f.get('tags') || '').split(/[\s,]+/).filter(Boolean) } });
    $('#customMsg').textContent = `Now tracking ${j.stock.sym} (${j.stock.name}).`;
    e.target.reset(); loadAll();
    api('refresh', { body: { prices: false, ai: false } });
  } catch (err) { $('#customMsg').textContent = err.message; }
};

// ---------- phone ----------
function qr(text, el) {
  try { const q = qrcode(0, 'M'); q.addData(text); q.make(); el.innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); }
  catch { el.textContent = 'QR code unavailable'; }
}
async function renderPhone() {
  const p = S.phone = await api('phone');
  const body = $('#phoneBody');
  if (!p.enabled || !p.paired) {
    body.innerHTML = `<p>Turn on the phone link to get one QR code. Scanned with your Android phone's camera, it installs the Finad app if needed and links it to this computer. Finad then sends its signals and alerts to your phone after every update, and the app updates itself.</p>
      ${p.error ? `<p class="down small">The last attempt failed: ${esc(p.error)}</p>` : ''}
      <button id="phoneOn" class="btn primary">Turn on the phone link</button>`;
    $('#phoneOn').onclick = async (e) => { e.target.disabled = true; e.target.textContent = 'Linking…'; await api('phone/enable', { body: {} }).catch(err => toast({ title: 'Phone link failed', body: err.message })); renderPhone(); };
    return;
  }
  body.innerHTML = `<div class="pair"><div class="qr" id="qrPair"></div><div>
      <p><b>Scan this with your Android phone's camera.</b> It installs the Finad app if the phone does not have it yet, then links it to this computer. Already have the app? Scan it there with Link computer → Scan QR code. The app updates itself, so you only scan once.</p>
      <div class="kv"><span>Status</span><b class="${p.error ? 'down' : 'up'}">${p.error ? 'Last send failed: ' + esc(p.error) : 'Linked'}</b>
        <span>Last sent</span><b>${p.lastPush ? ago(p.lastPush) : 'never'}</b>
        <span>Store</span><b>${esc(p.store)}</b>
        <span>Read-only id</span><code>${esc(p.ro)}</code></div>
      <div class="row gap" style="flex-wrap:wrap"><button id="phoneTest" class="btn primary">Send a test notification</button><button id="phoneCopy" class="btn">Copy link</button><button id="phoneNew" class="btn">New link</button><button id="phoneOff" class="btn danger">Turn off</button></div>
      <p class="muted small" style="margin-top:8px">The phone checks about every 15 minutes, so a test notification can take that long to arrive. Opening the app checks at once. "New link" stops the old link working; scan the new code afterwards.</p>
    </div></div>`;
  qr(p.link, $('#qrPair'));
  $('#phoneTest').onclick = async () => { await api('phone/test', { body: {} }); toast({ title: 'Test sent', body: 'Your phone shows it at its next check. Open the app to check now.' }); renderPhone(); };
  $('#phoneCopy').onclick = () => { navigator.clipboard?.writeText(p.link); toast({ title: 'Link copied', body: p.link }); };
  $('#phoneNew').onclick = async () => { if (confirm('Make a new link? The phone linked now stops getting updates until you scan the new code.')) { await api('phone/enable', { body: { newKey: true } }); renderPhone(); } };
  $('#phoneOff').onclick = async () => { await api('phone/disable', { body: {} }); renderPhone(); };
}

// ---------- updates ----------
function renderUpdateBanner() {
  const u = S.status?.update, el = $('#updateBanner');
  if (!u?.available) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `<b>Finad ${esc(u.latest)} is available.</b> <span class="muted">${esc(u.notes || '')}</span> <button class="btn small primary" data-go="settings">See the update</button>`;
}
function renderUpdateBox() {
  const u = S.status?.update || {};
  const box = $('#updateBox');
  box.innerHTML = `<p>Installed version <b>${esc(S.status?.version)}</b>${u.latest ? ` · latest <b>${esc(u.latest)}</b>` : ''}${u.checkedAt ? ` <span class="muted">(checked ${ago(u.checkedAt)})</span>` : ''}</p>
    ${u.error ? `<p class="muted small">Could not check: ${esc(u.error)}</p>` : ''}
    ${u.available ? (u.installed ? `<p>${esc(u.notes || 'A new version is ready.')}</p><button id="updApply" class="btn primary">Install ${esc(u.latest)} and restart</button>`
      : `<p>This copy runs from a project folder, so it doesn't update itself. <a href="https://shamoug.github.io/finad/download.html" target="_blank" rel="noopener">Download the new installer</a>.</p>`) : (u.latest ? '<p class="muted">You have the latest version.</p>' : '')}
    <div class="row gap"><button id="updCheck" class="btn">Check now</button></div>
    <p class="muted small">Finad checks every 6 hours. The version file and its SHA-256 checksum come from the Finad website (shamoug.github.io/finad), and a download that doesn't match its checksum is never installed.</p>`;
  $('#updCheck').onclick = async () => { $('#updCheck').disabled = true; S.status.update = await api('update/check', { body: {} }).catch(e => ({ error: e.message })); renderUpdateBox(); renderUpdateBanner(); };
  const ap = $('#updApply');
  if (ap) ap.onclick = async () => { ap.disabled = true; ap.textContent = 'Installing…'; try { await api('update/apply', { body: {} }); ap.textContent = 'Restarting…'; } catch (e) { ap.textContent = 'Failed'; toast({ title: 'Update failed', body: e.message }); } };
}

// ---------- settings ----------
const CFG_KEYS = { highZone: v => (v * 100).toFixed(0) + '%', lowZone: v => (v * 100).toFixed(0) + '%', minImpact: v => (+v).toFixed(2), halfLifeHours: v => v, themeWeight: v => (+v).toFixed(2) };
async function renderSettings() {
  const st = S.settings;
  for (const [k, f] of Object.entries(CFG_KEYS)) {
    const el = $('#' + k); el.value = st.cfg[k]; $('#v-' + k).textContent = f(st.cfg[k]);
    el.oninput = () => $('#v-' + k).textContent = f(el.value);
    el.onchange = async () => { S.settings = await api('settings', { body: { cfg: { [k]: +el.value } } }); loadAll(); };
  }
  const mc = $('#minConviction'); mc.value = st.alerts.minConviction; $('#v-minConviction').textContent = st.alerts.minConviction;
  mc.oninput = () => $('#v-minConviction').textContent = mc.value;
  mc.onchange = async () => { S.settings = await api('settings', { body: { alerts: { minConviction: +mc.value } } }); };
  const rm = $('#refreshMinutes'); rm.value = st.refreshMinutes; $('#v-refreshMinutes').textContent = st.refreshMinutes;
  rm.oninput = () => $('#v-refreshMinutes').textContent = rm.value;
  rm.onchange = async () => { S.settings = await api('settings', { body: { refreshMinutes: +rm.value } }); };
  $('#aiEnabled').checked = st.ai.enabled;
  $('#aiEnabled').onchange = async (e) => { S.settings = await api('settings', { body: { ai: { enabled: e.target.checked } } }); };
  renderUpdateBox();
  const models = await api('ai/models');
  $('#aiModel').innerHTML = '<option value="">Auto</option>' + models.models.map(m => `<option ${m === st.ai.model ? 'selected' : ''}>${esc(m)}</option>`).join('');
  $('#aiModel').onchange = async (e) => { S.settings = await api('settings', { body: { ai: { model: e.target.value } } }); };
  const ai = S.status?.ai;
  $('#aiInfo').innerHTML = models.available
    ? `Ollama found. ${ai?.model ? `Using <b>${esc(ai.model)}</b>; ` : ''}${ai?.analyzed ?? 0} headline(s) read this session, ${ai?.queue ?? 0} waiting. The AI refines the rule-based reading but never overrides it.`
    : 'Ollama not found at localhost:11434. Finad still works with its built-in rules. For AI reading, install Ollama from ollama.com and run <code>ollama pull qwen3:4b-instruct</code>.';
  $('#reanalyze').onclick = async () => { await api('reanalyze', { body: {} }); loadAll(); };
  $('#aiReset').onclick = async () => { if (confirm('Clear all local-AI readings? They are redone gradually.')) { await api('ai/reset', { body: {} }); loadAll(); } };
  const meta = await api('meta'); S.meta = meta;
  $('#sourceList').innerHTML = meta.sources.map(s => `<label><input type="checkbox" data-src="${esc(s.id)}" ${s.enabled ? 'checked' : ''}> ${esc(s.name)} <small class="${s.stat && !s.stat.ok ? 'bad' : ''}">${s.stat ? (s.stat.ok ? s.stat.count + ' items' : 'error') : s.kind}</small></label>`).join('');
  $$('#sourceList input').forEach(cb => cb.onchange = async () => {
    const disabled = $$('#sourceList input').filter(x => !x.checked).map(x => x.dataset.src);
    S.settings = await api('settings', { body: { disabledSources: disabled } });
  });
  $('#about').innerHTML = `Finad ${esc(S.status?.version || '')}${S.status?.desktop ? ' (desktop app)' : ''} · ${S.status?.stocks} stocks tracked · ${S.status?.articles} articles in memory · data folder <code>${esc(S.status?.dataDir || '')}</code>`;
}

// ---------- boot ----------
(async function boot() {
  await pollStatus();
  api('phone').then(p => { S.phone = p; }).catch(() => {});
  await loadAll().catch(e => { $('#kpis').innerHTML = `<span class="down">Could not load data: ${esc(e.message)}</span>`; });
  let v = 'signals'; try { v = localStorage.getItem('finad-view') || 'signals'; } catch {}
  show(v);
  connectEvents();
  setInterval(pollStatus, 15000);
})();
