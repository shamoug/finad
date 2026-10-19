// The stock universe Finad watches. Users can add more tickers in Settings.
// Format: SYMBOL | Name | Sector | aliases (;) | exposure tags (space)
// Aliases are case-sensitive proper-noun matches; tags link a stock to macro themes (see themes.js).
const RAW = `
AAPL|Apple|Technology|Apple;iPhone;Tim Cook;Apple's|bigtech china importer multinational ai
MSFT|Microsoft|Technology|Microsoft;Azure;Satya Nadella;Copilot|bigtech cloud ai software multinational
NVDA|Nvidia|Technology|Nvidia;NVIDIA;Jensen Huang;Blackwell|semis ai chinasemi rates
AMZN|Amazon|Consumer Discretionary|Amazon;AWS;Andy Jassy|bigtech ecommerce cloud ai importer
GOOGL|Alphabet|Communication|Alphabet;Google;YouTube;Sundar Pichai;Waymo;Gemini AI|bigtech ai cloud media
META|Meta Platforms|Communication|Meta Platforms;Meta's;Facebook;Instagram;WhatsApp;Zuckerberg|bigtech ai media
TSLA|Tesla|Consumer Discretionary|Tesla;Elon Musk;Cybertruck|autos ev china rates
AVGO|Broadcom|Technology|Broadcom|semis ai chinasemi
AMD|AMD|Technology|AMD;Advanced Micro Devices;Lisa Su|semis ai chinasemi rates
INTC|Intel|Technology|Intel;Intel's|semis china
QCOM|Qualcomm|Technology|Qualcomm|semis china chinasemi
MU|Micron|Technology|Micron|semis ai chinasemi
TSM|TSMC|Technology|TSMC;Taiwan Semiconductor|semis ai china
ASML|ASML|Technology|ASML|semis chinasemi ai
ARM|Arm Holdings|Technology|Arm Holdings|semis ai rates
SMCI|Super Micro Computer|Technology|Super Micro;Supermicro|ai semis rates
AMAT|Applied Materials|Technology|Applied Materials|semis chinasemi
LRCX|Lam Research|Technology|Lam Research|semis chinasemi
KLAC|KLA|Technology|KLA Corp|semis chinasemi
MRVL|Marvell|Technology|Marvell|semis ai
TXN|Texas Instruments|Technology|Texas Instruments|semis china industrial
ORCL|Oracle|Technology|Oracle;Larry Ellison|cloud ai software
CRM|Salesforce|Technology|Salesforce;Marc Benioff|software cloud ai rates
ADBE|Adobe|Technology|Adobe|software ai rates
NOW|ServiceNow|Technology|ServiceNow|software ai rates
PLTR|Palantir|Technology|Palantir|software ai defense rates
SNOW|Snowflake|Technology|Snowflake Inc;Snowflake's|software cloud rates
IBM|IBM|Technology|IBM|software ai cloud
CSCO|Cisco|Technology|Cisco|software ai
DELL|Dell|Technology|Dell Technologies;Dell's|ai importer
HPE|Hewlett Packard Enterprise|Technology|Hewlett Packard Enterprise;HPE|ai
CRWD|CrowdStrike|Technology|CrowdStrike|cyber software rates
PANW|Palo Alto Networks|Technology|Palo Alto Networks|cyber software
FTNT|Fortinet|Technology|Fortinet|cyber software
ZS|Zscaler|Technology|Zscaler|cyber software rates
NFLX|Netflix|Communication|Netflix|streaming media
DIS|Disney|Communication|Disney;Walt Disney;ESPN|media streaming travel
CMCSA|Comcast|Communication|Comcast;NBCUniversal|media telecom
WBD|Warner Bros Discovery|Communication|Warner Bros;Warner Bros. Discovery|media streaming
T|AT&T|Communication|AT&T|telecom
VZ|Verizon|Communication|Verizon|telecom
TMUS|T-Mobile|Communication|T-Mobile|telecom
SPOT|Spotify|Communication|Spotify|streaming media
RBLX|Roblox|Communication|Roblox|gaming rates
EA|Electronic Arts|Communication|Electronic Arts|gaming
JPM|JPMorgan Chase|Financials|JPMorgan;JP Morgan;Jamie Dimon|bank
BAC|Bank of America|Financials|Bank of America|bank
WFC|Wells Fargo|Financials|Wells Fargo|bank
C|Citigroup|Financials|Citigroup;Citi;Citibank|bank multinational
GS|Goldman Sachs|Financials|Goldman Sachs;Goldman|bank broker
MS|Morgan Stanley|Financials|Morgan Stanley|bank broker
SCHW|Charles Schwab|Financials|Charles Schwab;Schwab|broker bank
BLK|BlackRock|Financials|BlackRock;Larry Fink|broker
KKR|KKR|Financials|KKR|broker
BX|Blackstone|Financials|Blackstone|broker reit
V|Visa|Financials|Visa Inc;Visa's|payments multinational
MA|Mastercard|Financials|Mastercard|payments multinational
PYPL|PayPal|Financials|PayPal|payments
AXP|American Express|Financials|American Express;Amex|payments travel
COF|Capital One|Financials|Capital One|bank
COIN|Coinbase|Financials|Coinbase|crypto broker rates
HOOD|Robinhood|Financials|Robinhood|crypto broker rates
MSTR|Strategy (MicroStrategy)|Technology|MicroStrategy;Michael Saylor|crypto
BRK-B|Berkshire Hathaway|Financials|Berkshire Hathaway;Warren Buffett;Berkshire|insurer
PGR|Progressive|Financials|Progressive Corp|insurer
TRV|Travelers|Financials|Travelers Companies|insurer
ALL|Allstate|Financials|Allstate|insurer
AIG|AIG|Financials|AIG|insurer
UNH|UnitedHealth|Health Care|UnitedHealth;Optum|healthins
ELV|Elevance Health|Health Care|Elevance|healthins
CVS|CVS Health|Health Care|CVS;Aetna|healthins retail
HUM|Humana|Health Care|Humana|healthins
CI|Cigna|Health Care|Cigna|healthins
LLY|Eli Lilly|Health Care|Eli Lilly;Lilly;Zepbound;Mounjaro|pharma glp1
NVO|Novo Nordisk|Health Care|Novo Nordisk;Wegovy;Ozempic|pharma glp1
JNJ|Johnson & Johnson|Health Care|Johnson & Johnson;J&J|pharma medtech
PFE|Pfizer|Health Care|Pfizer|pharma vaccine
MRK|Merck|Health Care|Merck;Keytruda|pharma vaccine
ABBV|AbbVie|Health Care|AbbVie|pharma
BMY|Bristol Myers Squibb|Health Care|Bristol Myers;Bristol-Myers|pharma
AMGN|Amgen|Health Care|Amgen|biotech pharma
GILD|Gilead|Health Care|Gilead|biotech pharma
MRNA|Moderna|Health Care|Moderna|biotech vaccine rates
VRTX|Vertex Pharmaceuticals|Health Care|Vertex Pharmaceuticals;Vertex|biotech
REGN|Regeneron|Health Care|Regeneron|biotech
ISRG|Intuitive Surgical|Health Care|Intuitive Surgical|medtech
ABT|Abbott|Health Care|Abbott Laboratories;Abbott|medtech
MDT|Medtronic|Health Care|Medtronic|medtech
TMO|Thermo Fisher|Health Care|Thermo Fisher|medtech
DXCM|Dexcom|Health Care|Dexcom|medtech
WMT|Walmart|Consumer Staples|Walmart|retail staples importer
COST|Costco|Consumer Staples|Costco|retail staples
TGT|Target|Consumer Staples|Target Corp;Target's|retail importer
HD|Home Depot|Consumer Discretionary|Home Depot|homeimprove retail rates
LOW|Lowe's|Consumer Discretionary|Lowe's|homeimprove retail rates
NKE|Nike|Consumer Discretionary|Nike|retail importer china multinational
LULU|Lululemon|Consumer Discretionary|Lululemon|retail importer china
SBUX|Starbucks|Consumer Discretionary|Starbucks|restaurant china
MCD|McDonald's|Consumer Discretionary|McDonald's|restaurant multinational
CMG|Chipotle|Consumer Discretionary|Chipotle|restaurant
YUM|Yum Brands|Consumer Discretionary|Yum Brands;KFC;Taco Bell|restaurant china
BKNG|Booking Holdings|Consumer Discretionary|Booking Holdings;Booking.com|travel
ABNB|Airbnb|Consumer Discretionary|Airbnb|travel
MAR|Marriott|Consumer Discretionary|Marriott|travel hotel
HLT|Hilton|Consumer Discretionary|Hilton|travel hotel
CCL|Carnival|Consumer Discretionary|Carnival Corp;Carnival Cruise|travel cruise
RCL|Royal Caribbean|Consumer Discretionary|Royal Caribbean|travel cruise
UBER|Uber|Industrials|Uber|travel software
F|Ford|Consumer Discretionary|Ford Motor;Ford's|autos ev importer
GM|General Motors|Consumer Discretionary|General Motors;GM's|autos ev importer china
RIVN|Rivian|Consumer Discretionary|Rivian|autos ev rates
LCID|Lucid|Consumer Discretionary|Lucid Group;Lucid Motors|autos ev rates
TM|Toyota|Consumer Discretionary|Toyota|autos importer
LVMUY|LVMH|Consumer Discretionary|LVMH;Louis Vuitton|luxury china
EBAY|eBay|Consumer Discretionary|eBay|ecommerce
ETSY|Etsy|Consumer Discretionary|Etsy|ecommerce
PDD|PDD Holdings|Consumer Discretionary|PDD Holdings;Temu;Pinduoduo|ecommerce china
BABA|Alibaba|Consumer Discretionary|Alibaba|ecommerce china cloud
JD|JD.com|Consumer Discretionary|JD.com|ecommerce china
DPZ|Domino's|Consumer Discretionary|Domino's|restaurant
PG|Procter & Gamble|Consumer Staples|Procter & Gamble;P&G|staples multinational
KO|Coca-Cola|Consumer Staples|Coca-Cola;Coke|foodbev staples multinational
PEP|PepsiCo|Consumer Staples|PepsiCo;Pepsi;Frito-Lay|foodbev staples glp1victim
MDLZ|Mondelez|Consumer Staples|Mondelez;Oreo|foodbev staples glp1victim
HSY|Hershey|Consumer Staples|Hershey|foodbev staples glp1victim cocoa
KHC|Kraft Heinz|Consumer Staples|Kraft Heinz|foodbev staples glp1victim
GIS|General Mills|Consumer Staples|General Mills|foodbev staples glp1victim
PM|Philip Morris|Consumer Staples|Philip Morris|tobacco staples
MO|Altria|Consumer Staples|Altria|tobacco staples
CL|Colgate-Palmolive|Consumer Staples|Colgate|staples
XOM|Exxon Mobil|Energy|Exxon;ExxonMobil|energy
CVX|Chevron|Energy|Chevron|energy
COP|ConocoPhillips|Energy|ConocoPhillips|energy
OXY|Occidental|Energy|Occidental Petroleum;Occidental|energy
SLB|SLB|Energy|Schlumberger;SLB|energy oilsvc
HAL|Halliburton|Energy|Halliburton|energy oilsvc
MPC|Marathon Petroleum|Energy|Marathon Petroleum|refiner
VLO|Valero|Energy|Valero|refiner
EOG|EOG Resources|Energy|EOG Resources|energy
SHEL|Shell|Energy|Shell plc;Royal Dutch Shell|energy
BP|BP|Energy|BP plc;BP's|energy
EQT|EQT|Energy|EQT Corp|natgas energy
LNG|Cheniere Energy|Energy|Cheniere|natgas
DAL|Delta Air Lines|Industrials|Delta Air Lines;Delta Air|airline travel
UAL|United Airlines|Industrials|United Airlines|airline travel
AAL|American Airlines|Industrials|American Airlines|airline travel
LUV|Southwest Airlines|Industrials|Southwest Airlines|airline travel
BA|Boeing|Industrials|Boeing|aero defense china
LMT|Lockheed Martin|Industrials|Lockheed Martin;Lockheed|defense
RTX|RTX|Industrials|RTX;Raytheon;Pratt & Whitney|defense aero
NOC|Northrop Grumman|Industrials|Northrop Grumman;Northrop|defense
GD|General Dynamics|Industrials|General Dynamics|defense
LHX|L3Harris|Industrials|L3Harris|defense
GE|GE Aerospace|Industrials|GE Aerospace|aero defense
CAT|Caterpillar|Industrials|Caterpillar|industrial china materials
DE|Deere|Industrials|John Deere;Deere|industrial ag
HON|Honeywell|Industrials|Honeywell|industrial aero
MMM|3M|Industrials|3M|industrial
UPS|UPS|Industrials|UPS;United Parcel Service|trucking importer
FDX|FedEx|Industrials|FedEx|trucking importer
UNP|Union Pacific|Industrials|Union Pacific|rail
CSX|CSX|Industrials|CSX|rail
ZIM|ZIM Shipping|Industrials|ZIM Integrated|shipping
GEV|GE Vernova|Industrials|GE Vernova|power nuclear
ETN|Eaton|Industrials|Eaton Corp|power industrial
VRT|Vertiv|Industrials|Vertiv|power ai
NEE|NextEra Energy|Utilities|NextEra|utility solar power
DUK|Duke Energy|Utilities|Duke Energy|utility
SO|Southern Company|Utilities|Southern Company;Southern Co|utility nuclear
CEG|Constellation Energy|Utilities|Constellation Energy|nuclear power utility
VST|Vistra|Utilities|Vistra|nuclear power utility
OKLO|Oklo|Utilities|Oklo|nuclear rates
CCJ|Cameco|Energy|Cameco|nuclear
FSLR|First Solar|Technology|First Solar|solar
ENPH|Enphase|Technology|Enphase|solar rates
NUE|Nucor|Materials|Nucor|steel materials
CLF|Cleveland-Cliffs|Materials|Cleveland-Cliffs|steel materials
FCX|Freeport-McMoRan|Materials|Freeport-McMoRan;Freeport|materials copper china
NEM|Newmont|Materials|Newmont|gold
B|Barrick Mining|Materials|Barrick|gold
DOW|Dow|Materials|Dow Inc|chemicals materials
LIN|Linde|Materials|Linde|chemicals
ADM|Archer-Daniels-Midland|Consumer Staples|Archer-Daniels-Midland;ADM|ag
MOS|Mosaic|Materials|Mosaic Co|ag materials
CTVA|Corteva|Materials|Corteva|ag
DHI|D.R. Horton|Consumer Discretionary|D.R. Horton|homebuilder rates
LEN|Lennar|Consumer Discretionary|Lennar|homebuilder rates
PHM|PulteGroup|Consumer Discretionary|PulteGroup;Pulte|homebuilder rates
PLD|Prologis|Real Estate|Prologis|reit rates
O|Realty Income|Real Estate|Realty Income|reit rates
AMT|American Tower|Real Estate|American Tower|reit rates telecom
EQIX|Equinix|Real Estate|Equinix|reit ai
SPG|Simon Property|Real Estate|Simon Property|reit retail
`;

function parse(raw) {
  return raw.trim().split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    const [sym, name, sector, aliases, tags] = line.split('|');
    return { sym, name, sector, aliases: aliases.split(';').filter(Boolean), tags: (tags || '').split(/\s+/).filter(Boolean) };
  });
}

const UNIVERSE = parse(RAW);

module.exports = { UNIVERSE };
