// Finad's analysis engine:
//   1. per article: find companies mentioned (+ their sentiment) and macro themes (+ direction)
//   2. per stock: combine direct + thematic effects, weighted by source and recency, into a news impact
//   3. per stock: cross the impact with the 52-week position to produce SELL / BUY / AVOID / HOLD signals
const { THEMES, UP, DOWN, NOISE } = require('./themes');

const ANALYZER_VERSION = 4;

// ---------- finance sentiment lexicon ----------
const POS = [
  [/\b(beats?|beat (estimates|expectations)|tops? (estimates|expectations|forecasts?)|surpass\w*|exceed\w* (estimates|expectations))\b/i, 0.8],
  [/\b(raises?|raised|raising|lifts?|lifted|boosts?|boosted|hikes?|hiked|ups) ([\w-]+ ){0,3}(guidance|outlook|forecasts?|dividend)\b|\b(raised|higher|upbeat|strong) (\w+ ){0,2}(guidance|outlook|forecast)\b/i, 0.9],
  [/\b(upgrade[sd]?|upgrading|outperform|overweight|buy rating|price target (raised|hike|increase))\b/i, 0.7],
  [/\b(raises?|lifts?|ups) (its )?price target\b/i, 0.6],
  [/\b(record (profit|revenue|sales|quarter|high|earnings)|all-time high)\b/i, 0.6],
  [/\b(soar\w*|surg\w*|jump\w*|rall(y|ies|ied)|skyrocket\w*|spikes?|pops?|climbs?|rises?|rose|gains?|advances?)\b/i, 0.4],
  [/\b(fda approv\w*|approv(al|ed|es)|clearance|cleared by)\b/i, 0.6],
  [/\b(wins?|won|awarded|secures?|lands?) (a |an |the )?(\$?[\d.]+ ?(b|m|billion|million) )?(contract|deal|order)s?\b/i, 0.6],
  [/\b(partnership|partners with|teams up|strategic alliance|acquisition talks|to acquire|takeover (bid|offer))\b/i, 0.35],
  [/\b(buybacks?|share repurchase|special dividend|dividend (increase|hike))\b/i, 0.5],
  [/\b(strong (demand|results|sales|growth|quarter)|robust (demand|growth)|better[- ]than[- ]expected|blowout)\b/i, 0.6],
  [/\b(breakthrough|positive (trial|data|results)|successful trial|met (its )?primary endpoint)\b/i, 0.7],
  [/\b(profit (rises|jumps|soars|surges)|margin expansion|turnaround|rebound\w*)\b/i, 0.5],
  [/\b(bullish|optimis\w*|upbeat|tailwinds?)\b/i, 0.3],
];
const NEG = [
  [/\b(miss(es|ed)? (estimates|expectations|forecasts?)|falls? short|disappoint\w*|worse[- ]than[- ]expected)\b/i, -0.8],
  [/\b(cuts?|cutting|lowers?|lowered|slashe[sd]?|slashing|reduces?|reduced|withdraws?|withdrew|pulls?|pulled|suspends?|suspended) ([\w-]+ ){0,3}(guidance|outlook|forecasts?|dividend)\b|\b(lowered|weak|soft|gloomy|downbeat|disappointing) (\w+ ){0,2}(guidance|outlook|forecast)\b/i, -0.9],
  [/\b(profit warning|warns?|warned|guides? (lower|below))\b/i, -0.6],
  [/\b(downgrade[sd]?|downgrading|underperform|underweight|sell rating|price target (cut|lowered))\b/i, -0.7],
  [/\b(cuts?|lowers?) (its )?price target\b/i, -0.5],
  [/\b(plung\w*|tumbl\w*|slump\w*|sink\w*|sank|crash\w*|nosedive\w*|tank(s|ed)?|plummet\w*|sell-?off|slid(e|es)?|drops?|falls?|fell|slips?|declines?)\b/i, -0.4],
  [/\b(lawsuits?|sued|sues|class action|probe[sd]?|investigat\w*|subpoena\w*|indict\w*|charged|fraud|accounting (issues|irregularities)|restat\w*)\b/i, -0.6],
  [/\b(recalls?|recalled|safety (issue|concern)s?|grounded|crash(es)? (kills|killed)|fatal)\b/i, -0.6],
  [/\b(fined|fines?|penalt(y|ies)|sanction(s|ed)|banned|ban on|blocked by regulators|antitrust (case|suit|probe|ruling))\b/i, -0.5],
  [/\b(layoffs?|job cuts|cuts? (\d[\d,]* )?jobs|restructuring|plant closures?|shut(s|ting)? down)\b/i, -0.4],
  [/\b(bankrupt\w*|chapter 11|default\w*|insolven\w*|going concern|liquidity crunch)\b/i, -1.0],
  [/\b(ceo (resigns|steps down|ousted|exits|departs)|abrupt(ly)? (exit|departure)|executive departures?)\b/i, -0.5],
  [/\b(weak (demand|results|sales|guidance|quarter)|slowing (demand|growth|sales)|soft (demand|guidance)|demand slump|losing (market )?share)\b/i, -0.6],
  [/\b(short seller|short report|hindenburg|muddy waters)\b/i, -0.7],
  [/\b(outages?|data breach|hacked|cyberattack on)\b/i, -0.4],
  [/\b(fda (rejects?|rejection)|complete response letter|failed (trial|study)|trial (fails|failure|halted)|clinical hold)\b/i, -0.9],
  [/\b(loss (widens|deepens)|net loss|losses mount|margin (pressure|squeeze|compression))\b/i, -0.5],
  [/\b(strikes?|walkout)\b(?= (at|by|against))/i, -0.4],
  [/\b(bearish|pessimis\w*|headwinds?|gloomy|concerns? (over|about))\b/i, -0.3],
  [/\b(tariffs? (hit|weigh|hurt|cost))\b/i, -0.5],
];
const NEGATION = /\b(not|never|isn't|aren't|wasn't|won't|didn't|doesn't|fails? to)\b/i;

