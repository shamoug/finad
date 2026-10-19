// Quotes + 52-week range from Yahoo Finance's public chart endpoint (no key needed).
const { UA } = require('./feeds');

async function fetchChart(sym) {
  const hosts = ['query1', 'query2'];
  let lastErr;
  for (const h of hosts) {
    try {
      const url = `https://${h}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1y&interval=1d&includePrePost=false`;
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const res = j?.chart?.result?.[0];
      if (!res) throw new Error(j?.chart?.error?.description || 'no data');
      return shape(sym, res);
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

function shape(sym, res) {
  const m = res.meta || {};
  const ts = res.timestamp || [];
  const q = res.indicators?.quote?.[0] || {};
  const closes = [], highs = [], lows = [], times = [];
  for (let i = 0; i < ts.length; i++) {
    if (q.close?.[i] == null) continue;
    closes.push(q.close[i]); highs.push(q.high?.[i] ?? q.close[i]); lows.push(q.low?.[i] ?? q.close[i]); times.push(ts[i] * 1000);
  }
  const price = m.regularMarketPrice ?? closes[closes.length - 1];
  const hi = m.fiftyTwoWeekHigh ?? Math.max(...highs);
  const lo = m.fiftyTwoWeekLow ?? Math.min(...lows);
  const prev = closes.length > 1 ? closes[closes.length - 2] : m.chartPreviousClose;
  const back = (n) => closes.length > n ? closes[closes.length - 1 - n] : closes[0];
  const range = hi - lo || 1;
  // Downsample the history to ~120 points for sparklines
  const step = Math.max(1, Math.floor(closes.length / 120));
  const hist = [];
  for (let i = 0; i < closes.length; i += step) hist.push([times[i], +closes[i].toFixed(2)]);
  if (closes.length) hist.push([times[times.length - 1], +closes[closes.length - 1].toFixed(2)]);
  return {
    sym,
    name: m.longName || m.shortName || sym,
    exchange: m.fullExchangeName || m.exchangeName || '',
    currency: m.currency || 'USD',
    price,
    hi52: hi,
    lo52: lo,
    pos52: Math.max(0, Math.min(1, (price - lo) / range)),   // 0 = at 52w low, 1 = at 52w high
    offHigh: (price - hi) / hi,                               // e.g. -0.03 = 3% below high
    offLow: (price - lo) / lo,                                // e.g. 0.04 = 4% above low
    chg1d: prev ? (price - prev) / prev : 0,
    chg1m: (price - back(21)) / back(21),
    chg3m: (price - back(63)) / back(63),
    volume: m.regularMarketVolume || 0,
    hist,
    asOf: (m.regularMarketTime || 0) * 1000 || Date.now(),
  };
}

async function fetchMany(symbols, { concurrency = 8, onProgress } = {}) {
  const out = {}, errors = {};
  let i = 0, done = 0;
  async function worker() {
    while (i < symbols.length) {
      const s = symbols[i++];
      try { out[s] = await fetchChart(s); }
      catch (e) { errors[s] = e.message; }
      done++; onProgress?.(done, symbols.length);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { quotes: out, errors };
}

module.exports = { fetchChart, fetchMany };
