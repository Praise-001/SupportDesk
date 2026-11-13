'use strict';
const crypto = require('node:crypto');
const { HttpError, randomCode, slugify, hashPassword, hashPasswordSync, safeJson, str } = require('./util');
const { NICHES } = require('./niches');
const { transaction } = require('./db');

const MAX_SLA_MINUTES = 120; // hard rule: no ticket may sit without a human response for longer than 2 hours
const ESCALATE_FRACTION = 0.75; // escalate to an agent at 75% of the target (= 1h30 for the 2h cap)
const DEFAULT_SLA = { urgent: 30, high: 60, normal: 90, low: 120 };
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const STATUSES = ['new', 'open', 'pending', 'resolved', 'closed'];
const TRANSITIONS = {
  new: ['open', 'pending', 'resolved', 'closed'],
  open: ['pending', 'resolved', 'closed'],
  pending: ['open', 'resolved', 'closed'],
  resolved: ['open', 'closed'],
  closed: ['open'],
};
const ACTIVE = ['new', 'open', 'pending'];
const DONE = ['resolved', 'closed'];

// Customers never choose urgency. It is worked out quietly from the category and the wording,
// and staff can change it at any time.
const URGENT_RE = /\b(emergency|fraud(ulent)?|stolen|hacked|unauthori[sz]ed|data breach|scam)\b/i;
const HIGH_RE = /\b(urgent(ly)?|asap|immediately|right now|deadline|locked out|charged twice|double[- ]charged|overcharged|cannot (access|log ?in|login|pay)|can'?t (access|log ?in|login|pay)|not working|broken|failed)\b/i;
const LOW_CATEGORY_RE = /feature|feedback|suggestion|idea|compliment/i;
function inferPriority(subject, description, category) {
  const text = `${subject}\n${description}`;
  if (URGENT_RE.test(text)) return 'urgent';
  if (HIGH_RE.test(text)) return 'high';
  if (category && LOW_CATEGORY_RE.test(category.name)) return 'low';
  return 'normal';
}

module.exports = function makeCore(ctx) {
  const { db } = ctx;
  const all = (sql, ...p) => db.prepare(sql).all(...p);
  const get = (sql, ...p) => db.prepare(sql).get(...p);
  const run = (sql, ...p) => db.prepare(sql).run(...p);
  const now = () => (ctx.clock ? ctx.clock() : Date.now());

  // ---------- SLA ----------
  function slaTable(biz) {
    const cfg = safeJson(biz.sla_json, {});
    const out = {};
    for (const p of PRIORITIES) {
      let m = Number(cfg[p]);
      if (!Number.isFinite(m) || m <= 0) m = DEFAULT_SLA[p];
      out[p] = Math.min(MAX_SLA_MINUTES, Math.max(5, Math.round(m)));
    }
    return out;
  }

  function deadlines(biz, priority, createdAt) {
    const minutes = slaTable(biz)[priority] ?? DEFAULT_SLA.normal;
    return {
      due_at: createdAt + minutes * 60000,
      escalate_at: createdAt + Math.round(minutes * ESCALATE_FRACTION * 60000),
    };
  }

  function slaState(t, at = now()) {
    if (t.first_human_response_at) {
      return {
        state: 'met',
        responded_in_ms: t.first_human_response_at - t.created_at,
        within_target: t.first_human_response_at <= t.due_at,
      };
    }
    if (DONE.includes(t.status)) return { state: 'closed' };
    if (at >= t.due_at) return { state: 'overdue' };
    if (at >= t.escalate_at) return { state: 'warning' };
    return { state: 'ok' };
  }

  // ---------- Businesses ----------
  const getBusiness = (id) => get('SELECT * FROM businesses WHERE id = ?', id);
  const getBusinessBySlug = (slug) => get('SELECT * FROM businesses WHERE slug = ?', String(slug || '').toLowerCase());

  function uniqueSlug(name) {
    const base = slugify(name);
    let slug = base;
    let n = 2;
    while (get('SELECT 1 AS x FROM businesses WHERE slug = ?', slug)) slug = `${base}-${n++}`;
    return slug;
  }

  function applyNiche(businessId, nicheKey) {
    const niche = NICHES[nicheKey];
    if (!niche) throw new HttpError(400, 'Unknown niche');
    const existing = new Set(all('SELECT name FROM categories WHERE business_id = ?', businessId).map((c) => c.name.toLowerCase()));
    let sort = get('SELECT COALESCE(MAX(sort),0) AS m FROM categories WHERE business_id = ?', businessId).m;
    let added = 0;
    for (const c of niche.categories) {
      if (existing.has(c.name.toLowerCase())) continue;
      run(
        'INSERT INTO categories (business_id, name, description, fields_json, sort) VALUES (?,?,?,?,?)',
        businessId, c.name, c.description, JSON.stringify(c.fields || []), ++sort
      );
      added++;
    }
    return added;
  }

  function createBusiness({ name, niche, ownerName, email, password, passwordHash }) {
    if (!NICHES[niche]) throw new HttpError(400, 'Unknown niche');
    if (get('SELECT 1 AS x FROM users WHERE email = ?', email)) {
      throw new HttpError(409, 'An account with that email already exists');
    }
    const hash = passwordHash || (password ? hashPasswordSync(password) : '');
    return transaction(db, () => {
      const t = now();
      const slug = uniqueSlug(name);
      const inboundSecret = crypto.randomBytes(32).toString('hex');
      const b = run(
        'INSERT INTO businesses (slug, name, niche, inbound_secret, created_at) VALUES (?,?,?,?,?)',
        slug, name, niche, inboundSecret, t
      );
      const businessId = Number(b.lastInsertRowid);
      const u = run(
        "INSERT INTO users (business_id, name, email, password_hash, role, created_at) VALUES (?,?,?,?, 'owner', ?)",
        businessId, ownerName, email, hash, t
      );
      applyNiche(businessId, niche);
      return { business: getBusiness(businessId), owner: get('SELECT * FROM users WHERE id = ?', Number(u.lastInsertRowid)) };
    });
  }

  // ---------- Categories ----------
  function sanitizeFields(fields) {
    if (!Array.isArray(fields)) return [];
    const seen = new Set();
    const out = [];
    for (const f of fields.slice(0, 8)) {
      const label = String(f?.label || '').trim().slice(0, 60);
      if (!label) continue;
      let key = String(f?.key || slugify(label)).replace(/[^a-z0-9_]/gi, '_').toLowerCase().slice(0, 40) || 'field';
      while (seen.has(key)) key += '_2';
      seen.add(key);
      out.push({ key, label, type: f?.type === 'number' ? 'number' : 'text', required: !!f?.required });
    }
    return out;
  }

  const categoriesFor = (businessId, includeInactive = false) =>
    all(
      `SELECT * FROM categories WHERE business_id = ? ${includeInactive ? '' : 'AND active = 1'} ORDER BY sort, id`,
      businessId
    ).map((c) => ({ id: c.id, name: c.name, description: c.description, fields: safeJson(c.fields_json, []), active: !!c.active }));

  function pickCategoryByText(businessId, text) {
    const cats = all('SELECT * FROM categories WHERE business_id = ? AND active = 1 ORDER BY sort, id', businessId);
    if (!cats.length) return null;
    const stem = (w) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w);
    const toks = (s) => new Set(String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3).map(stem));
    const hay = toks(text);
    let best = null;
    let bestScore = 0;
    for (const c of cats) {
      // words in the category name count more than words in its description
      let score = 0;
      for (const w of toks(c.name)) if (hay.has(w)) score += 3;
      for (const w of toks(c.description)) if (hay.has(w)) score += 1;
      if (score > bestScore) {
        best = c;
        bestScore = score;
      }
    }
    if (best) return best.id;
    const fallback = cats.find((c) => /^(other|general|question)/i.test(c.name)) || cats[0];
    return fallback.id;
  }

  // ---------- Assignment (topic-based, then fewest open tickets) ----------
  function pickAgent(businessId, categoryId) {
    const rows = all(
      `SELECT u.id,
         (SELECT COUNT(*) FROM tickets t WHERE t.assigned_to = u.id AND t.status IN ('new','open','pending')) AS load,
         (SELECT COUNT(*) FROM agent_categories ac WHERE ac.user_id = u.id) AS ncat,
         (SELECT COUNT(*) FROM agent_categories ac WHERE ac.user_id = u.id AND ac.category_id = ?) AS matches
       FROM users u WHERE u.business_id = ? AND u.role = 'agent' AND u.active = 1`,
      categoryId ?? -1, businessId
    );
    if (!rows.length) return null;
    const tier = (r) => (r.matches > 0 ? 0 : r.ncat === 0 ? 1 : 2); // topic match → generalist → anyone
    rows.sort((a, b) => tier(a) - tier(b) || a.load - b.load || a.id - b.id);
    return rows[0].id;
  }

  const owners = (businessId) => all("SELECT id FROM users WHERE business_id = ? AND role = 'owner' AND active = 1", businessId);

  // ---------- Notifications ----------
  function notify(userId, ticketId, type, message) {
    if (!userId) return;
    run('INSERT INTO notifications (user_id, ticket_id, type, message, created_at) VALUES (?,?,?,?,?)', userId, ticketId, type, message, now());
  }
  function notifyOwners(businessId, ticketId, type, message) {
    for (const o of owners(businessId)) notify(o.id, ticketId, type, message);
  }

  // ---------- Tickets ----------
  const TICKET_SELECT = `
    SELECT t.*, c.name AS category_name, cu.name AS customer_name, cu.email AS customer_email, u.name AS assignee_name,
           (SELECT body FROM messages m WHERE m.ticket_id = t.id AND m.internal = 0 AND m.sender_type != 'system' ORDER BY m.id DESC LIMIT 1) AS last_body
    FROM tickets t
    LEFT JOIN categories c ON c.id = t.category_id
    JOIN customers cu ON cu.id = t.customer_id
    LEFT JOIN users u ON u.id = t.assigned_to`;

  const ticketById = (id) => get(`${TICKET_SELECT} WHERE t.id = ?`, id);
  const ticketByCode = (code) => get(`${TICKET_SELECT} WHERE t.code = ?`, String(code || '').toUpperCase());

  function serializeTicket(t, biz, role) {
    const full = {
      id: t.id,
      code: t.code,
      subject: t.subject,
      description: t.description,
      status: t.status,
      priority: t.priority,
      handler: t.handler,
      bot_name: biz ? biz.bot_name : undefined,
      source: t.source,
      category_id: t.category_id,
      category_name: t.category_name,
      customer: { id: t.customer_id, name: t.customer_name, email: t.customer_email },
      assigned_to: t.assigned_to,
      assignee_name: t.assignee_name,
      custom: safeJson(t.custom_json, {}),
      created_at: t.created_at,
      updated_at: t.updated_at,
      due_at: t.due_at,
      escalate_at: t.escalate_at,
      first_human_response_at: t.first_human_response_at,
      escalated_at: t.escalated_at,
      resolved_at: t.resolved_at,
      last_body: t.last_body ? String(t.last_body).slice(0, 140) : null,
      sla: slaState(t),
    };
    if (role !== 'customer') return full;
    // Customers see their conversation and its status. No deadlines, priority or assignments.
    // eslint-disable-next-line no-unused-vars
    const { priority, assigned_to, assignee_name, due_at, escalate_at, first_human_response_at, escalated_at, sla, source, ...safe } = full;
    return safe;
  }

  function canAccess(viewer, t) {
    if (!t || t.business_id !== viewer.bid) return false;
    if (viewer.role === 'customer') return t.customer_id === viewer.id;
    if (viewer.role === 'owner') return true;
    return t.assigned_to === viewer.id || t.assigned_to === null; // agent can access assigned or unassigned
  }

  function getTicketFor(viewer, id) {
    const t = ticketById(Number(id));
    if (!canAccess(viewer, t)) throw new HttpError(404, 'Ticket not found');
    return t;
  }

  function listTickets(viewer, f = {}) {
    const where = ['t.business_id = ?'];
    const params = [viewer.bid];
    if (viewer.role === 'customer') {
      where.push('t.customer_id = ?');
      params.push(viewer.id);
    } else if (viewer.role === 'agent') {
      if (f.assigned === 'unassigned') {
        where.push('t.assigned_to IS NULL');
      } else if (f.assigned === 'all') {
        where.push('(t.assigned_to = ? OR t.assigned_to IS NULL)');
        params.push(viewer.id);
      } else {
        where.push('t.assigned_to = ?');
        params.push(viewer.id);
      }
    } else if (f.assigned === 'unassigned') where.push('t.assigned_to IS NULL');
    else if (f.assigned === 'me') {
      where.push('t.assigned_to = ?');
      params.push(viewer.id);
    } else if (/^\d+$/.test(f.assigned || '')) {
      where.push('t.assigned_to = ?');
      params.push(Number(f.assigned));
    }
    if (f.status === 'active' || !f.status) where.push("t.status IN ('new','open','pending')");
    else if (STATUSES.includes(f.status)) {
      where.push('t.status = ?');
      params.push(f.status);
    }
    if (PRIORITIES.includes(f.priority)) {
      where.push('t.priority = ?');
      params.push(f.priority);
    }
    if (/^\d+$/.test(f.category || '')) {
      where.push('t.category_id = ?');
      params.push(Number(f.category));
    }
    if (f.q) {
      const like = `%${String(f.q).replace(/[%_]/g, '')}%`;
      where.push('(t.subject LIKE ? OR t.code LIKE ? OR cu.name LIKE ? OR cu.email LIKE ?)');
      params.push(like, like, like, like);
    }
    const order =
      f.sort === 'recent'
        ? 't.updated_at DESC'
        : "(t.status IN ('resolved','closed')) ASC, CASE WHEN t.status IN ('resolved','closed') THEN -t.updated_at ELSE t.due_at END ASC";
    const rows = all(`${TICKET_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 200`, ...params);
    const biz = getBusiness(viewer.bid);
    return rows.map((r) => serializeTicket(r, biz, viewer.role));
  }

  function messagesFor(viewer, ticketId) {
    const rows =
      viewer.role === 'customer'
        ? all('SELECT * FROM messages WHERE ticket_id = ? AND internal = 0 ORDER BY id', ticketId)
        : all('SELECT * FROM messages WHERE ticket_id = ? ORDER BY id', ticketId);
    return rows.map((m) => ({
      id: m.id,
      sender_type: m.sender_type,
      sender_name: m.sender_name,
      body: m.body,
      internal: !!m.internal,
      created_at: m.created_at,
      ...(viewer.role !== 'customer' && m.translation_en ? { translation: m.translation_en } : {}),
    }));
  }

  function insertMessage(ticketId, { sender_type, sender_id = null, sender_name, body, internal = 0 }) {
    const t = now();
    const r = run(
      'INSERT INTO messages (ticket_id, sender_type, sender_id, sender_name, body, internal, created_at) VALUES (?,?,?,?,?,?,?)',
      ticketId, sender_type, sender_id, sender_name, body, internal ? 1 : 0, t
    );
    run('UPDATE tickets SET updated_at = ? WHERE id = ?', t, ticketId);
    const id = Number(r.lastInsertRowid);
    if (ctx.onEvent) {
      try {
        ctx.onEvent(ticketId, 'message', { id, sender_type, sender_name, body, internal: !!internal, created_at: t });
      } catch {}
    }
    return id;
  }

  function systemMessage(ticketId, body) {
    return insertMessage(ticketId, { sender_type: 'system', sender_name: 'System', body });
  }

  function createTicket({ biz, customer, category_id, subject, description, priority, custom, source = 'web' }) {
    subject = str(subject, { min: 3, max: 200, field: 'Subject' });
    description = str(description, { min: 5, max: 6000, field: 'Description' });
    let catId = category_id ? Number(category_id) : null;
    let category = null;
    if (catId) {
      category = get('SELECT * FROM categories WHERE id = ? AND business_id = ? AND active = 1', catId, biz.id);
      if (!category) throw new HttpError(400, 'Unknown category');
    } else {
      catId = pickCategoryByText(biz.id, `${subject} ${description}`);
      category = catId ? get('SELECT * FROM categories WHERE id = ?', catId) : null;
    }
    if (!PRIORITIES.includes(priority)) priority = inferPriority(subject, description, category);
    const fields = category ? safeJson(category.fields_json, []) : [];
    const customOut = {};
    for (const fd of fields) {
      const v = String(custom?.[fd.key] ?? '').trim().slice(0, 200);
      if (fd.required && !v && source === 'web') throw new HttpError(400, `${fd.label} is required`);
      if (v) customOut[fd.key] = v;
    }

    return transaction(db, () => {
      const createdAt = now();
      const dl = deadlines(biz, priority, createdAt);
      let code;
      do code = `T-${randomCode(6)}`;
      while (get('SELECT 1 AS x FROM tickets WHERE code = ?', code));
      const assignee = pickAgent(biz.id, catId);
      const handler = biz.automation_mode === 'bot_first' ? 'bot' : 'human';
      const r = run(
        `INSERT INTO tickets (code, business_id, customer_id, category_id, subject, description, status, priority, assigned_to, handler, source, custom_json, created_at, updated_at, due_at, escalate_at)
         VALUES (?,?,?,?,?,?, 'new', ?,?,?,?,?,?,?,?,?)`,
        code, biz.id, customer.id, catId, subject, description, priority, assignee, handler, source,
        JSON.stringify(customOut), createdAt, createdAt, dl.due_at, dl.escalate_at
      );
      const id = Number(r.lastInsertRowid);
      insertMessage(id, { sender_type: 'customer', sender_id: customer.id, sender_name: customer.name, body: description });
      if (assignee) notify(assignee, id, 'assigned', `New ${priority} ticket ${code}: ${subject}`);
      else notifyOwners(biz.id, id, 'unassigned', `No agent available for ${code}: ${subject}`);
      return ticketById(id);
    });
  }

  // Customer or staff message on a ticket
  function addMessage(viewer, t, bodyIn, { internal = false } = {}) {
    const body = str(bodyIn, { min: 1, max: 6000, field: 'Message' });
    const biz = getBusiness(t.business_id);
    if (viewer.role === 'customer') {
      if (t.status === 'closed') throw new HttpError(409, 'This ticket is closed. Please open a new ticket.');
      const id = insertMessage(t.id, { sender_type: 'customer', sender_id: viewer.id, sender_name: t.customer_name, body });
      if (['resolved', 'pending'].includes(t.status)) {
        run("UPDATE tickets SET status = 'open', resolved_at = NULL WHERE id = ?", t.id);
        if (t.status === 'resolved') systemMessage(t.id, 'Ticket reopened by the customer.');
      }
      if (t.assigned_to && t.handler === 'human') notify(t.assigned_to, t.id, 'customer_reply', `${t.customer_name} replied on ${t.code}`);
      return { id, triggerBot: t.handler === 'bot' && biz.automation_mode === 'bot_first' };
    }
    // staff
    if (internal) {
      const id = insertMessage(t.id, { sender_type: viewer.role === 'owner' ? 'owner' : 'agent', sender_id: viewer.id, sender_name: viewer.name, body, internal: 1 });
      return { id, triggerBot: false };
    }
    if (t.status === 'closed') throw new HttpError(409, 'Reopen the ticket before replying.');
    const id = insertMessage(t.id, { sender_type: viewer.role === 'owner' ? 'owner' : 'agent', sender_id: viewer.id, sender_name: viewer.name, body });
    const at = now();
    // A human reply: stops the SLA clock, switches the thread to human handling
    run(
      `UPDATE tickets SET first_human_response_at = COALESCE(first_human_response_at, ?),
         handler = 'human',
         assigned_to = COALESCE(assigned_to, ?),
         status = CASE WHEN status IN ('new','open') THEN 'pending' ELSE status END
       WHERE id = ?`,
      at, viewer.role === 'agent' ? viewer.id : null, t.id
    );
    return { id, triggerBot: false };
  }

  function setStatus(viewer, t, status) {
    if (!STATUSES.includes(status) || status === 'new') throw new HttpError(400, 'Invalid status');
    if (t.status === status) return;
    if (!TRANSITIONS[t.status].includes(status)) throw new HttpError(409, `Cannot move a ticket from ${t.status} to ${status}`);
    const at = now();
    run(
      `UPDATE tickets SET status = ?, updated_at = ?,
         resolved_at = CASE WHEN ? IN ('resolved','closed') THEN COALESCE(resolved_at, ?) ELSE NULL END
       WHERE id = ?`,
      status, at, status, at, t.id
    );
    systemMessage(t.id, `Status changed to ${status} by ${viewer.name}.`);
    if (ctx.onEvent) {
      try { ctx.onEvent(t.id, 'ticket', { status }); } catch {}
    }
  }

  function setPriority(t, priority) {
    if (!PRIORITIES.includes(priority)) throw new HttpError(400, 'Invalid priority');
    const biz = getBusiness(t.business_id);
    const dl = deadlines(biz, priority, t.created_at);
    run('UPDATE tickets SET priority = ?, due_at = ?, escalate_at = ?, overdue_notified = 0, updated_at = ? WHERE id = ?', priority, dl.due_at, dl.escalate_at, now(), t.id);
  }

  function assignTicket(actor, t, userId) {
    if (userId === null || userId === undefined || userId === '') {
      run('UPDATE tickets SET assigned_to = NULL, updated_at = ? WHERE id = ?', now(), t.id);
      return;
    }
    const u = get("SELECT * FROM users WHERE id = ? AND business_id = ? AND active = 1", Number(userId), t.business_id);
    if (!u) throw new HttpError(400, 'Unknown team member');
    run('UPDATE tickets SET assigned_to = ?, updated_at = ? WHERE id = ?', u.id, now(), t.id);
    systemMessage(t.id, `Ticket assigned to ${u.name}.`);
    if (u.id !== actor.id) notify(u.id, t.id, 'assigned', `${actor.name} assigned you ${t.code}: ${t.subject}`);
  }

  // Human steps into a bot-handled thread — no interruption of the customer's conversation
  function takeover(actor, t) {
    if (t.handler === 'human') return false;
    run(
      `UPDATE tickets SET handler = 'human', assigned_to = COALESCE(assigned_to, ?), updated_at = ? WHERE id = ?`,
      actor.role === 'agent' ? actor.id : null, now(), t.id
    );
    systemMessage(t.id, `${actor.name} joined the conversation.`);
    if (ctx.onEvent) {
      try { ctx.onEvent(t.id, 'ticket', { handler: 'human' }); } catch {}
    }
    return true;
  }

  function handback(actor, t) {
    const biz = getBusiness(t.business_id);
    if (biz.automation_mode !== 'bot_first') throw new HttpError(409, 'Automation is turned off for this business.');
    if (t.handler === 'bot') return false;
    run("UPDATE tickets SET handler = 'bot', updated_at = ? WHERE id = ?", now(), t.id);
    systemMessage(t.id, `${biz.bot_name} is assisting again.`);
    if (ctx.onEvent) {
      try { ctx.onEvent(t.id, 'ticket', { handler: 'bot' }); } catch {}
    }
    return true;
  }

  // Move a ticket from the bot to a person (customer request, bot unsure, or SLA escalation)
  function routeToHuman(t, reason) {
    const biz = getBusiness(t.business_id);
    let assignee = t.assigned_to;
    if (assignee) {
      const a = get('SELECT active FROM users WHERE id = ?', assignee);
      if (!a || !a.active) assignee = null;
    }
    if (!assignee) assignee = pickAgent(t.business_id, t.category_id);
    run("UPDATE tickets SET handler = 'human', assigned_to = ?, updated_at = ? WHERE id = ?", assignee, now(), t.id);
    const text = {
      customer_request: 'Connecting you with a team member — they will pick up from here.',
      bot_unsure: `${biz.bot_name} has passed this to the team. A team member will continue the conversation.`,
      sla: 'A team member has joined to help.',
    }[reason];
    if (text && t.handler === 'bot') systemMessage(t.id, text);
    const label = { customer_request: 'asked for a person', bot_unsure: 'needs a person (bot unsure)', sla: 'is nearing its deadline' }[reason];
    if (assignee) notify(assignee, t.id, 'handoff', `${t.code} ${label}: ${t.subject}`);
    else notifyOwners(t.business_id, t.id, 'unassigned', `${t.code} ${label} but no agent is available`);
    if (ctx.onEvent) {
      try { ctx.onEvent(t.id, 'ticket', { handler: 'human' }); } catch {}
    }
    return assignee;
  }

  function customerSolved(t) {
    const at = now();
    run("UPDATE tickets SET status = 'resolved', resolved_at = ?, updated_at = ? WHERE id = ?", at, at, t.id);
    systemMessage(t.id, 'Marked as solved by the customer.');
  }

  // ---------- SLA scheduler tick ----------
  function slaTick(at = now()) {
    let escalated = 0;
    let overdue = 0;
    const base = `SELECT * FROM tickets WHERE first_human_response_at IS NULL AND status IN ('new','open','pending')`;
    for (const t of all(`${base} AND escalated_at IS NULL AND escalate_at <= ?`, at)) {
      const assignee = routeToHuman(t, 'sla');
      run("UPDATE tickets SET escalated_at = ?, status = CASE WHEN status = 'new' THEN 'open' ELSE status END WHERE id = ?", at, t.id);
      if (assignee) notify(assignee, t.id, 'escalated', `Response due soon on ${t.code}: ${t.subject}`);
      notifyOwners(t.business_id, t.id, 'escalated', `${t.code} is nearing its response deadline`);
      escalated++;
    }
    for (const t of all(`${base} AND overdue_notified = 0 AND due_at <= ?`, at)) {
      run('UPDATE tickets SET overdue_notified = 1 WHERE id = ?', t.id);
      if (t.assigned_to) notify(t.assigned_to, t.id, 'overdue', `OVERDUE: ${t.code} has had no response — ${t.subject}`);
      notifyOwners(t.business_id, t.id, 'overdue', `OVERDUE: ${t.code} has had no response`);
      overdue++;
    }
    return { escalated, overdue };
  }

  // ---------- Dashboard numbers ----------
  function stats(viewer) {
    const scope = viewer.role === 'agent' ? 'AND assigned_to = ?' : '';
    const p = viewer.role === 'agent' ? [viewer.bid, viewer.id] : [viewer.bid];
    const at = now();
    const count = (extra, ...ep) => get(`SELECT COUNT(*) AS n FROM tickets WHERE business_id = ? ${scope} ${extra}`, ...p, ...ep).n;
    const avg = get(
      `SELECT AVG(first_human_response_at - created_at) AS a FROM tickets WHERE business_id = ? ${scope} AND first_human_response_at IS NOT NULL`,
      ...p
    ).a;
    return {
      new: count("AND status = 'new'"),
      open: count("AND status = 'open'"),
      pending: count("AND status = 'pending'"),
      resolved: count("AND status IN ('resolved','closed')"),
      overdue: count("AND status IN ('new','open','pending') AND first_human_response_at IS NULL AND due_at <= ?", at),
      unassigned: count("AND assigned_to IS NULL AND status IN ('new','open','pending')"),
      avg_first_response_min: avg ? Math.round(avg / 60000) : null,
    };
  }

  return {
    PRIORITIES, STATUSES, TRANSITIONS, MAX_SLA_MINUTES, DEFAULT_SLA, ESCALATE_FRACTION,
    now, slaTable, deadlines, slaState,
    getBusiness, getBusinessBySlug, createBusiness, applyNiche,
    sanitizeFields, categoriesFor, pickCategoryByText, pickAgent, owners,
    notify, notifyOwners,
    ticketById, ticketByCode, serializeTicket, canAccess, getTicketFor, listTickets, messagesFor,
    insertMessage, systemMessage, createTicket, addMessage, setStatus, setPriority, assignTicket,
    takeover, handback, routeToHuman, customerSolved, slaTick, stats, inferPriority,
  };
};
