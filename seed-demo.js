'use strict';
// Manual control of the demo companies. They are also added automatically the first time the
// server starts (set DEMO_COMPANIES=off in .env to prevent that).
//   npm run seed:demo           add any that are missing
//   npm run unseed:demo         remove only the demo companies (and their tickets)
//   node seed-demo.js --list    print the demo logins without touching the database
const path = require('node:path');
const demoLib = require('./lib/demo');
const { COMPANIES, PASSWORD, agentEmail, ownerEmail } = demoLib;

if (process.argv.includes('--list')) {
  console.log(`\nDemo logins (password for all: ${PASSWORD})\n`);
  let kind = '';
  for (const c of COMPANIES) {
    if (c.niche !== kind) { kind = c.niche; console.log(`\n[${kind}]`); }
    console.log(`  ${c.name}\n    owner  ${ownerEmail(c)}\n    agents ${c.agents.map(([n]) => agentEmail(c, n)).join(', ')}`);
  }
  process.exit(0);
}

const { createApp, loadDotEnv } = require('./server');
loadDotEnv(path.join(__dirname, '.env'));
const app = createApp();
const demo = demoLib(app);

if (process.argv.includes('--remove')) {
  const n = demo.removeAll();
  console.log(n ? `Removed ${n} demo companies and everything under them. They will not come back on restart.` : 'There are no demo companies to remove.');
} else {
  try {
    const n = demo.addAll();
    console.log(`\nDemo companies added: ${n}${n < COMPANIES.length ? ` (${COMPANIES.length - n} already there)` : ''}.`);
  } catch (e) {
    console.error(`\nCould not load the demo companies: ${e.message}`);
    process.exit(1);
  }
}
process.exit(0);
  