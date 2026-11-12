'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS businesses (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  niche TEXT NOT NULL DEFAULT 'general',
  about TEXT NOT NULL DEFAULT '',
  bot_name TEXT NOT NULL DEFAULT 'Maya',
  automation_mode TEXT NOT NULL DEFAULT 'bot_first',   -- 'human' | 'bot_first'
  sla_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','agent')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  fields_json TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS agent_categories (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, category_id)
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','open','pending','resolved','closed')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  handler TEXT NOT NULL DEFAULT 'human' CHECK (handler IN ('bot','human')),
  source TEXT NOT NULL DEFAULT 'web',
  custom_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  due_at INTEGER NOT NULL,
  escalate_at INTEGER NOT NULL,
  first_human_response_at INTEGER,
  escalated_at INTEGER,
  overdue_notified INTEGER NOT NULL DEFAULT 0,
  resolved_at INTEGER
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('customer','agent','owner','bot','system')),
  sender_id INTEGER,
  sender_name TEXT NOT NULL,
  body TEXT NOT NULL,
  internal INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS faqs (
  id INTEGER PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  filename TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'text',
  char_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS doc_chunks (
  id INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  business_id INTEGER NOT NULL,
  idx INTEGER NOT NULL,
  text TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tickets_biz_status ON tickets(business_id, status);
CREATE INDEX IF NOT EXISTS idx_tickets_assignee ON tickets(assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_tickets_customer ON tickets(customer_id);
CREATE INDEX IF NOT EXISTS idx_tickets_sla ON tickets(first_human_response_at, status, escalate_at, due_at);
CREATE INDEX IF NOT EXISTS idx_messages_ticket ON messages(ticket_id, id);
CREATE INDEX IF NOT EXISTS idx_chunks_biz ON doc_chunks(business_id);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read, id);
`;

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  // migration: optional customer accounts (a guest row has no password)
  const cols = db.prepare('PRAGMA table_info(customers)').all();
  if (!cols.some((c) => c.name === 'password_hash')) db.exec('ALTER TABLE customers ADD COLUMN password_hash TEXT');
  // migration: demo companies (made-up data) can be told apart and removed again
  if (!db.prepare('PRAGMA table_info(businesses)').all().some((c) => c.name === 'demo')) db.exec('ALTER TABLE businesses ADD COLUMN demo INTEGER NOT NULL DEFAULT 0');
  // migration: cached English translation of a message (filled on demand)
  if (!db.prepare('PRAGMA table_info(messages)').all().some((c) => c.name === 'translation_en')) db.exec('ALTER TABLE messages ADD COLUMN translation_en TEXT');
  // migration: owners can keep a desk out of the public list (still reachable by its link)
  if (!db.prepare('PRAGMA table_info(businesses)').all().some((c) => c.name === 'listed')) db.exec('ALTER TABLE businesses ADD COLUMN listed INTEGER NOT NULL DEFAULT 1');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_account ON customers(business_id, lower(email)) WHERE password_hash IS NOT NULL');
  return db;
}

// Run fn inside a transaction (node:sqlite has no helper for this)
function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  }
}

module.exports = { openDb, transaction };
