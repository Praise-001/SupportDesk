'use strict';
const { NICHES } = require('./niches');
const { looksNonEnglish } = require('./util');

const STOP = new Set(
  'the a an and or but if then than that this these those to of in on at for from with by as is are was were be been being it its i you we they he she my your our their me us them do does did have has had can could would should will just not no yes how what when where why which who whom there here about into over under again so very please hello hi thanks thank'.split(' ')
);
const LOW_INFORMATION = new Set('app apps phone phones number numbers new device devices code codes help issue issues problem problems support using use get got want please'.split(' '));
const QUERY_SYNONYMS = [
  ['wifi', 'wireless', 'internet', 'network', 'connection'],
  ['login', 'signin', 'sign-in', 'password', 'access', 'locked'],
  ['broken', 'failure', 'failed', 'error', 'crash', 'stopped'],
  ['refund', 'reimbursement', 'return', 'moneyback'],
  ['delivery', 'shipping', 'shipment', 'package', 'parcel', 'tracking'],
  ['booking', 'reservation', 'appointment'],
  ['transfer', 'move', 'migrate', 'switch'],
  ['charge', 'charged', 'payment', 'billing', 'transaction'],
];

// Customer is asking for a person: skip the model and hand over straight away
const WANTS_PERSON =
  /\b(human|real person|live agent|live person|representative|supervisor|manager)\b|\ba (real |live )?(person|human)\b|\b(speak|talk|chat|connect|transfer|escalate|pass)\b[^.?!]{0,30}\b(person|someone|somebody|agent|staff|team|member)\b/i;
const NEEDS_PRIVATE_LOOKUP = /\b(?:what is|what's|where|status of|check|track|find|look up|confirm|change|update|cancel|refund|reverse|unlock|trace|dispute|show|send|access|tell me)\b[^.?!]{0,60}\b(?:my|mine|personal|account|order|booking|transaction|balance|transfer|application|grade|prescription|appointment|record|claim|invoice|case|package|warranty)\b/i;
// The same request in a few other languages (no \b: it does not work with accented letters)
const WANTS_PERSON_OTHER = /humain|conseiller|vraie personne|persona real|humano|agente humano|hablar con alguien|mensch|echten mitarbeiter|pessoa real|atendente|falar com (um |uma )?(pessoa|humano)|umano|operatore|человек|оператор|إنسان|موظف|मानव|इंसान/i;

function tokens(s) {
  return String(s || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => (w.length > 2 || w === 'qr') && !STOP.has(w))
    .map((w) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w));
}

