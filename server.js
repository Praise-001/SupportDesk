'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { openDb, transaction } = require('./lib/db');
const util = require('./lib/util');
const { HttpError, signJwt, verifyJwt, verifyPassword, hashPassword, isEmail, str, safeJson } = util;
const { NICHES, BOT_NAME_SUGGESTIONS, listNiches } = require('./lib/niches');
const { extractPdfText, chunkText } = require('./lib/pdf');
const makeCore = require('./lib/core');
const makeBot = require('./lib/bot');

// ---------- config ----------
function loadDotEnv(file) {
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!m || process.env[m[1]] !== undefined) continue;
      process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch {
    /* no .env file */
  }
}

function buildConfig(overrides = {}) {
  const e = process.env;
  const dataDir = overrides.dataDir || e.DATA_DIR || path.join(__dirname, 'data');
  return {
    port: Number(e.PORT) || 3000,
    dataDir,
    dbPath: overrides.dbPath || e.DB_PATH || path.join(dataDir, 'support.db'),
    jwtSecret: util.loadOrCreateSecret(dataDir, '.jwt_secret', e.JWT_SECRET),
    inboundSecret: util.loadOrCreateSecret(dataDir, '.inbound_secret', e.INBOUND_EMAIL_SECRET),
    openrouterKey: e.OPENROUTER_API_KEY || '',
    openrouterModel: e.OPENROUTER_MODEL || 'openrouter/auto',
    openrouterBaseUrl: (e.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, ''),
    publicUrl: e.PUBLIC_URL || `http://localhost:${Number(e.PORT) || 3000}`,
    botDelayMs: e.BOT_DELAY_MS !== undefined ? Number(e.BOT_DELAY_MS) : 600,
    slaTickMs: Number(e.SLA_TICK_MS) || 30000,
    rateLimit: Number(e.RATE_LIMIT_PER_MIN) || 60,
    ...overrides,
  };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

function createApp(overrides = {}) {
  const config = buildConfig(overrides);
  const db = openDb(config.dbPath);
  const ticketSubscribers = new Map();
  function broadcastTicketEvent(ticketId, event, data) {
    const subs = ticketSubscribers.get(Number(ticketId));
    if (!subs || !subs.size) return;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of [...subs]) {
      try { res.write(payload); } catch { subs.delete(res); }
    }
  }
  const ctx = { db, config, onEvent: broadcastTicketEvent };
  const core = makeCore(ctx);
  const bot = makeBot(ctx, core);
  const get = (sql, ...p) => db.prepare(sql).get(...p);
  const all = (sql, ...p) => db.prepare(sql).all(...p);
  const run = (sql, ...p) => db.prepare(sql).run(...p);

  // ---------- helpers ----------
  const hits = new Map();
  function rateLimit(req, key, max = config.rateLimit) {
    const ip = req.socket.remoteAddress || 'x';
    const k = `${key}:${ip}`;
    const t = Date.now();
    const rec = hits.get(k);
    if (!rec || t - rec.start > 60000) {
      hits.set(k, { start: t, n: 1 });
      return;
    }
    if (++rec.n > max) throw new HttpError(429, 'Too many requests — please wait a minute and try again.');
  }

  // `full` adds the reply targets, which only staff may see
  const publicBusiness = (b, full = false) => ({
    slug: b.slug,
    name: b.name,
    niche: b.niche,
    niche_label: NICHES[b.niche]?.label || 'General',
    about: b.about,
    demo: !!b.demo,
    bot_name: b.bot_name,
    automation_mode: b.automation_mode,
    ...(full ? { sla_minutes: core.slaTable(b), listed: !!b.listed } : {}),
    categories: core.categoriesFor(b.id),
  });

  function authenticate(req) {
    const h = req.headers.authorization || '';
    const m = h.match(/^Bearer (.+)$/);
    let token = m ? m[1] : null;
    if (!token && req.url) {
      try {
        const u = new URL(req.url, 'http://localhost');
        token = u.searchParams.get('token');
      } catch {}
    }
    if (!token) return null;
    const p = verifyJwt(token, config.jwtSecret);
    if (!p) return null;
    if (p.kind === 'customer') {
      const c = get('SELECT * FROM customers WHERE id = ?', p.sub);
      return c ? { id: c.id, role: 'customer', bid: c.business_id, name: c.name, email: c.email, account: !!c.password_hash } : null;
    }
    const u = get('SELECT * FROM users WHERE id = ? AND active = 1', p.sub);
    return u ? { id: u.id, role: u.role, bid: u.business_id, name: u.name, email: u.email } : null;
  }

  const staffToken = (u) => signJwt({ sub: u.id, kind: 'staff' }, config.jwtSecret, 12 * 3600);
  const customerToken = (c) => signJwt({ sub: c.id, kind: 'customer' }, config.jwtSecret, 7 * 24 * 3600);
  const viewerOut = (v) => ({ id: v.id, role: v.role, name: v.name, email: v.email, ...(v.role === 'customer' ? { account: !!v.account } : {}) });
  const customerUser = (c) => ({ id: c.id, role: 'customer', name: c.name, email: c.email, account: !!c.password_hash });

  function readBody(req, limit = 16 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > limit) {
          reject(new HttpError(413, 'Request body too large'));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try {
          const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve(v && typeof v === 'object' ? v : {});
        } catch {
          reject(new HttpError(400, 'Invalid JSON'));
        }
      });
      req.on('error', reject);
    });
  }

  // ---------- routes ----------
  const routes = [];
  const route = (method, pattern, opts, handler) => {
    const keys = [];
    const re = new RegExp(
      '^' + pattern.replace(/:([a-z_]+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$'
    );
    routes.push({ method, re, keys, opts, handler });
  };
  const STAFF = ['owner', 'agent'];
  const OWNER = ['owner'];
  const CUSTOMER = ['customer'];
  const PUBLIC = null;

  // --- public ---
  route('GET', '/api/health', PUBLIC, () => ({ ok: true, bot: config.openrouterKey ? 'openrouter' : 'faq-only' }));
  route('GET', '/api/niches', PUBLIC, () => ({ niches: listNiches(), bot_names: BOT_NAME_SUGGESTIONS }));
  // Browse: every kind of business with how many listed desks it has, then the desks of one kind.
  route('GET', '/api/directory', PUBLIC, ({ req }) => {
    rateLimit(req, 'search', config.rateLimit * 4);
    const counts = Object.fromEntries(all('SELECT niche, COUNT(*) AS n FROM businesses WHERE listed = 1 GROUP BY niche').map((r) => [r.niche, r.n]));
    return { niches: Object.entries(NICHES).map(([key, n]) => ({ key, label: n.label, description: n.description, count: counts[key] || 0 })) };
  });
  // Customers find a business by typing its name, or browse by kind of business. Desks the owner
  // has unlisted never appear here; they are reachable only through their own link.
  route('GET', '/api/businesses', PUBLIC, ({ query, req }) => {
    rateLimit(req, 'search', config.rateLimit * 4);
    // Forgiving match: ignores case, accents and apostrophes, and every word typed must appear
    // somewhere in the name, link or kind of business ("ola help" finds "Ọlá's Help Desk").
    const fold = (s) =>
      String(s || '')
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/['’`]/g, '')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
    if (query.niche !== undefined) {
      if (!NICHES[query.niche]) throw new HttpError(400, 'Unknown kind of business');
      const limit = 20;
      const offset = Math.max(0, Math.floor(Number(query.offset)) || 0);
      const rows = all('SELECT slug, name, niche, demo FROM businesses WHERE niche = ? AND listed = 1 ORDER BY name COLLATE NOCASE LIMIT ? OFFSET ?', query.niche, limit + 1, offset);
      return {
        businesses: rows.slice(0, limit).map((b) => ({ ...b, demo: !!b.demo, niche_label: NICHES[b.niche]?.label || 'General' })),
        has_more: rows.length > limit,
      };
    }
    const words = fold(query.q).split(' ').filter(Boolean);
    if (String(query.q || '').trim().length < 2 || !words.length) return { businesses: [] };
    const nameHas = (b) => words.every((w) => b.nameFold.includes(w));
    const rows = all('SELECT slug, name, niche, demo FROM businesses WHERE listed = 1')
      .map((b) => {
        const label = NICHES[b.niche]?.label || 'General';
        return { slug: b.slug, name: b.name, niche: b.niche, demo: !!b.demo, niche_label: label, nameFold: fold(b.name), hay: fold(`${b.name} ${b.slug} ${label}`) };
      })
      .filter((b) => words.every((w) => b.hay.includes(w)))
      .sort((a, b) => Number(!nameHas(a)) - Number(!nameHas(b)) || a.name.localeCompare(b.name))
      .slice(0, 8);
    return { businesses: rows.map(({ nameFold, hay, ...b }) => b) };
  });
  route('GET', '/api/b/:slug', PUBLIC, ({ params }) => {
    const b = core.getBusinessBySlug(params.slug);
    if (!b) throw new HttpError(404, 'Business not found');
    return { business: publicBusiness(b) };
  });

  // --- customers: guest, optional account, or back in with a ticket code ---
  const emailOf = (v) => {
    const e = str(v, { max: 200, field: 'Email' }).toLowerCase();
    if (!e) throw new HttpError(400, 'Email is required');
    if (!isEmail(e)) throw new HttpError(400, 'That email address does not look right');
    return e;
  };
  const newCustomer = (businessId, name, email, passwordHash = null) => {
    const r = run(
      'INSERT INTO customers (business_id, name, email, password_hash, created_at) VALUES (?,?,?,?,?)',
      businessId, name, email, passwordHash, core.now()
    );
    return get('SELECT * FROM customers WHERE id = ?', Number(r.lastInsertRowid));
  };
  const customerSession = (c, b, extra = {}) => ({ token: customerToken(c), user: customerUser(c), business: publicBusiness(b), ...extra });
  const businessOr404 = (slug) => {
    const b = core.getBusinessBySlug(slug);
    if (!b) throw new HttpError(404, 'Business not found');
    return b;
  };

  // Guest: name and email, no password. A guest always gets a fresh record, so typing
  // someone else's email address never exposes that person's tickets.
  route('POST', '/api/b/:slug/enter', PUBLIC, ({ params, body, req }) => {
    rateLimit(req, 'enter');
    const b = businessOr404(params.slug);
    return customerSession(newCustomer(b.id, str(body.name, { min: 1, max: 80, field: 'Name' }), emailOf(body.email)), b);
  });

  route('POST', '/api/b/:slug/customer/register', PUBLIC, async ({ params, body, req }) => {
    rateLimit(req, 'register');
    const b = businessOr404(params.slug);
    const name = str(body.name, { min: 1, max: 80, field: 'Name' });
    const email = emailOf(body.email);
    const password = String(body.password || '');
    if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
    if (get('SELECT 1 AS x FROM customers WHERE business_id = ? AND lower(email) = ? AND password_hash IS NOT NULL', b.id, email)) {
      throw new HttpError(409, 'An account with that email already exists. Sign in instead.');
    }
    const passHash = await hashPassword(password);
    return customerSession(newCustomer(b.id, name, email, passHash), b);
  });

  route('POST', '/api/b/:slug/customer/login', PUBLIC, async ({ params, body, req }) => {
    rateLimit(req, 'login');
    const b = businessOr404(params.slug);
    const email = String(body.email || '').trim().toLowerCase();
    const c = get('SELECT * FROM customers WHERE business_id = ? AND lower(email) = ? AND password_hash IS NOT NULL', b.id, email);
    if (!c || !(await verifyPassword(String(body.password || ''), c.password_hash))) throw new HttpError(401, 'Incorrect email or password');
    return customerSession(c, b);
  });

  // A guest who is already in can add a password to keep their tickets together
  route('POST', '/api/account/set-password', CUSTOMER, async ({ viewer, body }) => {
    const password = String(body.password || '');
    if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
    if (viewer.account) throw new HttpError(409, 'You already have an account');
    if (!viewer.email) throw new HttpError(400, 'Add an email address first');
    if (get('SELECT 1 AS x FROM customers WHERE business_id = ? AND lower(email) = lower(?) AND password_hash IS NOT NULL', viewer.bid, viewer.email)) {
      throw new HttpError(409, 'An account with this email already exists. Sign in to it instead.');
    }
    const passHash = await hashPassword(password);
    run('UPDATE customers SET password_hash = ? WHERE id = ?', passHash, viewer.id);
    return { ok: true };
  });

  // Back in with the ticket code and the email address used on the ticket
  route('POST', '/api/b/:slug/lookup', PUBLIC, ({ params, body, req }) => {
    rateLimit(req, 'lookup');
    const b = businessOr404(params.slug);
    const t = core.ticketByCode(String(body.code || '').trim());
    const email = String(body.email || '').trim().toLowerCase();
    if (!t || t.business_id !== b.id || !email || String(t.customer_email || '').toLowerCase() !== email) {
      throw new HttpError(404, 'We could not find a ticket with that code and email');
    }
    const c = get('SELECT * FROM customers WHERE id = ?', t.customer_id);
    if (c.password_hash) throw new HttpError(403, 'That ticket belongs to an account. Sign in with your email and password to see it.');
    return customerSession(c, b, { ticket_id: t.id });
  });

  route('POST', '/api/auth/register-business', PUBLIC, async ({ body, req }) => {
    rateLimit(req, 'register');
    const name = str(body.business_name, { min: 2, max: 80, field: 'Business name' });
    const ownerName = str(body.owner_name, { min: 1, max: 80, field: 'Your name' });
    const email = str(body.email, { min: 3, max: 200, field: 'Email' }).toLowerCase();
    if (!isEmail(email)) throw new HttpError(400, 'That email address does not look right');
    const password = String(body.password || '');
    if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
    const niche = NICHES[body.niche] ? body.niche : 'general';
    const passwordHash = await hashPassword(password);
    const { business, owner } = core.createBusiness({ name, niche, ownerName, email, passwordHash });
    return { token: staffToken(owner), user: { id: owner.id, role: 'owner', name: owner.name, email }, business: publicBusiness(business, true) };
  });

  route('POST', '/api/auth/login', PUBLIC, async ({ body, req }) => {
    rateLimit(req, 'login');
    const email = String(body.email || '').trim().toLowerCase();
    const u = get('SELECT * FROM users WHERE lower(email) = ? AND active = 1', email);
    if (!u || !(await verifyPassword(String(body.password || ''), u.password_hash))) throw new HttpError(401, 'Incorrect email or password');
    return { token: staffToken(u), user: { id: u.id, role: u.role, name: u.name, email: u.email }, business: publicBusiness(core.getBusiness(u.business_id), true) };
  });

  route('GET', '/api/me', ['owner', 'agent', 'customer'], ({ viewer }) => ({
    user: viewerOut(viewer),
    business: publicBusiness(core.getBusiness(viewer.bid), viewer.role !== 'customer'),
  }));

  // --- inbound email → ticket (webhook; works with SendGrid/Postmark-style payloads once mapped) ---
  route('POST', '/api/inbound/email', PUBLIC, ({ body, query, req }) => {
    rateLimit(req, 'inbound');
    const given = String(req.headers['x-webhook-secret'] || query.secret || '');
    const a = Buffer.from(given);
    const b = Buffer.from(config.inboundSecret);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new HttpError(401, 'Invalid webhook secret');

    let biz = body.business ? core.getBusinessBySlug(body.business) : null;
    if (!biz && body.to) {
      const m = String(body.to).toLowerCase().match(/([a-z0-9._+-]+)@/);
      if (m) {
        const local = m[1];
        biz = core.getBusinessBySlug(local.includes('+') ? local.split('+').pop() : local);
      }
    }
    if (!biz) throw new HttpError(404, 'No business matches this address');
    const from = String(body.from || '').toLowerCase().match(/[^\s<>"]+@[^\s<>"]+/)?.[0];
    if (!from || !isEmail(from)) throw new HttpError(400, 'Missing or invalid "from" address');
    const fromName = String(body.from_name || from.split('@')[0]).trim().slice(0, 80) || from;
    const subject = String(body.subject || '(no subject)').trim().slice(0, 200) || '(no subject)';
    // Drop quoted replies
    const text = String(body.text || '')
      .split(/\r?\n/)
      .reduce(
        (acc, line) => {
          if (acc.stop || /^On .+ wrote:\s*$/i.test(line) || /^-{2,}\s*Original Message/i.test(line)) acc.stop = true;
          else if (!line.startsWith('>')) acc.lines.push(line);
          return acc;
        },
        { lines: [], stop: false }
      )
      .lines.join('\n')
      .trim()
      .slice(0, 6000);
    if (!text) throw new HttpError(400, 'Email has no body text');

    let c = get('SELECT * FROM customers WHERE business_id = ? AND lower(email) = ?', biz.id, from);
    if (!c) {
      const r = run('INSERT INTO customers (business_id, name, email, created_at) VALUES (?,?,?,?)', biz.id, fromName, from, core.now());
      c = get('SELECT * FROM customers WHERE id = ?', Number(r.lastInsertRowid));
    }
    const codeMatch = subject.match(/\[(T-[A-Z0-9]{6})\]/i);
    const existing = codeMatch ? core.ticketByCode(codeMatch[1]) : null;
    if (existing && existing.business_id === biz.id && existing.customer_id === c.id) {
      const r = core.addMessage({ id: c.id, role: 'customer', bid: biz.id, name: c.name }, existing, text);
      if (r.triggerBot) bot.trigger(existing.id);
      return { status: 201, data: { ticket_code: existing.code, created: false } };
    }
    const t = core.createTicket({ biz, customer: c, category_id: null, subject, description: text, source: 'email' });
    if (t.handler === 'bot') bot.trigger(t.id);
    return { status: 201, data: { ticket_code: t.code, created: true } };
  });

  // Owner-only test button: sends a pretend email through exactly the same path as the real webhook
  route('POST', '/api/simulate-email', OWNER, ({ viewer, body, req }) => {
    const target = routes.find((r) => r.method === 'POST' && r.re.test('/api/inbound/email'));
    const fakeReq = { headers: { 'x-webhook-secret': config.inboundSecret }, socket: req.socket };
    const out = target.handler({
      req: fakeReq,
      query: {},
      body: {
        business: core.getBusiness(viewer.bid).slug,
        from: body.from,
        from_name: body.from_name,
        subject: body.subject,
        text: body.text,
      },
    });
    return out;
  });

  // --- tickets ---
  route('POST', '/api/tickets', CUSTOMER, ({ viewer, body }) => {
    const biz = core.getBusiness(viewer.bid);
    const customer = get('SELECT * FROM customers WHERE id = ?', viewer.id);
    const t = core.createTicket({
      biz,
      customer,
      category_id: body.category_id,
      subject: body.subject,
      description: body.description,
      custom: body.custom,
    });
    if (t.handler === 'bot') bot.trigger(t.id);
    return { status: 201, data: { ticket: core.serializeTicket(t, biz, viewer.role) } };
  });

  route('GET', '/api/tickets', ['owner', 'agent', 'customer'], ({ viewer, query }) => ({
    tickets: core.listTickets(viewer, query),
  }));

  route('GET', '/api/tickets/:id', ['owner', 'agent', 'customer'], ({ viewer, params }) => {
    const t = core.getTicketFor(viewer, params.id);
    const biz = core.getBusiness(t.business_id);
    return { ticket: core.serializeTicket(t, biz, viewer.role), messages: core.messagesFor(viewer, t.id) };
  });

  // Server-Sent Events stream for instant real-time message updates
  route('GET', '/api/tickets/:id/stream', ['owner', 'agent', 'customer'], ({ viewer, params, res, req }) => {
    const t = core.getTicketFor(viewer, params.id);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...SECURITY_HEADERS,
    });
    res.write(': connected\n\n');
    const tid = Number(t.id);
    if (!ticketSubscribers.has(tid)) ticketSubscribers.set(tid, new Set());
    const subs = ticketSubscribers.get(tid);
    subs.add(res);
    req.on('close', () => {
      subs.delete(res);
      if (!subs.size) ticketSubscribers.delete(tid);
    });
    return undefined;
  });

  route('POST', '/api/tickets/:id/messages', ['owner', 'agent', 'customer'], ({ viewer, params, body }) => {
    const t = core.getTicketFor(viewer, params.id);
    const internal = viewer.role !== 'customer' && !!body.internal;
    const r = core.addMessage(viewer, t, body.body, { internal });
    if (r.triggerBot) bot.trigger(t.id);
    return { status: 201, data: { id: r.id } };
  });

  // Staff can read any message in English. The result is cached on the message.
  route('POST', '/api/tickets/:id/messages/:mid/translate', STAFF, async ({ viewer, params, req }) => {
    rateLimit(req, 'translate', 60);
    const t = core.getTicketFor(viewer, params.id);
    const m = get('SELECT id FROM messages WHERE id = ? AND ticket_id = ?', Number(params.mid), t.id);
    if (!m) throw new HttpError(404, 'Message not found');
    if (!config.openrouterKey) throw new HttpError(503, 'Translation needs the AI key. Add OPENROUTER_API_KEY to your .env file and restart.');
    try {
      return { translation: await bot.translateToEnglish(m.id) };
    } catch (e) {
      console.error(`[translate] ${e.message}`);
      throw new HttpError(502, 'The translation service did not answer. Please try again.');
    }
  });

  route('POST', '/api/tickets/:id/status', STAFF, ({ viewer, params, body }) => {
    const t = core.getTicketFor(viewer, params.id);
    core.setStatus(viewer, t, String(body.status || ''));
    return { ok: true };
  });

  route('POST', '/api/tickets/:id/priority', STAFF, ({ viewer, params, body }) => {
    const t = core.getTicketFor(viewer, params.id);
    core.setPriority(t, String(body.priority || ''));
    return { ok: true };
  });

  route('POST', '/api/tickets/:id/assign', OWNER, ({ viewer, params, body }) => {
    const t = core.getTicketFor(viewer, params.id);
    core.assignTicket(viewer, t, body.user_id);
    return { ok: true };
  });

  route('POST', '/api/tickets/:id/takeover', STAFF, ({ viewer, params }) => {
    const t = core.getTicketFor(viewer, params.id);
    return { ok: true, changed: core.takeover(viewer, t) };
  });

  route('POST', '/api/tickets/:id/handback', STAFF, ({ viewer, params }) => {
    const t = core.getTicketFor(viewer, params.id);
    const changed = core.handback(viewer, t);
    if (changed) bot.trigger(t.id);
    return { ok: true, changed };
  });

  route('POST', '/api/tickets/:id/request-human', CUSTOMER, ({ viewer, params }) => {
    const t = core.getTicketFor(viewer, params.id);
    if (t.handler === 'bot') core.routeToHuman(t, 'customer_request');
    return { ok: true };
  });

  route('POST', '/api/tickets/:id/solved', CUSTOMER, ({ viewer, params }) => {
    const t = core.getTicketFor(viewer, params.id);
    if (!['resolved', 'closed'].includes(t.status)) core.customerSolved(t);
    return { ok: true };
  });

  route('GET', '/api/stats', STAFF, ({ viewer }) => ({ stats: core.stats(viewer) }));

  // --- settings ---
  route('GET', '/api/settings', OWNER, ({ viewer }) => {
    const b = core.getBusiness(viewer.bid);
    return {
      settings: {
        ...publicBusiness(b, true),
        inbound: {
          endpoint: '/api/inbound/email',
          secret: config.inboundSecret,
          address_hint: `${b.slug}@your-inbound-domain`,
        },
        ai_enabled: !!config.openrouterKey,
        ai_model: config.openrouterKey ? config.openrouterModel : null,
      },
    };
  });

  route('PATCH', '/api/settings', OWNER, ({ viewer, body }) => {
    const b = core.getBusiness(viewer.bid);
    const name = body.name !== undefined ? str(body.name, { min: 2, max: 80, field: 'Business name' }) : b.name;
    const about = body.about !== undefined ? str(body.about, { max: 4000, field: 'About' }) : b.about;
    const botName = body.bot_name !== undefined ? str(body.bot_name, { min: 1, max: 30, field: 'Bot name' }) : b.bot_name;
    const mode = body.automation_mode !== undefined ? body.automation_mode : b.automation_mode;
    if (!['human', 'bot_first'].includes(mode)) throw new HttpError(400, 'Invalid automation mode');
    const niche = body.niche !== undefined ? body.niche : b.niche;
    if (!NICHES[niche]) throw new HttpError(400, 'Unknown niche');
    const listed = body.listed !== undefined ? (body.listed ? 1 : 0) : b.listed;
    let sla = safeJson(b.sla_json, {});
    if (body.sla && typeof body.sla === 'object') {
      sla = {};
      for (const p of core.PRIORITIES) {
        const m = Number(body.sla[p]);
        if (!Number.isFinite(m) || m < 5) throw new HttpError(400, `SLA for ${p} must be at least 5 minutes`);
        sla[p] = Math.min(core.MAX_SLA_MINUTES, Math.round(m));
      }
    }
    run(
      'UPDATE businesses SET name = ?, about = ?, bot_name = ?, automation_mode = ?, niche = ?, sla_json = ?, listed = ? WHERE id = ?',
      name, about, botName, mode, niche, JSON.stringify(sla), listed, b.id
    );
    // New targets apply to tickets that are still waiting for a first human reply
    if (body.sla) {
      const nb = core.getBusiness(b.id);
      for (const t of all("SELECT id, priority, created_at FROM tickets WHERE business_id = ? AND first_human_response_at IS NULL AND status IN ('new','open','pending')", b.id)) {
        const d = core.deadlines(nb, t.priority, t.created_at);
        run('UPDATE tickets SET due_at = ?, escalate_at = ? WHERE id = ?', d.due_at, d.escalate_at, t.id);
      }
    }
    return { business: publicBusiness(core.getBusiness(b.id), true) };
  });

  route('POST', '/api/categories/apply-niche', OWNER, ({ viewer, body }) => {
    if (!NICHES[body.niche]) throw new HttpError(400, 'Unknown niche');
    const added = core.applyNiche(viewer.bid, body.niche);
    run('UPDATE businesses SET niche = ? WHERE id = ?', body.niche, viewer.bid);
    return { added, categories: core.categoriesFor(viewer.bid, true) };
  });

  route('GET', '/api/categories', STAFF, ({ viewer }) => ({ categories: core.categoriesFor(viewer.bid, true) }));

  route('POST', '/api/categories', OWNER, ({ viewer, body }) => {
    const name = str(body.name, { min: 2, max: 60, field: 'Name' });
    const sort = get('SELECT COALESCE(MAX(sort),0) + 1 AS n FROM categories WHERE business_id = ?', viewer.bid).n;
    const r = run(
      'INSERT INTO categories (business_id, name, description, fields_json, sort) VALUES (?,?,?,?,?)',
      viewer.bid, name, str(body.description, { max: 200 }), JSON.stringify(core.sanitizeFields(body.fields)), sort
    );
    return { status: 201, data: { id: Number(r.lastInsertRowid), categories: core.categoriesFor(viewer.bid, true) } };
  });

  route('PATCH', '/api/categories/:id', OWNER, ({ viewer, params, body }) => {
    const c = get('SELECT * FROM categories WHERE id = ? AND business_id = ?', Number(params.id), viewer.bid);
    if (!c) throw new HttpError(404, 'Category not found');
    run(
      'UPDATE categories SET name = ?, description = ?, fields_json = ?, active = ? WHERE id = ?',
      body.name !== undefined ? str(body.name, { min: 2, max: 60, field: 'Name' }) : c.name,
      body.description !== undefined ? str(body.description, { max: 200 }) : c.description,
      body.fields !== undefined ? JSON.stringify(core.sanitizeFields(body.fields)) : c.fields_json,
      body.active !== undefined ? (body.active ? 1 : 0) : c.active,
      c.id
    );
    return { categories: core.categoriesFor(viewer.bid, true) };
  });

  // --- team ---
  const teamList = (bid) =>
    all("SELECT id, name, email, role, active, created_at FROM users WHERE business_id = ? ORDER BY role DESC, name COLLATE NOCASE", bid).map((u) => ({
      ...u,
      active: !!u.active,
      category_ids: all('SELECT category_id FROM agent_categories WHERE user_id = ?', u.id).map((r) => r.category_id),
      open_tickets: get("SELECT COUNT(*) AS n FROM tickets WHERE assigned_to = ? AND status IN ('new','open','pending')", u.id).n,
    }));

  function setAgentCategories(userId, businessId, ids) {
    run('DELETE FROM agent_categories WHERE user_id = ?', userId);
    for (const id of [...new Set((Array.isArray(ids) ? ids : []).map(Number))]) {
      if (get('SELECT 1 AS x FROM categories WHERE id = ? AND business_id = ?', id, businessId)) {
        run('INSERT INTO agent_categories (user_id, category_id) VALUES (?,?)', userId, id);
      }
    }
  }

  route('GET', '/api/team', OWNER, ({ viewer }) => ({ team: teamList(viewer.bid) }));

  route('POST', '/api/team', OWNER, async ({ viewer, body }) => {
    const name = str(body.name, { min: 1, max: 80, field: 'Name' });
    const email = str(body.email, { min: 3, max: 200, field: 'Email' }).toLowerCase();
    if (!isEmail(email)) throw new HttpError(400, 'That email address does not look right');
    const password = String(body.password || '');
    if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
    if (get('SELECT 1 AS x FROM users WHERE lower(email) = ?', email)) throw new HttpError(409, 'An account with that email already exists');
    const passwordHash = await hashPassword(password);
    transaction(db, () => {
      const r = run(
        "INSERT INTO users (business_id, name, email, password_hash, role, created_at) VALUES (?,?,?,?, 'agent', ?)",
        viewer.bid, name, email, passwordHash, core.now()
      );
      setAgentCategories(Number(r.lastInsertRowid), viewer.bid, body.category_ids);
    });
    return { status: 201, data: { team: teamList(viewer.bid) } };
  });

  route('PATCH', '/api/team/:id', OWNER, async ({ viewer, params, body }) => {
    const u = get('SELECT * FROM users WHERE id = ? AND business_id = ?', Number(params.id), viewer.bid);
    if (!u) throw new HttpError(404, 'Team member not found');
    if (u.role === 'owner' && body.active === false) throw new HttpError(400, 'The owner account cannot be deactivated');
    let passwordHash = null;
    if (body.password) {
      if (String(body.password).length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
      passwordHash = await hashPassword(String(body.password));
    }
    transaction(db, () => {
      if (body.name !== undefined) run('UPDATE users SET name = ? WHERE id = ?', str(body.name, { min: 1, max: 80, field: 'Name' }), u.id);
      if (passwordHash) {
        run('UPDATE users SET password_hash = ? WHERE id = ?', passwordHash, u.id);
      }
      if (body.category_ids !== undefined && u.role === 'agent') setAgentCategories(u.id, viewer.bid, body.category_ids);
      if (body.active !== undefined) {
        run('UPDATE users SET active = ? WHERE id = ?', body.active ? 1 : 0, u.id);
        if (!body.active) {
          // hand their open tickets to someone else
          for (const t of all("SELECT id, category_id FROM tickets WHERE assigned_to = ? AND status IN ('new','open','pending')", u.id)) {
            run('UPDATE tickets SET assigned_to = NULL WHERE id = ?', t.id);
            const next = core.pickAgent(viewer.bid, t.category_id);
            run('UPDATE tickets SET assigned_to = ? WHERE id = ?', next, t.id);
            if (next) core.notify(next, t.id, 'assigned', 'A ticket was reassigned to you');
          }
        }
      }
    });
    return { team: teamList(viewer.bid) };
  });

  // --- knowledge base ---
  const faqList = (bid) => all('SELECT id, question, answer, created_at FROM faqs WHERE business_id = ? ORDER BY id DESC', bid);

  route('GET', '/api/faqs', STAFF, ({ viewer }) => ({ faqs: faqList(viewer.bid) }));
  route('POST', '/api/faqs', OWNER, ({ viewer, body }) => {
    run(
      'INSERT INTO faqs (business_id, question, answer, created_at) VALUES (?,?,?,?)',
      viewer.bid, str(body.question, { min: 3, max: 300, field: 'Question' }), str(body.answer, { min: 3, max: 4000, field: 'Answer' }), core.now()
    );
    return { status: 201, data: { faqs: faqList(viewer.bid) } };
  });
  route('PATCH', '/api/faqs/:id', OWNER, ({ viewer, params, body }) => {
    const f = get('SELECT * FROM faqs WHERE id = ? AND business_id = ?', Number(params.id), viewer.bid);
    if (!f) throw new HttpError(404, 'FAQ not found');
    run(
      'UPDATE faqs SET question = ?, answer = ? WHERE id = ?',
      body.question !== undefined ? str(body.question, { min: 3, max: 300, field: 'Question' }) : f.question,
      body.answer !== undefined ? str(body.answer, { min: 3, max: 4000, field: 'Answer' }) : f.answer,
      f.id
    );
    return { faqs: faqList(viewer.bid) };
  });
  route('DELETE', '/api/faqs/:id', OWNER, ({ viewer, params }) => {
    run('DELETE FROM faqs WHERE id = ? AND business_id = ?', Number(params.id), viewer.bid);
    return { faqs: faqList(viewer.bid) };
  });

  const docList = (bid) =>
    all('SELECT id, title, filename, kind, char_count, created_at FROM documents WHERE business_id = ? ORDER BY id DESC', bid);

  route('GET', '/api/documents', STAFF, ({ viewer }) => ({ documents: docList(viewer.bid) }));
  route('POST', '/api/documents', OWNER, ({ viewer, body }) => {
    const filename = String(body.filename || '').slice(0, 200);
    const title = str(body.title || filename.replace(/\.[a-z0-9]+$/i, ''), { min: 1, max: 120, field: 'Title' });
    let text = '';
    let kind = 'text';
    if (body.data_base64) {
      const buf = Buffer.from(String(body.data_base64), 'base64');
      if (!buf.length) throw new HttpError(400, 'The uploaded file is empty');
      if (buf.length > 12 * 1024 * 1024) throw new HttpError(413, 'File too large (max 12 MB)');
      if (/\.pdf$/i.test(filename) || buf.slice(0, 5).toString('latin1') === '%PDF-') {
        kind = 'pdf';
        try {
          text = extractPdfText(buf);
        } catch (e) {
          throw new HttpError(422, e.message);
        }
      } else if (/\.(txt|md|csv)$/i.test(filename)) text = buf.toString('utf8');
      else throw new HttpError(415, 'Upload a PDF, .txt or .md file — or paste the text instead.');
    } else text = String(body.text || '');
    text = text.replace(/\u0000/g, '').trim();
    if (text.length < 20) throw new HttpError(400, 'There is not enough text in this document');
    if (text.length > 400000) throw new HttpError(413, 'Document is too long (max 400,000 characters)');
    const chunks = chunkText(text);
    const id = transaction(db, () => {
      const r = run(
        'INSERT INTO documents (business_id, title, filename, kind, char_count, created_at) VALUES (?,?,?,?,?,?)',
        viewer.bid, title, filename, kind, text.length, core.now()
      );
      const docId = Number(r.lastInsertRowid);
      chunks.forEach((c, i) => run('INSERT INTO doc_chunks (document_id, business_id, idx, text) VALUES (?,?,?,?)', docId, viewer.bid, i, c));
      return docId;
    });
    return { status: 201, data: { id, chunks: chunks.length, documents: docList(viewer.bid) } };
  });
  route('DELETE', '/api/documents/:id', OWNER, ({ viewer, params }) => {
    run('DELETE FROM documents WHERE id = ? AND business_id = ?', Number(params.id), viewer.bid);
    return { documents: docList(viewer.bid) };
  });

  // --- notifications ---
  route('GET', '/api/notifications', STAFF, ({ viewer }) => ({
    items: all('SELECT id, ticket_id, type, message, read, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 40', viewer.id).map((n) => ({ ...n, read: !!n.read })),
    unread: get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0', viewer.id).n,
  }));
  route('POST', '/api/notifications/read', STAFF, ({ viewer, body }) => {
    if (Array.isArray(body.ids) && body.ids.length) {
      for (const id of body.ids.slice(0, 100)) run('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?', Number(id), viewer.id);
    } else run('UPDATE notifications SET read = 1 WHERE user_id = ?', viewer.id);
    return { ok: true };
  });

  // ---------- request handling ----------
  const PUBLIC_DIR = path.join(__dirname, 'public');
  const SECURITY_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
  };

  function sendJson(res, status, data) {
    const body = JSON.stringify(data);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
    res.end(body);
  }

  const staticCache = new Map();
  function serveStatic(req, res, pathname) {
    let rel = pathname === '/' || pathname.startsWith('/b/') ? '/index.html' : pathname;
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return sendJson(res, 403, { error: 'Forbidden' });
    fs.stat(file, (err, stats) => {
      if (err || !stats.isFile()) return sendJson(res, 404, { error: 'Not found' });
      const etag = `W/"${stats.size}-${Math.floor(stats.mtimeMs)}"`;
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, { ...SECURITY_HEADERS, ETag: etag });
        return res.end();
      }
      const cached = staticCache.get(file);
      if (cached && cached.mtimeMs === stats.mtimeMs) {
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
          'Content-Length': cached.data.length,
          'Cache-Control': 'no-cache',
          ETag: etag,
          ...SECURITY_HEADERS,
        });
        return res.end(req.method === 'HEAD' ? undefined : cached.data);
      }
      fs.readFile(file, (readErr, data) => {
        if (readErr) return sendJson(res, 404, { error: 'Not found' });
        staticCache.set(file, { mtimeMs: stats.mtimeMs, data });
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
          'Content-Length': data.length,
          'Cache-Control': 'no-cache',
          ETag: etag,
          ...SECURITY_HEADERS,
        });
        res.end(req.method === 'HEAD' ? undefined : data);
      });
    });
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    if (!pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed' });
      return serveStatic(req, res, pathname);
    }
    try {
      let matched = null;
      let pathMatched = false;
      for (const r of routes) {
        const m = r.re.exec(pathname);
        if (!m) continue;
        pathMatched = true;
        if (r.method !== req.method) continue;
        matched = { r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
        break;
      }
      if (!matched) throw new HttpError(pathMatched ? 405 : 404, pathMatched ? 'Method not allowed' : 'Not found');
      const { r, params } = matched;
      let viewer = null;
      if (r.opts) {
        viewer = authenticate(req);
        if (!viewer) throw new HttpError(401, 'Please sign in');
        if (!r.opts.includes(viewer.role)) throw new HttpError(403, 'You do not have permission to do that');
      }
      const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readBody(req);
      const query = Object.fromEntries(url.searchParams);
      const out = await r.handler({ req, res, params, query, body, viewer });
      if (res.headersSent || res.writableEnded) return;
      if (out && out.status && out.data) sendJson(res, out.status, out.data);
      else sendJson(res, 200, out ?? { ok: true });
    } catch (e) {
      if (res.headersSent || res.writableEnded) return;
      if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message });
      console.error('[server]', e);
      sendJson(res, 500, { error: 'Something went wrong on our side. Please try again.' });
    }
  }

  const server = http.createServer((req, res) => {
    handle(req, res);
  });

  let timer = null;
  function start(port = config.port) {
    return new Promise((resolve) => {
      server.listen(port, () => {
        timer = setInterval(() => {
          try {
            core.slaTick();
          } catch (e) {
            console.error('[sla]', e);
          }
        }, config.slaTickMs);
        timer.unref();
        resolve(server.address().port);
      });
    });
  }

  async function close() {
    if (timer) clearInterval(timer);
    for (const subs of ticketSubscribers.values()) {
      for (const res of subs) {
        try { res.end(); } catch {}
      }
    }
    ticketSubscribers.clear();
    await bot.idle();
    await new Promise((r) => server.close(r));
    db.close();
  }

  return { server, ctx, core, bot, config, start, close };
}

module.exports = { createApp, buildConfig, loadDotEnv };

if (require.main === module) {
  loadDotEnv(path.join(__dirname, '.env'));
  const app = createApp();
  // Made-up demo companies so the public list is never empty. Added once, on the first start.
  if (process.env.DEMO_COMPANIES !== 'off') {
    try {
      const n = require('./lib/demo')(app).ensure();
      if (n) console.log(`\n  Added ${n} demo companies (tagged "Demo"). Remove them any time with: npm run unseed:demo`);
    } catch (e) {
      console.error(`\n  Could not add the demo companies: ${e.message}`);
    }
  }
  app.start().then((port) => {
    console.log(`\n  Support Desk running → http://localhost:${port}`);
    console.log(`  AI bot: ${app.config.openrouterKey ? `OpenRouter (${app.config.openrouterModel})` : 'no OPENROUTER_API_KEY set → local knowledge matching and guided troubleshooting'}`);
    console.log(`  Email webhook: POST /api/inbound/email  (secret in the owner's Settings page)\n`);
  });
  const stop = () => app.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