function sentimentOf(text) {
  if (!text) return 0;
  let s = 0, hits = 0;
  for (const [re, w] of POS) if (re.test(text)) { s += w; hits++; }
  for (const [re, w] of NEG) if (re.test(text)) { s += w; hits++; }
  if (!hits) return 0;
  // A negation flips the weaker tone only when one side dominates weakly; keep it simple: dampen.
  if (NEGATION.test(text) && Math.abs(s) < 0.9) s *= -0.5;
  return Math.max(-1, Math.min(1, s / Math.max(1, hits * 0.6)));
}

function splitSentences(text) {
  return String(text || '').split(/(?<=[.!?;])\s+|\s+[|•–—-]\s+/).map(s => s.trim()).filter(s => s.length > 3);
}

// ---------- entity matching ----------
const TICKER_STOP = new Set(['A', 'ALL', 'ARE', 'ARM', 'B', 'C', 'CAT', 'DE', 'F', 'GD', 'GE', 'GM', 'HD', 'IT', 'KEY', 'LOW', 'MA', 'MO', 'MS', 'NOW', 'O', 'ON', 'SO', 'T', 'TM', 'V', 'X', 'BP', 'CI', 'JD', 'EA', 'LIN', 'LNG', 'DOW', 'CL', 'ADM', 'GS', 'UPS', 'AIG', 'IBM', 'CVS', 'AMD', 'AMT', 'MMM']);
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function buildMatchers(stocks) {
  return stocks.map(st => {
    const sym = st.sym.replace('-', '.');
    const parts = st.aliases.map(a => escapeRe(a));
    const aliasRe = parts.length ? new RegExp(`(?<![A-Za-z0-9])(?:${parts.join('|')})(?![A-Za-z0-9])`) : null;
    const forms = [`\\(${escapeRe(sym)}\\)`, `\\$${escapeRe(sym)}\\b`, `(?:NYSE|NASDAQ|Nasdaq|NYSEAMERICAN)\\s*:\\s*${escapeRe(sym)}\\b`];
    if (sym.length >= 3 && !TICKER_STOP.has(sym)) forms.push(`(?<![A-Za-z0-9$])${escapeRe(sym)}(?![A-Za-z0-9])`);
    const tickRe = new RegExp(forms.join('|'));
    return { st, test: (s) => (aliasRe && aliasRe.test(s)) || tickRe.test(s) };
  });
}

