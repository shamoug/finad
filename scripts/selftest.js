// Quick sanity checks for the rule-based reader: node scripts/selftest.js
const { detectThemes, sentimentOf, analyzeArticle, buildMatchers } = require('../lib/analyze');
const { UNIVERSE } = require('../lib/universe');

let fail = 0;
const check = (name, ok) => { console.log((ok ? 'ok   ' : 'FAIL ') + name); if (!ok) fail++; };
const theme = (t) => Object.fromEntries(detectThemes(t, '').map(x => [x.id, x.dir]));

check('oil up on tanker attacks', theme('Brent crude hovers near $109 as Ukraine resumes energy strikes, tankers attacked in Middle East').oil === 1);
check('oil down on OPEC output', theme('Oil prices fall as OPEC boosts output').oil === -1);
check('dovish Fed = rates down', theme('Fed signals rate cuts ahead as inflation cools').rates === -1);
check('new tariffs = tariffs up', theme('US imposes new tariffs on Chinese EVs').tariffs === 1);
check('ceasefire = war easing', theme('Israel and Hamas agree ceasefire deal').war === -1);
check('yields jump = rates up', theme('Stocks slide as bond yields jump').rates === 1);
check('no theme in sports', !Object.keys(theme('Arsenal beat Chelsea in a thrilling football derby')).length);

check('raised guidance positive', sentimentOf("Will Raised Earnings Guidance Change UnitedHealth Stock's Narrative") > 0.5);
check('cut outlook negative', sentimentOf('Nike cuts full-year sales outlook as tariffs bite') < -0.5);
check('earnings beat positive', sentimentOf('Nvidia shares jump after earnings beat estimates') > 0.5);
check('probe negative', sentimentOf('Boeing faces FAA probe after door plug incident') < -0.3);
check('upgrade positive', sentimentOf('Apple upgraded to buy at Morgan Stanley') > 0.5);

const m = buildMatchers(UNIVERSE);
const an = analyzeArticle({ title: 'Delta Air Lines warns on fuel costs; Target Corp shares slip', summary: '' }, m);
check('matches Delta and Target', an.mentions.DAL && an.mentions.TGT);
const an2 = analyzeArticle({ title: 'Our target is to win the delta of the river', summary: '' }, m);
check('no false match on lowercase words', !an2.mentions.TGT && !an2.mentions.DAL);
const an3 = analyzeArticle({ title: 'Shares of XYZ (NVDA) rose', summary: '' }, m);
check('ticker in parentheses', !!an3.mentions.NVDA);

console.log(fail ? `\n${fail} check(s) failed` : '\nAll checks passed');
process.exit(fail ? 1 : 0);
