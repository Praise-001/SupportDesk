'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { promisify } = require('node:util');
const scryptAsync = promisify(crypto.scrypt);

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const N = 16384;
  const r = 8;
  const p = 1;
  const ln = Math.log2(N);
  const h = await scryptAsync(String(pw), salt, 64, { N, r, p, maxmem: 32 * 1024 * 1024 });
  return `$scrypt$ln=${ln},r=${r},p=${p}$${salt.toString('hex')}$${h.toString('hex')}`;
}

async function verifyPassword(pw, stored) {
  const s = String(stored || '');
  if (!s) return false;
  if (s.startsWith('$scrypt$')) {
    const parts = s.split('$');
    if (parts.length !== 5) return false;
    const params = Object.fromEntries(parts[2].split(',').map((x) => x.split('=')));
    const N = 1 << Number(params.ln || 14);
    const r = Number(params.r || 8);
    const p = Number(params.p || 1);
    const salt = Buffer.from(parts[3], 'hex');
    const expected = Buffer.from(parts[4], 'hex');
    const calc = await scryptAsync(String(pw), salt, expected.length, { N, r, p, maxmem: 64 * 1024 * 1024 });
    return expected.length === calc.length && crypto.timingSafeEqual(expected, calc);
  }
  const [sHex, hHex] = s.split(':');
  if (!sHex || !hHex) return false;
  const salt = Buffer.from(sHex, 'hex');
  const expected = Buffer.from(hHex, 'hex');
  const calc = await scryptAsync(String(pw), salt, expected.length);
  return expected.length === calc.length && crypto.timingSafeEqual(expected, calc);
}

function hashPasswordSync(pw) {
  const salt = crypto.randomBytes(16);
  const N = 16384;
  const r = 8;
  const p = 1;
  const ln = Math.log2(N);
  const h = crypto.scryptSync(String(pw), salt, 64, { N, r, p, maxmem: 32 * 1024 * 1024 });
  return `$scrypt$ln=${ln},r=${r},p=${p}$${salt.toString('hex')}$${h.toString('hex')}`;
}

function verifyPasswordSync(pw, stored) {
  const s = String(stored || '');
  if (!s) return false;
  if (s.startsWith('$scrypt$')) {
    const parts = s.split('$');
    if (parts.length !== 5) return false;
    const params = Object.fromEntries(parts[2].split(',').map((x) => x.split('=')));
    const N = 1 << Number(params.ln || 14);
    const r = Number(params.r || 8);
    const p = Number(params.p || 1);
    const salt = Buffer.from(parts[3], 'hex');
    const expected = Buffer.from(parts[4], 'hex');
    const calc = crypto.scryptSync(String(pw), salt, expected.length, { N, r, p, maxmem: 64 * 1024 * 1024 });
    return expected.length === calc.length && crypto.timingSafeEqual(expected, calc);
  }
  const [sHex, hHex] = s.split(':');
  if (!sHex || !hHex) return false;
  const salt = Buffer.from(sHex, 'hex');
  const expected = Buffer.from(hHex, 'hex');
  const calc = crypto.scryptSync(String(pw), salt, expected.length);
  return expected.length === calc.length && crypto.timingSafeEqual(expected, calc);
}

function signJwt(payload, secret, ttlSec = 12 * 3600) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(
    JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec })
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyJwt(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const expected = crypto.createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest();
  let given;
  try {
    given = Buffer.from(parts[2], 'base64url');
  } catch {
    return null;
  }
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randomCode(len = 6) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

function slugify(s) {
  return (
    String(s || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'business'
  );
}

// Load a secret from env, or create one once and keep it in the data folder
function loadOrCreateSecret(dir, name, envValue) {
  if (envValue) return envValue;
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  try {
    const v = fs.readFileSync(file, 'utf8').trim();
    if (v) return v;
  } catch {
    /* create below */
  }
  const v = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, v, { mode: 0o600 });
  return v;
}

function isEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 200;
}

function str(v, { min = 0, max = 1000, field = 'value' } = {}) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < min) throw new HttpError(400, `${field} is required${min > 1 ? ` (min ${min} characters)` : ''}`);
  if (s.length > max) throw new HttpError(400, `${field} is too long (max ${max} characters)`);
  return s;
}

function safeJson(s, fallback) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

// Quick guess at whether a message is not English. Used to decide when to offer a translation
// and when the assistant should translate before searching the (English) knowledge base.
const EN_WORDS = new Set('the and you your for with this that have not are was can could please hello thanks thank would what when where how why which from about order account payment refund need help been will does just they them there their into still after before because'.split(' '));
const FOREIGN_WORDS = new Set(('el la los las una por para con que pero como donde cuando está estoy tengo quiero necesito mi su gracias hola buenas ' +
  'le les des une pour dans avec je suis mon ma mes votre vous nous pas est cette bonjour merci ' +
  'não você uma meu minha estou preciso obrigado olá por favor para com ' +
  'ich nicht und der die das ist mit für ein eine mein ich habe wie bitte danke hallo ' +
  'sono che per non come dove grazie ciao buongiorno mio ' +
  'saya pesanan belum tidak yang dengan untuk tolong terima kasih halo selamat bisa sudah ' +
  'habari nimeshindwa tafadhali asante sijapokea pesa yangu sijapata ' +
  'merhaba siparişim henüz için lütfen teşekkürler benim değil ' +
  'ik mijn niet een het voor bedankt alstublieft hallo').split(' '));
function looksNonEnglish(text) {
  const s = String(text || '').trim();
  if (s.length < 4) return false;
  const letters = s.match(/\p{L}/gu) || [];
  if (!letters.length) return false;
  const nonLatin = letters.filter((c) => !/\p{Script=Latin}/u.test(c)).length;
  if (nonLatin / letters.length > 0.3) return true;
  const words = s.toLowerCase().match(/\p{L}+/gu) || [];
  let en = 0;
  let foreign = 0;
  for (const w of words) {
    if (EN_WORDS.has(w)) en++;
    else if (FOREIGN_WORDS.has(w)) foreign++;
  }
  const accents = (s.match(/[áàâãäçéèêëíìîïñóòôõöúùûüßœ¿¡]/gi) || []).length;
  if (foreign >= 2 && foreign > en) return true;
  if (foreign >= 1 && accents >= 1 && en === 0) return true;
  return false;
}

module.exports = {
  looksNonEnglish,
  HttpError,
  hashPassword,
  verifyPassword,
  hashPasswordSync,
  verifyPasswordSync,
  signJwt,
  verifyJwt,
  randomCode,
  slugify,
  loadOrCreateSecret,
  isEmail,
  str,
  safeJson,
};