// ---------- themes ----------
function directionIn(sentence, theme) {
  if (theme.type === 'event') {
    if (theme.relief && theme.relief.test(sentence)) return -1;
    return 1;
  }
  if (theme.upExtra && theme.upExtra.test(sentence)) return 1;
  if (theme.downExtra && theme.downExtra.test(sentence)) return -1;
  const m = sentence.match(theme.subject);
  const after = m ? sentence.slice(m.index) : sentence;
  const u = after.match(UP), d = after.match(DOWN);
  if (u && d) return u.index < d.index ? 1 : -1;
  if (u) return 1;
  if (d) return -1;
  const bu = UP.test(sentence), bd = DOWN.test(sentence);
  if (bu && !bd) return 1;
  if (bd && !bu) return -1;
  return 0;
}

function detectThemes(title, summary) {
  const found = {};
  const scan = (text, strength) => {
    for (const s of splitSentences(text)) {
      if (NOISE.test(s)) continue;
      for (const th of THEMES) {
        if (!th.subject.test(s)) continue;
        const dir = directionIn(s, th);
        if (!dir) continue;
        const prev = found[th.id];
        if (!prev || strength > prev.strength) found[th.id] = { id: th.id, dir, strength, sentence: s.slice(0, 220) };
      }
    }
  };
  scan(summary, 0.6);
  scan(title, 1.0);
  return Object.values(found);
}

// ---------- per-article analysis ----------
function analyzeArticle(a, matchers) {
  const title = a.title || '', summary = a.summary || '';
  const titleSent = sentimentOf(title);
  const sumSentences = splitSentences(summary);
  const mentions = {};
  for (const m of matchers) {
    const sym = m.st.sym;
    let rel = 0, sent = 0, where = '';
    if (m.test(title)) { rel = 1; sent = titleSent; where = 'title'; }
    else {
      const hits = sumSentences.filter(s => m.test(s));
      if (hits.length) { rel = 0.6; sent = hits.map(sentimentOf).reduce((x, y) => x + y, 0) / hits.length; where = 'summary'; }
    }
    if (!rel && a.ticker === sym) { rel = 0.6; sent = titleSent || sentimentOf(summary); where = 'ticker feed'; }
    if (rel) mentions[sym] = { rel, sent: +sent.toFixed(3), where };
  }
  return {
    v: ANALYZER_VERSION,
    sentiment: +((titleSent * 0.7) + sentimentOf(summary) * 0.3).toFixed(3),
    mentions,
    themes: detectThemes(title, summary),
  };
}

// ---------- aggregation ----------
const THEME_BY_ID = Object.fromEntries(THEMES.map(t => [t.id, t]));

function themeSensitivity(theme, tags) {
  let s = 0;
  for (const t of tags) if (theme.impacts[t] != null) s += theme.impacts[t];
  return Math.max(-1, Math.min(1, s));
}

const DEFAULTS = {
  highZone: 0.80,    // pos in 52w range at/above which a stock is "near its 52-week high"
  lowZone: 0.20,     // pos at/below which it's "near its 52-week low"
  minImpact: 0.10,   // |news impact| needed to call a signal
  halfLifeHours: 36, // news relevance half-life
  themeWeight: 0.35, // how strongly macro themes count vs direct company news
  maxAgeDays: 7,
};