module.exports = function makeBot(ctx, core) {
  const { db, config } = ctx;
  const all = (sql, ...p) => db.prepare(sql).all(...p);
  const inflight = new Map();
  const knowledgeCache = new Map();

  function invalidateKnowledge(businessId) {
    if (businessId) knowledgeCache.delete(businessId);
    else knowledgeCache.clear();
  }

  function getKnowledge(businessId) {
    const cached = knowledgeCache.get(businessId);
    const now = Date.now();
    if (cached && now - cached.ts < 30000) return cached.docs;
    const faqs = all('SELECT id, question, answer FROM faqs WHERE business_id = ?', businessId);
    const chunks = all(
      `SELECT c.id, c.text, d.title FROM doc_chunks c JOIN documents d ON d.id = c.document_id WHERE c.business_id = ?`,
      businessId
    );
    const docs = [
      ...faqs.map((f) => ({ kind: 'faq', ref: f, toks: tokens(`${f.question} ${f.question} ${f.answer}`) })),
      ...chunks.map((c) => ({ kind: 'chunk', ref: c, toks: tokens(`${c.title} ${c.text}`) })),
    ];
    knowledgeCache.set(businessId, { ts: now, docs });
    return docs;
  }

  // Rank the business's FAQs and document chunks against the customer's text
  function retrieve(businessId, text) {
    const q = [...new Set(tokens(text))];
    const meaningful = q.filter((t) => !LOW_INFORMATION.has(t));
    const weightedQuery = new Map(q.map((t) => [t, 1]));
    for (const family of QUERY_SYNONYMS) {
      if (family.some((term) => q.includes(term))) {
        for (const term of family) if (!q.includes(term)) weightedQuery.set(term, 0.3);
      }
    }
    const docs = getKnowledge(businessId);
    if (!docs.length || !q.length) return { faqs: [], chunks: [] };
    const df = new Map();
    for (const d of docs) for (const t of new Set(d.toks)) df.set(t, (df.get(t) || 0) + 1);
    const N = docs.length;
    for (const d of docs) {
      const tf = new Map();
      for (const t of d.toks) tf.set(t, (tf.get(t) || 0) + 1);
      let score = 0;
      for (const [t, weight] of weightedQuery) {
        const f = tf.get(t);
        if (f) score += weight * (1 + Math.log(f)) * Math.log(1 + N / (1 + (df.get(t) || 0)));
      }
      d.score = score;
      d.topicMatches = meaningful.filter((t) => d.toks.includes(t)).length;
    }
    const top = (kind, n) =>
      docs.filter((d) => d.kind === kind && d.score > 0 && d.topicMatches > 0)
        .sort((a, b) => b.score - a.score).slice(0, n);
    return { faqs: top('faq', 4), chunks: top('chunk', 4) };
  }

  function buildKnowledge(biz, hits) {
    const parts = [];
    if (biz.about && biz.about.trim()) parts.push(`ABOUT THE BUSINESS:\n${biz.about.trim().slice(0, 2000)}`);
    if (hits.faqs.length) {
      parts.push('FAQ:\n' + hits.faqs.map((h) => `Q: ${h.ref.question}\nA: ${h.ref.answer}`).join('\n\n'));
    }
    if (hits.chunks.length) {
      parts.push('DOCUMENT EXCERPTS:\n' + hits.chunks.map((h) => `[${h.ref.title}]\n${h.ref.text.slice(0, 1000)}`).join('\n\n'));
    }
    return parts.join('\n\n') || '(no knowledge has been added yet)';
  }

  async function callModel(messages) {
    const res = await fetch(`${config.openrouterBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.openrouterKey}`,
        'HTTP-Referer': config.publicUrl,
        'X-Title': 'Support Desk',
      },
      body: JSON.stringify({ model: config.openrouterModel, messages, temperature: 0.2, max_tokens: 700 }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('Empty model response');
    return content;
  }

  // English version of a message, cached on the message row. Needs the AI key.
  async function translateToEnglish(messageId) {
    const row = db.prepare('SELECT id, body, translation_en FROM messages WHERE id = ?').get(messageId);
    if (!row) return null;
    if (row.translation_en) return row.translation_en;
    const text = await callModel([
      { role: 'system', content: 'You are a translator. Translate the user message into natural English. Keep names, numbers, amounts and reference codes exactly as written. Reply with ONLY the translation: no quotes, notes or explanations. If it is already English, repeat it unchanged.' },
      { role: 'user', content: row.body },
    ]);
    const out = text.trim().replace(/^["“]|["”]$/g, '').slice(0, 4000);
    db.prepare('UPDATE messages SET translation_en = ? WHERE id = ?').run(out, row.id);
    return out;
  }

  function parseModelJson(text) {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        const o = JSON.parse(m[0]);
        if (typeof o.answer === 'string') return { answer: o.answer.trim(), needs_human: !!o.needs_human };
      } catch {
        /* fall through */
      }
    }
    return { answer: text.trim(), needs_human: false };
  }

  function answerFromKnowledge(t, biz, query, convo) {
    const hits = retrieve(biz.id, query);
    const recent = convo.filter((m) => m.sender_type === 'customer').slice(-3).map((m) => m.body).join('\n');
    const previousBotReplies = convo.filter((m) => m.sender_type === 'bot').map((m) => m.body);
    if (NEEDS_PRIVATE_LOOKUP.test(recent)) {
      return { answer: 'This needs a secure check of your specific account or request. Please share only its reference in this ticket; do not send a password, PIN, one-time code or full payment-card details. I’m connecting you with the team.', needs_human: true };
    }
    const faq = hits.faqs.find((h) => h.score >= 2.2 && !previousBotReplies.some((a) => a.includes(h.ref.answer)));
    const chunk = hits.chunks.find((h) => h.score >= 2.0 && !previousBotReplies.some((a) => a.includes(h.ref.text.slice(0, 120))));
    const best = [faq && { ...faq, kind: 'faq' }, chunk && { ...chunk, kind: 'chunk' }]
      .filter(Boolean).sort((a, b) => b.score - a.score)[0];
    if (best?.kind === 'faq') {
      return {
        answer: best.ref.answer,
        needs_human: false,
      };
    }
    if (best?.kind === 'chunk') {
      return {
        answer: best.ref.text,
        needs_human: false,
      };
    }
    if (previousBotReplies.length >= 2) {
      return { answer: 'I’m sorry this is still happening after those steps. I’m connecting you with a team member and will include what we have already tried.', needs_human: true };
    }
    return {
      answer: '',
      needs_human: true,
      reason: 'bot_unsure',
    };
  }

  async function generate(t, biz, convo) {
    const customerMsgs = convo.filter((m) => m.sender_type === 'customer');
    const lastCustomer = customerMsgs[customerMsgs.length - 1];
    const recent = customerMsgs.slice(-3).map((m) => m.body).join('\n');

    if (!config.openrouterKey) {
      // Without a model key, use grounded FAQ/document matches and ask a focused
      // diagnostic question before escalating an unresolved issue.
      const query = customerMsgs.length === 1 ? `${t.subject}\n${lastCustomer.body}` : lastCustomer.body;
      return answerFromKnowledge(t, biz, query, convo);
    }

    // The knowledge base is written in English: for another language, search with an English version
    let searchText = `${t.subject}\n${recent}`;
    if (looksNonEnglish(lastCustomer.body)) {
      try {
        searchText = `${t.subject}\n${(await translateToEnglish(lastCustomer.id)) || lastCustomer.body}`;
      } catch (e) {
        console.error(`[bot] ${t.code}: translation failed: ${e.message}`);
      }
    }
    const hits = retrieve(biz.id, searchText);

    const niche = NICHES[biz.niche]?.label || 'general';
    const system =
      `You are ${biz.bot_name}, the automated support assistant for "${biz.name}" (${niche}). ` +
      `Answer the customer's actual question directly and naturally. Use relevant KNOWLEDGE excerpts for this company's policies, prices, schedules, service guarantees, and customer-specific facts; never invent those. For general questions and common how-to help, including another app or device, use general knowledge when confident, but do not present it as a company policy. If current, personal, or product-specific facts are needed and aren't provided, ask for the minimum safe detail. ` +
      `Match the reply to the exact issue, product and actions named. Ignore any FAQ or excerpt about a different topic; do not force unrelated policy into the answer. Do not make the customer repeat details already provided or ask broad diagnostic questions when a direct answer is possible. ` +
      `Briefly acknowledge the specific issue, then answer it. For troubleshooting, give a short numbered set of relevant steps, explain what to expect, and offer a different next option if the first route fails. Ask one focused follow-up only when a missing detail changes the answer. Avoid generic filler, canned closings and unrelated information. ` +
      `Do NOT hand off only because a question is new, the customer is frustrated, the answer is uncertain, or an emergency is mentioned. If knowledge is insufficient, be honest, ask for a safe clarifying detail and keep helping. For emergencies, first tell the customer to contact local emergency services or the appropriate urgent professional; never let this ticket delay care. ` +
      `Set "needs_human" to true only when the request needs staff access to private account/order/booking/case/health records or private product configuration/telemetry, an authorised account action or professional decision, immediate staff containment of a security incident, the customer asks for a person, or two reasonable guided attempts on the same issue have already failed. Ask for safe product details such as model, app version or exact error first when the customer can provide them. Before handoff, guide the customer through a first solution and then a different safe option. When handing off, summarize what the customer has tried and never ask them to post passwords, PINs, one-time codes, API secrets, full card/account numbers or sensitive documents. ` +
      `Be warm, brief and specific. Write "answer" in the same language as the customer's latest message (the knowledge is in English, so translate it faithfully and keep numbers, names and amounts exact). Do not claim to be a human if asked. ` +
      `Respond with ONLY a JSON object: {"answer": "<message to the customer>", "needs_human": <true|false>}. ` +
      `If needs_human is true, "answer" should be a short, kind note saying a team member will take over and briefly state what has already been tried when known.\n\n` +
      `KNOWLEDGE:\n${buildKnowledge(biz, hits)}`;
    const transcript = convo
      .filter((m) => m.sender_type !== 'system')
      .slice(-10)
      .map((m) => `${m.sender_type === 'customer' ? 'Customer' : m.sender_type === 'bot' ? biz.bot_name : 'Team'}: ${m.body}`)
      .join('\n');
    const user = `Ticket: ${t.subject}\nCategory: ${t.category_name || 'n/a'}\n\nConversation so far:\n${transcript}\n\nWrite the next reply to the customer.`;
    try {
      const text = await callModel([
        { role: 'system', content: system },
        { role: 'user', content: user },
      ]);
      return parseModelJson(text);
    } catch (e) {
      console.error(`[bot] ${t.code}: model unavailable, using local knowledge: ${e.message}`);
      return answerFromKnowledge(t, biz, searchText, convo);
    }
  }

  async function respond(ticketId) {
    let t = core.ticketById(ticketId);
    if (!t || t.handler !== 'bot') return;
    const biz = core.getBusiness(t.business_id);
    if (biz.automation_mode !== 'bot_first' || ['closed'].includes(t.status)) return;
    const convo = all('SELECT * FROM messages WHERE ticket_id = ? AND internal = 0 ORDER BY id', t.id);
    const last = convo[convo.length - 1];
    if (!last || last.sender_type !== 'customer') return; // already answered

    let out;
    if (WANTS_PERSON.test(last.body) || WANTS_PERSON_OTHER.test(last.body)) {
      out = { answer: '', needs_human: true, reason: 'customer_request' };
    } else {
      if (config.botDelayMs > 0) await new Promise((r) => setTimeout(r, config.botDelayMs));
      try {
        out = await generate(t, biz, convo);
      } catch (e) {
        console.error(`[bot] ${t.code}: ${e.message}`);
        out = { answer: '', needs_human: true };
      }
    }

    // The thread may have changed while the model was thinking (e.g. a person took over)
    t = core.ticketById(ticketId);
    if (!t || t.handler !== 'bot') return;
    const newest = db.prepare('SELECT id FROM messages WHERE ticket_id = ? AND internal = 0 ORDER BY id DESC LIMIT 1').get(t.id);
    if (newest.id !== last.id) return;

    if (out.answer) {
      core.insertMessage(t.id, { sender_type: 'bot', sender_name: biz.bot_name, body: out.answer });
    }
    if (out.needs_human) core.routeToHuman(t, out.reason || 'bot_unsure');
  }

  function trigger(ticketId) {
    try {
      db.prepare("INSERT INTO bot_jobs (ticket_id, status, attempts, created_at, run_at) VALUES (?, 'pending', 0, ?, ?)")
        .run(ticketId, Date.now(), Date.now());
    } catch {}
    if (inflight.has(ticketId)) {
      // run again after the current pass finishes so a quick follow-up message is not missed
      inflight.get(ticketId).again = true;
      return;
    }
    const entry = { again: false };
    entry.promise = (async () => {
      try {
        await respond(ticketId);
        try {
          db.prepare("UPDATE bot_jobs SET status = 'completed' WHERE ticket_id = ? AND status IN ('pending','processing')")
            .run(ticketId);
        } catch {}
      } catch (e) {
        console.error('[bot] unexpected', e);
        try {
          db.prepare("UPDATE bot_jobs SET status = 'failed', error = ? WHERE ticket_id = ? AND status IN ('pending','processing')")
            .run(String(e.message), ticketId);
        } catch {}
      } finally {
        inflight.delete(ticketId);
        if (entry.again) trigger(ticketId);
      }
    })();
    inflight.set(ticketId, entry);
  }

  // Resume any uncompleted bot jobs from previous run
  try {
    const pendingJobs = all("SELECT DISTINCT ticket_id FROM bot_jobs WHERE status IN ('pending','processing')");
    for (const job of pendingJobs) {
      trigger(job.ticket_id);
    }
  } catch {}

  async function idle() {
    while (inflight.size) await Promise.all([...inflight.values()].map((e) => e.promise));
  }

  return { retrieve, respond, trigger, idle, translateToEnglish, invalidateKnowledge };
};
