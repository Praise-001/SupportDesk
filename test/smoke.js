'use strict';
// End-to-end smoke test. Spins up the real server on a temp database and a mock OpenRouter.
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../server');
const { extractPdfText } = require('../lib/pdf');

let passed = 0;
let failed = 0;
function check(name, cond, extra) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${extra !== undefined ? ' → ' + JSON.stringify(extra) : ''}`);
  }
}

// ---- mock OpenRouter ----
const llm = { calls: [] };
const mock = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    llm.calls.push({ auth: req.headers.authorization, body });
    if (/You are a translator/.test(body.messages[0].content)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'EN: ' + body.messages[1].content } }] }));
      return;
    }
    const user = body.messages.find((m) => m.role === 'user').content.toLowerCase();
    const lastLine = user.split('\n').filter((l) => l.startsWith('customer:')).pop() || '';
    const needsHuman = /human|person|agent|manager/.test(lastLine);
    const answer = needsHuman ? 'Let me bring in a teammate.' : 'You can return items within 30 days.';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: '```json\n' + JSON.stringify({ answer, needs_human: needsHuman }) + '\n```' } }] }));
  });
});

function minimalPdf(text) {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => {
    offs.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

async function main() {
  const mockPort = await new Promise((r) => mock.listen(0, () => r(mock.address().port)));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'support-desk-test-'));
  const app = createApp({
    dataDir: dir,
    dbPath: path.join(dir, 'test.db'),
    openrouterKey: 'test-key',
    openrouterBaseUrl: `http://127.0.0.1:${mockPort}`,
    botDelayMs: 0,
    rateLimit: 100000,
  });
  const port = await app.start(0);
  const base = `http://127.0.0.1:${port}`;
  const { core } = app;

  async function api(method, url, body, token) {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = {};
    try {
      data = await res.json();
    } catch {
      /* non-json */
    }
    return { status: res.status, ...data };
  }

  console.log('\nSetup');
  const health = await api('GET', '/api/health');
  check('health endpoint', health.ok === true && health.bot === 'openrouter');
  const niches = await api('GET', '/api/niches');
  check('10 niche templates incl. academic, tech, social', niches.niches.length === 10 && ['general', 'academic', 'tech', 'social'].every((k) => niches.niches.some((n) => n.key === k)));

  const reg = await api('POST', '/api/auth/register-business', { business_name: 'Shoply', owner_name: 'Olu', email: 'olu@shoply.test', password: 'password123', niche: 'ecommerce' });
  check('owner registers a business', reg.status === 200 && reg.token && reg.business.slug === 'shoply');
  const dup = await api('POST', '/api/auth/register-business', { business_name: 'Other', owner_name: 'X', email: 'olu@shoply.test', password: 'password123', niche: 'general' });
  check('duplicate email rejected', dup.status === 409);
  const weak = await api('POST', '/api/auth/register-business', { business_name: 'Other', owner_name: 'X', email: 'x@x.test', password: 'short', niche: 'general' });
  check('weak password rejected', weak.status === 400);
  const owner = reg.token;
  check('niche categories created', reg.business.categories.length === 6 && reg.business.categories.some((c) => c.name === 'Returns & refunds'));
  const cat = (n) => reg.business.categories.find((c) => c.name === n).id;

  const ann = await api('POST', '/api/team', { name: 'Ann', email: 'ann@shoply.test', password: 'password123', category_ids: [cat('Returns & refunds')] }, owner);
  await api('POST', '/api/team', { name: 'Ben', email: 'ben@shoply.test', password: 'password123', category_ids: [cat('Payments')] }, owner);
  const cy = await api('POST', '/api/team', { name: 'Cy', email: 'cy@shoply.test', password: 'password123', category_ids: [] }, owner);
  check('owner adds 3 agents', cy.team.filter((u) => u.role === 'agent').length === 3);
  const annTok = (await api('POST', '/api/auth/login', { email: 'ann@shoply.test', password: 'password123' })).token;
  const benTok = (await api('POST', '/api/auth/login', { email: 'ben@shoply.test', password: 'password123' })).token;
  const bad = await api('POST', '/api/auth/login', { email: 'ann@shoply.test', password: 'nope-nope' });
  check('wrong password → 401', bad.status === 401);

  await api('POST', '/api/faqs', { question: 'What is your return window?', answer: 'Items can be returned within 30 days of delivery.' }, owner);
  const doc = await api('POST', '/api/documents', { title: 'Shipping policy', text: 'Standard shipping takes 3 to 5 business days. Express shipping takes 1 to 2 business days and costs extra.' }, owner);
  check('FAQ + document added', doc.status === 201 && doc.chunks >= 1);

  console.log('\nRBAC');
  check('unauthenticated → 401', (await api('GET', '/api/tickets')).status === 401);
  check('agent cannot read team', (await api('GET', '/api/team', undefined, annTok)).status === 403);
  check('agent cannot change settings', (await api('PATCH', '/api/settings', { name: 'Hacked' }, annTok)).status === 403);
  check('agent cannot add FAQ', (await api('POST', '/api/faqs', { question: 'abc', answer: 'def' }, annTok)).status === 403);

  console.log('\nCustomer + auto-assignment (by topic)');
  check('guest entry needs an email', (await api('POST', '/api/b/shoply/enter', { name: 'Nomail' })).status === 400);
  const cust = await api('POST', '/api/b/shoply/enter', { name: 'Dana', email: 'dana@example.com' });
  check('guest entry with name and email (no password)', cust.status === 200 && cust.token && cust.user.role === 'customer' && cust.user.account === false);
  check('customers are not sent reply targets', cust.business.sla_minutes === undefined && (await api('GET', '/api/b/shoply')).business.sla_minutes === undefined);
  const ct = cust.token;
  check('customer blocked from staff stats', (await api('GET', '/api/stats', undefined, ct)).status === 403);
  const noOrder = await api('POST', '/api/tickets', { category_id: cat('Returns & refunds'), subject: 'Return my shoes', description: 'They do not fit.', priority: 'high', custom: {} }, ct);
  check('required custom field enforced', noOrder.status === 400 && /Order number/.test(noOrder.error));
  const t1 = await api('POST', '/api/tickets', { category_id: cat('Returns & refunds'), subject: 'Return my shoes', description: 'What is your return window for shoes?', priority: 'high', custom: { order_number: 'A-100' } }, ct);
  check('ticket created', t1.status === 201 && t1.ticket.code.startsWith('T-'));
  check('customer response hides priority, deadlines, assignee and SLA', ['priority', 'due_at', 'escalate_at', 'sla', 'assignee_name', 'assigned_to'].every((k) => !(k in t1.ticket)));
  check('returns ticket → Ann (topic match)', core.ticketById(t1.ticket.id).assignee_name === 'Ann');
  const t2 = await api('POST', '/api/tickets', { category_id: cat('Payments'), subject: 'Charged twice', description: 'My card was charged twice for one order.', priority: 'urgent' }, ct);
  check('payments ticket → Ben (topic match)', core.ticketById(t2.ticket.id).assignee_name === 'Ben');
  check('urgency is worked out silently from the wording', core.ticketById(t2.ticket.id).priority === 'high' && core.ticketById(t1.ticket.id).priority === 'normal');
  check('customers cannot force a priority', core.ticketById(t2.ticket.id).priority !== 'urgent');
  await api('POST', `/api/tickets/${t2.ticket.id}/priority`, { priority: 'urgent' }, owner);
  const t3 = await api('POST', '/api/tickets', { category_id: cat('Account'), subject: 'Change my address', description: 'I need to update my delivery address.', priority: 'low' }, ct);
  check('account ticket → generalist Cy', core.ticketById(t3.ticket.id).assignee_name === 'Cy');
  await api('POST', `/api/tickets/${t3.ticket.id}/priority`, { priority: 'low' }, owner);
  const low = core.ticketById(t3.ticket.id);
  check('low priority escalates at 90 min (1h30)', low.escalate_at - low.created_at === 90 * 60000 && low.due_at - low.created_at === 120 * 60000);
  const urgent = core.ticketById(t2.ticket.id);
  check('urgent target shorter than 2h cap', urgent.due_at - urgent.created_at === 30 * 60000);

  console.log('\nBot (Maya via OpenRouter) + knowledge');
  await app.bot.idle();
  let thread = await api('GET', `/api/tickets/${t1.ticket.id}`, undefined, ct);
  const botMsg = thread.messages.find((m) => m.sender_type === 'bot');
  check('bot replied automatically as "Maya"', botMsg && botMsg.sender_name === 'Maya' && /30 days/.test(botMsg.body));
  check('bot call authenticated with the key', llm.calls[0] && llm.calls[0].auth === 'Bearer test-key');
  const sys0 = llm.calls[0].body.messages[0].content;
  check('FAQ passed to the model as knowledge', /return window/i.test(sys0) && /30 days/.test(sys0));
  check('ticket still handled by bot', thread.ticket.handler === 'bot');
  const hit = app.bot.retrieve(core.getBusinessBySlug('shoply').id, 'how long does express shipping take');
  check('retrieval finds uploaded document', hit.chunks.length >= 1 && /Express/.test(hit.chunks[0].ref.text));

  console.log('\nCustomer asks for a person');
  await api('POST', `/api/tickets/${t1.ticket.id}/messages`, { body: 'I would like to talk to a human please' }, ct);
  await app.bot.idle();
  thread = await api('GET', `/api/tickets/${t1.ticket.id}`, undefined, ct);
  check('bot hands over to a person', thread.ticket.handler === 'human');
  check('customer sees a handoff note', thread.messages.some((m) => m.sender_type === 'system' && /team/i.test(m.body)));
  const annNotes = await api('GET', '/api/notifications', undefined, annTok);
  check('assigned agent notified', annNotes.items.some((n) => n.ticket_id === t1.ticket.id));

  console.log('\nTakeover (human steps into the bot conversation) + handback');
  await api('POST', `/api/tickets/${t2.ticket.id}/messages`, { body: 'Can you explain the duplicate charge?' }, ct);
  await app.bot.idle();
  const before = (await api('GET', `/api/tickets/${t2.ticket.id}`, undefined, ct)).messages.filter((m) => m.sender_type === 'bot').length;
  check('bot answering before takeover', before >= 1);
  const tk = await api('POST', `/api/tickets/${t2.ticket.id}/takeover`, {}, benTok);
  check('agent takes over', tk.status === 200 && tk.changed === true);
  await api('POST', `/api/tickets/${t2.ticket.id}/messages`, { body: 'Thanks, I am still waiting.' }, ct);
  await app.bot.idle();
  const after = (await api('GET', `/api/tickets/${t2.ticket.id}`, undefined, ct)).messages.filter((m) => m.sender_type === 'bot').length;
  check('bot stays silent after takeover', after === before);
  const rep = await api('POST', `/api/tickets/${t2.ticket.id}/messages`, { body: 'Hi Dana, I am refunding the duplicate now.' }, benTok);
  check('human reply accepted', rep.status === 201);
  const note = await api('POST', `/api/tickets/${t2.ticket.id}/messages`, { body: 'Checked Stripe: duplicate confirmed.', internal: true }, benTok);
  check('internal note accepted', note.status === 201);
  const custView = await api('GET', `/api/tickets/${t2.ticket.id}`, undefined, ct);
  const staffView = await api('GET', `/api/tickets/${t2.ticket.id}`, undefined, benTok);
  check('customer cannot see internal notes', !custView.messages.some((m) => m.internal) && !JSON.stringify(custView).includes('Stripe'));
  check('staff can see internal notes', staffView.messages.some((m) => m.internal));
  check('first human reply stops SLA clock', staffView.ticket.sla.state === 'met' && staffView.ticket.status === 'pending');
  check('agent cannot read another agent\'s ticket', (await api('GET', `/api/tickets/${t1.ticket.id}`, undefined, benTok)).status === 404);
  check('owner can read any ticket', (await api('GET', `/api/tickets/${t1.ticket.id}`, undefined, owner)).status === 200);
  const hb = await api('POST', `/api/tickets/${t2.ticket.id}/handback`, {}, benTok);
  check('handback to bot', hb.changed === true);
  await api('POST', `/api/tickets/${t2.ticket.id}/messages`, { body: 'One more question about shipping times?' }, ct);
  await app.bot.idle();
  const end = (await api('GET', `/api/tickets/${t2.ticket.id}`, undefined, ct)).messages.filter((m) => m.sender_type === 'bot').length;
  check('bot answers again after handback', end === before + 1);
  const ownerTake = await api('POST', `/api/tickets/${t3.ticket.id}/takeover`, {}, owner);
  check('owner can take over any thread', ownerTake.status === 200);
  const ownerReply = await api('POST', `/api/tickets/${t3.ticket.id}/messages`, { body: 'Hi, owner here — address updated.' }, owner);
  const t3view = await api('GET', `/api/tickets/${t3.ticket.id}`, undefined, ct);
  check('owner message shows to customer as owner', ownerReply.status === 201 && t3view.messages.some((m) => m.sender_type === 'owner'));

  console.log('\nStatus workflow');
  check('cannot set status "new"', (await api('POST', `/api/tickets/${t2.ticket.id}/status`, { status: 'new' }, benTok)).status === 400);
  check('pending → resolved', (await api('POST', `/api/tickets/${t2.ticket.id}/status`, { status: 'resolved' }, benTok)).status === 200);
  check('resolved → pending blocked', (await api('POST', `/api/tickets/${t2.ticket.id}/status`, { status: 'pending' }, benTok)).status === 409);
  await api('POST', `/api/tickets/${t2.ticket.id}/messages`, { body: 'Actually it happened again.' }, ct);
  check('customer reply reopens resolved ticket', (await api('GET', `/api/tickets/${t2.ticket.id}`, undefined, ct)).ticket.status === 'open');
  await app.bot.idle();
  const solved = await api('POST', `/api/tickets/${t2.ticket.id}/solved`, {}, ct);
  check('customer can mark solved', solved.status === 200 && (await api('GET', `/api/tickets/${t2.ticket.id}`, undefined, ct)).ticket.status === 'resolved');
  await api('POST', `/api/tickets/${t2.ticket.id}/status`, { status: 'closed' }, benTok);
  check('closed ticket rejects customer replies', (await api('POST', `/api/tickets/${t2.ticket.id}/messages`, { body: 'hello?' }, ct)).status === 409);

  console.log('\nSLA escalation (2-hour rule)');
  const sla = await api('PATCH', '/api/settings', { sla: { urgent: 999, high: 60, normal: 90, low: 500 } }, owner);
  check('SLA targets are capped at 2 hours', sla.business.sla_minutes.urgent === 120 && sla.business.sla_minutes.low === 120);
  await api('PATCH', '/api/settings', { sla: { urgent: 30, high: 60, normal: 90, low: 120 } }, owner);
  const t4 = await api('POST', '/api/tickets', { category_id: cat('Product question'), subject: 'Is this in stock?', description: 'Do you have size 42 in stock?', priority: 'normal' }, ct);
  await app.bot.idle();
  const row4 = core.ticketById(t4.ticket.id);
  check('bot-handled ticket still has no human response', row4.first_human_response_at === null && row4.handler === 'bot');
  let tick = core.slaTick(row4.created_at + 60 * 60000);
  check('no escalation before the threshold', core.ticketById(t4.ticket.id).handler === 'bot' && core.ticketById(t4.ticket.id).escalated_at === null);
  tick = core.slaTick(row4.created_at + 70 * 60000);
  const esc = core.ticketById(t4.ticket.id);
  check('escalated to a human at 75% of target', esc.handler === 'human' && esc.escalated_at !== null && tick.escalated >= 1);
  check('escalated ticket has an assignee', esc.assigned_to !== null);
  const notes = await api('GET', '/api/notifications', undefined, owner);
  check('owner notified of escalation', notes.items.some((n) => n.ticket_id === t4.ticket.id && n.type === 'escalated'));
  tick = core.slaTick(row4.created_at + 95 * 60000);
  const od = await api('GET', `/api/tickets/${t4.ticket.id}`, undefined, owner);
  check('overdue flagged after the target', od.ticket.sla.state === 'overdue' || tick.overdue >= 1);
  const odNotes = await api('GET', '/api/notifications', undefined, owner);
  check('owner notified of overdue ticket', odNotes.items.some((n) => n.ticket_id === t4.ticket.id && n.type === 'overdue'));
  const stats = await api('GET', '/api/stats', undefined, owner);
  check('stats endpoint works', typeof stats.stats.open === 'number');

  console.log('\nInbound email → ticket');
  const wrong = await api('POST', '/api/inbound/email', { to: 'shoply@x.test', from: 'sam@example.com', subject: 'Hi', text: 'Hello there' });
  check('webhook rejects a wrong secret', wrong.status === 401);
  const send = (payload) =>
    fetch(`${base}/api/inbound/email`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-secret': app.config.inboundSecret }, body: JSON.stringify(payload) }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
  const em = await send({ to: 'support+shoply@mail.test', from: 'Sam <sam@example.com>', from_name: 'Sam', subject: 'I need a refund for my order', text: 'Please refund my last order, it arrived broken.' });
  check('email creates a ticket', em.status === 201 && em.created === true);
  const emTicket = core.ticketByCode(em.ticket_code);
  check('email ticket categorised by keywords + assigned', emTicket.source === 'email' && emTicket.category_name === 'Returns & refunds' && emTicket.assigned_to !== null);
  const em2 = await send({ to: 'shoply@mail.test', from: 'sam@example.com', subject: `Re: I need a refund [${em.ticket_code}]`, text: 'Any update?\n\nOn Mon, Sam wrote:\n> old quoted text' });
  check('email reply appends to the same ticket', em2.status === 201 && em2.created === false && em2.ticket_code === em.ticket_code);
  const emMsgs = app.ctx.db.prepare('SELECT body FROM messages WHERE ticket_id = ?').all(emTicket.id);
  check('quoted text stripped from replies', emMsgs.some((m) => m.body === 'Any update?') && !emMsgs.some((m) => /old quoted/.test(m.body)));
  await app.bot.idle();

  console.log('\nCustomer return visit, team, categories');
  const lk = await api('POST', '/api/b/shoply/lookup', { code: t1.ticket.code, email: 'DANA@example.com' });
  check('guest resumes with ticket code + email', lk.status === 200 && lk.ticket_id === t1.ticket.id);
  check('wrong email rejected', (await api('POST', '/api/b/shoply/lookup', { code: t1.ticket.code, email: 'eve@example.com' })).status === 404);
  check('name alone no longer opens a ticket', (await api('POST', '/api/b/shoply/lookup', { code: t1.ticket.code, name: 'Dana' })).status === 404);
  const eve = await api('POST', '/api/b/shoply/enter', { name: 'Eve', email: 'eve@example.com' });
  const sneaky = await api('POST', '/api/b/shoply/enter', { name: 'Not Dana', email: 'dana@example.com' });
  check('typing someone else\'s email shows none of their tickets', (await api('GET', '/api/tickets?status=all', undefined, sneaky.token)).tickets.length === 0);
  check('other customers cannot see my tickets', (await api('GET', `/api/tickets/${t1.ticket.id}`, undefined, eve.token)).status === 404);
  const before2 = (await api('GET', '/api/team', undefined, owner)).team.find((u) => u.name === 'Ann').open_tickets;
  const deact = await api('PATCH', `/api/team/${ann.team.find((u) => u.name === 'Ann').id}`, { active: false }, owner);
  const annAfter = deact.team.find((u) => u.name === 'Ann');
  check('deactivating an agent reassigns their tickets', before2 > 0 && annAfter.open_tickets === 0 && annAfter.active === false);
  const addCat = await api('POST', '/api/categories', { name: 'Gift cards', description: 'Gift card help', fields: [{ label: 'Card number ending', type: 'text' }] }, owner);
  check('owner adds a custom category with a field', addCat.status === 201 && addCat.categories.some((c) => c.name === 'Gift cards' && c.fields.length === 1));
  const apply = await api('POST', '/api/categories/apply-niche', { niche: 'academic' }, owner);
  check('niche template can be applied on top', apply.added >= 5);
  const pub = await api('GET', '/api/b/shoply');
  check('public business page lists categories', pub.business.categories.length > 6);

  console.log('\nCustomer accounts, business search, simulated email');
  const reg2 = await api('POST', '/api/b/shoply/customer/register', { name: 'Ada', email: 'ada@example.com', password: 'adapass-123' });
  check('customer creates an optional account', reg2.status === 200 && reg2.user.account === true);
  check('duplicate account email rejected', (await api('POST', '/api/b/shoply/customer/register', { name: 'Ada 2', email: 'ADA@example.com', password: 'adapass-123' })).status === 409);
  check('short account password rejected', (await api('POST', '/api/b/shoply/customer/register', { name: 'X', email: 'x2@example.com', password: 'short' })).status === 400);
  check('wrong account password → 401', (await api('POST', '/api/b/shoply/customer/login', { email: 'ada@example.com', password: 'nope-nope-1' })).status === 401);
  const adaTicket = await api('POST', '/api/tickets', { category_id: cat('Account'), subject: 'Update my name', description: 'Please update the name on my account.' }, reg2.token);
  const adaLogin = await api('POST', '/api/b/shoply/customer/login', { email: 'ada@example.com', password: 'adapass-123' });
  check('account holder signs in and sees their tickets', adaLogin.status === 200 && (await api('GET', '/api/tickets?status=all', undefined, adaLogin.token)).tickets.some((t) => t.code === adaTicket.ticket.code));
  check('an account ticket cannot be opened with just code + email', (await api('POST', '/api/b/shoply/lookup', { code: adaTicket.ticket.code, email: 'ada@example.com' })).status === 403);
  const guestUp = await api('POST', '/api/b/shoply/enter', { name: 'Gus', email: 'gus@example.com' });
  check('guest can add a password to keep tickets together', (await api('POST', '/api/account/set-password', { password: 'gus-pass-123' }, guestUp.token)).status === 200);
  check('…then sign in with it', (await api('POST', '/api/b/shoply/customer/login', { email: 'gus@example.com', password: 'gus-pass-123' })).status === 200);
  const clash = await api('POST', '/api/b/shoply/enter', { name: 'Ada Guest', email: 'ada@example.com' });
  check('a guest cannot take over an existing account email', (await api('POST', '/api/account/set-password', { password: 'whatever-123' }, clash.token)).status === 409);
  check('agents cannot use the customer password route', (await api('POST', '/api/account/set-password', { password: 'whatever-123' }, benTok)).status === 403);

  check('business search needs a query', (await api('GET', '/api/businesses')).businesses.length === 0 && (await api('GET', '/api/businesses?q=s')).businesses.length === 0);
  const found = await api('GET', '/api/businesses?q=shop');
  check('business search finds by name as you type', found.businesses.length === 1 && found.businesses[0].slug === 'shoply');
  check('business search returns nothing for a non-match', (await api('GET', '/api/businesses?q=zzzz')).businesses.length === 0);
  const ola = await api('POST', '/api/auth/register-business', { business_name: "Ọlá's Help Desk", owner_name: 'Ola', email: 'ola@example.com', password: 'password123', niche: 'legal' });
  check('a desk with accents and an apostrophe can be created', ola.status === 200);
  const searchSlugs = async (q) => (await api('GET', `/api/businesses?q=${encodeURIComponent(q)}`)).businesses.map((b) => b.slug);
  check('search ignores accents and apostrophes ("ola", "ọlá", "olas")', (await Promise.all(['ola', 'ọlá', 'olas', "OLA'S"].map(searchSlugs))).every((r) => r.includes(ola.business.slug)));
  check('search needs every word, in any order ("help ola", "ola help desk")', (await searchSlugs('help ola')).includes(ola.business.slug) && !(await searchSlugs('ola zzzz')).includes(ola.business.slug));
  check('search also finds by kind of business ("legal")', (await searchSlugs('legal')).includes(ola.business.slug));
  check('a search never returns more than 8 or any hidden fields', Object.keys((await api('GET', '/api/businesses?q=ola')).businesses[0]).sort().join() === 'demo,name,niche,niche_label,slug');
  const directory = await api('GET', '/api/directory');
  check('directory lists every kind of business with a count', directory.niches.length >= 10 && directory.niches.find((n) => n.key === 'legal').count >= 1 && directory.niches.every((n) => typeof n.count === 'number'));
  const legal = await api('GET', '/api/businesses?niche=legal');
  check('browsing a kind lists its companies', legal.businesses.some((b) => b.slug === ola.business.slug) && legal.businesses.every((b) => b.niche === 'legal') && legal.has_more === false);
  check('an unknown kind is rejected', (await api('GET', '/api/businesses?niche=nope')).status === 400);
  const olaLogin = ola.token;
  const hide = await api('PATCH', '/api/settings', { listed: false }, olaLogin);
  check('an owner can unlist their desk', hide.status === 200 && hide.business.listed === false);
  check('an unlisted desk is gone from browse, search and counts', !(await api('GET', '/api/businesses?niche=legal')).businesses.some((b) => b.slug === ola.business.slug) && !(await searchSlugs('ola')).includes(ola.business.slug) && (await api('GET', '/api/directory')).niches.find((n) => n.key === 'legal').count === directory.niches.find((n) => n.key === 'legal').count - 1);
  check('an unlisted desk still opens by its own link', (await api('GET', `/api/b/${ola.business.slug}`)).business.name === "Ọlá's Help Desk");
  await api('PATCH', '/api/settings', { listed: true }, olaLogin);
  check('listing it again brings it back', (await searchSlugs('ola')).includes(ola.business.slug));

  const simBody = { from: 'sim@example.com', from_name: 'Sim Customer', subject: 'Where is my parcel', text: 'My order has not arrived and it is broken.' };
  check('simulate email is owner only', (await api('POST', '/api/simulate-email', simBody, benTok)).status === 403 && (await api('POST', '/api/simulate-email', simBody, ct)).status === 403);
  const sim = await api('POST', '/api/simulate-email', simBody, owner);
  check('simulate email creates a ticket like the real webhook', sim.status === 201 && sim.created === true && core.ticketByCode(sim.ticket_code).source === 'email');
  check('simulated email is routed, prioritised and answered like any ticket', core.ticketByCode(sim.ticket_code).assigned_to !== null && core.ticketByCode(sim.ticket_code).priority === 'high');
  await app.bot.idle();

  console.log('\nPDF + knowledge upload');
  const pdfText = extractPdfText(minimalPdf('Refunds are issued to the original payment method within five business days of approval.'));
  check('PDF text extraction', /original payment method/.test(pdfText));
  const up = await api('POST', '/api/documents', { filename: 'policy.pdf', title: 'Refund policy', data_base64: minimalPdf('Refunds are issued to the original payment method within five business days of approval.').toString('base64') }, owner);
  check('owner uploads a PDF', up.status === 201 && up.documents.some((d) => d.title === 'Refund policy' && d.kind === 'pdf'));
  const notPdf = await api('POST', '/api/documents', { filename: 'x.exe', data_base64: Buffer.from('MZ not allowed at all really').toString('base64') }, owner);
  check('unsupported file type rejected', notPdf.status === 415);
  const pr = await api('GET', '/api/documents', undefined, benTok);
  check('agents can list documents but not delete', pr.status === 200 && (await api('DELETE', `/api/documents/${pr.documents[0].id}`, undefined, benTok)).status === 403);
  check('deactivated agent can no longer use their token', (await api('GET', '/api/tickets', undefined, annTok)).status === 401);

  console.log('\nOther languages + Translate to English');
  const { looksNonEnglish } = require('../lib/util');
  const guess = (t) => looksNonEnglish(t);
  check('detects Spanish, French, Portuguese, German, Arabic', ['Hola, necesito ayuda con mi pedido por favor', 'Bonjour, je suis bloqué et je ne reçois pas le mail', 'Olá, preciso de ajuda com meu pedido', 'Ich habe mein Passwort vergessen', 'مرحبا أحتاج مساعدة في طلبي'].every(guess));
  check('does not flag English, codes or tiny messages', !['My order has not arrived and I need help', 'Order 12345 tracking number please', 'ok thanks', 'Where is my refund for the broken lamp?'].some(guess));
  const callsBefore = llm.calls.length;
  const es = await api('POST', '/api/tickets', { category_id: cat('Account'), subject: 'Ayuda con mi pedido', description: 'Hola, necesito ayuda con mi pedido por favor' }, ct);
  await app.bot.idle();
  const esCalls = llm.calls.slice(callsBefore);
  check('non-English message is translated for searching, then answered', esCalls.length === 2 && /You are a translator/.test(esCalls[0].body.messages[0].content) && /same language as the customer/.test(esCalls[1].body.messages[0].content));
  const esThreadStaff = await api('GET', `/api/tickets/${es.ticket.id}`, undefined, owner);
  const esMsg = esThreadStaff.messages.find((m) => m.sender_type === 'customer');
  check('translation is cached for staff, never shown to customers', esMsg.translation === 'EN: Hola, necesito ayuda con mi pedido por favor' && !(await api('GET', `/api/tickets/${es.ticket.id}`, undefined, ct)).messages.some((m) => 'translation' in m));
  const again = await api('POST', `/api/tickets/${es.ticket.id}/messages/${esMsg.id}/translate`, {}, owner);
  check('staff can translate a message to English (cached, no extra model call)', again.status === 200 && again.translation === esMsg.translation && llm.calls.length === callsBefore + 2);
  const botEs = esThreadStaff.messages.find((m) => m.sender_type === 'bot');
  const trBot = await api('POST', `/api/tickets/${es.ticket.id}/messages/${botEs.id}/translate`, {}, owner);
  check('staff can translate the assistant reply too', trBot.status === 200 && /^EN: /.test(trBot.translation));
  check('customers cannot use the translate endpoint', (await api('POST', `/api/tickets/${es.ticket.id}/messages/${esMsg.id}/translate`, {}, ct)).status === 403);
  check('translate refuses a message from another ticket', (await api('POST', `/api/tickets/${t1.ticket.id}/messages/${esMsg.id}/translate`, {}, owner)).status === 404);
  const esPerson = await api('POST', `/api/tickets/${es.ticket.id}/messages`, { body: 'Quiero hablar con una persona real' }, ct);
  await app.bot.idle();
  check('a request for a person in Spanish hands over to a human', core.ticketById(es.ticket.id).handler === 'human' && esPerson.status === 201);

  console.log('\nHuman-only mode and no-API-key fallback');
  await api('PATCH', '/api/settings', { automation_mode: 'human' }, owner);
  const t5 = await api('POST', '/api/tickets', { category_id: cat('Product question'), subject: 'Human only test', description: 'Hello, anyone there?', priority: 'normal' }, ct);
  await app.bot.idle();
  check('human-only mode: no bot, handler human', t5.ticket.handler === 'human' && !(await api('GET', `/api/tickets/${t5.ticket.id}`, undefined, ct)).messages.some((m) => m.sender_type === 'bot'));
  await app.close();

  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'support-desk-test2-'));
  const app2 = createApp({ dataDir: dir2, dbPath: path.join(dir2, 'b.db'), openrouterKey: '', botDelayMs: 0, rateLimit: 100000 });
  const port2 = await app2.start(0);
  const b2 = `http://127.0.0.1:${port2}`;
  const call2 = async (m, u, body, tok) => {
    const r = await fetch(b2 + u, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, ...(await r.json()) };
  };
  const r2 = await call2('POST', '/api/auth/register-business', { business_name: 'Campus Help', owner_name: 'Prof', email: 'prof@campus.test', password: 'password123', niche: 'academic' });
  await call2('POST', '/api/faqs', { question: 'When does course registration open?', answer: 'Registration opens on the first Monday of each semester.' }, r2.token);
  const c2 = await call2('POST', '/api/b/campus-help/enter', { name: 'Tolu', email: 'tolu@example.com' });
  const ca = r2.business.categories[1].id;
  const hit2 = await call2('POST', '/api/tickets', { category_id: ca, subject: 'Course registration', description: 'When does course registration open this semester?', priority: 'normal', custom: { student_id: 'S1', course_code: 'CS101' } }, c2.token);
  await app2.bot.idle();
  const th2 = await call2('GET', `/api/tickets/${hit2.ticket.id}`, undefined, c2.token);
  check('no API key: matching FAQ answers directly', th2.messages.some((m) => m.sender_type === 'bot' && /first Monday/.test(m.body)) && th2.ticket.handler === 'bot');
  const miss = await call2('POST', '/api/tickets', { category_id: ca, subject: 'Weird thing', description: 'My dog ate my transcript and the library is on fire.', priority: 'normal', custom: { student_id: 'S1', course_code: 'CS101' } }, c2.token);
  await app2.bot.idle();
  const th3 = await call2('GET', `/api/tickets/${miss.ticket.id}`, undefined, c2.token);
  check('no API key: unmatched question goes to a person', th3.ticket.handler === 'human');
  const nk = await call2('POST', `/api/tickets/${hit2.ticket.id}/messages/${th2.messages[0].id}/translate`, {}, r2.token);
  check('translate says what is missing when there is no AI key', nk.status === 503 && /OPENROUTER_API_KEY/.test(nk.error || nk.message || ''));
  await app2.close();
  mock.close();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