function aggregate({ articles, quotes, stocks, cfg = {}, holdings = [] }) {
  cfg = { ...DEFAULTS, ...cfg };
  const now = Date.now();
  const bySym = Object.fromEntries(stocks.map(s => [s.sym, { raw: 0, direct: 0, thematic: 0, n: 0, evidence: [] }]));
  const themeAgg = {};
  const maxAge = cfg.maxAgeDays * 864e5;

  for (const a of articles) {
    const age = now - a.ts;
    if (age > maxAge || !a.an) continue;
    const decay = Math.pow(0.5, Math.max(0, age) / 36e5 / cfg.halfLifeHours);
    const w = (a.weight || 1) * decay;

    // direct company effects (rule-based, blended with local-AI reading when available)
    const direct = {};
    for (const [sym, m] of Object.entries(a.an.mentions)) direct[sym] = { score: m.sent * m.rel, rel: m.rel, why: m.where };
    // Small local models speculate, so AI refines rather than overrides: low-confidence calls are dropped,
    // AI-only calls (stock not named in the text) count at half weight.
    for (const it of a.ai?.impacts || []) {
      if (!bySym[it.sym] || (it.conf ?? 0) < 0.5) continue;
      const aiScore = Math.max(-1, Math.min(1, it.dir * it.conf));
      direct[it.sym] = direct[it.sym]
        ? { score: direct[it.sym].score * 0.6 + aiScore * 0.4 * direct[it.sym].rel, rel: direct[it.sym].rel, why: 'AI + rules', reason: it.reason }
        : { score: aiScore * 0.5, why: 'AI', reason: it.reason };
    }
    for (const [sym, d] of Object.entries(direct)) {
      const S = bySym[sym]; if (!S) continue;
      const c = d.score * w;
      S.direct += c; S.raw += c; S.n++;
      if (Math.abs(d.score) > 0.02) S.evidence.push({ kind: 'direct', c: +c.toFixed(4), id: a.id, title: a.title, link: a.link, publisher: a.publisher, ts: a.ts, why: d.why, reason: d.reason });
    }

    // macro themes: accumulate the net direction of each theme across all coverage
    for (const th of a.an.themes) {
      const theme = THEME_BY_ID[th.id]; if (!theme) continue;
      const T = themeAgg[th.id] ||= { id: th.id, label: theme.label, type: theme.type, score: 0, n: 0, up: 0, down: 0, articles: [] };
      const c = th.dir * th.strength * w;
      T.score += c; T.n++; th.dir > 0 ? T.up++ : T.down++;
      T.articles.push({ id: a.id, title: a.title, link: a.link, publisher: a.publisher, ts: a.ts, dir: th.dir, c, sentence: th.sentence });
    }
  }

  // A theme's pull saturates (tanh) so twenty articles on one war don't drown out company news.
  for (const T of Object.values(themeAgg)) {
    T.intensity = Math.tanh(T.score / 1.5);
    T.articles.sort((x, y) => Math.abs(y.c) - Math.abs(x.c));
    T.articles = T.articles.slice(0, 25);
    const theme = THEME_BY_ID[T.id];
    const lead = T.articles.find(x => Math.sign(x.dir) === Math.sign(T.intensity)) || T.articles[0];
    for (const st of stocks) {
      const sens = themeSensitivity(theme, st.tags);
      if (!sens) continue;
      const c = T.intensity * sens * cfg.themeWeight;
      const S = bySym[st.sym];
      S.thematic += c; S.raw += c;
      S.evidence.push({ kind: 'theme', theme: T.id, label: theme.label, dir: Math.sign(T.intensity), sens, c: +c.toFixed(4), n: T.n, id: lead.id, title: lead.title, link: lead.link, publisher: lead.publisher, ts: lead.ts });
    }
  }

  const held = new Map(holdings.map(h => [h.sym, h]));
  const rows = [];
  for (const st of stocks) {
    const S = bySym[st.sym];
    const q = quotes[st.sym];
    const impact = Math.tanh(S.raw / 1.5);
    // keep the strongest evidence: top direct stories + top theme effects (collapsed per theme)
    const directEv = S.evidence.filter(e => e.kind === 'direct').sort((x, y) => Math.abs(y.c) - Math.abs(x.c)).slice(0, 8);
    const themeEv = S.evidence.filter(e => e.kind === 'theme').sort((x, y) => Math.abs(y.c) - Math.abs(x.c)).slice(0, 6);
    const row = {
      sym: st.sym, name: q?.name && q.name !== st.sym ? q.name : st.name, sector: st.sector, tags: st.tags, custom: !!st.custom,
      impact: +impact.toFixed(3), direct: +S.direct.toFixed(3), thematic: +S.thematic.toFixed(3), stories: S.n,
      evidence: { direct: directEv, themes: themeEv },
      held: held.get(st.sym) || null,
    };
    if (q) Object.assign(row, {
      price: q.price, hi52: q.hi52, lo52: q.lo52, pos52: q.pos52, offHigh: q.offHigh, offLow: q.offLow,
      chg1d: q.chg1d, chg1m: q.chg1m, chg3m: q.chg3m, currency: q.currency, hist: q.hist,
    });
    Object.assign(row, classify(row, cfg));
    rows.push(row);
  }

  const themes = Object.values(themeAgg).map(t => ({
    ...t, score: +t.score.toFixed(3), intensity: +t.intensity.toFixed(3), impacts: THEME_BY_ID[t.id].impacts,
    winners: rows.filter(r => r.evidence.themes.some(e => e.theme === t.id && e.c > 0)).sort((a, b) => b.thematic - a.thematic).slice(0, 8).map(r => r.sym),
    losers: rows.filter(r => r.evidence.themes.some(e => e.theme === t.id && e.c < 0)).sort((a, b) => a.thematic - b.thematic).slice(0, 8).map(r => r.sym),
  })).sort((a, b) => Math.abs(b.intensity) - Math.abs(a.intensity) || b.n - a.n);
  const pick = (act) => rows.filter(r => r.action === act).sort((a, b) => (b.held ? 1 : 0) - (a.held ? 1 : 0) || b.conviction - a.conviction);
  return {
    cfg,
    rows,
    themes,
    signals: { SELL: pick('SELL'), BUY: pick('BUY'), AVOID: pick('AVOID'), HOLD: pick('HOLD') },
  };
}

