'use strict';
// Reproduction script for faults confirmed in Support-Desk audit.
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createApp } = require('../server');
const { hashPassword } = require('../lib/util');

let passed = 0;
let failed = 0;

function check(name, cond, extra) {
  if (cond) {
    passed++;
    console.log(`  ✓ REPRODUCED: ${name}`);
  } else {
    failed++;
    console.log(`  ✗ NOT REPRODUCED: ${name}${extra !== undefined ? ' → ' + JSON.stringify(extra) : ''}`);
  }
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

async function testCrash() {
  console.log('\n1. Crash vulnerability: GET /%');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'support-crash-test-'));
  const port = 39123;
  const child = spawn(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', path.join(__dirname, '..', 'server.js')],
    {
      env: {
        ...process.env,
        PORT: String(port),
        DATA_DIR: tempDir,
        DB_PATH: path.join(tempDir, 'crash.db'),
        DEMO_COMPANIES: 'off',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d.toString(); });
  child.stderr.on('data', (d) => { stderr += d.toString(); });

  // Wait for server to start listening
  await new Promise((resolve, reject) => {
    const start = Date.now();
    const interval = setInterval(() => {
      const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        clearInterval(interval);
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - start > 10000) {
          clearInterval(interval);
          reject(new Error(`Server failed to start in 10s. stdout: ${stdout}, stderr: ${stderr}`));
        }
      });
    }, 100);
  });

  // Now send the malformed URI request: GET /%
  const crashPromise = new Promise((resolve) => {
    child.on('exit', (code, signal) => {
      resolve({ exited: true, code, signal });
    });
  });

  const req = http.request({
    hostname: '127.0.0.1',
    port,
    path: '/%',
    method: 'GET',
  });
  req.on('error', () => {}); // connection reset expected when server dies
  req.end();

  const exitInfo = await Promise.race([
    crashPromise,
    new Promise((r) => setTimeout(() => r({ exited: false }), 3000)),
  ]);

  if (!exitInfo.exited) {
    child.kill();
  }

  check(
    'GET /% causes unhandled URIError and kills the entire server process',
    exitInfo.exited === true && (stderr.includes('URIError') || exitInfo.code !== 0),
    { exitInfo, stderr: stderr.slice(0, 300) }
  );

  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
}

