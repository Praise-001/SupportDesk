# Support Desk

A support ticketing system for many businesses on one install. Customers send requests, an automated assistant answers instantly when it can, and a person always replies within two hours. Owners can step into any conversation without the customer noticing a break.

It has **no npm dependencies**: Node's built-in `node:http`, `node:sqlite`, `crypto` and `fetch` are all it uses.

## Run it

You need **Node 22.13 or newer**.

```bash
cp .env.example .env        # optional: add your OpenRouter key
npm run seed                # optional: demo business with agents, FAQs and tickets
npm start                   # http://localhost:3000
# or run with Docker: docker compose up -d
# or in development with hot reload: npm run dev
```

Demo logins (after `npm run seed`), all with password `demo-pass-1234`:

| Role  | Email                       | Handles                              |
| ----- | --------------------------- | ------------------------------------ |
| Owner | owner@northfield.example    | everything                           |
| Agent | kemi@northfield.example     | admissions, registration, exams      |
| Agent | tomas@northfield.example    | fees, accommodation                  |
| Agent | priya@northfield.example    | IT, library, other                   |

Customers use `http://localhost:3000/b/northfield-campus-help` (guest with a name and email, no password). Change these passwords before using the seed anywhere real.

Run the tests with `npm test` (102 end-to-end checks against a real server, using a mock OpenRouter).

## What it does

**Two doors.** The first screen asks whether you need help (customer) or run a desk (owner or agent). Customers never see anything about creating a desk. Owners sign in or create a desk and pick a niche.

**Customers, three ways in.**
- *Guest:* a name and an email, no password. The ticket code is shown after sending.
- *Optional account:* create one at the start, or press "Save my requests" later, to see every request in one list and sign in with email and password.
- *Ticket code:* a guest comes back with the code plus the email on the ticket. (Tickets that belong to an account need the account password instead.)

Customers find a business by typing its name into a search box or by using its link. There is no public list of every business. Customers only ever see their conversation and whether it is Open, Resolved or Closed: no deadlines, no urgency, no assignments.

**Many businesses, one install.** Each business has its own owner, agents, categories, FAQs, documents and tickets. Customers reach a desk through its link (`/b/<slug>`) or by picking it from a list.

**Niche templates.** General, academic/campus, tech/SaaS, social/entertainment, online store, health, finance, food/hospitality, travel and legal. A template sets starting categories and extra form fields (for example a student ID or an order number). Owners can edit, hide or add anything, and apply another template later without losing what they have.

**Routing.** A new request goes to an agent who handles that category. If several do, to the one with the fewest open requests. If none do, to a generalist, then to any agent. If the business has no agents, it stays unassigned and the owner is alerted.

**The two-hour rule.** Customers do not choose urgency. The system works it out quietly from the category and the wording ("charged twice" or "deadline" means high, "fraud" or "hacked" means urgent, feature requests are low) and staff can change it on any request. Each urgency has a reply target (default urgent 30m, high 60m, normal 90m, low 120m) and **no target can exceed 120 minutes**. A request that still has no reply from a person:

1. at 75% of its target (1h 30m for a 120 minute target) moves from the assistant to an agent, who is alerted along with the owners
2. at the target is flagged overdue and alerted again

The first reply from a person, or resolving the ticket, stops the clock. Owners can change the targets in Setup (capped at 120).

**Assistant ("Maya").** Each business can name its assistant. It answers from the owner's FAQs, "about" text and uploaded documents via OpenRouter, and every message is labelled "Automated reply". It hands over to a person when it is unsure, when the customer asks for one (including "Talk to a person"), or when the SLA runs out. Without an API key it answers only when an FAQ clearly matches the newest message.

**Takeover.** An owner or the assigned agent presses "Take over". A line like "Prof. Obi joined the conversation" appears in the thread, the assistant stops, and the customer carries on in the same conversation. "Hand back" returns it to the assistant. If someone takes over while the assistant is mid-answer, the assistant's answer is discarded.

**Knowledge base.** FAQs plus uploaded PDF, `.txt` or `.md` documents (or pasted text), split into chunks and searched by keyword relevance.

**Other.** Internal notes the customer can never see, a status workflow (new, open, waiting on customer, resolved, closed), alerts for staff, email-to-ticket, an agent inbox that shows only each agent's own tickets, and live SLA badges.

## Email to ticket

`POST /api/inbound/email` with the header `x-webhook-secret` (the secret is in Setup) and JSON:

```json
{ "to": "northfield-campus-help@yourdomain.com", "from": "student@example.com", "from_name": "Student", "subject": "Fees", "text": "Hello…" }
```

The business comes from the `to` address (`<slug>@` or `support+<slug>@`) or a `business` field. A subject containing `[T-ABC123]` adds the message to that ticket. Quoted reply text is stripped. Try it:

```bash
curl -X POST localhost:3000/api/inbound/email \
  -H "content-type: application/json" -H "x-webhook-secret: <secret from Setup>" \
  -d '{"business":"northfield-campus-help","from":"sam@example.com","subject":"Fee refund","text":"Please refund my fee."}'
```

