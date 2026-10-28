// COPY of renellence-edge api/_territory.js (owner 2026-10-28: Pulse reads Meta leads itself and places them by these rules). Keep it in step.
// Ontario territory rules by postal area (forward sortation area, the first three characters
// of a postal code) - the server's copy of TR_RULE / trRuleFor() in index.html, which draws
// the Territory map. test/territory-rules.test.js checks the two tables agree, so a change to
// one without the other fails the tests.
//
// Patrick's WhatsApp, 2026-09-25:
//   "Markham Thornhill Richmond Hill south of Elgin Mills is Lucas until Finch"
//   "Sam is north of Elgin Mills, Stouffville, Aurora and North Mississauga and Durham Brampton is Sam."
//   "Emily is north york East York beaches to Bloor is Emily"
//   "Yorkville, dwntwn Oakville Burlington and South West, Kitchener Guelph Waterloo Hamilton
//    Niagara and Winsor is Lucas"
// Scarborough added to Emily (Patrick 2026-09-28). The areas no rule covered were settled by
// Yousef on 2026-09-29: Lucas takes the Toronto lakeshore and down the QEW, Sam everything north
// of that line. Regions are never used whole - territories split York, Peel and Toronto itself.
//
// Each group says WHO, the area in plain words, and where the rule came from, so the Reassign
// tab can explain a recommended swap instead of just asserting it.

