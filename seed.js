'use strict';
// Creates a demo business with agents, FAQs, a policy document and a spread of tickets
// (including ones close to or past their deadline). Safe to run once on a fresh database.
//   npm run seed
const path = require('node:path');
const { createApp, loadDotEnv } = require('./server');
const { hashPasswordSync } = require('./lib/util');
const { chunkText } = require('./lib/pdf');

loadDotEnv(path.join(__dirname, '.env'));
const app = createApp();
const { core, ctx } = app;
const db = ctx.db;
const run = (sql, ...p) => db.prepare(sql).run(...p);
const get = (sql, ...p) => db.prepare(sql).get(...p);

if (core.getBusinessBySlug('northfield-campus-help')) {
  console.log('Demo data already exists (Northfield Campus Help). Nothing to do.');
  process.exit(0);
}

const PASSWORD = 'demo-pass-1234';
const { business, owner } = core.createBusiness({
  name: 'Northfield Campus Help',
  niche: 'academic',
  ownerName: 'Prof. Adaeze Obi',
  email: 'owner@northfield.example',
  password: PASSWORD,
});
const bid = business.id;
const cats = Object.fromEntries(core.categoriesFor(bid).map((c) => [c.name, c.id]));

run(
  'UPDATE businesses SET about = ?, bot_name = ? WHERE id = ?',
  'Northfield University supports 12,000 students across three campuses. The student help desk is open to current students, applicants and staff. Our vision is that no student waits more than two hours for a person to reply.',
  'Maya',
  bid
);

function addAgent(name, email, categoryNames) {
  const r = run(
    "INSERT INTO users (business_id, name, email, password_hash, role, created_at) VALUES (?,?,?,?, 'agent', ?)",
    bid, name, email, hashPasswordSync(PASSWORD), Date.now()
  );
  const id = Number(r.lastInsertRowid);
  for (const n of categoryNames) run('INSERT INTO agent_categories (user_id, category_id) VALUES (?,?)', id, cats[n]);
  return id;
}
const kemi = addAgent('Kemi Bello', 'kemi@northfield.example', ['Admissions', 'Course registration', 'Exams & grades']);
const tomas = addAgent('Tomás Rivera', 'tomas@northfield.example', ['Fees & financial aid', 'Accommodation']);
addAgent('Priya Nair', 'priya@northfield.example', ['IT & campus portal', 'Library & resources', 'Other']);

const faq = (q, a) => run('INSERT INTO faqs (business_id, question, answer, created_at) VALUES (?,?,?,?)', bid, q, a, Date.now());
faq('When does course registration open?', 'Registration opens at 9:00 on the first Monday of each semester. Final-year students register first, then third years, then everyone else.');
faq('How do I reset my campus portal password?', 'Go to the portal sign-in page and choose "Forgot password". A reset link is sent to your student email and expires after 30 minutes.');
faq('Where do I pay my tuition fees?', 'Fees are paid in the portal under Finance, then Pay now. You can pay by card or bank transfer. Transfers take up to two working days to appear.');
faq('How do I apply for a hostel room?', 'Hostel applications open on 1 June. Apply in the portal under Accommodation. Rooms are allocated by the order of application date.');

const doc = run(
  'INSERT INTO documents (business_id, title, filename, kind, char_count, created_at) VALUES (?,?,?,?,?,?)',
  bid, 'Exam and re-mark policy', 'exam-policy.txt', 'text', 0, Date.now()
);
const policy = `Exam results are released within ten working days after the last paper of the semester.

Students may request a re-mark within fourteen days of results being released. Each re-mark request costs 25 pounds, which is refunded if the mark changes.

Students who cannot sit an exam because of illness must submit a medical certificate within three working days of the exam date. The department will then arrange a deferred sitting at the next available date.

Re-mark outcomes are final. Appeals can only be made on procedural grounds and go to the Academic Standards Committee.`;
chunkText(policy).forEach((c, i) => run('INSERT INTO doc_chunks (document_id, business_id, idx, text) VALUES (?,?,?,?)', Number(doc.lastInsertRowid), bid, i, c));
run('UPDATE documents SET char_count = ? WHERE id = ?', policy.length, Number(doc.lastInsertRowid));

