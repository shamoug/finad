// News sources (market + world) and a dependency-free RSS/Atom reader.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

// kind: 'market' = financial press, 'world' = general/world news that moves markets
// weight: source credibility multiplier used by the scoring engine
const SOURCES = [
  { id: 'cnbc-top',    name: 'CNBC Top News',       kind: 'market', weight: 1.0, url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html' },
  { id: 'cnbc-world',  name: 'CNBC World',          kind: 'world',  weight: 1.0, url: 'https://www.cnbc.com/id/100727362/device/rss/rss.html' },
  { id: 'mw-top',      name: 'MarketWatch',         kind: 'market', weight: 1.0, url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories' },
  { id: 'wsj-world',   name: 'WSJ World',           kind: 'world',  weight: 1.0, url: 'https://feeds.a.dj.com/rss/RSSWorldNews.xml' },
  { id: 'nyt-biz',     name: 'NYT Business',        kind: 'market', weight: 1.0, url: 'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml' },
  { id: 'ft-world',    name: 'Financial Times',     kind: 'world',  weight: 1.0, url: 'https://www.ft.com/world?format=rss' },
  { id: 'bbc-biz',     name: 'BBC Business',        kind: 'market', weight: 0.9, url: 'https://feeds.bbci.co.uk/news/business/rss.xml' },
  { id: 'bbc-world',   name: 'BBC World',           kind: 'world',  weight: 0.9, url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { id: 'aljazeera',   name: 'Al Jazeera',          kind: 'world',  weight: 0.8, url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  { id: 'guardian',    name: 'Guardian Business',   kind: 'market', weight: 0.8, url: 'https://www.theguardian.com/business/rss' },
  { id: 'npr-econ',    name: 'NPR Economy',         kind: 'market', weight: 0.8, url: 'https://feeds.npr.org/1006/rss.xml' },
  { id: 'gn-business', name: 'Google News Business',kind: 'market', weight: 0.9, url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx6TVdZU0FtVnVHZ0pWVXlnQVAB?hl=en-US&gl=US&ceid=US:en' },
  { id: 'gn-stocks',   name: 'Google News Stocks',  kind: 'market', weight: 0.9, url: 'https://news.google.com/rss/search?q=stock+shares+when:2d&hl=en-US&gl=US&ceid=US:en' },
  { id: 'gn-world',    name: 'Google News World',   kind: 'world',  weight: 0.9, url: 'https://news.google.com/rss/headlines/section/topic/WORLD?hl=en-US&gl=US&ceid=US:en' },
  { id: 'investing',   name: 'Investing.com',       kind: 'market', weight: 0.8, url: 'https://www.investing.com/rss/news_25.rss' },
  { id: 'nasdaq',      name: 'Nasdaq Markets',      kind: 'market', weight: 0.8, url: 'https://www.nasdaq.com/feed/rssoutbound?category=Markets' },
  { id: 'seekingalpha',name: 'Seeking Alpha',       kind: 'market', weight: 0.8, url: 'https://seekingalpha.com/market_currents.xml' },
  { id: 'oilprice',    name: 'OilPrice.com',        kind: 'market', weight: 0.7, url: 'https://oilprice.com/rss/main' },
  { id: 'fed',         name: 'Federal Reserve',     kind: 'world',  weight: 1.2, url: 'https://www.federalreserve.gov/feeds/press_all.xml' },
  { id: 'techcrunch',  name: 'TechCrunch',          kind: 'market', weight: 0.6, url: 'https://techcrunch.com/feed/' },
];

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', mdash: '—', ndash: '–', hellip: '…' };
function decode(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z0-9#]+);/gi, (m, e) => ENT[e.toLowerCase()] ?? m);
}
function stripTags(s) { return decode(decode(s).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim(); }
function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
}

function parseFeed(xml, source) {
  const out = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks) {
    let title = stripTags(tag(b, 'title'));
    let link = stripTags(tag(b, 'link'));
    if (!link) { const m = b.match(/<link[^>]*href="([^"]+)"/i); if (m) link = decode(m[1]); }
    const desc = stripTags(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content'));
    const date = stripTags(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date'));
    let publisher = source.name;
    // Google News titles end with " - Publisher"
    if (source.id.startsWith('gn-')) {
      const m = title.match(/^(.*) - ([^-]{2,60})$/);
      if (m) { title = m[1]; publisher = m[2].trim(); }
    }
    if (!title) continue;
    const ts = Date.parse(date) || Date.now();
    out.push({
      title,
      summary: source.id.startsWith('gn-') ? '' : desc.slice(0, 600),
      link,
      publisher,
      source: source.id,
      kind: source.kind,
      weight: source.weight,
      ts,
    });
  }
  return out;
}

async function fetchText(url, ms = 15000) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
}

async function fetchSource(source) {
  const xml = await fetchText(source.url);
  return parseFeed(xml, source);
}

// Per-ticker headlines from Yahoo Finance (used for the user's holdings / watchlist).
function tickerSource(sym) {
  return { id: 'yf-' + sym, name: 'Yahoo Finance · ' + sym, kind: 'market', weight: 0.9, ticker: sym,
    url: `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(sym)}&region=US&lang=en-US` };
}

module.exports = { SOURCES, UA, fetchSource, fetchText, tickerSource, stripTags };
