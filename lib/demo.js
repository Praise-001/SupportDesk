'use strict';
// The made-up demo companies (see demo/). Loaded automatically the first time the server starts,
// so the public list is never empty, and removable at any time.
const { hashPasswordSync } = require('./util');
const { chunkText } = require('./pdf');
const COMPANIES = require('../demo');

const PASSWORD = 'demo-pass-1234';
let passwordHash = null; // hashed once: the same demo password is used for every demo login
const ascii = (s) => String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
const TITLE = /^(dr|prof|nurse|pharmacist|hygienist|mr|mrs|ms)\.?$/i;
const agentEmail = (c, name) => `${ascii(name.split(' ').find((w) => !TITLE.test(w)) || name)}@${c.domain}`;
const ownerEmail = (c) => `owner@${c.domain}`;

module.exports = function makeDemo({ core, ctx }) {
  const db = ctx.db;
  const run = (sql, ...p) => db.prepare(sql).run(...p);
  const get = (sql, ...p) => db.prepare(sql).get(...p);
  const all = (sql, ...p) => db.prepare(sql).all(...p);

  function load(c) {
    if (get('SELECT 1 AS x FROM businesses WHERE demo = 1 AND name = ?', c.name)) return false;
    if (get('SELECT 1 AS x FROM users WHERE email = ?', ownerEmail(c))) throw new Error(`${ownerEmail(c)} is already used by another account`);
    const { business } = core.createBusiness({ name: c.name, niche: c.niche, ownerName: c.owner, email: ownerEmail(c), password: PASSWORD });
    const bid = business.id;
    run('UPDATE businesses SET about = ?, bot_name = ?, automation_mode = ?, demo = 1 WHERE id = ?', c.about, c.bot || 'Maya', c.mode || 'bot_first', bid);

    // request types from the kind's template that do not fit this company
    for (const name of c.dropCategories || []) run('DELETE FROM categories WHERE business_id = ? AND name = ?', bid, name);
    // extra categories this company needs beyond its kind's template
    for (const [name, description] of c.extraCategories || []) {
      const sort = get('SELECT COALESCE(MAX(sort),0) + 1 AS s FROM categories WHERE business_id = ?', bid).s;
      run('INSERT INTO categories (business_id, name, description, fields_json, sort) VALUES (?,?,?,?,?)', bid, name, description, '[]', sort);
    }
    const cats = Object.fromEntries(all('SELECT id, name FROM categories WHERE business_id = ?', bid).map((x) => [x.name, x.id]));
    const catId = (name) => {
      if (!cats[name]) throw new Error(`${c.name}: no category called "${name}" (have: ${Object.keys(cats).join(', ')})`);
      return cats[name];
    };

    const agents = {};
    for (const [name, specialties] of c.agents) {
      const r = run("INSERT INTO users (business_id, name, email, password_hash, role, created_at) VALUES (?,?,?,?, 'agent', ?)", bid, name, agentEmail(c, name), (passwordHash || (passwordHash = hashPasswordSync(PASSWORD))), Date.now());
      const id = Number(r.lastInsertRowid);
      agents[name] = id;
      for (const s of specialties) run('INSERT INTO agent_categories (user_id, category_id) VALUES (?,?)', id, catId(s));
    }

    let order = 0;
    for (const [q, a] of c.faqs) run('INSERT INTO faqs (business_id, question, answer, created_at) VALUES (?,?,?,?)', bid, q, a, Date.now() + order++);

    for (const [title, text] of c.docs) {
      const slug = ascii(title).replace(/\./g, '-');
      const d = run('INSERT INTO documents (business_id, title, filename, kind, char_count, created_at) VALUES (?,?,?,?,?,?)', bid, title, `${slug}.txt`, 'text', text.length, Date.now() + order++);
      chunkText(text).forEach((chunk, i) => run('INSERT INTO doc_chunks (document_id, business_id, idx, text) VALUES (?,?,?,?)', Number(d.lastInsertRowid), bid, i, chunk));
    }

    const customers = new Map();
    const customer = ([name, email]) => {
      if (!customers.has(email)) {
        const r = run('INSERT INTO customers (business_id, name, email, created_at) VALUES (?,?,?,?)', bid, name, email, Date.now());
        customers.set(email, get('SELECT * FROM customers WHERE id = ?', Number(r.lastInsertRowid)));
      }
      return customers.get(email);
    };
    const msg = (id, type, name, body, at) =>
      run('INSERT INTO messages (ticket_id, sender_type, sender_name, body, internal, created_at) VALUES (?,?,?,?,0,?)', id, type, name, body, at);

    for (const x of c.tickets) {
      const t = core.createTicket({ biz: core.getBusiness(bid), customer: customer(x.who), category_id: catId(x.cat), subject: x.subject, description: x.body, priority: x.pri, custom: x.custom || {} });
      const priority = core.ticketById(t.id).priority;
      const created = Date.now() - x.mins * 60000;
      const dl = core.deadlines(core.getBusiness(bid), priority, created);
      run('UPDATE tickets SET created_at = ?, updated_at = ?, due_at = ?, escalate_at = ? WHERE id = ?', created, created, dl.due_at, dl.escalate_at, t.id);
      run('UPDATE messages SET created_at = ? WHERE ticket_id = ?', created, t.id);
      if (x.kind === 'bot') {
        msg(t.id, 'bot', c.bot || 'Maya', x.reply, created + 25000);
      } else if (x.kind === 'agent' || x.kind === 'resolved') {
        const who = get('SELECT u.name FROM tickets t JOIN users u ON u.id = t.assigned_to WHERE t.id = ?', t.id);
        const at = created + (x.after || 14) * 60000;
        msg(t.id, 'agent', who ? who.name : c.owner, x.reply, at);
        if (x.followup) msg(t.id, 'customer', x.who[0], x.followup, at + 9 * 60000);
        run('UPDATE tickets SET first_human_response_at = ?, status = ?, handler = ?, updated_at = ? WHERE id = ?', at, x.kind === 'resolved' ? 'resolved' : 'pending', 'human', at, t.id);
      }
    }
    return true;
  }

  // one company is all or nothing, so a mistake can never leave half a desk behind
  function loadOne(c) {
    const lastId = get('SELECT COALESCE(MAX(id), 0) AS m FROM businesses').m;
    try {
      return load(c);
    } catch (e) {
      run('DELETE FROM businesses WHERE id > ? AND name = ?', lastId, c.name);
      throw e;
    }
  }

  // Adds every company that is not there yet. Returns how many were added.
  function addAll() {
    let added = 0;
    for (const c of COMPANIES) if (loadOne(c)) added++;
    run("INSERT INTO app_meta (key, value) VALUES ('demo_companies', 'added') ON CONFLICT(key) DO UPDATE SET value = 'added'");
    return added;
  }

  // Removes only the demo companies and everything under them. They do not come back on restart.
  function removeAll() {
    const n = get('SELECT COUNT(*) AS n FROM businesses WHERE demo = 1').n;
    run('DELETE FROM businesses WHERE demo = 1');
    run("INSERT INTO app_meta (key, value) VALUES ('demo_companies', 'removed') ON CONFLICT(key) DO UPDATE SET value = 'removed'");
    return n;
  }

  // On server start: add them once. If they were added or removed before, leave things as they are.
  function ensure() {
    if (get("SELECT 1 AS x FROM app_meta WHERE key = 'demo_companies'")) return 0;
    return addAll();
  }

  return { addAll, removeAll, ensure };
};

module.exports.COMPANIES = COMPANIES;
module.exports.PASSWORD = PASSWORD;
module.exports.agentEmail = agentEmail;
module.exports.ownerEmail = ownerEmail;