const SOURCE_0925 = 'Patrick, 2026-09-25';
const GROUPS = [
  { rep: 'Lucas', area: 'Markham, Thornhill and Richmond Hill south of Elgin Mills', source: SOURCE_0925,
    quote: 'Markham Thornhill Richmond Hill south of Elgin Mills is Lucas until Finch',
    codes: 'L3P L3R L3S L6B L6C L6E L6G L3T L4J L4B L4C' },
  { rep: 'Lucas', area: 'Downtown Toronto and Yorkville', source: SOURCE_0925, quote: 'Yorkville, dwntwn ... is Lucas',
    codes: 'M5A M5B M5C M5E M5G M5H M5J M5K M5L M5R M5S M5T M5V M5W M5X M4W M4X M4Y' },
  { rep: 'Lucas', area: 'Oakville, Burlington, Hamilton, Niagara and the southwest', source: SOURCE_0925,
    quote: 'Oakville Burlington and South West, Kitchener Guelph Waterloo Hamilton Niagara and Windsor is Lucas',
    codes: 'L6H L6J L6K L6L L6M L7L L7M L7N L7P L7R L7S L7T L9A L9B L9C L9G L9H L9K L0R L3B L3C L3K L3M L0S' },
  { rep: 'Sam', area: 'North of Elgin Mills: north Richmond Hill, Aurora, Newmarket, Stouffville and north', source: SOURCE_0925,
    quote: 'Sam is north of Elgin Mills, Stouffville, Aurora',
    codes: 'L4E L4G L3X L3Y L7B L9N L4P L0G L4A L9L L9P' },
  { rep: 'Sam', area: 'North Mississauga', source: SOURCE_0925, quote: 'North Mississauga ... is Sam',
    codes: 'L4T L4V L4W L4Z L5R L5S L5T L5V L5W L5M L5N' },
  { rep: 'Sam', area: 'Brampton', source: SOURCE_0925, quote: 'Brampton is Sam',
    codes: 'L6P L6R L6S L6T L6V L6W L6X L6Y L6Z L7A' },
  { rep: 'Emily', area: 'North York', source: SOURCE_0925, quote: 'Emily is north york East York beaches to Bloor',
    codes: 'M2J M2K M2L M2N M2P M3A M3B M3C M3H M3J M3K M3L M3M M4A M5M M6A M6B M6L M9M' },
  { rep: 'Emily', area: 'East York, the Beaches and Leslieville', source: SOURCE_0925, quote: 'Emily is north york East York beaches to Bloor',
    codes: 'M4B M4C M4G M4H M4J M4K M4E M4L M4M' },
  { rep: 'Emily', area: 'Scarborough', source: 'Patrick, 2026-09-28', quote: 'Scarborough is Emily',
    codes: 'M1B M1C M1E M1G M1H M1J M1K M1L M1M M1N M1P M1R M1S M1T M1V M1W M1X' },
  { rep: 'Emily', area: 'Northern Ontario: Sudbury and area, and everything north', source: 'Yousef, 2026-10-02',
    quote: 'Give all the territory in Ontario around Sudbury and north to Emily',
    codes: 'P3A P3B P3C P3E P3G P3L P3N P3P P3Y P5A P5E P0P P0M P0J P0K P0L P0N P0R P0S P0T P0V P0W P0X P0Y P2N P4N P4P P4R P5N P6A P6B P6C P7A P7B P7C P7E P7G P7J P7K P7L P8N P8T P9A P9N' },
  { rep: 'Emily', area: 'Peterborough', source: 'Yousef, 2026-10-05', quote: 'Peterborough is all Emily territory',
    codes: 'K9H K9J K9K K9L' },
  { rep: 'Lucas', area: 'The Toronto lakeshore and south Mississauga, down the QEW', source: 'Yousef, 2026-09-29',
    quote: 'Lucas takes the Toronto lakeshore and down the QEW',
    codes: 'M6K M6R M6S M8V M8W M8Y M8Z L5E L5G L5H L5J L5K' },
  { rep: 'Sam', area: 'Midtown and west-central Toronto', source: 'Yousef, 2026-09-29', quote: 'Sam takes everything north of the lakeshore line',
    codes: 'M4N M4P M4R M4S M4T M4V M5N M5P M6C M6E M6G M6H M6J M6M M6N M6P' },
  { rep: 'Sam', area: 'North and central Etobicoke', source: 'Yousef, 2026-09-29', quote: 'Sam takes everything north of the lakeshore line',
    codes: 'M8X M9A M9B M9C M9N M9P M9R M9V M9W' },
  { rep: 'Sam', area: 'Central Mississauga, Vaughan, King, Milton, Caledon, Halton Hills and north', source: 'Yousef, 2026-09-29',
    quote: 'Sam takes everything north of the lakeshore line',
    codes: 'L4X L4Y L5A L5B L5C L5L L4H L4K L4L L6A L0J L3L L9E L9T L0P L7G L7J L7C L7E L7K L0N L9W L9V L9R L3Z' },
  { rep: 'Lucas|Emily', area: 'North York between Steeles and Finch', source: SOURCE_0925, split: true,
    quote: 'Lucas "until Finch", Emily has North York - this strip could be either',
    codes: 'M2H M2M M2R M3N M9L' },
  { rep: 'Lucas|Sam', area: 'Richmond Hill across Elgin Mills', source: SOURCE_0925, split: true,
    quote: 'Lucas south of Elgin Mills, Sam north - this postal area straddles it',
    codes: 'L4S' },
];
// Whole postal districts, used when no exact area above matches. BC (V) and Alberta (T) are all
// Brittany's (Yousef 2026-09-30: "everything in BC and Alberta should be Brittany").
const WEST = { source: 'Yousef, 2026-09-30', quote: 'Everything in BC and Alberta should be Brittany' };
// Quebec (G, H, J) is all Angela's (Yousef 2026-10-01: "reassign all contacts in quebec to angela tuzzolino").
const QUEBEC = { source: 'Yousef, 2026-10-01', quote: 'Reassign all contacts in Quebec to Angela Tuzzolino' };
const PREFIXES = [
  Object.assign({ test: /^[GHJ]/, rep: 'Angela', area: 'Quebec' }, QUEBEC),
  Object.assign({ test: /^V/, rep: 'Brittany', area: 'British Columbia' }, WEST),
  Object.assign({ test: /^T/, rep: 'Brittany', area: 'Alberta' }, WEST),
  { test: /^N/, rep: 'Lucas', area: 'Southwestern Ontario (Kitchener, Guelph, Waterloo, London, Windsor)', source: SOURCE_0925,
    quote: 'South West, Kitchener Guelph Waterloo ... Winsor is Lucas' },
  { test: /^L2/, rep: 'Lucas', area: 'Niagara', source: SOURCE_0925, quote: 'Hamilton Niagara ... is Lucas' },
  { test: /^L8/, rep: 'Lucas', area: 'Hamilton', source: SOURCE_0925, quote: 'Hamilton Niagara ... is Lucas' },
  { test: /^L1/, rep: 'Sam', area: 'Durham Region', source: SOURCE_0925, quote: 'Durham ... is Sam' },
  // Every Ontario postal area no rule above covers (Yousef 2026-10-05): Ottawa and the east (K), Barrie,
  // Simcoe and the rest of L, any Toronto area left over (M), North Bay, Parry Sound and Muskoka (P).
  { test: /^[KLMP]/, rep: 'Emily', area: 'The rest of Ontario', source: 'Yousef, 2026-10-05',
    quote: 'Anything else unassigned in Ontario should go to Emily' },
];

const BY_FSA = {};
GROUPS.forEach((g) => g.codes.split(' ').forEach((c) => { BY_FSA[c] = g; }));

function fsaOf(zip) {
  const z = String(zip || '').toUpperCase().replace(/\s+/g, '');
  return /^[A-Z]\d[A-Z]/.test(z) ? z.slice(0, 3) : '';
}