function customer(name, email) {
  const r = run('INSERT INTO customers (business_id, name, email, created_at) VALUES (?,?,?,?)', bid, name, email, Date.now());
  return get('SELECT * FROM customers WHERE id = ?', Number(r.lastInsertRowid));
}
function ticket(c, cat, subject, description, priority, custom, minutesAgo, mutate) {
  const t = core.createTicket({ biz: core.getBusiness(bid), customer: c, category_id: cats[cat], subject, description, priority, custom });
  const created = Date.now() - minutesAgo * 60000;
  const dl = core.deadlines(core.getBusiness(bid), priority, created);
  run('UPDATE tickets SET created_at = ?, updated_at = ?, due_at = ?, escalate_at = ? WHERE id = ?', created, created, dl.due_at, dl.escalate_at, t.id);
  run('UPDATE messages SET created_at = ? WHERE ticket_id = ?', created, t.id);
  if (mutate) mutate(t.id, created);
  return t;
}
const msg = (id, type, name, body, at) =>
  run('INSERT INTO messages (ticket_id, sender_type, sender_name, body, internal, created_at) VALUES (?,?,?,?,0,?)', id, type, name, body, at);

const amara = customer('Amara Okafor', 'amara@student.example');
const lucas = customer('Lucas Meyer', 'lucas@student.example');
const sana = customer('Sana Rahman', 'sana@student.example');
const jon = customer('Jon Whitfield', 'jon@student.example');

// Asked a question the FAQ covers; the assistant already answered
ticket(amara, 'Course registration', 'When can I register for second semester?', 'I am a third-year student. When does registration open for me?', 'normal', { student_id: 'S2210443', course_code: 'ECO301' }, 8, (id, at) => {
  msg(id, 'bot', 'Maya', 'Registration opens at 9:00 on the first Monday of the semester. Third-year students register after final-year students, so your slot is in the afternoon. Let me know if you want a person to check your timetable.', at + 20000);
});

// Nearing the deadline: Maya has not been able to fully help, nobody human has replied
ticket(lucas, 'Exams & grades', 'Result looks wrong for MTH204', 'My coursework mark was 71 but the portal shows 61. I think there is a typo. Can someone check?', 'high', { student_id: 'S2198812', course_code: 'MTH204' }, 52, (id, at) => {
  msg(id, 'bot', 'Maya', 'I can see that re-mark requests are open for fourteen days after results. A team member will look at the mark itself and reply to you.', at + 30000);
});

// Past the target: shows up as overdue
ticket(sana, 'Fees & financial aid', 'Paid fees by transfer, still shows unpaid', 'I sent my tuition by bank transfer three days ago and the portal still says unpaid. The deadline is tomorrow.', 'urgent', { student_id: 'S2230107' }, 41);

// Answered by a person, waiting on the customer
ticket(jon, 'Accommodation', 'Can I swap rooms with my flatmate?', 'We both want to swap rooms in Block C. Is that allowed?', 'low', { student_id: 'S2201199' }, 95, (id, at) => {
  run('UPDATE tickets SET first_human_response_at = ?, status = ?, handler = ? WHERE id = ?', at + 12 * 60000, 'pending', 'human', id);
  msg(id, 'agent', 'Tomás Rivera', 'Hi Jon, room swaps are fine if both of you sign the swap form at the accommodation office. Bring your student cards.', at + 12 * 60000);
});

// Came in by email, still unassigned-looking new
ticket(amara, 'IT & campus portal', 'Cannot sign in to the library portal', 'The library portal rejects my password but the campus portal works fine.', 'normal', {}, 3);

const unassigned = get("SELECT COUNT(*) AS n FROM tickets WHERE assigned_to IS NULL").n;
void kemi; void tomas; void owner; void unassigned;

console.log('\nDemo data created.\n');
console.log('  Owner  owner@northfield.example   /', PASSWORD);
console.log('  Agent  kemi@northfield.example    /', PASSWORD, '(admissions, registration, exams)');
console.log('  Agent  tomas@northfield.example   /', PASSWORD, '(fees, accommodation)');
console.log('  Agent  priya@northfield.example   /', PASSWORD, '(IT, library, other)');
console.log('\n  Customer link: /b/northfield-campus-help\n');
app.close().then(() => process.exit(0));