function classify(r, cfg) {
  if (r.pos52 == null) return { zone: 'n/a', action: 'NONE', conviction: 0, rationale: 'No price data.' };
  const zone = r.pos52 >= cfg.highZone ? 'high' : r.pos52 <= cfg.lowZone ? 'low' : 'mid';
  const neg = r.impact <= -cfg.minImpact, pos = r.impact >= cfg.minImpact;
  let action = 'NONE';
  if (zone === 'high' && neg) action = 'SELL';
  else if (zone === 'low' && pos) action = 'BUY';
  else if (zone === 'low' && neg) action = 'AVOID';
  else if (zone === 'high' && pos) action = 'HOLD';
  else if (neg && r.held) action = 'WATCH';

  const edge = zone === 'high' ? (r.pos52 - cfg.highZone) / (1 - cfg.highZone)
    : zone === 'low' ? (cfg.lowZone - r.pos52) / cfg.lowZone : 0;
  const evidence = Math.min(1, 0.45 + r.stories / 8);
  const conviction = Math.round(100 * Math.min(1, Math.abs(r.impact) * (0.6 + 0.4 * Math.max(0, edge)) * evidence * 1.6));

  const mid = (r.hi52 + r.lo52) / 2;
  const toMid = (mid - r.price) / r.price;
  return { zone, action, conviction, toMid: +toMid.toFixed(4), rationale: explain(r, action, toMid) };
}

function pct(x, d = 1) { return (x >= 0 ? '+' : '') + (x * 100).toFixed(d) + '%'; }

function explain(r, action, toMid) {
  const parts = [];
  const tone = r.impact < 0 ? 'negative' : 'positive';
  const topTheme = r.evidence.themes.find(t => Math.sign(t.c) === Math.sign(r.impact));
  const topStory = r.evidence.direct.find(e => Math.sign(e.c) === Math.sign(r.impact));
  parts.push(`News flow is ${tone} (impact ${r.impact.toFixed(2)}) across ${r.stories} direct stor${r.stories === 1 ? 'y' : 'ies'}` + (r.evidence.themes.length ? ` and ${r.evidence.themes.length} macro theme${r.evidence.themes.length > 1 ? 's' : ''}` : '') + '.');
  if (topStory) parts.push(`Key story: "${topStory.title}" (${topStory.publisher}).`);
  if (topTheme) parts.push(`Macro driver: ${topTheme.label} — ${topTheme.c < 0 ? 'headwind' : 'tailwind'} for this business.`);
  if (action === 'SELL') parts.push(`Trades ${pct(r.offHigh)} from its 52-week high of ${r.hi52.toFixed(2)} — limited upside left while news turns against it; a slide back to the 52-week midpoint would be ${pct(toMid)}.`);
  if (action === 'BUY') parts.push(`Sits ${pct(r.offLow)} above its 52-week low of ${r.lo52.toFixed(2)} — beaten down while news turns in its favour; recovering to the 52-week midpoint would be ${pct(toMid)}.`);
  if (action === 'AVOID') parts.push(`Near its 52-week low and news is still negative — a possible falling knife; wait for the news to turn.`);
  if (action === 'HOLD') parts.push(`Near its 52-week high with supportive news — momentum intact; consider a trailing stop rather than selling.`);
  if (action === 'WATCH') parts.push(`You hold this and news has turned negative — keep an eye on it.`);
  return parts.join(' ');
}

module.exports = { analyzeArticle, buildMatchers, aggregate, sentimentOf, detectThemes, DEFAULTS, ANALYZER_VERSION };
