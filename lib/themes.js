// Macro / world-event themes -> which exposure tags (see universe.js) win or lose.
//
// Two theme types:
//  - 'factor': a quantity that moves (oil, rates, dollar...). Needs a subject AND a direction word in
//    the same sentence. 'up' applies impacts as written; 'down' flips them.
//  - 'event': something that happens (war, hurricane, outbreak). Subject alone triggers it with
//    the impacts as written; an optional 'relief' pattern (ceasefire, contained...) flips them.
//
// Impact numbers are sensitivities from -1 (strongly hurt) to +1 (strongly helped).

const UP = /\b(surg\w*|soar\w*|jump\w*|spik\w*|ris(e|es|ing)|rose|climb\w*|rall(y|ies|ied)|gain\w*|higher|rebound\w*|accelerat\w*|hot(ter)?|increas\w*|boost\w*|expand\w*|strong(er)?|record|tops|topped|escalat\w*)\b/i;
const DOWN = /\b(plung\w*|tumbl\w*|slump\w*|fall(s|ing)?|fell|drop\w*|slid(e|es|ing)?|declin\w*|lower\w*|sink\w*|sank|crash\w*|weak(er|en\w*)?|cool\w*|eas(e|es|ing)|slow\w*|decreas\w*|cut(s|ting)?|shrink\w*|contract\w*|down|retreat\w*|tank(ed|ing))\b/i;

