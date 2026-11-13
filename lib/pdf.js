'use strict';
// PDF → text. Prefers the `pdftotext` tool (poppler) when installed; otherwise a basic built-in
// extractor that handles common text-based PDFs. Scanned/image-only PDFs are not supported.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFileSync, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);

async function viaPdftotextAsync(buf) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pdf-'));
  const file = path.join(dir, 'in.pdf');
  try {
    await fs.promises.writeFile(file, buf);
    const { stdout } = await execFileAsync('pdftotext', ['-enc', 'UTF-8', file, '-'], {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 30000,
    });
    return stdout;
  } finally {
    try { await fs.promises.rm(dir, { recursive: true, force: true }); } catch {}
  }
}

function viaPdftotext(buf) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-'));
  const file = path.join(dir, 'in.pdf');
  try {
    fs.writeFileSync(file, buf);
    const out = execFileSync('pdftotext', ['-enc', 'UTF-8', file, '-'], {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 30000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.toString('utf8');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function unescapePdfString(s) {
  return s
    .replace(/\\([nrtbf])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' })[c])
    .replace(/\\([0-7]{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)))
    .replace(/\\([()\\])/g, '$1')
    .replace(/\\\r?\n/g, '');
}

function viaBuiltin(buf) {
  const raw = buf.toString('latin1');
  const out = [];
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m;
  while ((m = re.exec(raw))) {
    let content;
    const bytes = Buffer.from(m[1], 'latin1');
    try {
      content = zlib.inflateSync(bytes).toString('latin1');
    } catch {
      content = m[1];
    }
    if (!/\b(Tj|TJ)\b/.test(content)) continue;
    // text-showing operators: (text) Tj   and   [(a) -20 (b)] TJ
    const ops = content.match(/\[(?:[^\]\\]|\\.)*\]\s*TJ|\((?:[^()\\]|\\.)*\)\s*Tj|T\*|ET/g) || [];
    let line = '';
    for (const op of ops) {
      if (op === 'T*' || op === 'ET') {
        if (line.trim()) out.push(line);
        line = '';
      } else if (op.endsWith('Tj')) {
        line += unescapePdfString(op.slice(1, op.lastIndexOf(')')));
      } else {
        const parts = op.match(/\((?:[^()\\]|\\.)*\)|-?\d+(?:\.\d+)?/g) || [];
        for (const p of parts) {
          if (p.startsWith('(')) line += unescapePdfString(p.slice(1, -1));
          else if (Number(p) < -200) line += ' ';
        }
      }
    }
    if (line.trim()) out.push(line);
  }
  return out.join('\n');
}

async function extractPdfTextAsync(buf) {
  if (!Buffer.isBuffer(buf) || buf.slice(0, 5).toString('latin1') !== '%PDF-') {
    throw new Error('That file does not look like a PDF.');
  }
  let text = '';
  try {
    text = await viaPdftotextAsync(buf);
  } catch {
    text = '';
  }
  if (text.trim().length < 20) {
    try {
      text = viaBuiltin(buf);
    } catch {
      text = '';
    }
  }
  text = text.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length < 20) {
    throw new Error(
      'No readable text found in this PDF. Scanned or image-only PDFs are not supported — paste the text instead.'
    );
  }
  return text;
}

function extractPdfText(buf) {
  if (!Buffer.isBuffer(buf) || buf.slice(0, 5).toString('latin1') !== '%PDF-') {
    throw new Error('That file does not look like a PDF.');
  }
  let text = '';
  try {
    text = viaPdftotext(buf);
  } catch {
    text = '';
  }
  if (text.trim().length < 20) {
    try {
      text = viaBuiltin(buf);
    } catch {
      text = '';
    }
  }
  text = text.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length < 20) {
    throw new Error(
      'No readable text found in this PDF. Scanned or image-only PDFs are not supported — paste the text instead.'
    );
  }
  return text;
}

// Split text into ~900 character chunks on paragraph boundaries
function chunkText(text, target = 900) {
  const paras = String(text)
    .replace(/\r/g, '')
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const chunks = [];
  let cur = '';
  const push = () => {
    if (cur.trim()) chunks.push(cur.trim());
    cur = '';
  };
  for (const p of paras) {
    if (p.length > target * 1.5) {
      push();
      for (let i = 0; i < p.length; i += target) chunks.push(p.slice(i, i + target));
      continue;
    }
    if (cur && cur.length + p.length + 1 > target) push();
    cur += (cur ? '\n' : '') + p;
  }
  push();
  return chunks;
}

module.exports = { extractPdfText, extractPdfTextAsync, chunkText };