// The rule for a postal area: { fsa, reps: ['Lucas'] or ['Lucas', 'Emily'], split, area, source, quote },
// or null when no rule covers it (Manitoba, Saskatchewan, the Atlantic provinces and the territories).
function ruleFor(fsa) {
  const f = String(fsa || '').toUpperCase();
  if (!/^[A-Z]\d[A-Z]$/.test(f)) return null;
  const g = BY_FSA[f] || PREFIXES.find((p) => p.test.test(f));
  if (!g) return null;
  const reps = g.rep.split('|');
  return { fsa: f, reps, split: reps.length > 1, area: g.area, source: g.source, quote: g.quote };
}

// The same answer as the page's trRuleFor() for Ontario: 'Lucas', 'Lucas|Emily', or ''.
function ruleName(fsa) { const r = ruleFor(fsa); return r ? r.reps.join('|') : ''; }

// No postal code: BC and Alberta can still be told from the province, or failing that the city
// (most records carry only a city). Ontario can't - its cities are split between reps.
const PROV = { bc: 'BC', 'b.c.': 'BC', 'british columbia': 'BC', ab: 'AB', alberta: 'AB',
  qc: 'QC', 'qc.': 'QC', quebec: 'QC', 'québec': 'QC', que: 'QC', pq: 'QC' };
const WEST_CITIES = {
  BC: ['abbotsford', 'bowser', 'burnaby', 'campbell river', 'castlegar', 'chilliwack', 'cloverdale', 'colwood', 'comox', 'coquitlam', 'courtenay', 'cranbrook',
    'creston', 'dawson creek', 'delta', 'duncan', 'fernie', 'fort st john', 'fort st. john', 'garibaldi highlands', 'gibsons', 'grand forks', 'hope', 'kamloops',
    'kelowna', 'kitimat', 'lake country', 'lake cowichan', 'langford', 'langley', 'langley twp', 'maple ridge', 'merritt', 'mill bay', 'mission', 'nanaimo', 'nelson',
    'new westminster', 'north vancouver', 'oliver', 'osoyoos', 'parksville', 'penticton', 'pitt meadows', 'port alberni', 'port coquitlam', 'port hardy', 'port moody',
    'powell river', 'prince george', 'prince rupert', 'qualicum beach', 'quesnel', 'radium hot springs', 'revelstoke', 'rossland', 'royston', 'saanich', 'saanich core',
    'saanichton', 'salmon arm', 'salt spring island', 'sechelt', 'sicamous', 'sidney', 'smithers', 'squamish', 'summerland', 'surrey', 'terrace', 'trail',
    'tsawwassen', 'ucluelet', 'vancouver', 'vernon', 'victoria', 'west kelowna', 'west vancouver', 'whistler', 'white rock', 'williams lake'],
  AB: ['airdrie', 'banff', 'calgary', 'canmore', 'camrose', 'chestermere', 'cochrane', 'cold lake', 'edmonton', 'edmonton southwest', 'edson', 'fort mcmurray',
    'fort saskatchewan', 'grande prairie', 'high river', 'leduc', 'lethbridge', 'lloydminster', 'east lloydminster', 'medicine hat', 'okotoks', 'peace river',
    'red deer', 'sherwood park', 'spruce grove', 'st. albert', 'st albert', 'stony plain', 'sylvan lake'],
};
const CITY_PV = {};
Object.keys(WEST_CITIES).forEach((pv) => WEST_CITIES[pv].forEach((c) => { CITY_PV[c] = pv; }));
// "Airdrie", "Calgary, Alberta", "Surrey BC" -> the province, else ''. ("Richmond" alone is
// Richmond, BC in this book; "Richmond Hill" is Ontario and is not in the list.)
CITY_PV.richmond = 'BC';
function westOf(state, city) {
  const st = String(state || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (st) return PROV[st] || '';                       // a province that is filled in decides
  const c = String(city || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const tail = /(?:,|\s)\s*(bc|b\.c\.|british columbia|ab|alberta|qc|quebec|québec)$/.exec(c);
  if (tail) return PROV[tail[1]];
  return CITY_PV[c.replace(/,.*$/, '').trim()] || '';
}
// The rule for a record with no postal code, from its province or city - BC, Alberta and Quebec
// (Quebec from the province, or a city written with it, e.g. "Laval, QC"; its cities are not listed).
function placeRule(state, city) {
  const pv = westOf(state, city);
  if (!pv) return null;
  if (pv === 'QC') return { fsa: '', place: pv, reps: ['Angela'], split: false, area: 'Quebec', source: QUEBEC.source, quote: QUEBEC.quote };
  return { fsa: '', place: pv, reps: ['Brittany'], split: false, area: pv === 'BC' ? 'British Columbia' : 'Alberta', source: WEST.source, quote: WEST.quote };
}

module.exports = { ruleFor, ruleName, fsaOf, placeRule, westOf, GROUPS };