const THEMES = [
  { id: 'oil', label: 'Oil prices', type: 'factor',
    subject: /\b(oil|crude|brent|wti|opec\+?|petroleum|gasoline prices|fuel prices)\b/i,
    upExtra: /\b(output cuts?|production cuts?|supply (disruption|shock|cut|risk|fears?)s?|sanctions on (iran|russia)n? oil|tankers? (attack|seiz|hit|struck)\w*|attack\w* on (oil|tankers?|refiner\w*|energy)|energy (infrastructure )?strikes|refinery (attack|strike|fire)s?|disrupt\w*)\b/i,
    downExtra: /\b(output (hike|increase)s?|boost (output|production)|supply glut|oversupply)\b/i,
    impacts: { energy: 0.9, oilsvc: 0.7, refiner: 0.3, airline: -0.9, cruise: -0.5, trucking: -0.4, chemicals: -0.3, autos: -0.2 } },

  { id: 'natgas', label: 'Natural gas prices', type: 'factor',
    subject: /\b(natural gas|nat gas|lng prices|henry hub)\b/i,
    impacts: { natgas: 0.9, chemicals: -0.4, utility: -0.2 } },

  { id: 'rates', label: 'Interest rates / Fed', type: 'factor',
    subject: /\b(interest rates?|rate (hike|cut)s?|fed funds|treasury yields?|bond yields?|10-year yield|federal reserve|the fed|fomc|powell|mortgage rates?)\b/i,
    upExtra: /\b(rate hikes?|hikes? rates|hawkish|higher for longer|yields? (jump|surge|climb)|no (rate )?cuts?|pause (rate )?cuts?)\b/i,
    downExtra: /\b(rate cuts?|cuts? rates|dovish|easing cycle|yields? (fall|drop|slide))\b/i,
    impacts: { rates: -0.7, homebuilder: -0.9, reit: -0.8, homeimprove: -0.4, utility: -0.5, solar: -0.6, bank: 0.4, insurer: 0.2, broker: -0.2, crypto: -0.4, gold: -0.4 } },

  { id: 'inflation', label: 'Inflation', type: 'factor',
    subject: /\b(inflation|cpi|consumer prices|pce|producer prices|ppi|price pressures)\b/i,
    impacts: { rates: -0.5, homebuilder: -0.5, reit: -0.4, retail: -0.4, restaurant: -0.3, staples: -0.2, gold: 0.5, energy: 0.2, bank: 0.2 } },

  { id: 'tariffs', label: 'Tariffs / trade war', type: 'event',
    subject: /\b(tariffs?|trade war|import (duties|taxes)|section 232|section 301|levies on imports|retaliatory dut(y|ies))\b/i,
    relief: /\b(trade (deal|truce|agreement)|tariffs? (cut|relief|pause|paused|rollback|exempt\w*|lift\w*|suspend\w*|struck down|reduc\w*)|lower tariffs|drop(s|ped)? tariffs|delays? tariffs)\b/i,
    impacts: { importer: -0.8, china: -0.6, autos: -0.6, retail: -0.4, semis: -0.3, ag: -0.4, luxury: -0.3, steel: 0.6, multinational: -0.3 } },

  { id: 'chipcurbs', label: 'Chip export curbs (China)', type: 'event',
    subject: /\b(export (controls?|curbs?|bans?|restrictions?|licen[cs]es?)|entity list|chip (ban|curbs?|restrictions?))\b/i,
    relief: /\b(eas\w* (export )?(controls|curbs|restrictions)|lift\w* (the )?(ban|curbs|restrictions)|approv\w* (sales|exports)|grants? licen[cs]es?|allow\w* (sales|exports))\b/i,
    impacts: { chinasemi: -0.9, semis: -0.3 } },

  { id: 'war', label: 'War / geopolitical conflict', type: 'event',
    subject: /\b(war|invasion|invade[sd]?|missile (strike|attack)s?|airstrikes?|air strikes?|drone attacks?|military (escalation|offensive|strikes?)|troops (enter|massing)|shelling|bombard\w*|hostilities|blockade|geopolitical tensions?|ceasefire|cease-fire|truce|peace (deal|talks|agreement|plan|accord))\b/i,
    relief: /\b(ceasefire|cease-fire|truce|peace (deal|agreement|talks|plan|accord)|armistice|de-?escalat\w*|hostage (deal|release))\b/i,
    impacts: { defense: 0.8, energy: 0.4, gold: 0.6, airline: -0.6, travel: -0.4, cruise: -0.5, luxury: -0.2 } },

  { id: 'mideast', label: 'Middle East / shipping lanes', type: 'event',
    subject: /\b(strait of hormuz|red sea|houthis?|suez canal|tanker (attack|seiz)\w*|iran (strike|attack)s?|israel.{0,20}iran|iran.{0,20}israel)\b/i,
    relief: /\b(ceasefire|truce|reopen\w*|de-?escalat\w*|deal)\b/i,
    impacts: { energy: 0.7, shipping: 0.6, defense: 0.5, airline: -0.6, cruise: -0.5, importer: -0.3, gold: 0.4 } },

  { id: 'recession', label: 'Recession / slowdown fears', type: 'event',
    subject: /\b(recession|economic slowdown|hard landing|stagflation|jobless claims (rise|jump|surge)|unemployment (rate )?(rises|jumps|climbs)|weak(er)? jobs (report|data)|payrolls (miss|fall|shrink)|gdp (contract|shrank|shrinks)|consumer confidence (falls|drops|slumps)|layoffs (mount|surge|rise))\b/i,
    relief: /\b(soft landing|recession fears (ease|fade)|avoid(s|ed)? (a )?recession|strong(er)? jobs (report|data)|payrolls (beat|surge|jump))\b/i,
    impacts: { retail: -0.5, restaurant: -0.4, travel: -0.6, cruise: -0.6, hotel: -0.5, autos: -0.5, bank: -0.5, industrial: -0.5, materials: -0.5, rail: -0.3, trucking: -0.4, staples: 0.4, utility: 0.4, gold: 0.4, tobacco: 0.3, healthins: 0.2 } },

  { id: 'ai', label: 'AI spending / data centers', type: 'factor',
    subject: /\b(ai (spending|capex|demand|investment|infrastructure|chips?|data cent(er|re)s?)|data cent(er|re)s?|hyperscalers?|gpu demand)\b/i,
    upExtra: /\b(billions? (in|on|for) (ai|data)|stargate|ai boom|build[- ]?out|new data cent(er|re))\b/i,
    downExtra: /\b(ai bubble|ai (spending )?(fears|doubts|concerns|worries)|capex cuts?|cancel\w* (data cent|orders))\b/i,
    impacts: { ai: 0.8, semis: 0.6, power: 0.6, nuclear: 0.4, cloud: 0.3, reit: 0.1 } },

  { id: 'crypto', label: 'Crypto prices', type: 'factor',
    subject: /\b(bitcoin|crypto(currenc(y|ies))?|ether(eum)?|btc|stablecoins?)\b/i,
    impacts: { crypto: 1.0 } },

  { id: 'gold', label: 'Gold prices', type: 'factor',
    subject: /\b(gold (prices?|futures)|bullion|price of gold|gold (hits|rises|falls|surges|slips))\b/i,
    impacts: { gold: 1.0 } },

  { id: 'dollar', label: 'US dollar', type: 'factor',
    subject: /\b(us dollar|u\.s\. dollar|dollar index|greenback|dxy)\b/i,
    impacts: { multinational: -0.5, gold: -0.5, materials: -0.3, importer: 0.2 } },

  { id: 'chinaecon', label: 'China economy', type: 'factor',
    subject: /\b(china'?s? (economy|growth|gdp|exports|demand|stimulus|property|consumers?)|chinese (economy|demand|consumers?|stimulus)|beijing.{0,20}stimulus|pboc)\b/i,
    upExtra: /\b(stimulus|rate cut|support measures|rescue package|easing)\b/i,
    downExtra: /\b(deflation|property crisis|evergrande|country garden|weak demand)\b/i,
    impacts: { china: 0.7, luxury: 0.6, materials: 0.5, copper: 0.6, industrial: 0.3 } },

  { id: 'disaster', label: 'Natural disasters', type: 'event',
    subject: /\b(hurricane|wildfires?|earthquake|typhoon|cyclone|tornado(es)?|catastrophic flood\w*|severe storms?)\b/i,
    impacts: { insurer: -0.7, homeimprove: 0.4, utility: -0.3, cruise: -0.3, refiner: 0.2 } },

  { id: 'outbreak', label: 'Disease outbreak', type: 'event',
    subject: /\b(pandemic|outbreak|epidemic|bird flu|h5n1|new (covid )?variant|virus (spreads|cases surge)|lockdowns?)\b/i,
    relief: /\b(contained|outbreak (ends|eases|over)|lift\w* lockdown)\b/i,
    impacts: { vaccine: 0.7, airline: -0.7, cruise: -0.8, travel: -0.6, hotel: -0.5, restaurant: -0.3, ecommerce: 0.2 } },

  { id: 'drugprice', label: 'Drug pricing pressure', type: 'event',
    subject: /\b(drug pric(es|ing) (cap|curb|crackdown|order|reform)|medicare (drug )?(price )?negotiat\w*|most[- ]favou?red[- ]nation|pharma(ceutical)? tariffs?)\b/i,
    relief: /\b(deal with (drugmakers|pharma)|exempt\w*)\b/i,
    impacts: { pharma: -0.7, biotech: -0.4 } },

  { id: 'medcosts', label: 'Health insurer medical costs', type: 'event',
    subject: /\b(medical costs? (rise|surge|jump|trend)|utilization (rise|surge|spike)|medicare advantage (rates?|cuts?|payments?)|medical loss ratio)\b/i,
    relief: /\b(medicare advantage (rate )?(increase|hike|boost)|costs? (ease|moderate))\b/i,
    impacts: { healthins: -0.8 } },

  { id: 'glp1', label: 'GLP-1 / weight-loss drugs', type: 'event',
    subject: /\b(glp-?1|weight[- ]loss (drugs?|pills?|shots?)|obesity (drugs?|pills?)|wegovy|ozempic|zepbound|mounjaro|orforglipron)\b/i,
    impacts: { glp1: 0.5, glp1victim: -0.4 } },

  { id: 'antitrust', label: 'Big Tech regulation / antitrust', type: 'event',
    subject: /\b(antitrust|monopoly (case|ruling|trial)|break ?up (google|meta|amazon|apple)|digital markets act|dma fine|eu fines?|ftc (sues|lawsuit)|doj (sues|lawsuit))\b/i,
    relief: /\b(wins? antitrust|dismiss\w*|settle\w*|ruling in favou?r)\b/i,
    impacts: { bigtech: -0.5 } },

  { id: 'defensebudget', label: 'Defense spending', type: 'factor',
    subject: /\b(defen[cs]e (budget|spending)|military (spending|aid|budget)|nato (spending|target)|pentagon (budget|contracts?)|arms (sales|deal|package))\b/i,
    upExtra: /\b(approv\w*|boost\w*|\$\d+ ?billion)\b/i,
    impacts: { defense: 0.8, aero: 0.3 } },

  { id: 'cleanpolicy', label: 'Clean-energy / EV subsidies', type: 'factor',
    subject: /\b(ev (tax )?credits?|ev subsid\w*|clean[- ]energy (tax )?credits?|ira (credits|subsidies)|solar (tax )?credits?|electric[- ]vehicle (incentives|credits|subsidies))\b/i,
    upExtra: /\b(extend\w*|expand\w*|preserv\w*)\b/i,
    downExtra: /\b(repeal\w*|end(s|ed|ing)?|expir\w*|scrap\w*|phase[- ]out|eliminat\w*|gut\w*)\b/i,
    impacts: { solar: 0.9, ev: 0.7, utility: 0.2 } },

  { id: 'nuclear', label: 'Nuclear power push', type: 'event',
    subject: /\b(nuclear (power|energy|reactors?|plants?|deal|renaissance)|small modular reactors?|smrs?|uranium (prices?|demand|supply))\b/i,
    impacts: { nuclear: 0.8, power: 0.3 } },

  { id: 'housing', label: 'Housing market', type: 'factor',
    subject: /\b(home sales|housing starts|home prices|housing market|building permits|new homes? sales|existing[- ]home sales|mortgage applications)\b/i,
    impacts: { homebuilder: 0.9, homeimprove: 0.5, bank: 0.2 } },

  { id: 'consumer', label: 'Consumer spending', type: 'factor',
    subject: /\b(consumer spending|retail sales|consumer sentiment|consumer confidence|holiday (sales|spending|shopping)|black friday)\b/i,
    impacts: { retail: 0.7, ecommerce: 0.6, restaurant: 0.5, travel: 0.4, autos: 0.3, payments: 0.5, luxury: 0.3 } },

  { id: 'travel', label: 'Travel demand', type: 'factor',
    subject: /\b(travel demand|air travel|tsa (screen|checkpoint)\w*|summer travel|holiday travel|bookings|airfares?)\b/i,
    impacts: { airline: 0.7, travel: 0.6, hotel: 0.5, cruise: 0.5 } },

  { id: 'cyber', label: 'Cyberattacks', type: 'event',
    subject: /\b(cyber ?attacks?|ransomware|data breach(es)?|hack(ed|ers?|ing)|state-sponsored hackers?)\b/i,
    impacts: { cyber: 0.6 } },

  { id: 'shutdown', label: 'Government shutdown / fiscal', type: 'event',
    subject: /\b(government shutdown|debt ceiling|shutdown (looms|drags|begins|continues)|federal workers furlough\w*)\b/i,
    relief: /\b(shutdown (ends|ended|averted)|end(s|ed)? (the )?shutdown|funding (deal|bill) (passes|passed|signed)|averts? shutdown)\b/i,
    impacts: { defense: -0.3, healthins: -0.2, airline: -0.3, travel: -0.2 } },

  { id: 'shipping', label: 'Freight / shipping disruptions', type: 'event',
    subject: /\b(port strike|dockworkers? strike|shipping disruptions?|supply chain (disruptions?|snarls?)|container rates|freight rates (jump|surge|soar))\b/i,
    relief: /\b(strike (ends|ended|averted)|tentative (deal|agreement))\b/i,
    impacts: { shipping: 0.7, importer: -0.5, retail: -0.3, autos: -0.3 } },

  { id: 'steel', label: 'Steel / metals prices', type: 'factor',
    subject: /\b(steel (prices?|tariffs?|imports?)|aluminum (prices?|tariffs?)|copper (prices?|futures)|metals prices)\b/i,
    impacts: { steel: 0.8, copper: 0.6, materials: 0.4, autos: -0.3, industrial: -0.2 } },

  { id: 'ag', label: 'Farm / crop prices', type: 'factor',
    subject: /\b(crop prices|grain prices|soybeans?|corn (prices|futures)|wheat (prices|futures)|farm income|fertili[sz]er prices)\b/i,
    impacts: { ag: 0.7, foodbev: -0.3, restaurant: -0.2 } },

  { id: 'cocoa', label: 'Cocoa prices', type: 'factor',
    subject: /\b(cocoa)\b/i,
    impacts: { cocoa: -0.8 } },
];

// Words that cancel a theme hit when they appear in the same sentence ("oil-painting" etc. handled by regex boundaries).
const NOISE = /\b(olive oil|oil painting|painting|recipe|football|soccer|nba|nfl|movie|film review|celebrity|horoscope)\b/i;

module.exports = { THEMES, UP, DOWN, NOISE };
