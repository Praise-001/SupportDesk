'use strict';
// Loads the demo companies into a real (temporary) database and checks what the public sees.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../server');
const makeDemo = require('../lib/demo');

let passed = 0;
let failed = 0;
const check = (name, ok, detail) => { if (ok) passed++; else { failed++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); } };

(async () => {
  console.log('\nDemo companies load automatically');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'support-desk-demo-'));
  const app = createApp({ dataDir: dir, dbPath: path.join(dir, 'd.db'), rateLimit: 100000, botDelayMs: 0 });
  const demo = makeDemo(app);
  const port = await app.start(0);
  const api = async (u, tok) => (await fetch(`http://127.0.0.1:${port}${u}`, { headers: tok ? { Authorization: `Bearer ${tok}` } : {} })).json();
  const q = (sql) => app.ctx.db.prepare(sql).get();

  check('a fresh install starts with no companies', (await api('/api/directory')).niches.every((n) => n.count === 0));
  const n = demo.ensure();
  check('first start adds every demo company', n === makeDemo.COMPANIES.length && n >= 25, `added ${n}`);
  const dirNow = await api('/api/directory');
  check('every kind has at least two companies on the public screen', dirNow.niches.every((k) => k.count >= 2), JSON.stringify(dirNow.niches.map((k) => [k.key, k.count])));
  check('each company is listed under its kind with a Demo flag', (await api('/api/businesses?niche=tech')).businesses.every((b) => b.demo === true && b.niche === 'tech'));
  check('a second start adds nothing more', demo.ensure() === 0 && q('SELECT COUNT(*) AS n FROM businesses').n === n);

  const login = await (await fetch(`http://127.0.0.1:${port}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'owner@kilimani-tech.example', password: 'demo-pass-1234' }) })).json();
  check('a demo owner can sign in with the shared password', !!login.token && login.business.demo === true);
  const tickets = await api('/api/tickets', login.token);
  check('their inbox has the sample tickets, all assigned', (tickets.tickets || []).length >= 3 && tickets.tickets.every((t) => t.assigned_to), JSON.stringify(Object.keys(tickets)));

  const removed = demo.removeAll();
  check('unseed removes only the demo companies', removed === n && q('SELECT COUNT(*) AS n FROM businesses').n === 0 && q('SELECT COUNT(*) AS n FROM tickets').n === 0 && q('SELECT COUNT(*) AS n FROM users').n === 0);
  check('after removing them they do not come back on restart', demo.ensure() === 0 && q('SELECT COUNT(*) AS n FROM businesses').n === 0);
  check('they can be added again on request', demo.addAll() === n);

  await app.close();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
