'use strict';
// Checks the demo companies before they are ever loaded: enough of them for every kind of service,
// every category and agent specialty exists, and each desk has the full set of content.
const { NICHES } = require('../lib/niches');
const { looksNonEnglish } = require('../lib/util');
const COMPANIES = require('../demo');

let passed = 0;
let failed = 0;
const check = (name, ok, detail) => {
  if (ok) { passed++; return; }
  failed++;
  console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nDemo data');
const KINDS = Object.keys(NICHES);
const perKind = Object.fromEntries(KINDS.map((k) => [k, COMPANIES.filter((c) => c.niche === k)]));
for (const k of KINDS) check(`kind "${k}" has at least two companies`, perKind[k].length >= 2, `has ${perKind[k].length}`);
check('names are unique', new Set(COMPANIES.map((c) => c.name)).size === COMPANIES.length);
check('email domains are unique', new Set(COMPANIES.map((c) => c.domain)).size === COMPANIES.length);

const KINDS_OK = new Set(['new', 'bot', 'agent', 'resolved']);
let tickets = 0;
let nonEnglish = 0;
const bots = new Set();
for (const c of COMPANIES) {
  const where = c.name;
  const dropped = new Set(c.dropCategories || []);
  const cats = new Set([...NICHES[c.niche].categories.map((x) => x.name).filter((n) => !dropped.has(n)), ...(c.extraCategories || []).map((x) => x[0])]);
  check(`${where}: about text`, c.about && c.about.length >= 200, 'about is too short');
  check(`${where}: domain`, /^[a-z0-9.-]+\.example$/.test(c.domain), c.domain);
  check(`${where}: at least 2 agents`, c.agents.length >= 2);
  check(`${where}: agent names are unique`, new Set(c.agents.map((a) => a[0].split(' ').find((w) => !/^(dr|prof|nurse|pharmacist|hygienist)\.?$/i.test(w)))).size === c.agents.length);
  for (const [name, specs] of c.agents) {
    check(`${where}: ${name} has specialties`, specs.length >= 1);
    for (const s of specs) check(`${where}: ${name} specialty "${s}" exists`, cats.has(s), `have: ${[...cats].join(' | ')}`);
  }
  const covered = new Set(c.agents.flatMap((a) => a[1]));
  const mainCats = NICHES[c.niche].categories.filter((x) => x.name !== 'Other' && !dropped.has(x.name)).map((x) => x.name);
  const missing = mainCats.filter((m) => !covered.has(m));
  check(`${where}: every request type has an agent`, missing.length === 0, `no agent for: ${missing.join(', ')}`);
  check(`${where}: 8 or more FAQs`, c.faqs.length >= 8, `has ${c.faqs.length}`);
  check(`${where}: FAQ questions are unique`, new Set(c.faqs.map((f) => f[0])).size === c.faqs.length);
  for (const [q, a] of c.faqs) check(`${where}: FAQ "${q.slice(0, 40)}" is complete`, q.length >= 10 && a.length >= 60, 'too short');
  check(`${where}: at least 3 policy documents`, c.docs.length >= 3, `has ${c.docs.length}`);
  for (const [title, text] of c.docs) check(`${where}: document "${title}" has enough text`, text.length >= 400, `${text.length} characters`);
  check(`${where}: at least 4 sample tickets`, c.tickets.length >= 4, `has ${c.tickets.length}`);
  const states = new Set(c.tickets.map((x) => x.kind));
  check(`${where}: tickets in several states`, states.size >= 3, [...states].join(','));
  for (const x of c.tickets) {
    tickets++;
    check(`${where}: ticket "${x.subject}" uses a real category`, cats.has(x.cat), x.cat);
    const catDef = NICHES[c.niche].categories.find((k) => k.name === x.cat);
    for (const f of (catDef ? catDef.fields : []).filter((q) => q.required)) {
      check(`${where}: ticket "${x.subject}" fills the required "${f.label}"`, !!(x.custom && x.custom[f.key]));
    }
    check(`${where}: ticket "${x.subject}" has a valid state`, KINDS_OK.has(x.kind));
    check(`${where}: ticket "${x.subject}" has a reply when it should`, x.kind === 'new' || (x.reply && x.reply.length > 40));
    check(`${where}: ticket "${x.subject}" has a customer`, Array.isArray(x.who) && /@/.test(x.who[1]));
    if (x.kind === 'bot') bots.add(x.reply);
    if (looksNonEnglish(x.body)) nonEnglish++;
  }
  check(`${where}: has a new ticket waiting for a first reply`, c.tickets.some((x) => x.kind === 'new' || x.kind === 'bot'));
}
check('some tickets are written in other languages (to show off translation)', nonEnglish >= 12, `only ${nonEnglish} detected`);
check('companies span at least 25 desks', COMPANIES.length >= 25, `${COMPANIES.length}`);

console.log(`  ${COMPANIES.length} companies, ${tickets} sample tickets, ${nonEnglish} in other languages`);
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