**No email service yet?** Owners get a "Simulate incoming email" button in Setup. It sends a pretend email through exactly the same code as the real webhook, so you can watch routing, priority and the assistant work, then open the ticket with one click.

This is an entry point, not a mail server. An email provider that can post JSON works directly; one that posts multipart (SendGrid Inbound Parse, for example) needs a small relay that converts the email to this JSON.

## Settings (`.env`)

See `.env.example`. The important ones are `OPENROUTER_API_KEY` and `OPENROUTER_MODEL`. Secrets for tokens and the email webhook are generated on first run and stored in `data/`.

## Files

```
server.js        HTTP server, routes, auth, static files
lib/core.js      tickets, assignment, SLA maths, notifications
lib/bot.js       retrieval over FAQs and documents, OpenRouter call, takeover-safe replies
lib/niches.js    niche templates
lib/pdf.js       PDF text extraction and chunking
lib/db.js        SQLite schema
public/          index.html, styles.css, app.js (no framework, no build step)
seed.js          one demo business (Northfield Campus Help)
seed-demo.js     loads or removes the 32 demo companies from demo/
demo/            the demo company content, one file per kind of service
test/smoke.js    end-to-end tests
API.md           endpoint reference
```

## Things to know

- **Not tried against live OpenRouter.** It was built and tested against a mock of the OpenRouter chat API. Add your key and send a test ticket to confirm the model you choose behaves as expected.
- **Sign-in lives in browser memory**, so reloading the page signs you out. Guests get back into a conversation with their ticket code and email; account holders sign in.
- **Updates are real-time**: open conversations stream instantly via Server-Sent Events (SSE) with an automatic 4-second polling fallback.
- **Dark mode** is supported automatically based on browser/system preference.
- **PDF reading** uses `pdftotext` (from poppler) when installed and a basic built-in reader otherwise. Scanned, image-only PDFs have no text to read; paste the text instead.
- **Assistant knowledge is keyword search**, not embeddings. It works well for a few dozen FAQs and short documents.
- **Before real use**: serve it over HTTPS behind a reverse proxy, back up `data/`, and note that rate limiting is in memory and per process. The ticket code plus email is the key to a guest's conversation.
- Agents do not see unassigned tickets; the owner assigns those.

**Finding a desk:** customer search ignores case, accents and apostrophes, and every word typed must match the name, link or kind of business ("ola help" finds "Ọlá's Help Desk"). Nothing is listed until 2+ characters are typed. Signing out wipes everything from that visit in the tab.

**Browsing:** "I need help" shows a search bar on top and every kind of service below it (with how many companies are registered under each). Tapping a kind lists its companies, 20 at a time with "Show more". Owners can switch "Show my desk in the public list" off in Setup; an unlisted desk is hidden from search, browsing and counts, and is reachable only through its customer link.

## Demo companies

32 made-up companies come with the site and are added **automatically the first time the server starts**, so the "I need help" screen is full from the first minute. There are at least two for every kind of service (general, academic, tech, social, online store, health, finance, food, travel, legal), in cities around the world. Each one has an about text, 8-9 FAQs, 3 policy documents the assistant can read, an owner, 2-3 agents with specialties, and 4 sample tickets (waiting for a first reply, answered by the assistant, answered by a person, resolved). A few tickets are written in Spanish, French, Portuguese, German, Turkish and Indonesian so you can try the translation link.

- They show a **Demo** tag in the public list and a note on their welcome page.
- Your own desks are never touched, and a restart never adds them twice.
- The first start takes a few seconds longer while they are created.
- `npm run unseed:demo` removes only the demo companies and everything under them. They do **not** come back on the next start. `npm run seed:demo` adds them again.
- To start without them from the beginning, put `DEMO_COMPANIES=off` in `.env` before the first start.
- Owner and agent logins are in `DEMO_LOGINS.md` (password for all: `demo-pass-1234`). Change or remove them before using the system for real.
- The sample tickets are dated from the moment they are created, so their timers drift as time passes.

## Other languages

The assistant answers in the language the customer writes in (it needs `OPENROUTER_API_KEY`). Because the knowledge base is written in English, it first translates the customer's message to English to find the right FAQ or document, then replies in the customer's language.

Staff (owner and agents) see a small **Translate to English** link under any message that looks like it is not in English, including the assistant's replies. The translation is saved on the message, so each message is translated only once, and customers never see the link. Without an API key, the link explains that translation needs the key, and the assistant only answers when an English FAQ clearly matches. Language detection is a quick word-based guess, so a very short or unusual message may not show the link.

## Returning customers

After signing out, "I need help" always shows the full landing screen again: the search bar, the kinds of service and the companies under each, so a customer can pick any company. Nothing from the earlier choice is kept in the address bar.

"Open recent tickets?" lists every ticket the customer has opened on this device, newest first. Choosing one opens that company with the ticket code and email already filled in, so only one button press is needed (for a ticket that belongs to an account, the email is filled in and the password is asked for). The list lives in the browser's own storage on that device only, and is never sent to the server. On a shared computer, clear the browser's site data to forget it. Inside the customer area, "Other companies" signs out and goes back to the landing screen. A company's own link (`/b/company-name`) still opens that company, with a "Choose a different company" option.
