# API reference

JSON over HTTP. Send `Authorization: Bearer <token>` on protected routes. Errors look like `{ "error": "message" }` with a matching status (400, 401, 403, 404, 409, 413, 422, 429).

Roles: **customer** (a name, no password, 7-day token), **agent** (sees only tickets assigned to them), **owner** (everything in their business). Staff tokens last 12 hours.

Timestamps are milliseconds since the epoch.

## Public

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/api/health` | | `{ ok, bot: "openrouter" \| "faq-only" }` |
| GET | `/api/niches` | | `{ niches[], bot_names[] }` |
| GET | `/api/businesses?q=` | | Search by name. Needs at least 2 characters, returns at most 8 and nothing for an empty query (there is no full list). `{ businesses: [{ slug, name, niche, niche_label }] }` |
| GET | `/api/b/:slug` | | `{ business }` (name, about, bot_name, automation_mode, categories with fields). Reply targets are staff-only. |
| POST | `/api/b/:slug/enter` | `{ name, email }` | `{ token, user, business }` guest entry. Always creates a fresh guest record. |
| POST | `/api/b/:slug/customer/register` | `{ name, email, password(8+) }` | `{ token, user, business }` optional account. 409 if that email already has an account. |
| POST | `/api/b/:slug/customer/login` | `{ email, password }` | `{ token, user, business }` |
| POST | `/api/b/:slug/lookup` | `{ code, email }` | `{ token, user, business, ticket_id }` guest returns with a ticket code and the email on it. 403 if the ticket belongs to an account. |
| POST | `/api/auth/register-business` | `{ business_name, owner_name, email, password(8+), niche }` | `{ token, user, business }` |
| POST | `/api/auth/login` | `{ email, password }` | `{ token, user, business }` |
| POST | `/api/inbound/email` | `{ to \| business, from, from_name?, subject, text }` + header `x-webhook-secret` | `201 { ticket_code, created }` |

## Any signed-in user

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/me` | `{ user, business }` |
| GET | `/api/tickets` | Query: `status` (`active` default, `new`, `open`, `pending`, `resolved`, `closed`, `all`), `priority`, `category`, `q`, `sort` (`sla` default or `recent`), owner only: `assigned` (`me`, `unassigned`, or a user id). Customers get their own tickets, agents their assigned ones. |
| GET | `/api/tickets/:id` | `{ ticket, messages }`. Customers never receive internal notes. |
| GET | `/api/tickets/:id/stream` | Server-Sent Events (SSE) stream for real-time ticket messages and status updates (`event: message`, `event: ticket`). Supports `?token=` query param. |
| POST | `/api/tickets/:id/messages` | `{ body, internal? }`. `internal` is staff only. A staff reply stops the SLA clock and sets the handler to a person. A customer reply reopens a resolved ticket; a closed ticket returns 409. |

### Ticket object

Customers receive a reduced object: no `priority`, `assigned_to`, `assignee_name`, `due_at`, `escalate_at`, `first_human_response_at`, `escalated_at`, `sla` or `source`. The full object below is for staff.

```
id, code ("T-ABC123"), subject, description, status, priority, handler ("bot"|"human"), bot_name,
source ("web"|"email"), category_id, category_name, customer { id, name, email },
assigned_to, assignee_name, custom {}, created_at, updated_at, due_at, escalate_at,
first_human_response_at, escalated_at, resolved_at, last_body,
sla: { state: "ok"|"warning"|"overdue"|"met"|"closed", responded_in_ms?, within_target? }
```

### Message object

`{ id, sender_type: "customer"|"agent"|"owner"|"bot"|"system", sender_name, body, internal, created_at }`

## Customer

| Method | Path | Body |
| --- | --- | --- |
| POST | `/api/tickets` | `{ category_id, subject, description, custom? }` returns `201 { ticket }`. Required category fields are enforced. There is no priority field: it is worked out from the category and wording and staff can change it. |
| POST | `/api/account/set-password` | `{ password(8+) }` a signed-in guest adds a password to become an account. 409 if the email already has one. |
| POST | `/api/tickets/:id/request-human` | hands a bot-handled ticket to a person |
| POST | `/api/tickets/:id/solved` | marks it resolved |

