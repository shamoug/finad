// Optional local AI (Ollama) reading of headlines - nothing leaves the computer.
// When Ollama is not running, Finad works with its rule-based engine alone.
const BASE = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';

async function listModels() {
  try {
    const r = await fetch(BASE + '/api/tags', { signal: AbortSignal.timeout(3000) });
    const j = await r.json();
    return (j.models || []).filter(m => !(m.capabilities || []).includes('embedding') && !/embed/i.test(m.name)).map(m => m.name);
  } catch { return null; }
}

async function pickModel(preferred) {
  const models = await listModels();
  if (!models || !models.length) return null;
  if (preferred && models.includes(preferred)) return preferred;
  const order = [/qwen3.*instruct/i, /qwen/i, /llama3/i, /gemma/i, /mistral/i, /phi/i];
  for (const re of order) { const m = models.find(n => re.test(n)); if (m) return m; }
  return models[0];
}

const SYSTEM = `You are an equity analyst. Given one news item, list the US-listed stocks most likely to move because of it.
Rules:
- Only include stocks whose price this news plausibly moves in the next days/weeks (direct subjects, suppliers, competitors, sector peers hit by the macro effect).
- First-order effects only. Do not invent links (e.g. oil prices do not move Tesla). A headline asking a question or listing stocks to watch is not news: give low conf.
- dir is +1 (price likely up) or -1 (price likely down). conf is 0.1-1.0.
- reason: max 20 words, concrete cause -> effect.
- Use the ticker list provided when possible. At most 6 stocks. If no stock is meaningfully affected, return an empty list.
Reply with JSON only: {"impacts":[{"sym":"TICKER","dir":1,"conf":0.6,"reason":"..."}]}`;

async function analyzeWithAI(model, article, tickerHint) {
  const prompt = `Tickers you may use: ${tickerHint}\n\nHeadline: ${article.title}\nSummary: ${(article.summary || '').slice(0, 500)}\nSource: ${article.publisher}`;
  const r = await fetch(BASE + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(60000),
    body: JSON.stringify({
      model, stream: false, format: 'json', think: false,
      options: { temperature: 0.1, num_ctx: 4096 },
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }],
    }),
  });
  if (!r.ok) throw new Error('Ollama HTTP ' + r.status);
  const j = await r.json();
  let txt = j.message?.content || '{}';
  txt = txt.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const m = txt.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(m ? m[0] : '{}');
  const impacts = (parsed.impacts || []).map(x => ({
    sym: String(x.sym || '').toUpperCase().replace('.', '-').trim(),
    dir: Math.sign(+x.dir) || 0,
    conf: Math.max(0.1, Math.min(1, +x.conf || 0.5)),
    reason: String(x.reason || '').slice(0, 200),
  })).filter(x => /^[A-Z][A-Z0-9-]{0,6}$/.test(x.sym) && x.dir);
  return { model, impacts, at: Date.now() };
}

module.exports = { listModels, pickModel, analyzeWithAI };