async function main() {
  await testCrash();

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'support-repro-'));
  const app = createApp({
    dataDir: dir,
    dbPath: path.join(dir, 'test.db'),
    openrouterKey: '',
    rateLimit: 100,
    skipDemoSeed: true,
  });
  const port = await app.start(0);
  const base = `http://127.0.0.1:${port}`;
  const { core } = app;

  console.log('\n2. SSE Leakage: Internal staff notes broadcast to customer stream');
  const reg1 = await api(base, 'POST', '/api/auth/register-business', {
    business_name: 'Alpha Corp',
    owner_name: 'Alice',
    email: 'alice@alpha.test',
    password: 'password123',
    niche: 'general',
  });
  const alphaOwner = reg1.token;

  // Add agent
  await api(base, 'POST', '/api/team', {
    name: 'Agent Bob',
    email: 'bob@alpha.test',
    password: 'password123',
    category_ids: [],
  }, alphaOwner);
  const bobTok = (await api(base, 'POST', '/api/auth/login', { email: 'bob@alpha.test', password: 'password123' })).token;

  // Customer enters and creates a ticket
  const custEnter = await api(base, 'POST', '/api/b/alpha-corp/enter', {
    name: 'Charlie Cust',
    email: 'charlie@cust.test',
  });
  const custTok = custEnter.token;
  const ticketRes = await api(base, 'POST', '/api/tickets', {
    subject: 'Billing question',
    description: 'I need help with my invoice.',
  }, custTok);
  const ticketId = ticketRes.ticket.id;

  // Customer opens SSE stream
  let customerReceivedInternalNote = false;
  let receivedData = null;
  const sseReq = http.request(
    `${base}/api/tickets/${ticketId}/stream?token=${custTok}`,
    { method: 'GET', headers: { Accept: 'text/event-stream' } },
    (res) => {
      res.on('data', (chunk) => {
        const text = chunk.toString('utf8');
        if (text.includes('event: message')) {
          try {
            const dataMatch = text.match(/data:\s*(\{.*\})/);
            if (dataMatch) {
              const msg = JSON.parse(dataMatch[1]);
              if (msg.internal && msg.body.includes('SECRET_INTERNAL_NOTE')) {
                customerReceivedInternalNote = true;
                receivedData = msg;
              }
            }
          } catch {}
        }
      });
    }
  );
  sseReq.end();

  // Wait a moment for SSE connection to establish
  await new Promise((r) => setTimeout(r, 400));

  // Agent posts internal note
  await api(base, 'POST', `/api/tickets/${ticketId}/messages`, {
    body: 'SECRET_INTERNAL_NOTE: Customer might be high risk, do not refund.',
    internal: true,
  }, bobTok);

  // Wait for event to propagate
  await new Promise((r) => setTimeout(r, 400));
  sseReq.destroy();

  check(
    'Customer SSE stream receives unredacted internal staff note',
    customerReceivedInternalNote === true,
    { receivedData }
  );

  console.log('\n3. Cross-Tenant Webhook Forgery: Tenant A attacks Tenant B');
  const reg2 = await api(base, 'POST', '/api/auth/register-business', {
    business_name: 'Beta Corp',
    owner_name: 'Brian',
    email: 'brian@beta.test',
    password: 'password123',
    niche: 'general',
  });
  const betaOwner = reg2.token;

  // Tenant A owner inspects settings and reads the global webhook secret
  const settingsA = await api(base, 'GET', '/api/settings', undefined, alphaOwner);
  const sharedSecret = settingsA.settings.inbound.secret;

  // Tenant A uses this secret to inject an inbound email into Tenant B's business desk!
  const forgedRes = await fetch(`${base}/api/inbound/email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-webhook-secret': sharedSecret,
    },
    body: JSON.stringify({
      business: 'beta-corp',
      from: 'victim@attacker.test',
      subject: 'Forged Ticket Into Beta Desk',
      text: 'This ticket was created by Tenant Alpha using the global secret.',
    }),
  });
  const forgedData = await forgedRes.json();

  // Verify ticket was created in Beta Corp
  const betaTickets = await api(base, 'GET', '/api/tickets', undefined, betaOwner);
  const ticketInBeta = betaTickets.tickets.find((t) => t.subject === 'Forged Ticket Into Beta Desk');

  check(
    'Tenant A can forge inbound tickets in Tenant B using shared secret from Setup',
    forgedRes.status === 201 && !!ticketInBeta,
    { forgedData, ticketInBeta }
  );

  console.log('\n4. Rate Limiting: High volume ticket and message creation without 429');
  let ticketsCreated = 0;
  for (let i = 0; i < 25; i++) {
    const r = await api(base, 'POST', '/api/tickets', {
      subject: `Spam Ticket ${i}`,
      description: `Spam ticket payload ${i}`,
    }, custTok);
    if (r.status === 201) ticketsCreated++;
  }
  let messagesCreated = 0;
  for (let i = 0; i < 25; i++) {
    const r = await api(base, 'POST', `/api/tickets/${ticketId}/messages`, {
      body: `Spam message ${i}`,
    }, custTok);
    if (r.status === 201) messagesCreated++;
  }
  check(
    '25/25 ticket creations and 25/25 messages pass without rate limiting (no 429)',
    ticketsCreated === 25 && messagesCreated === 25,
    { ticketsCreated, messagesCreated }
  );

  console.log('\n5. SLA Metric Distortion: Resolving ticket without human reply sets first_human_response_at');
  const unhandledTicket = await api(base, 'POST', '/api/tickets', {
    subject: 'Ignored Ticket',
    description: 'Will be resolved without human reply',
  }, custTok);
  const unhandledId = unhandledTicket.ticket.id;

  // Resolve it directly
  await api(base, 'POST', `/api/tickets/${unhandledId}/status`, { status: 'resolved' }, alphaOwner);

  const resolvedTicket = (await api(base, 'GET', `/api/tickets/${unhandledId}`, undefined, alphaOwner)).ticket;
  const statsAfter = (await api(base, 'GET', '/api/stats', undefined, alphaOwner)).stats;

  check(
    'Resolving ticket without human response sets first_human_response_at and counts as met SLA',
    resolvedTicket.first_human_response_at !== null &&
    resolvedTicket.first_human_response_at !== undefined &&
    statsAfter.avg_first_response_min !== null,
    {
      first_human_response_at: resolvedTicket.first_human_response_at,
      avg_first_response_min: statsAfter.avg_first_response_min,
    }
  );

  console.log('\n6. Password Hash Parameters: scrypt output format');
  const sampleHash = await hashPassword('password123');
  const parts = sampleHash.split(':');
  const hasOnlySaltAndHash = parts.length === 2 && parts[0].length === 32 && parts[1].length === 128;
  check(
    'Password hash is bare salt:hash without algorithm identifier or cost parameters',
    hasOnlySaltAndHash,
    { sampleHash }
  );

  await app.close();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}

  console.log(`\nReproduction Results: ${passed} reproduced, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Test suite failed:', e);
  process.exit(1);
});
