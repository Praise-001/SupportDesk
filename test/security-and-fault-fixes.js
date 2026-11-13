'use strict';
// Verification test suite for security, fault fixes, and architectural improvements.
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../server');
const { hashPassword, verifyPassword } = require('../lib/util');
const { extractPdfTextAsync } = require('../lib/pdf');

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

async function api(base, method, url, body, token) {
  const res = await fetch(base + url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = {};
  try {
    data = await res.json();
  } catch {}
  return { status: res.status, ...data };
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'support-fixes-test-'));
  const app = createApp({
    dataDir: dir,
    dbPath: path.join(dir, 'test.db'),
    openrouterKey: '',
    rateLimit: 10,
    skipDemoSeed: true,
  });
  const port = await app.start(0);
  const base = `http://127.0.0.1:${port}`;
  const { core } = app;

  console.log('\n1. URI Crash Fix');
  const crashReq = await fetch(`${base}/%`);
  check('GET /% returns 400 Bad Request without crashing server', crashReq.status === 400);

  const healthAfter = await api(base, 'GET', '/api/health');
  check('Server remains healthy after malformed URI requests', healthAfter.status === 200);

  console.log('\n2. Password Hashing PHC Format');
  const phcHash = await hashPassword('Secret123');
  check('New password hash uses PHC scrypt format', phcHash.startsWith('$scrypt$ln=14,r=8,p=1$'));
  const validPhc = await verifyPassword('Secret123', phcHash);
  check('PHC format verifies correctly with matching password', validPhc === true);
  const invalidPhc = await verifyPassword('WrongPass', phcHash);
  check('PHC format rejects incorrect password', invalidPhc === false);

  // Legacy backwards compatibility check
  const legacyHash = '0123456789abcdef0123456789abcdef:b109f3bbbc244eb82441917ed06d618b9008dd09b3befd1b5e07394c706a8bb980b1d7785e5976ec049b46ee5d3db18a';
  const legacyCheck = await verifyPassword('any', legacyHash);
  check('Legacy salt:hash format is handled gracefully without errors', legacyCheck === false);

  console.log('\n3. Per-Viewer SSE Event Filtering (No Staff Leak to Customer)');
  const regAlpha = await api(base, 'POST', '/api/auth/register-business', {
    business_name: 'FixCorp',
    owner_name: 'Owner Alice',
    email: 'alice@fixcorp.test',
    password: 'password123',
    niche: 'general',
  });
  const ownerTok = regAlpha.token;

  await api(base, 'POST', '/api/team', {
    name: 'Agent Bob',
    email: 'bob@fixcorp.test',
    password: 'password123',
    category_ids: [],
  }, ownerTok);
  const bobTok = (await api(base, 'POST', '/api/auth/login', { email: 'bob@fixcorp.test', password: 'password123' })).token;

  const custEntry = await api(base, 'POST', '/api/b/fixcorp/enter', {
    name: 'Customer Dave',
    email: 'dave@cust.test',
  });
  const custTok = custEntry.token;

  const ticket = await api(base, 'POST', '/api/tickets', {
    subject: 'Urgent Issue',
    description: 'Help needed',
  }, custTok);
  const tid = ticket.ticket.id;

  let customerGotInternal = false;
  let customerGotPublic = false;

  const sseReq = http.request(
    `${base}/api/tickets/${tid}/stream?token=${custTok}`,
    { method: 'GET', headers: { Accept: 'text/event-stream' } },
    (res) => {
      res.on('data', (chunk) => {
        const text = chunk.toString('utf8');
        if (text.includes('SECRET_NOTE')) customerGotInternal = true;
        if (text.includes('PUBLIC_REPLY')) customerGotPublic = true;
      });
    }
  );
  sseReq.end();
  await new Promise((r) => setTimeout(r, 400));

  // Staff sends internal note
  await api(base, 'POST', `/api/tickets/${tid}/messages`, {
    body: 'SECRET_NOTE: Staff discussion only.',
    internal: true,
  }, bobTok);

  // Staff sends public note
  await api(base, 'POST', `/api/tickets/${tid}/messages`, {
    body: 'PUBLIC_REPLY: Hello customer, we are working on it.',
    internal: false,
  }, bobTok);

  await new Promise((r) => setTimeout(r, 500));
  sseReq.destroy();

  check('Customer SSE stream does NOT receive internal note', customerGotInternal === false);
  check('Customer SSE stream receives public messages normally', customerGotPublic === true);

  console.log('\n4. Tenant Isolation & Webhook Protection');
  const regBeta = await api(base, 'POST', '/api/auth/register-business', {
    business_name: 'TargetCorp',
    owner_name: 'Owner Brian',
    email: 'brian@targetcorp.test',
    password: 'password123',
    niche: 'general',
  });
  const targetOwnerTok = regBeta.token;

  const alphaSettings = await api(base, 'GET', '/api/settings', undefined, ownerTok);
  const alphaSecret = alphaSettings.settings.inbound.secret;

  const targetSettings = await api(base, 'GET', '/api/settings', undefined, targetOwnerTok);
  const targetSecret = targetSettings.settings.inbound.secret;

  check('Different businesses receive unique webhook secrets', alphaSecret !== targetSecret && alphaSecret.length === 64);

  // Attempt cross-tenant spoofing: Attacker Alpha uses its secret to forge a ticket into TargetCorp
  const crossAttack = await fetch(`${base}/api/inbound/email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-webhook-secret': alphaSecret,
    },
    body: JSON.stringify({
      business: 'targetcorp',
      from: 'attacker@evil.test',
      subject: 'Unauthorized injection',
      text: 'Trying to inject',
    }),
  });
  check('Cross-tenant attack rejected with 401 Invalid webhook secret', crossAttack.status === 401);

  // Legitimate webhook with target business secret succeeds
  const legitWebhook = await fetch(`${base}/api/inbound/email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-webhook-secret': targetSecret,
    },
    body: JSON.stringify({
      business: 'targetcorp',
      from: 'customer@client.test',
      subject: 'Legit email ticket',
      text: 'Need assistance please',
    }),
  });
  check('Legitimate inbound email with per-tenant secret succeeds', legitWebhook.status === 201);

  console.log('\n5. Rate Limiting Protection');
  // Configured rateLimit is 10
  let blockedTickets = 0;
  for (let i = 0; i < 15; i++) {
    const res = await api(base, 'POST', '/api/tickets', {
      subject: `Ticket rate limit test ${i}`,
      description: 'Testing',
    }, custTok);
    if (res.status === 429) blockedTickets++;
  }
  check('Rate limit actively throttles excessive ticket creation (429)', blockedTickets > 0);

  console.log('\n6. SLA Accuracy on Direct Resolution');
  const slaTicket = await api(base, 'POST', '/api/tickets', {
    subject: 'Unanswered ticket',
    description: 'Will be resolved without staff reply',
  }, targetOwnerTok); // Owner creating or customer
  const custEntry2 = await api(base, 'POST', '/api/b/targetcorp/enter', {
    name: 'Customer Eve',
    email: 'eve@cust.test',
  });
  const unhandledT = await api(base, 'POST', '/api/tickets', {
    subject: 'Direct close test',
    description: 'No agent replied',
  }, custEntry2.token);
  const unhandledId = unhandledT.ticket.id;

  // Resolve it directly without human message
  await api(base, 'POST', `/api/tickets/${unhandledId}/status`, { status: 'resolved' }, targetOwnerTok);

  const closedTicketData = (await api(base, 'GET', `/api/tickets/${unhandledId}`, undefined, targetOwnerTok)).ticket;
  check('Resolving ticket without human reply keeps first_human_response_at as null', closedTicketData.first_human_response_at === null);

  const stats = (await api(base, 'GET', '/api/stats', undefined, targetOwnerTok)).stats;
  check('SLA metrics are not artificially skewed by closed tickets without human replies', stats.avg_first_response_min === null);

  console.log('\n7. Async PDF Extraction');
  const pdfBytes = minimalPdf('Async non-blocking PDF text processing.');
  const extracted = await extractPdfTextAsync(pdfBytes);
  check('Async PDF extraction succeeds non-blocking', /Async non-blocking/.test(extracted));

  console.log('\n8. Agent Visibility of Unassigned Tickets');
  const unassignedTickets = await api(base, 'GET', '/api/tickets?assigned=unassigned', undefined, bobTok);
  check('Agent can access and query unassigned tickets pool', Array.isArray(unassignedTickets.tickets));

  await app.close();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}

  console.log(`\nFix Verification: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Test suite failed:', e);
  process.exit(1);
});