## Staff (owner or agent)

| Method | Path | Body |
| --- | --- | --- |
| POST | `/api/tickets/:id/status` | `{ status }`. Allowed moves: new→open/pending/resolved/closed, open→pending/resolved/closed, pending→open/resolved/closed, resolved→open/closed, closed→open. Otherwise 409. |
| POST | `/api/tickets/:id/priority` | `{ priority }` recalculates deadlines |
| POST | `/api/tickets/:id/takeover` | person joins; the assistant stops |
| POST | `/api/tickets/:id/handback` | return to the assistant (only when automation is on) |
| GET | `/api/stats` | `{ stats: { new, open, pending, resolved, overdue, unassigned, avg_first_response_min } }` |
| GET | `/api/categories` | including hidden ones |
| GET | `/api/faqs`, `/api/documents` | read-only for agents |
| GET | `/api/notifications` | `{ items[], unread }` |
| POST | `/api/notifications/read` | `{ ids? }` (all when omitted) |

## Owner only

| Method | Path | Body |
| --- | --- | --- |
| POST | `/api/tickets/:id/assign` | `{ user_id \| null }` |
| POST | `/api/simulate-email` | `{ from, from_name?, subject, text }` sends a pretend email through the real webhook code. Returns `201 { ticket_code, created }`. |
| GET / PATCH | `/api/settings` | PATCH: `{ name?, about?, bot_name?, automation_mode: "bot_first"\|"human", niche?, sla?: { urgent, high, normal, low } }`. SLA minutes are 5–120. GET also returns the email webhook secret and whether AI is on. |
| POST | `/api/categories` | `{ name, description?, fields?: [{ label, type: "text"\|"number", required }] }` |
| PATCH | `/api/categories/:id` | `{ name?, description?, fields?, active? }` |
| POST | `/api/categories/apply-niche` | `{ niche }` adds missing categories from a template |
| GET / POST | `/api/team` | POST: `{ name, email, password(8+), category_ids }` creates an agent |
| PATCH | `/api/team/:id` | `{ name?, password?, category_ids?, active? }`. Deactivating reassigns open tickets. |
| POST / PATCH / DELETE | `/api/faqs`, `/api/faqs/:id` | `{ question, answer }` |
| POST | `/api/documents` | `{ title?, filename?, data_base64 }` (PDF, .txt, .md up to 12 MB) or `{ title, text }` |
| DELETE | `/api/documents/:id` | |

## Behaviour worth knowing

- **Assignment:** topic match, then fewest open tickets, then generalist agents, then any agent.
- **SLA:** `due_at` is creation time plus the urgency target (max 120 minutes). `escalate_at` is 75% of that. A scheduler runs every 30 seconds.
- **Bot:** after a customer message on a bot-handled ticket, the assistant replies in the background. Poll `GET /api/tickets/:id` to see the reply. If a person takes over first, the pending reply is dropped.

`GET /api/businesses?q=` — accent-, case- and apostrophe-tolerant; all words must match name, slug or niche label; max 8 results; empty for queries under 2 characters.

`GET /api/directory` — every kind of business with `count` of listed desks.
`GET /api/businesses?niche=<key>&offset=<n>` — listed desks of one kind, 20 per page, with `has_more`. `PATCH /api/settings` accepts `listed` (boolean); unlisted desks are excluded from search, browse and counts but `GET /api/b/:slug` still works.

`POST /api/tickets/:id/messages/:mid/translate` (owner, agent) — returns `{ translation }`, the English version of one message. Cached on the message, and staff messages from `GET /api/tickets/:id` then include `translation`. Returns 503 when no `OPENROUTER_API_KEY` is set. Customers get 403.
Public business objects now include `demo` (true for demo companies).

No server change for recent tickets: the list is kept in the browser (`localStorage` key `sd_recent_tickets`) and opened through the existing `POST /api/b/:slug/lookup` (code + email).
