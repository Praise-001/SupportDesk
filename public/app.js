/* Support Desk — vanilla JS front end (no framework, no build step).
   The sign-in token lives in memory only: reloading the page signs you out.
   Customers can pick a conversation back up with their ticket code and name. */
(() => {
  'use strict';

  const root = document.getElementById('app');
  const toastBox = document.getElementById('toasts');

  const state = {
    token: null,
    user: null,
    business: null,
    slug: (location.pathname.match(/^\/b\/([^/]+)/) || [])[1] || null,
    preview: null, // public info for the business in the URL
    prefill: null, // code + email carried over from "Open recent tickets?"
    entryStep: 'choose',
    niches: null,
    botNames: [],
    staffTab: 'inbox',
    openTicketId: null,
    filters: null,
  };
  let clockOffset = 0;
  let viewCleanups = [];
  let sessionCleanups = [];
  const onViewCleanup = (fn) => viewCleanups.push(fn);
  const onSessionCleanup = (fn) => sessionCleanups.push(fn);
  const runViewCleanups = () => viewCleanups.splice(0).forEach((f) => { try { f(); } catch { /* ignore */ } });
  const runSessionCleanups = () => sessionCleanups.splice(0).forEach((f) => { try { f(); } catch { /* ignore */ } });

  /* ---------------------------------------------------------------- helpers */
  function append(el, kids) {
    for (const k of kids.flat(Infinity)) {
      if (k === null || k === undefined || k === false) continue;
      el.append(k instanceof Node ? k : document.createTextNode(String(k)));
    }
  }
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    let deferredValue;
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'value') deferredValue = v;
        else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      }
    }
    append(el, kids);
    if (deferredValue !== undefined) el.value = deferredValue;
    return el;
  }
  const svgNS = 'http://www.w3.org/2000/svg';
  function logo(size = 26) {
    const s = document.createElementNS(svgNS, 'svg');
    s.setAttribute('viewBox', '0 0 32 32');
    s.setAttribute('width', size);
    s.setAttribute('height', size);
    s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(svgNS, 'path');
    p.setAttribute('d', 'M3 7h26v7a2.5 2.5 0 0 0 0 5v6H3v-6a2.5 2.5 0 0 0 0-5z');
    p.setAttribute('fill', '#FFC83D');
    s.append(p);
    return s;
  }
  function ticketCodeIcon(copied) {
    const s = document.createElementNS(svgNS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('width', '18');
    s.setAttribute('height', '18');
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '2');
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(svgNS, 'path');
    p.setAttribute('d', copied ? 'm5 12 4 4L19 6' : 'M8 8V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-3M5 8h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z');
    s.append(p);
    return s;
  }

  const now = () => Date.now() + clockOffset;
  function fmtDur(ms) {
    const m = Math.floor(Math.max(0, ms) / 60000);
    if (m < 1) return 'under 1m';
    const hh = Math.floor(m / 60);
    const mm = m % 60;
    return hh ? (mm ? `${hh}h ${mm}m` : `${hh}h`) : `${mm}m`;
  }
  const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  function fmtDay(ts) {
    const d = new Date(ts);
    if (d.toDateString() === new Date().toDateString()) return fmtTime(ts);
    return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${fmtTime(ts)}`;
  }
  function ago(ts) {
    const s = Math.floor((now() - ts) / 1000);
    if (s < 45) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const hr = Math.floor(m / 60);
    return hr < 24 ? `${hr}h ago` : `${Math.floor(hr / 24)}d ago`;
  }
  const PRI_LABEL = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' };
  const STATUS_LABEL = { new: 'New', open: 'Open', pending: 'Waiting on customer', resolved: 'Resolved', closed: 'Closed' };
  // Customers only ever see Open, Resolved or Closed
  const CUSTOMER_STATUS = { new: 'Open', open: 'Open', pending: 'Open', resolved: 'Resolved', closed: 'Closed' };
  const custStatusClass = (s) => (s === 'resolved' ? 'status-resolved' : s === 'closed' ? 'status-closed' : 'status-open');
  const TRANSITIONS = {
    new: ['open', 'pending', 'resolved', 'closed'],
    open: ['pending', 'resolved', 'closed'],
    pending: ['open', 'resolved', 'closed'],
    resolved: ['open', 'closed'],
    closed: ['open'],
  };

  function toast(msg, kind = '') {
    const el = h('div', { class: `toast ${kind}` }, msg);
    toastBox.append(el);
    setTimeout(() => el.remove(), kind === 'bad' ? 6500 : 3500);
  }

  class ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  }
  async function api(method, path, body) {
    let res;
    try {
      res = await fetch(path, {
        method,
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError('Could not reach the server. Check your connection and try again.', 0);
    }
    const date = res.headers.get('date');
    if (date && !Number.isNaN(Date.parse(date))) clockOffset = Date.parse(date) - Date.now();
    let data = {};
    try {
      data = await res.json();
    } catch { /* empty body */ }
    if (!res.ok) {
      if (res.status === 401 && state.token) signOut('Your session ended. Sign in again to continue.');
      throw new ApiError(data.error || `Something went wrong (${res.status}).`, res.status);
    }
    return data;
  }

  /* ----------------------------------------------------- shared components */
  const loading = (text = 'Loading…') =>
    h('div', { class: 'loading' }, h('div', { class: 'spinner', role: 'status', 'aria-label': text }), text);
  const emptyBox = (title, text, action) =>
    h('div', { class: 'empty' }, h('h3', null, title), h('p', null, text), action || null);
  const errorBox = (msg, retry) =>
    h('div', { class: 'errorbox', role: 'alert' },
      h('strong', null, 'That did not work. '), msg,
      retry ? h('div', null, h('button', { class: 'btn small', onclick: retry }, 'Try again')) : null);

  function field(label, input, hint) {
    return h('label', { class: 'field' }, h('span', { class: 'label' }, label), input, hint ? h('div', { class: 'hint' }, hint) : null);
  }

  function slaBadge(t) {
    const el = h('span', { class: 'sla' });
    el.dataset.state = t.sla.state;
    el.dataset.due = t.due_at;
    el.dataset.esc = t.escalate_at;
    if (t.sla.state === 'met') {
      el.dataset.met = t.sla.responded_in_ms;
      el.dataset.within = t.sla.within_target ? '1' : '0';
    }
    paintBadge(el);
    return el;
  }
  function paintBadge(el) {
    const d = el.dataset;
    let cls = '';
    let text = '';
    if (d.state === 'met') {
      cls = d.within === '1' ? 'ok' : 'warn';
      text = `Replied in ${fmtDur(+d.met)}`;
    } else if (d.state === 'closed') text = 'Resolved';
    else {
      const t = now();
      const due = +d.due;
      if (t >= due) { cls = 'bad'; text = `Overdue by ${fmtDur(t - due)}`; }
      else if (t >= +d.esc) { cls = 'warn'; text = `Due in ${fmtDur(due - t)}`; }
      else { cls = 'ok'; text = `${fmtDur(due - t)} left`; }
    }
    el.className = `sla ${cls}`;
    el.textContent = text;
  }
  const slaInterval = setInterval(() => document.querySelectorAll('.sla[data-state]').forEach(paintBadge), 15000);
  window.addEventListener('beforeunload', () => clearInterval(slaInterval));

  function topbar({ nav, extra, who }) {
    return h('header', { class: 'topbar' },
      h('a', { class: 'brand', href: '/', onclick: (e) => { e.preventDefault(); } }, logo(), state.business ? state.business.name : 'Support Desk'),
      nav || null,
      h('span', { class: 'right' }),
      extra || null,
      who ? h('span', { class: 'who' }, who) : null,
      h('button', { class: 'btn small quiet', onclick: () => signOut() }, 'Sign out'));
  }

  function copyLine(text) {
    return h('div', { class: 'copyline' },
      h('code', null, text),
      h('button', {
        class: 'btn small',
        type: 'button',
        onclick: async () => {
          try { await navigator.clipboard.writeText(text); toast('Copied', 'ok'); } catch { toast('Copy failed. Select the text and copy it manually.', 'bad'); }
        },
      }, 'Copy'));
  }

  async function withBusy(btn, fn) {
    const label = btn.textContent;
    btn.disabled = true;
    try { return await fn(); } finally { btn.disabled = false; btn.textContent = label; }
  }

  /* ---------------------------------------------------------------- session */
  function startSession(data) {
    state.token = data.token;
    state.user = data.user;
    state.business = data.business;
    // Deliberately NOT stored as state.slug: an owner or agent signing in must never change
    // which business the next customer in this tab is looking at.
    state.preview = null;
    state.fromPick = false;
    state.openTicketId = data.ticket_id || null;
    state.filters = null;
    state.staffTab = 'inbox';
    render();
  }
  // Tickets this customer has opened on this device, so they can come back to them without
  // finding the company again. Kept in this browser only (never sent anywhere).
  const RECENT_KEY = 'sd_recent_tickets';
  function recentTickets() {
    try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
  }
  function rememberTickets(list) {
    try {
      const b = state.business;
      const email = state.user && state.user.email;
      if (!b || !b.slug || !email || !list.length) return;
      const map = new Map(recentTickets().map((r) => [`${r.slug}/${r.code}`, r]));
      for (const t of list) map.set(`${b.slug}/${t.code}`, { slug: b.slug, biz: b.name, code: t.code, subject: t.subject, email, account: !!state.user.account, at: t.updated_at || Date.now() });
      localStorage.setItem(RECENT_KEY, JSON.stringify([...map.values()].sort((a, b2) => b2.at - a.at).slice(0, 1000)));
    } catch { /* storage may be unavailable: the list is only a convenience */ }
  }
  // Back to the screen where any company can be chosen, forgetting the one that was open
  function chooseAnotherCompany() {
    state.slug = null;
    state.preview = null;
    state.fromPick = false;
    state.prefill = null;
    try { history.pushState({ entryStep: 'pick', slug: null }, '', '/'); } catch { /* ignore */ }
    go('pick', false);
  }
  // Everything that belongs to one person's visit is wiped on sign-out, so what an owner or agent
  // did in this tab can never show up for the next person. The next customer starts from the
  // landing page, where they can search or browse for any company.
  function signOut(message) {
    runViewCleanups();
    runSessionCleanups();
    state.token = null;
    state.user = null;
    state.business = null;
    state.slug = null;
    state.preview = null;
    state.fromPick = false;
    state.prefill = null;
    try { history.replaceState(null, '', '/'); } catch { /* ignore */ }
    state.entryStep = 'choose';
    state.adminTab = 'signin';
    state.staffTab = 'inbox';
    state.openTicketId = null;
    state.filters = null;
    render();
    if (message) toast(message, 'bad');
  }

  window.addEventListener('popstate', (e) => {
    if (state.user) return;
    const slugMatch = (location.pathname.match(/^\/b\/([^/]+)/) || [])[1] || null;
    if (e.state && e.state.entryStep) {
      state.entryStep = e.state.entryStep;
      state.slug = e.state.slug !== undefined ? e.state.slug : slugMatch;
    } else {
      state.slug = slugMatch;
      state.entryStep = state.slug ? 'onboard' : 'choose';
    }
    state.preview = null;
    render();
  });

  function render() {
    runViewCleanups();
    if (!state.user) return renderEntry();
    if (state.user.role === 'customer') return renderCustomer();
    return renderStaff();
  }

  /* ------------------------------------------------------------------ entry */
  async function renderEntry() {
    runSessionCleanups();
    if (state.slug && !state.preview) {
      root.replaceChildren(loading('Opening support desk…'));
      try {
        state.preview = (await api('GET', `/api/b/${encodeURIComponent(state.slug)}`)).business;
      } catch (e) {
        if (e.status === 404) { state.slug = null; toast('That support desk does not exist. Choose one below.', 'bad'); history.replaceState(null, '', '/'); }
        else { root.replaceChildren(h('main', { class: 'page narrow', id: 'main' }, errorBox(e.message, renderEntry))); return; }
      }
    }
    const step = state.entryStep;
    const view = step === 'pick' ? entryPick() : step === 'onboard' ? entryOnboard() : step === 'admin' ? entryAdmin() : entryChoose();
    root.replaceChildren(view);
    const first = root.querySelector('input, button.ticket');
    if (first && step !== 'choose') first.focus();
  }
  const go = (step, push = true) => {
    state.entryStep = step;
    if (push) {
      try { history.pushState({ entryStep: step, slug: state.slug }, '', location.pathname); } catch {}
    }
    renderEntry();
  };

  function entryChoose() {
    const biz = state.preview;
    return h('main', { class: 'entry', id: 'main' },
      h('div', null,
        h('div', { class: 'mark' }, logo(30), biz ? biz.name : 'Support Desk'),
        h('h1', null, 'Tell us what is going on. We will get it to the right person.'),
        h('p', { class: 'lede' },
          biz
            ? `${biz.bot_name}, our automated assistant, can often answer straight away. Anything it cannot handle goes to the ${biz.name} team, and every reply shows up here.`
            : 'Send a request and follow the conversation here. An automated assistant can often answer straight away, and the business team picks up anything it cannot.')),
      h('div', { class: 'doors' },
        h('button', { class: 'ticket help', onclick: () => go(state.slug ? 'onboard' : 'pick') },
          h('span', { class: 'main' }, h('h2', null, 'I need help'), h('p', null, 'Send a request and follow the conversation here.')),
          h('span', { class: 'tab' }, 'No account needed')),
        h('button', { class: 'ticket admin', onclick: () => go('admin') },
          h('span', { class: 'main' }, h('h2', null, 'I run a support desk'), h('p', null, 'Sign in to your inbox, or set up a desk for your team.')),
          h('span', { class: 'tab' }, 'Owners and agents'))),
      biz ? h('p', { class: 'other-company' }, `Not looking for ${biz.name}? `, h('button', { class: 'link-btn', type: 'button', onclick: chooseAnotherCompany }, 'Choose a different company')) : null);
  }

  function backLink(step) {
    return h('button', { class: 'btn small quiet', type: 'button', onclick: () => go(step) }, 'Back');
  }

  function entryPick() {
    // This screen is where any company can be chosen, so nothing from an earlier choice stays selected
    if (state.slug) {
      state.slug = null; state.preview = null; state.fromPick = false;
      try { history.replaceState(null, '', '/'); } catch { /* ignore */ }
    }
    let debounce;
    let seq = 0;
    let open = null; // the kind of business being browsed, or null for the grid of kinds
    const results = h('div', { class: 'business-list', 'aria-live': 'polite' });
    const browse = h('div', { class: 'browse' });
    const choose = (b) => { state.slug = b.slug; state.preview = null; state.fromPick = true; try { history.pushState({ entryStep: 'onboard', slug: b.slug }, '', `/b/${b.slug}`); } catch {} go('onboard', false); };
    const row = (b) => h('button', { onclick: () => choose(b) }, h('span', { class: 'name' }, b.name), h('span', { class: 'tags' }, b.demo ? h('span', { class: 'tag demo' }, 'Demo') : null, h('span', { class: 'tag' }, b.niche_label)));

    async function showKinds() {
      open = null;
      browse.replaceChildren(loading('Loading…'));
      try {
        const d = await api('GET', '/api/directory');
        if (open) return;
        browse.replaceChildren(
          h('p', { class: 'sub', style: 'margin:16px 0 8px' }, 'Or pick the kind of service you need help with.'),
          h('div', { class: 'niche-grid' }, d.niches.map((n) =>
            h('button', { type: 'button', class: 'niche-card', disabled: !n.count, 'aria-label': `${n.label}, ${n.count} ${n.count === 1 ? 'company' : 'companies'}`, onclick: () => showKind(n) },
              h('span', { class: 'name' }, n.label), h('span', { class: 'count' }, n.count ? `${n.count} ${n.count === 1 ? 'company' : 'companies'}` : 'None yet')))));
      } catch (x) { browse.replaceChildren(errorBox(x.message)); }
    }

    async function showKind(n, offset = 0) {
      open = n;
      const list = offset ? browse.querySelector('.business-list.kind') : h('div', { class: 'business-list kind' });
      if (!offset) {
        browse.replaceChildren(
          h('div', { class: 'kind-head' }, h('button', { class: 'btn small quiet', type: 'button', onclick: showKinds }, 'All kinds'), h('h3', null, n.label)), list);
        list.replaceChildren(loading('Loading…'));
      }
      try {
        const d = await api('GET', `/api/businesses?niche=${encodeURIComponent(n.key)}&offset=${offset}`);
        if (open !== n) return;
        if (!offset) list.replaceChildren();
        browse.querySelector('.more')?.remove();
        if (!offset && !d.businesses.length) { list.replaceChildren(emptyBox('No companies yet', 'Nobody has registered under this kind of service.')); return; }
        list.append(...d.businesses.map(row));
        if (d.has_more) browse.append(h('button', { class: 'btn more', type: 'button', onclick: (e) => withBusy(e.target, () => showKind(n, offset + d.businesses.length)) }, 'Show more'));
      } catch (x) { if (open === n) list.replaceChildren(errorBox(x.message)); }
    }

    const search = h('input', {
      class: 'input', type: 'search', placeholder: 'Type a business name', 'aria-label': 'Search for a business', autocomplete: 'off',
      oninput: (e) => {
        clearTimeout(debounce);
        const q = e.target.value.trim();
        seq++;
        if (q.length < 2) { results.replaceChildren(); browse.classList.remove('hidden'); return; }
        browse.classList.add('hidden');
        const mine = seq;
        debounce = setTimeout(async () => {
          results.replaceChildren(loading('Searching…'));
          try {
            const d = await api('GET', `/api/businesses?q=${encodeURIComponent(q)}`);
            if (mine !== seq) return;
            if (!d.businesses.length) { results.replaceChildren(emptyBox('No match', 'Check the spelling, or pick a kind of service below.')); return; }
            results.replaceChildren(...d.businesses.map(row));
          } catch (x) { if (mine === seq) results.replaceChildren(errorBox(x.message)); }
        }, 300);
      },
    });
    onViewCleanup(() => clearTimeout(debounce));
    showKinds();

    // Open recent tickets? Opens that company with the ticket code and email already filled in
    const recent = recentTickets();
    const openRecent = (r) => {
      state.slug = r.slug; state.preview = null; state.fromPick = true;
      state.prefill = { code: r.code, email: r.email, account: !!r.account };
      history.replaceState(null, '', `/b/${r.slug}`);
      go('onboard');
    };
    const recentBox = recent.length
      ? h('details', { class: 'recent' },
          h('summary', null, 'Open recent tickets?', h('span', { class: 'count' }, `${recent.length}`)),
          h('div', { class: 'recent-list' }, recent.map((r) =>
            h('button', { type: 'button', class: 'recent-item', onclick: () => openRecent(r) },
              h('span', { class: 'name' }, r.subject),
              h('span', { class: 'meta' }, `${r.biz} · ${r.code} · ${ago(r.at)}`)))))
      : null;
    return h('main', { class: 'page narrow', id: 'main' }, backLink('choose'),
      h('div', { class: 'panel', style: 'margin-top:12px' }, h('h2', null, 'Who do you need help from?'),
        h('p', { class: 'sub' }, 'Search for the business, or browse by kind of service.'), recentBox, search, results, browse));
  }

  function entryOnboard() {
    const biz = state.preview;
    const slug = encodeURIComponent(state.slug);
    const pf = state.prefill; // set by "Open recent tickets?"
    state.prefill = null;
    const errEl = () => h('p', { class: 'error-text hidden', role: 'alert' });
    function submitForm(form, err, busyText, fn) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        err.classList.add('hidden');
        const btn = form.querySelector('button[type=submit]');
        try { await withBusy(btn, async () => { btn.textContent = busyText; startSession(await fn()); }); }
        catch (x) { err.textContent = x.message; err.classList.remove('hidden'); }
      });
    }

    // 1. Guest: a name and an email, no password
    const gErr = errEl();
    const gName = h('input', { class: 'input', required: true, maxlength: 80, autocomplete: 'name' });
    const gEmail = h('input', { class: 'input', type: 'email', required: true, maxlength: 200, autocomplete: 'email' });
    const guest = h('form', { class: 'form-grid' },
      field('Your name', gName), field('Your email', gEmail, 'Your ticket code is tied to this email, so you can come back to the conversation later.'),
      gErr, h('button', { class: 'btn stub', type: 'submit' }, 'Continue as a guest'));
    submitForm(guest, gErr, 'Starting…', () => api('POST', `/api/b/${slug}/enter`, { name: gName.value, email: gEmail.value }));

    // 2. Optional account: see every request in one place
    let mode = 'signin';
    const acct = h('div');
    function drawAcct() {
      const err = errEl();
      const email = h('input', { class: 'input', type: 'email', required: true, maxlength: 200, autocomplete: 'username' });
      if (pf && pf.account && mode === 'signin') email.value = pf.email;
      const pw = h('input', { class: 'input', type: 'password', required: true, minlength: mode === 'signin' ? 1 : 8, autocomplete: mode === 'signin' ? 'current-password' : 'new-password' });
      let form;
      if (mode === 'signin') {
        form = h('form', { class: 'form-grid' }, field('Email', email), field('Password', pw), err, h('button', { class: 'btn primary', type: 'submit' }, 'Sign in'));
        submitForm(form, err, 'Signing in…', () => api('POST', `/api/b/${slug}/customer/login`, { email: email.value, password: pw.value }));
      } else {
        const name = h('input', { class: 'input', required: true, maxlength: 80, autocomplete: 'name' });
        form = h('form', { class: 'form-grid' }, field('Your name', name), field('Email', email), field('Password', pw, 'At least 8 characters.'), err, h('button', { class: 'btn primary', type: 'submit' }, 'Create account'));
        submitForm(form, err, 'Creating…', () => api('POST', `/api/b/${slug}/customer/register`, { name: name.value, email: email.value, password: pw.value }));
      }
      const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Sign in or create an account' },
        h('button', { type: 'button', 'aria-pressed': String(mode === 'signin'), onclick: () => { mode = 'signin'; drawAcct(); } }, 'Sign in'),
        h('button', { type: 'button', 'aria-pressed': String(mode === 'register'), onclick: () => { mode = 'register'; drawAcct(); } }, 'Create account'));
      acct.replaceChildren(h('div', { class: 'row between', style: 'margin-bottom:6px' }, h('h2', null, 'Your account'), seg),
        h('p', { class: 'sub' }, 'Optional. An account keeps all your requests in one list.'), form);
    }
    drawAcct();

    // 3. Back in with a ticket code
    const lErr = errEl();
    const code = h('input', { class: 'input code', maxlength: 12, required: true, placeholder: 'T-ABC123', autocapitalize: 'characters' });
    const lEmail = h('input', { class: 'input', type: 'email', required: true, maxlength: 200 });
    if (pf && !pf.account) { code.value = pf.code; lEmail.value = pf.email; }
    const lookup = h('form', { class: 'form-grid' },
      h('div', { class: 'form-grid two' }, field('Ticket code', code), field('Email on the ticket', lEmail)),
      lErr, h('button', { class: 'btn', type: 'submit' }, 'Open my conversation'));
    submitForm(lookup, lErr, 'Looking…', () => api('POST', `/api/b/${slug}/lookup`, { code: code.value, email: lEmail.value }));

    const guestPanel = h('div', { class: 'panel' }, h('h2', null, 'Continue as a guest'), h('p', { class: 'sub' }, 'No password needed. We only ask for your name and email.'), guest);
    const acctPanel = h('div', { class: `panel${pf && pf.account ? ' pick-me' : ''}` }, pf && pf.account ? h('p', { class: 'demo-note', style: 'margin:0 0 10px' }, `Ticket ${pf.code} belongs to your account. Enter your password to open it.`) : null, acct);
    const lookupPanel = h('div', { class: `panel${pf && !pf.account ? ' pick-me' : ''}` },
      h('h2', null, pf && !pf.account ? `Open ticket ${pf.code}` : 'Have a ticket code?'),
      h('p', { class: 'sub' }, pf && !pf.account ? 'Your ticket code and email are filled in. Press the button to open your conversation.' : 'Enter the code you were given and the email you used, to pick the conversation back up.'), lookup);
    // a ticket picked from "Open recent tickets?" puts the matching way in at the top
    const panels = pf ? (pf.account ? [acctPanel, lookupPanel, guestPanel] : [lookupPanel, acctPanel, guestPanel]) : [guestPanel, acctPanel, lookupPanel];
    if (pf) setTimeout(() => { const t = pf.account ? acct.querySelector('input[type=password]') : lookup.querySelector('button[type=submit]'); if (t) t.focus(); }, 0);
    return h('main', { class: 'page narrow', id: 'main' },
      h('div', { class: 'row' },
        h('button', { class: 'btn small quiet', type: 'button', onclick: () => (state.fromPick ? chooseAnotherCompany() : go('choose')) }, 'Back'),
        state.fromPick ? null : h('button', { class: 'btn small quiet', type: 'button', onclick: chooseAnotherCompany }, 'Choose a different company')),
      h('h1', { style: 'font-size:2rem;margin:12px 0 14px' }, biz ? `Welcome to ${biz.name}` : 'Welcome'),
      biz && biz.demo ? h('p', { class: 'demo-note' }, 'Demo company: everything here is made up for testing.') : null,
      ...panels);
  }

  async function ensureNiches() {
    if (state.niches) return;
    const d = await api('GET', '/api/niches');
    state.niches = d.niches;
    state.botNames = d.bot_names;
  }

  function entryAdmin() {
    const tab = state.adminTab || 'signin';
    const body = h('div', null, loading());
    const setTab = (t) => { state.adminTab = t; renderEntry(); };
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Sign in or create a desk' },
      h('button', { type: 'button', 'aria-pressed': String(tab === 'signin'), onclick: () => setTab('signin') }, 'Sign in'),
      h('button', { type: 'button', 'aria-pressed': String(tab === 'create'), onclick: () => setTab('create') }, 'Create a desk'));

    if (tab === 'signin') {
      const err = h('p', { class: 'error-text hidden', role: 'alert' });
      const email = h('input', { class: 'input', type: 'email', required: true, autocomplete: 'username' });
      const pw = h('input', { class: 'input', type: 'password', required: true, autocomplete: 'current-password' });
      const form = h('form', { class: 'form-grid', onsubmit: async (e) => {
        e.preventDefault();
        err.classList.add('hidden');
        const btn = form.querySelector('button[type=submit]');
        try { await withBusy(btn, async () => { btn.textContent = 'Signing in…'; startSession(await api('POST', '/api/auth/login', { email: email.value, password: pw.value })); }); }
        catch (x) { err.textContent = x.message; err.classList.remove('hidden'); }
      } }, field('Email', email), field('Password', pw), err, h('button', { class: 'btn primary', type: 'submit' }, 'Sign in'));
      body.replaceChildren(form);
    } else {
      ensureNiches().then(() => {
        const err = h('p', { class: 'error-text hidden', role: 'alert' });
        const biz = h('input', { class: 'input', required: true, maxlength: 80 });
        const me = h('input', { class: 'input', required: true, maxlength: 80, autocomplete: 'off' });
        const email = h('input', { class: 'input', type: 'email', required: true, autocomplete: 'username' });
        const pw = h('input', { class: 'input', type: 'password', required: true, minlength: 8, autocomplete: 'new-password' });
        const choices = h('div', { class: 'choices' }, state.niches.map((n, i) =>
          h('label', { class: 'choice' },
            h('input', { type: 'radio', name: 'niche', value: n.key, checked: i === 0 }),
            h('span', null, h('span', { class: 't' }, n.label), h('br'), h('span', { class: 'd' }, `${n.description} Starts with: ${n.categories.slice(0, 4).join(', ')}.`)))));
        const form = h('form', { class: 'form-grid', onsubmit: async (e) => {
          e.preventDefault();
          err.classList.add('hidden');
          const btn = form.querySelector('button[type=submit]');
          const niche = form.querySelector('input[name=niche]:checked').value;
          try {
            await withBusy(btn, async () => {
              btn.textContent = 'Creating…';
              startSession(await api('POST', '/api/auth/register-business', { business_name: biz.value, owner_name: me.value, email: email.value, password: pw.value, niche }));
            });
          } catch (x) { err.textContent = x.message; err.classList.remove('hidden'); }
        } },
          field('Business name', biz),
          h('div', { class: 'field' }, h('span', { class: 'label' }, 'What kind of business is it?'), choices,
            h('div', { class: 'hint' }, 'This only sets up your starting categories. You can change everything later.')),
          h('div', { class: 'form-grid two' }, field('Your name', me), field('Your email', email)),
          field('Password', pw, 'At least 8 characters.'), err,
          h('button', { class: 'btn primary', type: 'submit' }, 'Create my desk'));
        body.replaceChildren(form);
      }).catch((e) => body.replaceChildren(errorBox(e.message, () => renderEntry())));
    }
    return h('main', { class: 'page narrow', id: 'main' }, backLink('choose'),
      h('div', { class: 'panel', style: 'margin-top:12px' },
        h('div', { class: 'row between', style: 'margin-bottom:14px' }, h('h2', null, tab === 'signin' ? 'Welcome back' : 'Set up your support desk'), seg), body));
  }

  // Same guess as the server's: is this message probably not English?
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

  /* --------------------------------------------------------------- Thread */
  // Shared by customers and staff. Polls for new messages while open.
  function Thread({ id, role, team, onChanged }) {
    const isStaff = role !== 'customer';
    const el = h('div', null, loading('Opening conversation…'));
    let data = null;
    let timer = null;
    let destroyed = false;
    let sig = '';
    let mode = 'reply';
    let codeCopied = false;
    let copyResetTimer = null;
    let codeCopyButton = null;
    const tr = new Map(); // message id -> { text, shown }
    const ui = {};

    async function load(first) {
      try {
        const d = await api('GET', `/api/tickets/${id}`);
        if (destroyed) return;
        data = d;
        draw(first);
      } catch (e) {
        if (destroyed) return;
        if (first) el.replaceChildren(errorBox(e.message, () => { el.replaceChildren(loading()); load(true); }));
      }
    }

    function messageEl(m, t) {
      if (m.sender_type === 'system') return h('div', { class: 'msg system' }, m.body);
      if (m.internal) {
        return h('div', { class: 'msg note' }, h('div', { class: 'who' }, m.sender_name, h('span', { class: 'tag' }, 'Internal note'), h('span', { class: 'when' }, fmtDay(m.created_at))), m.body);
      }
      const mine = !isStaff && m.sender_type === 'customer';
      const label = mine ? 'You' : m.sender_name;
      const cls = m.sender_type === 'owner' ? 'staff' : m.sender_type;
      return h('div', { class: `msg ${cls}` },
        h('div', { class: 'who' }, label, m.sender_type === 'bot' ? h('span', { class: 'tag auto' }, 'Automated reply') : null, h('span', { class: 'when' }, fmtDay(m.created_at))),
        m.body,
        isStaff ? translateBlock(m) : null);
    }

    // Staff only: a small "Translate to English" link under any message that is not in English
    function translateBlock(m) {
      const st = tr.get(m.id) || (m.translation ? { text: m.translation, shown: false } : null);
      if (!st && !looksNonEnglish(m.body)) return null;
      if (st && st.shown) {
        return h('div', { class: 'translation' },
          h('div', { class: 'k' }, 'In English'), st.text,
          h('div', null, h('button', { class: 'tr-btn', type: 'button', onclick: () => { st.shown = false; tr.set(m.id, st); drawMessages(false); } }, 'Hide translation')));
      }
      const btn = h('button', { class: 'tr-btn', type: 'button', 'aria-label': 'Translate this message to English' }, 'Translate to English');
      btn.onclick = async () => {
        if (st && st.text) { st.shown = true; tr.set(m.id, st); drawMessages(false); return; }
        btn.disabled = true; btn.textContent = 'Translating…';
        try {
          const r = await api('POST', `/api/tickets/${id}/messages/${m.id}/translate`);
          tr.set(m.id, { text: r.translation, shown: true });
          drawMessages(false);
        } catch (e) { btn.disabled = false; btn.textContent = 'Translate to English'; toast(e.message, 'bad'); }
      };
      return h('div', { class: 'tr-row' }, btn);
    }

    function botTyping(t, msgs) {
      const last = [...msgs].reverse().find((m) => m.sender_type !== 'system' && !m.internal);
      return t.handler === 'bot' && last && last.sender_type === 'customer' && !['closed'].includes(t.status) && state.business && state.business.automation_mode === 'bot_first';
    }

    function drawMessages(first) {
      const t = data.ticket;
      const box = ui.msgs;
      const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
      box.replaceChildren(...data.messages.map((m) => messageEl(m, t)));
      if (botTyping(t, data.messages)) {
        box.append(h('div', { class: 'typing', role: 'status', 'aria-label': `${t.bot_name} is typing` }, h('i'), h('i'), h('i')));
      }
      if (first || nearBottom) box.scrollTop = box.scrollHeight;
    }

    async function act(path, body, okMsg) {
      try {
        await api('POST', `/api/tickets/${id}/${path}`, body || {});
        if (okMsg) toast(okMsg, 'ok');
      } catch (e) { toast(e.message, 'bad'); }
      await load(false);
      if (onChanged) onChanged();
    }

    function drawHead() {
      const t = data.ticket;
      const head = ui.head;
      const kids = [];
      codeCopyButton = !isStaff ? h('button', {
        class: 'ticket-code-copy', type: 'button',
        'aria-label': codeCopied ? 'Ticket code copied' : 'Copy ticket code',
        title: codeCopied ? 'Copied' : 'Copy ticket code',
        onclick: async () => {
          try {
            await navigator.clipboard.writeText(t.code);
            codeCopied = true;
            codeCopyButton.replaceChildren(ticketCodeIcon(true));
            codeCopyButton.setAttribute('aria-label', 'Ticket code copied');
            codeCopyButton.title = 'Copied';
            clearTimeout(copyResetTimer);
            copyResetTimer = setTimeout(() => {
              codeCopied = false;
              if (codeCopyButton) {
                codeCopyButton.replaceChildren(ticketCodeIcon(false));
                codeCopyButton.setAttribute('aria-label', 'Copy ticket code');
                codeCopyButton.title = 'Copy ticket code';
              }
            }, 1600);
          } catch { toast('Copy failed. Select the ticket code and copy it manually.', 'bad'); }
        },
      }, ticketCodeIcon(codeCopied)) : null;
      kids.push(h('div', { class: 'row' },
        h('span', { class: 'stubcode' }, t.code),
        codeCopyButton,
        isStaff
          ? h('span', { class: `tag status-${t.status}` }, STATUS_LABEL[t.status])
          : h('span', { class: `tag ${custStatusClass(t.status)}` }, CUSTOMER_STATUS[t.status]),
        isStaff ? slaBadge(t) : null,
        isStaff && t.source === 'email' ? h('span', { class: 'tag' }, 'Came in by email') : null,
        isStaff && (t.priority === 'urgent' || t.priority === 'high') ? h('span', { class: `tag ${t.priority === 'urgent' ? 'urgent' : 'hi'}` }, `${PRI_LABEL[t.priority]} priority`) : null,
        h('span', { class: 'right' })));
      kids.push(h('h2', { style: 'margin-top:8px' }, t.subject));

      if (isStaff) {
        const kv = [
          h('span', null, h('span', { class: 'k' }, 'Customer'), t.customer.name + (t.customer.email ? ` (${t.customer.email})` : '')),
          h('span', null, h('span', { class: 'k' }, 'Category'), t.category_name || 'None'),
          h('span', null, h('span', { class: 'k' }, 'Opened'), fmtDay(t.created_at)),
          h('span', null, h('span', { class: 'k' }, 'Assigned to'), t.assignee_name || 'Nobody yet'),
        ];
        for (const [k, v] of Object.entries(t.custom || {})) kv.push(h('span', null, h('span', { class: 'k' }, k.replace(/_/g, ' ')), v));
        kids.push(h('div', { class: 'kv' }, kv));

        const statusSel = h('select', { class: 'select small', 'aria-label': 'Status', onchange: (e) => act('status', { status: e.target.value }) },
          [t.status, ...TRANSITIONS[t.status]].map((s) => h('option', { value: s, selected: s === t.status }, STATUS_LABEL[s])));
        const priSel = h('select', { class: 'select small', 'aria-label': 'Priority', onchange: (e) => act('priority', { priority: e.target.value }) },
          Object.keys(PRI_LABEL).map((p) => h('option', { value: p, selected: p === t.priority }, PRI_LABEL[p])));
        const controls = [h('label', null, 'Status', statusSel), h('label', null, 'Priority', priSel)];
        if (role === 'owner' && team) {
          const sel = h('select', { class: 'select small', 'aria-label': 'Assign to', onchange: (e) => act('assign', { user_id: e.target.value === '' ? null : Number(e.target.value) }, 'Assignment saved') },
            h('option', { value: '' }, 'Unassigned'),
            team.filter((u) => u.active).map((u) => h('option', { value: u.id, selected: u.id === t.assigned_to }, `${u.name}${u.role === 'owner' ? ' (owner)' : ''}`)));
          controls.push(h('label', null, 'Assigned to', sel));
        }
        kids.push(h('div', { class: 'controls' }, controls));

        const auto = state.business && state.business.automation_mode === 'bot_first';
        if (t.handler === 'bot') {
          kids.push(h('div', { class: 'handler' }, h('span', { class: 'tag auto' }, 'Automated'),
            h('span', { class: 'grow' }, `${t.bot_name} is replying to this customer. Take over any time; the conversation carries on without a break.`),
            h('button', { class: 'btn small primary', onclick: () => act('takeover', {}, 'You are in the conversation') }, 'Take over')));
        } else {
          kids.push(h('div', { class: 'handler human' }, h('span', { class: 'grow' }, 'A person is handling this conversation.'),
            auto ? h('button', { class: 'btn small', onclick: () => act('handback', {}, `${t.bot_name} is back on this one`) }, `Hand back to ${t.bot_name}`) : null));
        }
      } else {
        // customer view: the conversation and its status, never deadlines or assignments
        const isOpen = !['resolved', 'closed'].includes(t.status);
        kids.push(h('p', { class: 'muted', style: 'margin:8px 0 0' },
          !isOpen
            ? (t.status === 'closed' ? 'This request is closed.' : 'Marked as resolved. Reply below if you still need help.')
            : t.handler === 'bot'
              ? `${t.bot_name}, our automated assistant, is helping with this. You can ask for a person at any time.`
              : 'A team member is looking after this. Reply below to add more detail.'));
        const actions = [];
        if (t.handler === 'bot' && isOpen) actions.push(h('button', { class: 'btn small', onclick: () => act('request-human', {}, 'A team member is on the way') }, 'Talk to a person'));
        if (isOpen) actions.push(h('button', { class: 'btn small', onclick: () => act('solved', {}, 'Glad that is sorted') }, 'This solved it'));
        if (actions.length) kids.push(h('div', { class: 'row', style: 'margin-top:12px' }, actions));
      }
      head.replaceChildren(...kids);
    }

    function buildComposer() {
      const ta = h('textarea', { class: 'textarea', maxlength: 6000, 'aria-label': 'Message', placeholder: 'Write a message' });
      const send = h('button', { class: 'btn primary', type: 'button' }, 'Send');
      const hint = h('span', { class: 'muted small' });
      const seg = isStaff
        ? h('div', { class: 'seg', role: 'group', 'aria-label': 'Reply or note' },
          h('button', { type: 'button', 'aria-pressed': 'true', onclick: () => setMode('reply') }, 'Reply to customer'),
          h('button', { type: 'button', class: 'note', 'aria-pressed': 'false', onclick: () => setMode('note') }, 'Internal note'))
        : null;
      const wrap = h('div', { class: 'composer' }, seg, ta, h('div', { class: 'row between' }, hint, send));
      function setMode(m) {
        mode = m;
        wrap.classList.toggle('note-mode', m === 'note');
        if (seg) [...seg.children].forEach((b, i) => b.setAttribute('aria-pressed', String((i === 0) === (m === 'reply'))));
        ta.placeholder = m === 'note' ? 'Write a note for your team. The customer cannot see it.' : 'Write your reply';
        send.textContent = m === 'note' ? 'Save note' : 'Send reply';
        hint.textContent = m === 'note' ? 'Only your team can see notes.' : isStaff ? 'The customer sees this straight away.' : 'Press Ctrl+Enter to send.';
      }
      async function submit() {
        const body = ta.value.trim();
        if (!body) return;
        send.disabled = true;
        try {
          await api('POST', `/api/tickets/${id}/messages`, { body, internal: isStaff && mode === 'note' });
          ta.value = '';
          await load(false);
          if (onChanged) onChanged();
          ui.msgs.scrollTop = ui.msgs.scrollHeight;
        } catch (e) { toast(e.message, 'bad'); }
        send.disabled = false;
        ta.focus();
      }
      send.addEventListener('click', submit);
      ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } });
      setMode('reply');
      ui.ta = ta; ui.send = send; ui.wrap = wrap; ui.seg = seg;
      return wrap;
    }

    function drawClosedState() {
      const t = data.ticket;
      const closed = t.status === 'closed';
      ui.composerHost.replaceChildren();
      if (closed && !isStaff) {
        ui.composerHost.append(h('div', { class: 'composer' }, h('p', { class: 'muted', style: 'margin:0' }, 'This request is closed. Start a new request if you still need help.')));
      } else if (closed && isStaff && mode === 'reply') {
        ui.composerHost.append(ui.wrap);
        ui.send.disabled = true;
        ui.ta.disabled = true;
        ui.ta.placeholder = 'Reopen the ticket to reply, or write an internal note.';
      } else {
        ui.composerHost.append(ui.wrap);
        ui.ta.disabled = false;
        ui.send.disabled = false;
      }
    }

    function draw(first) {
      const t = data.ticket;
      const last = data.messages[data.messages.length - 1];
      const key = JSON.stringify([t.status, t.priority, t.handler, t.assigned_to, t.sla && t.sla.state, data.messages.length, last && last.id, state.business && state.business.automation_mode]);
      if (first || !ui.head) {
        ui.head = h('div', { class: 'thread-head' });
        ui.msgs = h('div', { class: 'messages', tabindex: '0', 'aria-label': 'Conversation' });
        ui.composerHost = h('div');
        buildComposer();
        el.replaceChildren(h('div', { class: 'thread-box' }, ui.head, ui.msgs, ui.composerHost));
        sig = '';
      }
      if (key === sig) return;
      sig = key;
      drawHead();
      drawMessages(first);
      drawClosedState();
    }

    load(true);
    let sse = null;
    try {
      if (typeof window !== 'undefined' && window.EventSource && state.token) {
        sse = new EventSource(`/api/tickets/${id}/stream?token=${encodeURIComponent(state.token)}`);
        sse.addEventListener('message', (e) => {
          if (destroyed) return;
          try {
            const m = JSON.parse(e.data);
            if (data && data.messages && !data.messages.some((x) => x.id === m.id)) {
              data.messages.push(m);
              draw(false);
              if (onChanged) onChanged();
            }
          } catch {}
        });
        const onTicketUpdate = () => {
          if (destroyed) return;
          load(false);
          if (onChanged) onChanged();
        };
        sse.addEventListener('ticket', onTicketUpdate);
        sse.addEventListener('status', onTicketUpdate);
        sse.addEventListener('handler', onTicketUpdate);
      }
    } catch {}
    timer = setInterval(() => { if (!document.hidden) load(false); }, 4000);
    return {
      el,
      destroy() {
        destroyed = true;
        clearInterval(timer);
        clearTimeout(copyResetTimer);
        if (sse) { try { sse.close(); } catch {} }
      },
    };
  }

  /* --------------------------------------------------------------- Customer */
  function renderCustomer() {
    runSessionCleanups();
    let tickets = null;
    let selectedId = state.openTicketId;
    let thread = null;
    let term = '';
    const listEl = h('div', { class: 'tlist' }, loading('Loading your requests…'));
    const content = h('section', { 'aria-live': 'polite' });
    const search = h('input', {
      class: 'input small', type: 'search', style: 'width:100%', placeholder: 'Search your requests', 'aria-label': 'Search your requests',
      oninput: (e) => { term = e.target.value.trim().toLowerCase(); drawList(); },
    });
    const stopThread = () => { if (thread) thread.destroy(); thread = null; };

    function showNew() {
      selectedId = null;
      stopThread();
      content.replaceChildren(newRequestForm((t) => { selectedId = t.id; refreshList(); showThread(t.id); }));
      drawList();
    }
    function showThread(id) {
      selectedId = id;
      stopThread();
      thread = Thread({ id, role: 'customer', onChanged: refreshList });
      content.replaceChildren(thread.el);
      drawList();
    }
    function showAccount() {
      selectedId = null;
      stopThread();
      const err = h('p', { class: 'error-text hidden', role: 'alert' });
      const pw = h('input', { class: 'input', type: 'password', required: true, minlength: 8, autocomplete: 'new-password' });
      const pw2 = h('input', { class: 'input', type: 'password', required: true, minlength: 8, autocomplete: 'new-password' });
      const form = h('form', { class: 'form-grid', onsubmit: async (e) => {
        e.preventDefault();
        err.classList.add('hidden');
        if (pw.value !== pw2.value) { err.textContent = 'The two passwords do not match.'; err.classList.remove('hidden'); return; }
        const btn = form.querySelector('button[type=submit]');
        try {
          await withBusy(btn, async () => {
            btn.textContent = 'Saving…';
            await api('POST', '/api/account/set-password', { password: pw.value });
            state.user.account = true;
            toast('Account saved. Next time, sign in with your email and password.', 'ok');
            render();
          });
        } catch (x) { err.textContent = x.message; err.classList.remove('hidden'); }
      } }, field('Choose a password', pw, 'At least 8 characters.'), field('Type it again', pw2), err,
        h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit' }, 'Save account'), h('button', { class: 'btn quiet', type: 'button', onclick: () => (tickets && tickets.length ? content.replaceChildren(emptyBox('Pick a request', 'Choose one from the list, or send a new request.')) : showNew()) }, 'Cancel')));
      content.replaceChildren(h('div', { class: 'panel' }, h('h2', null, 'Save your requests'),
        h('p', { class: 'sub' }, `Add a password to ${state.user.email || 'your email'} so you can sign in later and see every request in one place.`), form));
      drawList();
    }
    function drawList() {
      if (tickets === null) return;
      if (!tickets.length) {
        listEl.replaceChildren(h('p', { class: 'muted small' }, 'Your requests will show up here once you send one.'));
        return;
      }
      const shown = term ? tickets.filter((t) => `${t.subject} ${t.code} ${t.last_body || ''}`.toLowerCase().includes(term)) : tickets;
      if (!shown.length) { listEl.replaceChildren(h('p', { class: 'muted small' }, 'No requests match that search.')); return; }
      listEl.replaceChildren(...shown.map((t) =>
        h('button', { class: 'titem', 'aria-current': String(t.id === selectedId), onclick: () => showThread(t.id) },
          h('span', { class: 'subject' }, t.subject),
          h('span', { class: 'snippet' }, t.last_body || ' '),
          h('span', { class: 'meta' }, h('span', { class: `tag ${custStatusClass(t.status)}` }, CUSTOMER_STATUS[t.status]), h('span', { class: 'code muted small' }, t.code), h('span', { class: 'muted small' }, ago(t.updated_at))))));
    }
    async function refreshList() {
      try { tickets = (await api('GET', '/api/tickets?status=all&sort=recent')).tickets; rememberTickets(tickets); drawList(); }
      catch (e) { listEl.replaceChildren(errorBox(e.message, refreshList)); }
    }

    root.replaceChildren(
      topbar({ who: state.user.name, extra: h('span', { class: 'row' },
        state.user.account ? null : h('button', { class: 'btn small', onclick: showAccount }, 'Save my requests'),
        h('button', { class: 'btn small quiet', onclick: () => { signOut(); chooseAnotherCompany(); } }, 'Other companies')) }),
      h('main', { class: 'page', id: 'main' },
        h('div', { class: 'cust' },
          h('aside', { class: 'side' }, h('button', { class: 'btn stub', onclick: showNew }, 'New request'), search, listEl),
          content)));

    refreshList().then(() => {
      if (selectedId) showThread(selectedId);
      else if (tickets && tickets.length === 0) showNew();
      else content.replaceChildren(emptyBox('Pick a request', 'Choose one from the list, or send a new request.'));
    });
    const poll = setInterval(() => { if (!document.hidden) refreshList(); }, 20000);
    onSessionCleanup(() => { clearInterval(poll); stopThread(); });
    onViewCleanup(stopThread);
  }

  function newRequestForm(onCreated) {
    const biz = state.business;
    const cats = biz.categories;
    if (!cats.length) return h('div', { class: 'panel' }, emptyBox('Not ready yet', `${biz.name} has not set up any request types. Please check back soon.`));
    const err = h('p', { class: 'error-text hidden', role: 'alert' });
    const cat = h('select', { class: 'select', required: true }, cats.map((c) => h('option', { value: c.id }, c.name)));
    const catHint = h('div', { class: 'hint' });
    const extra = h('div', { class: 'form-grid' });
    const subject = h('input', { class: 'input', required: true, maxlength: 200, minlength: 3 });
    const desc = h('textarea', { class: 'textarea', required: true, maxlength: 6000, minlength: 5 });
    const customInputs = {};
    function drawExtra() {
      const c = cats.find((x) => String(x.id) === cat.value);
      catHint.textContent = c ? c.description : '';
      extra.replaceChildren();
      for (const k of Object.keys(customInputs)) delete customInputs[k];
      for (const f of (c && c.fields) || []) {
        const input = h('input', { class: 'input', type: f.type === 'number' ? 'number' : 'text', maxlength: 200, required: !!f.required });
        customInputs[f.key] = input;
        extra.append(field(f.label + (f.required ? '' : ' (optional)'), input));
      }
    }
    cat.addEventListener('change', drawExtra);
    drawExtra();
    const form = h('form', { class: 'form-grid', onsubmit: async (e) => {
      e.preventDefault();
      err.classList.add('hidden');
      const btn = form.querySelector('button[type=submit]');
      const custom = {};
      for (const [k, input] of Object.entries(customInputs)) custom[k] = input.value;
      try {
        await withBusy(btn, async () => {
          btn.textContent = 'Sending…';
          const r = await api('POST', '/api/tickets', { category_id: Number(cat.value), subject: subject.value, description: desc.value, custom });
          toast(`Request sent. Your ticket code is ${r.ticket.code}. Keep it to come back later.`, 'ok');
          onCreated(r.ticket);
        });
      } catch (x) { err.textContent = x.message; err.classList.remove('hidden'); }
    } },
      field('What is this about?', cat), catHint, extra,
      field('Subject', subject, 'A short summary.'),
      field('What happened?', desc, 'Include anything that helps us fix it the first time.'),
      err, h('button', { class: 'btn primary', type: 'submit' }, 'Send request'));
    return h('div', { class: 'panel' }, h('h2', null, 'New request'),
      h('p', { class: 'sub' }, `${biz.bot_name}, our automated assistant, may answer right away. You can ask for a person at any time.`), form);
  }

  /* Staff */
  const isOwner = () => state.user.role === 'owner';

  function renderStaff() {
    runSessionCleanups();
    const tabs = [['inbox', 'Inbox'], ['knowledge', 'Knowledge'], ...(isOwner() ? [['team', 'Team'], ['setup', 'Setup']] : [])];
    const main = h('main', { class: 'page', id: 'main' });
    const nav = h('nav', { class: 'nav-tabs', 'aria-label': 'Sections' });
    const bellCount = h('span', { class: 'count hidden' });
    const bell = h('button', { class: 'btn small quiet bell', 'aria-label': 'Notifications', 'aria-haspopup': 'true' }, 'Alerts', bellCount);
    let pop = null;
    const shell = h('div', null, topbar({ nav, extra: bell, who: `${state.user.name}, ${isOwner() ? 'owner' : 'agent'}` }), main);

    function paintNav() {
      nav.replaceChildren(...tabs.map(([k, label]) =>
        h('button', { type: 'button', 'aria-current': state.staffTab === k ? 'page' : null, onclick: () => open(k) }, label)));
    }
    function open(tab, ticketId) {
      runViewCleanups();
      state.staffTab = tab;
      if (ticketId) state.openTicketId = ticketId;
      paintNav();
      const view = tab === 'knowledge' ? knowledgeView() : tab === 'team' ? teamView() : tab === 'setup' ? setupView() : inboxView();
      main.replaceChildren(view);
      window.scrollTo(0, 0);
    }

    async function pollBell() {
      try {
        const d = await api('GET', '/api/notifications');
        bellCount.textContent = d.unread > 99 ? '99+' : String(d.unread);
        bellCount.classList.toggle('hidden', d.unread === 0);
        return d;
      } catch { return null; }
    }
    const bellTimer = setInterval(() => { if (!document.hidden) pollBell(); }, 20000);
    onSessionCleanup(() => { clearInterval(bellTimer); if (pop) pop.remove(); });
    bell.addEventListener('click', async () => {
      if (pop) { pop.remove(); pop = null; return; }
      const d = await pollBell();
      if (!d) return;
      pop = h('div', { class: 'popover', role: 'dialog', 'aria-label': 'Notifications' },
        h('div', { class: 'head' }, 'Alerts', d.items.some((n) => !n.read) ? h('button', { class: 'btn small quiet', onclick: async () => { await api('POST', '/api/notifications/read', {}); pop.remove(); pop = null; pollBell(); } }, 'Mark all read') : null),
        d.items.length ? d.items.map((n) => h('button', { class: `item ${n.read ? '' : 'unread'}`, onclick: async () => {
          pop.remove(); pop = null;
          await api('POST', '/api/notifications/read', { ids: [n.id] }).catch(() => {});
          pollBell();
          if (n.ticket_id) open('inbox', n.ticket_id);
        } }, h('div', null, n.message), h('div', { class: 'when' }, ago(n.created_at))))
          : emptyBox('No alerts', 'Assignments, replies and deadline warnings show up here.'));
      document.body.append(pop);
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && pop) { pop.remove(); pop = null; } });

    root.replaceChildren(shell);
    // Fresh business info (e.g. after a reload of settings elsewhere)
    api('GET', '/api/me').then((d) => { state.business = d.business; }).catch(() => {});
    pollBell();
    open(state.staffTab);
  }

  /* ------------------------------------------------------------- Inbox view */
  function inboxView() {
    const f = state.filters || (state.filters = { status: 'active', assigned: '', priority: '', q: '' });
    let team = null;
    let tickets = null;
    let thread = null;
    let selected = state.openTicketId;
    const stats = h('div', { class: 'stats' });
    const listEl = h('div', { class: 'tlist', 'aria-live': 'polite' }, loading('Loading requests…'));
    const threadEl = h('section', { class: 'inbox-thread' });
    const grid = h('div', { class: `inbox ${selected ? 'has-sel' : ''}` });
    const outer = h('div', { class: `inbox-wrap ${selected ? 'has-sel' : ''}` });

    async function loadStats() {
      try {
        const s = (await api('GET', '/api/stats')).stats;
        const cell = (n, label, alert) => h('div', { class: `stat ${alert && n > 0 ? 'alert' : ''}` }, h('b', null, String(n)), h('span', null, label));
        stats.replaceChildren(
          cell(s.new, 'New'), cell(s.open, 'Open'), cell(s.pending, 'Waiting on customer'), cell(s.overdue, 'Overdue', true),
          isOwner() ? cell(s.unassigned, 'Unassigned', true) : null,
          h('div', { class: 'stat' }, h('b', null, s.avg_first_response_min === null ? 'None yet' : `${s.avg_first_response_min}m`), h('span', null, 'Average first reply')));
      } catch { /* the list shows errors */ }
    }
    function qs() {
      const p = new URLSearchParams();
      p.set('status', f.status);
      if (f.priority) p.set('priority', f.priority);
      if (f.assigned) p.set('assigned', f.assigned);
      if (f.q) p.set('q', f.q);
      return p.toString();
    }
    function drawList() {
      if (!tickets.length) {
        const filtered = f.q || f.priority || f.assigned || f.status !== 'active';
        listEl.replaceChildren(emptyBox(filtered ? 'Nothing matches' : 'All caught up', filtered ? 'Try clearing a filter.' : 'New requests show up here the moment they arrive.'));
        return;
      }
      listEl.replaceChildren(...tickets.map((t) =>
        h('button', { class: `titem pri-${t.priority}`, 'aria-current': String(t.id === selected), onclick: () => select(t.id) },
          h('span', { class: 'subject' }, t.subject),
          h('span', { class: 'snippet' }, `${t.customer.name}: ${t.last_body || ''}`),
          h('span', { class: 'meta' },
            slaBadge(t),
            t.status === 'new' ? h('span', { class: 'tag status-new' }, 'New') : null,
            t.handler === 'bot' ? h('span', { class: 'tag auto' }, 'Automated') : null,
            t.priority === 'urgent' ? h('span', { class: 'tag urgent' }, 'Urgent') : t.priority === 'high' ? h('span', { class: 'tag hi' }, 'High') : null,
            isOwner() && !t.assigned_to ? h('span', { class: 'tag urgent' }, 'Unassigned') : null,
            isOwner() && t.assignee_name ? h('span', { class: 'muted small' }, t.assignee_name) : null))));
    }
    async function loadList() {
      try { tickets = (await api('GET', `/api/tickets?${qs()}`)).tickets; drawList(); }
      catch (e) { if (tickets === null) listEl.replaceChildren(errorBox(e.message, loadList)); }
    }
    const refresh = () => { loadList(); loadStats(); };
    function select(id) {
      selected = id;
      state.openTicketId = id;
      grid.classList.add('has-sel');
      outer.classList.add('has-sel');
      if (thread) thread.destroy();
      thread = Thread({ id, role: state.user.role, team, onChanged: refresh });
      threadEl.replaceChildren(h('button', { class: 'btn small quiet back', onclick: () => { grid.classList.remove('has-sel'); outer.classList.remove('has-sel'); selected = null; state.openTicketId = null; drawList(); } }, 'Back to inbox'), thread.el);
      drawList();
      if (window.innerWidth < 960) window.scrollTo(0, 0);
    }

    const statusSel = h('select', { class: 'select small', 'aria-label': 'Status filter', onchange: (e) => { f.status = e.target.value; loadList(); } },
      [['active', 'Active'], ['new', 'New'], ['open', 'Open'], ['pending', 'Waiting on customer'], ['resolved', 'Resolved'], ['closed', 'Closed'], ['all', 'Everything']].map(([v, l]) => h('option', { value: v, selected: f.status === v }, l)));
    const priSel = h('select', { class: 'select small', 'aria-label': 'Priority filter', onchange: (e) => { f.priority = e.target.value; loadList(); } },
      h('option', { value: '' }, 'Any priority'), Object.keys(PRI_LABEL).map((p) => h('option', { value: p, selected: f.priority === p }, PRI_LABEL[p])));
    const assignSel = h('select', { class: 'select small', 'aria-label': 'Assignee filter', onchange: (e) => { f.assigned = e.target.value; loadList(); } }, h('option', { value: '' }, 'Everyone'));
    let debounce;
    const search = h('input', { class: 'input small', type: 'search', placeholder: 'Search subject, code or customer', 'aria-label': 'Search requests', value: f.q,
      oninput: (e) => { clearTimeout(debounce); debounce = setTimeout(() => { f.q = e.target.value.trim(); loadList(); }, 300); } });

    grid.append(
      h('section', { class: 'inbox-list' }, h('div', { class: 'filters' }, search, statusSel, priSel, isOwner() ? assignSel : null), listEl),
      threadEl);
    threadEl.replaceChildren(emptyBox('Pick a request', 'Select one from the list to read the conversation, reply, or add a private note.'));

    if (isOwner()) {
      api('GET', '/api/team').then((d) => {
        team = d.team;
        assignSel.replaceChildren(h('option', { value: '' }, 'Everyone'), h('option', { value: 'unassigned', selected: f.assigned === 'unassigned' }, 'Unassigned'),
          ...team.filter((u) => u.active).map((u) => h('option', { value: u.id, selected: String(f.assigned) === String(u.id) }, u.name)));
        if (thread && selected) select(selected);
      }).catch(() => {});
    }
    loadStats();
    loadList().then(() => { if (selected) select(selected); });
    const poll = setInterval(() => { if (!document.hidden) refresh(); }, 15000);
    onViewCleanup(() => { clearInterval(poll); clearTimeout(debounce); if (thread) thread.destroy(); });
    outer.append(stats, grid);
    return outer;
  }

  /* --------------------------------------------------------- Knowledge view */
  function knowledgeView() {
    const wrap = h('div', { class: 'stack' });
    const owner = isOwner();
    const botName = state.business.bot_name;
    const banner = h('div');
    if (owner) {
      api('GET', '/api/settings').then((d) => {
        if (!d.settings.ai_enabled) banner.replaceChildren(h('div', { class: 'banner' }, h('strong', null, 'AI replies are off. '), `Add OPENROUTER_API_KEY to the .env file and restart the server. Until then ${botName} only answers when an FAQ closely matches, and hands everything else to your team.`));
        else banner.replaceChildren(h('div', { class: 'banner' }, `AI replies are on (${d.settings.ai_model}). ${botName} answers from the FAQs and documents below.`));
      }).catch(() => {});
    }

    /* FAQs */
    const faqPanel = h('div', { class: 'panel' }, loading());
    let faqs = [];
    function drawFaqs() {
      const q = h('input', { class: 'input', maxlength: 300, required: true });
      const a = h('textarea', { class: 'textarea', maxlength: 4000, required: true });
      const add = h('form', { class: 'form-grid', style: 'margin-top:16px', onsubmit: async (e) => {
        e.preventDefault();
        const btn = add.querySelector('button');
        try { await withBusy(btn, async () => { faqs = (await api('POST', '/api/faqs', { question: q.value, answer: a.value })).faqs; toast('FAQ added', 'ok'); drawFaqs(); }); } catch (x) { toast(x.message, 'bad'); }
      } }, field('Question', q), field('Answer', a), h('div', null, h('button', { class: 'btn primary', type: 'submit' }, 'Add FAQ')));
      const rows = faqs.length ? h('div', { class: 'rows' }, faqs.map((f) => faqRow(f))) : emptyBox('No FAQs yet', owner ? `Add the questions customers ask most. ${botName} uses them to answer instantly.` : 'The owner has not added any yet.');
      faqPanel.replaceChildren(h('h2', null, 'FAQs'), h('p', { class: 'sub' }, `Short, accurate answers. ${botName} quotes these when a question matches.`), rows, owner ? add : null);
    }
    function faqRow(f) {
      const row = h('div', { class: 'r' });
      const view = () => row.replaceChildren(
        h('div', { class: 'grow' }, h('div', { class: 'q' }, f.question), h('div', { class: 'a' }, f.answer)),
        owner ? h('div', { class: 'row' },
          h('button', { class: 'btn small', onclick: edit }, 'Edit'),
          h('button', { class: 'btn small danger', onclick: async () => { if (!confirm('Delete this FAQ?')) return; try { faqs = (await api('DELETE', `/api/faqs/${f.id}`)).faqs; drawFaqs(); toast('FAQ deleted'); } catch (x) { toast(x.message, 'bad'); } } }, 'Delete')) : null);
      const edit = () => {
        const q = h('input', { class: 'input', value: f.question, maxlength: 300 });
        const a = h('textarea', { class: 'textarea', maxlength: 4000 }, f.answer);
        row.replaceChildren(h('div', { class: 'grow form-grid' }, field('Question', q), field('Answer', a),
          h('div', { class: 'row' },
            h('button', { class: 'btn small primary', onclick: async () => { try { faqs = (await api('PATCH', `/api/faqs/${f.id}`, { question: q.value, answer: a.value })).faqs; drawFaqs(); toast('Saved', 'ok'); } catch (x) { toast(x.message, 'bad'); } } }, 'Save'),
            h('button', { class: 'btn small quiet', onclick: view }, 'Cancel'))));
      };
      view();
      return row;
    }
    api('GET', '/api/faqs').then((d) => { faqs = d.faqs; drawFaqs(); }).catch((e) => faqPanel.replaceChildren(errorBox(e.message)));

    /* Documents */
    const docPanel = h('div', { class: 'panel' }, loading());
    let docs = [];
    async function toBase64(file) {
      const buf = new Uint8Array(await file.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(bin);
    }
    function drawDocs() {
      let upload = null;
      if (owner) {
        const fileInput = h('input', { type: 'file', accept: '.pdf,.txt,.md,application/pdf,text/plain', class: 'hidden', id: 'docfile' });
        const zone = h('div', { class: 'dropzone' },
          h('p', null, h('strong', null, 'Upload company policies, guidelines, about or vision documents')),
          h('p', { class: 'muted small' }, 'PDF, .txt or .md up to 10 MB. Scanned PDFs without text cannot be read.'),
          h('button', { class: 'btn', type: 'button', onclick: () => fileInput.click() }, 'Choose a file'), fileInput);
        async function sendFile(file) {
          if (!file) return;
          if (file.size > 10 * 1024 * 1024) return toast('That file is over 10 MB. Split it or paste the text instead.', 'bad');
          zone.classList.add('over');
          try {
            const r = await api('POST', '/api/documents', { filename: file.name, title: file.name.replace(/\.[a-z0-9]+$/i, '') || file.name, data_base64: await toBase64(file) });
            docs = r.documents;
            toast(`Added "${file.name}"`, 'ok');
            drawDocs();
          } catch (x) { toast(x.message, 'bad'); }
          zone.classList.remove('over');
        }
        fileInput.addEventListener('change', () => sendFile(fileInput.files[0]));
        ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('over'); }));
        ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('over'); }));
        zone.addEventListener('drop', (e) => sendFile(e.dataTransfer.files[0]));
        const title = h('input', { class: 'input', maxlength: 120, required: true });
        const text = h('textarea', { class: 'textarea', required: true, style: 'min-height:140px' });
        const paste = h('form', { class: 'form-grid', onsubmit: async (e) => {
          e.preventDefault();
          const btn = paste.querySelector('button');
          try { await withBusy(btn, async () => { docs = (await api('POST', '/api/documents', { title: title.value, text: text.value })).documents; toast('Document added', 'ok'); drawDocs(); }); } catch (x) { toast(x.message, 'bad'); }
        } }, field('Title', title), field('Text', text), h('div', null, h('button', { class: 'btn', type: 'submit' }, 'Add pasted text')));
        upload = h('div', { class: 'stack' }, zone, h('details', null, h('summary', { style: 'cursor:pointer;font-weight:600' }, 'Or paste text instead'), h('div', { style: 'margin-top:12px' }, paste)));
      }
      const rows = docs.length
        ? h('div', { class: 'rows', style: 'margin-bottom:16px' }, docs.map((d) => h('div', { class: 'r' },
          h('div', { class: 'grow' }, h('div', { class: 'q' }, d.title), h('div', { class: 'a' }, `${d.kind === 'pdf' ? 'PDF' : 'Text'}, ${Math.round(d.char_count / 1000 * 10) / 10}k characters, added ${ago(d.created_at)}`)),
          owner ? h('button', { class: 'btn small danger', onclick: async () => { if (!confirm(`Delete "${d.title}"?`)) return; try { docs = (await api('DELETE', `/api/documents/${d.id}`)).documents; drawDocs(); toast('Document deleted'); } catch (x) { toast(x.message, 'bad'); } } }, 'Delete') : null)))
        : h('div', { style: 'margin-bottom:16px' }, emptyBox('No documents yet', owner ? `Upload policies or guidelines so ${botName} can answer from them.` : 'The owner has not added any yet.'));
      docPanel.replaceChildren(h('h2', null, 'Documents'), h('p', { class: 'sub' }, `${botName} searches these when a question is not covered by an FAQ.`), rows, upload);
    }
    api('GET', '/api/documents').then((d) => { docs = d.documents; drawDocs(); }).catch((e) => docPanel.replaceChildren(errorBox(e.message)));

    wrap.append(h('div', null, h('h1', { style: 'font-size:2rem;margin-bottom:6px' }, 'Knowledge base'),
      h('p', { class: 'muted' }, `What ${botName} knows. Anything it cannot answer goes to a person.`)), banner, faqPanel, docPanel);
    return wrap;
  }

  /* -------------------------------------------------------------- Team view */
  function teamView() {
    const wrap = h('div');
    let team = [];
    let cats = [];
    const listEl = h('div', null, loading());
    function catChecks(selected) {
      const boxes = cats.filter((c) => c.active).map((c) => h('label', null, h('input', { type: 'checkbox', value: c.id, checked: selected.includes(c.id) }), c.name));
      const el = h('div', { class: 'checks' }, boxes);
      el.values = () => [...el.querySelectorAll('input:checked')].map((i) => Number(i.value));
      return el;
    }
    function draw() {
      const rows = team.map((u) => {
        const row = h('div', { class: 'r' });
        const names = u.category_ids.map((id) => (cats.find((c) => c.id === id) || {}).name).filter(Boolean);
        const view = () => row.replaceChildren(
          h('div', { class: 'grow' },
            h('div', { class: 'row' }, h('span', { class: 'q' }, u.name), h('span', { class: 'tag' }, u.role === 'owner' ? 'Owner' : 'Agent'), !u.active ? h('span', { class: 'tag urgent' }, 'Deactivated') : null),
            h('div', { class: 'a' }, u.email),
            u.role === 'agent' ? h('div', { class: 'chips' }, names.length ? names.map((n) => h('span', { class: 'tag' }, n)) : h('span', { class: 'muted small' }, 'Takes any topic')) : null,
            h('div', { class: 'muted small', style: 'margin-top:4px' }, `${u.open_tickets} open ${u.open_tickets === 1 ? 'request' : 'requests'}`)),
          u.role === 'agent' ? h('div', { class: 'row' },
            u.active ? h('button', { class: 'btn small', onclick: edit }, 'Edit') : null,
            h('button', { class: `btn small ${u.active ? 'danger' : ''}`, onclick: async () => {
              if (u.active && !confirm(`Deactivate ${u.name}? Their open requests move to other agents.`)) return;
              try { team = (await api('PATCH', `/api/team/${u.id}`, { active: !u.active })).team; draw(); toast(u.active ? 'Agent deactivated' : 'Agent reactivated'); } catch (x) { toast(x.message, 'bad'); }
            } }, u.active ? 'Deactivate' : 'Reactivate')) : null);
        const edit = () => {
          const name = h('input', { class: 'input', value: u.name, maxlength: 80 });
          const pw = h('input', { class: 'input', type: 'password', minlength: 8, autocomplete: 'new-password' });
          const checks = catChecks(u.category_ids);
          row.replaceChildren(h('div', { class: 'grow form-grid' }, field('Name', name), h('div', { class: 'field' }, h('span', { class: 'label' }, 'Topics they handle'), checks, h('div', { class: 'hint' }, 'Requests in these categories go to them first. Leave empty for any topic.')),
            field('New password (optional)', pw, 'At least 8 characters.'),
            h('div', { class: 'row' },
              h('button', { class: 'btn small primary', onclick: async () => { try { team = (await api('PATCH', `/api/team/${u.id}`, { name: name.value, category_ids: checks.values(), ...(pw.value ? { password: pw.value } : {}) })).team; draw(); toast('Saved', 'ok'); } catch (x) { toast(x.message, 'bad'); } } }, 'Save'),
              h('button', { class: 'btn small quiet', onclick: view }, 'Cancel'))));
        };
        view();
        return row;
      });
      const name = h('input', { class: 'input', required: true, maxlength: 80, autocomplete: 'off' });
      const email = h('input', { class: 'input', type: 'email', required: true, autocomplete: 'off' });
      const pw = h('input', { class: 'input', type: 'password', required: true, minlength: 8, autocomplete: 'new-password' });
      const checks = catChecks([]);
      const add = h('form', { class: 'form-grid', onsubmit: async (e) => {
        e.preventDefault();
        const btn = add.querySelector('button[type=submit]');
        try { await withBusy(btn, async () => { team = (await api('POST', '/api/team', { name: name.value, email: email.value, password: pw.value, category_ids: checks.values() })).team; toast('Agent added. Share their email and password with them.', 'ok'); draw(); }); } catch (x) { toast(x.message, 'bad'); }
      } },
        h('div', { class: 'form-grid two' }, field('Name', name), field('Email', email)),
        field('Temporary password', pw, 'At least 8 characters. They can ask you to change it later.'),
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'Topics they handle'), checks, h('div', { class: 'hint' }, 'Leave empty to let them take any topic.')),
        h('div', null, h('button', { class: 'btn primary', type: 'submit' }, 'Add agent')));
      listEl.replaceChildren(
        h('div', { class: 'panel' }, h('h2', null, 'Your team'), h('p', { class: 'sub' }, 'Agents only see the requests assigned to them. You see everything.'), h('div', { class: 'rows' }, rows)),
        h('div', { class: 'panel' }, h('h2', null, 'Add an agent'), h('p', { class: 'sub' }, 'New requests are matched to an agent by topic, then to whoever has the fewest open requests.'), add));
    }
    Promise.all([api('GET', '/api/team'), api('GET', '/api/categories')]).then(([t, c]) => { team = t.team; cats = c.categories; draw(); }).catch((e) => listEl.replaceChildren(errorBox(e.message, () => open('team'))));
    wrap.append(h('h1', { style: 'font-size:2rem;margin-bottom:14px' }, 'Team'), listEl);
    function open() { state.staffTab = 'team'; render(); }
    return wrap;
  }

  /* ------------------------------------------------------------- Setup view */
  function setupView() {
    const wrap = h('div', { class: 'stack' });
    const body = h('div', null, loading());
    let s = null;
    let cats = [];

    async function savePatch(patch, okMsg) {
      try {
        const d = await api('PATCH', '/api/settings', patch);
        state.business = d.business;
        s = { ...s, ...d.business };
        toast(okMsg || 'Saved', 'ok');
        return true;
      } catch (e) { toast(e.message, 'bad'); return false; }
    }

    function fieldBuilder(initial) {
      const list = h('div', { class: 'cat-fields' });
      const rows = [];
      const addRow = (f = { label: '', type: 'text', required: false }) => {
        const label = h('input', { class: 'input small', style: 'width:100%', value: f.label, maxlength: 60, placeholder: 'Field name, like Order number', 'aria-label': 'Field name' });
        const type = h('select', { class: 'select small', 'aria-label': 'Field type' }, h('option', { value: 'text', selected: f.type !== 'number' }, 'Text'), h('option', { value: 'number', selected: f.type === 'number' }, 'Number'));
        const req = h('input', { type: 'checkbox', checked: !!f.required });
        const row = h('div', { class: 'fieldrow' }, label, type, h('label', { class: 'row small' }, req, 'Required'),
          h('button', { class: 'btn small quiet', type: 'button', onclick: () => { rows.splice(rows.indexOf(entry), 1); row.remove(); } }, 'Remove'));
        const entry = { f, label, type, req };
        rows.push(entry);
        list.append(row);
      };
      (initial || []).forEach(addRow);
      const el = h('div', { class: 'stack' }, list, h('button', { class: 'btn small', type: 'button', onclick: () => addRow() }, 'Add a form field'));
      el.values = () => rows.filter((r) => r.label.value.trim()).map((r) => ({ key: r.f.key, label: r.label.value.trim(), type: r.type.value, required: r.req.checked }));
      return el;
    }

    function draw() {
      const url = `${location.origin}/b/${s.slug}`;

      const share = h('div', { class: 'panel' }, h('h2', null, 'Customer link'), h('p', { class: 'sub' }, 'Send this to customers. It opens your desk directly.'), copyLine(url));

      const name = h('input', { class: 'input', value: s.name, maxlength: 80 });
      const about = h('textarea', { class: 'textarea', maxlength: 4000, style: 'min-height:130px' }, s.about || '');
      const niche = h('select', { class: 'select' }, state.niches.map((n) => h('option', { value: n.key, selected: n.key === s.niche }, n.label)));
      const listed = h('input', { type: 'checkbox', checked: s.listed !== false });
      const business = h('div', { class: 'panel' }, h('h2', null, 'Your business'),
        h('p', { class: 'sub' }, 'The about text is read by your automated assistant when it answers.'),
        h('div', { class: 'form-grid' },
          field('Business name', name),
          field('About, vision and anything customers should know', about),
          h('label', { class: 'choice' }, listed,
            h('span', null, h('span', { class: 't' }, 'Show my desk in the public list'), h('br'), h('span', { class: 'd' }, 'Customers can find you by search and under your kind of service. Turn this off to be reachable only through your customer link.'))),
          h('div', null, h('button', { class: 'btn primary', onclick: (e) => withBusy(e.target, () => savePatch({ name: name.value, about: about.value, listed: listed.checked }).then(() => { draw(); })) }, 'Save')),
          h('div', { class: 'field' }, h('span', { class: 'label' }, 'Starting categories for your kind of business'), niche,
            h('div', { class: 'hint' }, 'Adds any categories from this template that you do not have yet. Nothing you already have is deleted.')),
          h('div', null, h('button', { class: 'btn', onclick: async (e) => withBusy(e.target, async () => {
            try { const r = await api('POST', '/api/categories/apply-niche', { niche: niche.value }); cats = r.categories; s.niche = niche.value; toast(r.added ? `Added ${r.added} categories` : 'You already have all of these', r.added ? 'ok' : ''); await refreshPublic(); draw(); } catch (x) { toast(x.message, 'bad'); }
          }) }, 'Add these categories'))));

      const botName = h('input', { class: 'input', value: s.bot_name, maxlength: 30 });
      const chips = h('div', { class: 'chips' }, state.botNames.map((n) => h('button', { class: 'btn small', type: 'button', onclick: () => { botName.value = n; } }, n)));
      const modes = h('div', { class: 'choices' },
        h('label', { class: 'choice' }, h('input', { type: 'radio', name: 'mode', value: 'bot_first', checked: s.automation_mode === 'bot_first' }),
          h('span', null, h('span', { class: 't' }, 'Assistant answers first'), h('br'), h('span', { class: 'd' }, 'It replies instantly from your FAQs and documents. Your team can take over any conversation without a break, and it hands over by itself when unsure.'))),
        h('label', { class: 'choice' }, h('input', { type: 'radio', name: 'mode', value: 'human', checked: s.automation_mode === 'human' }),
          h('span', null, h('span', { class: 't' }, 'People only'), h('br'), h('span', { class: 'd' }, 'Every request goes straight to an agent. No automated replies.'))));
      const assistant = h('div', { class: 'panel' }, h('h2', null, 'Automated assistant'),
        h('p', { class: 'sub' }, s.ai_enabled ? `AI replies are on (${s.ai_model}).` : 'No OPENROUTER_API_KEY is set, so it only answers when an FAQ closely matches.'),
        h('div', { class: 'form-grid' },
          field('Its name', botName, 'Customers see this name with an "Automated reply" label.'), chips, modes,
          h('div', null, h('button', { class: 'btn primary', onclick: (e) => withBusy(e.target, () => savePatch({ bot_name: botName.value, automation_mode: wrap.querySelector('input[name=mode]:checked').value }, 'Assistant settings saved')) }, 'Save'))));

      const inputs = {};
      const slaGrid = h('div', { class: 'sla-grid' }, ['urgent', 'high', 'normal', 'low'].map((p) => {
        inputs[p] = h('input', { class: 'input', type: 'number', min: 5, max: 120, value: s.sla_minutes[p] });
        return field(`${PRI_LABEL[p]} (minutes)`, inputs[p]);
      }));
      const sla = h('div', { class: 'panel' }, h('h2', null, 'Reply targets'),
        h('p', { class: 'sub' }, 'How fast a person should reply, by urgency. Customers never pick urgency: it is worked out from the category and the wording of the request, and your team can change it on any request. The longest allowed is 120 minutes.'),
        slaGrid,
        h('p', { class: 'muted small', style: 'margin-top:10px' }, 'At 75% of the target, an unanswered request moves from the assistant to an agent and your team is alerted. At the target it is flagged overdue. At 120 minutes that is 1h 30m.'),
        h('div', null, h('button', { class: 'btn primary', onclick: (e) => withBusy(e.target, () => savePatch({ sla: Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, Number(v.value)])) }, 'Reply targets saved')) }, 'Save targets')));

      const catPanel = h('div', { class: 'panel' }, h('h2', null, 'Categories'), h('p', { class: 'sub' }, 'What customers can pick when they send a request. Extra fields appear for that category only.'));
      const rows = h('div', { class: 'rows', style: 'margin-bottom:16px' }, cats.map((c) => {
        const row = h('div', { class: 'r' });
        const view = () => row.replaceChildren(
          h('div', { class: 'grow' }, h('div', { class: 'row' }, h('span', { class: 'q' }, c.name), !c.active ? h('span', { class: 'tag' }, 'Hidden') : null), h('div', { class: 'a' }, c.description),
            c.fields.length ? h('div', { class: 'chips' }, c.fields.map((f) => h('span', { class: 'tag' }, `${f.label}${f.required ? ' (required)' : ''}`))) : null),
          h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: edit }, 'Edit'),
            h('button', { class: 'btn small', onclick: async () => { try { cats = (await api('PATCH', `/api/categories/${c.id}`, { active: !c.active })).categories; await refreshPublic(); draw(); } catch (x) { toast(x.message, 'bad'); } } }, c.active ? 'Hide' : 'Show')));
        const edit = () => {
          const n = h('input', { class: 'input', value: c.name, maxlength: 60 });
          const d = h('input', { class: 'input', value: c.description, maxlength: 200 });
          const fb = fieldBuilder(c.fields);
          row.replaceChildren(h('div', { class: 'grow form-grid' }, field('Name', n), field('Description', d), h('div', { class: 'field' }, h('span', { class: 'label' }, 'Extra form fields'), fb),
            h('div', { class: 'row' },
              h('button', { class: 'btn small primary', onclick: async () => { try { cats = (await api('PATCH', `/api/categories/${c.id}`, { name: n.value, description: d.value, fields: fb.values() })).categories; await refreshPublic(); draw(); toast('Saved', 'ok'); } catch (x) { toast(x.message, 'bad'); } } }, 'Save'),
              h('button', { class: 'btn small quiet', onclick: view }, 'Cancel'))));
        };
        view();
        return row;
      }));
      const cn = h('input', { class: 'input', required: true, maxlength: 60 });
      const cd = h('input', { class: 'input', maxlength: 200 });
      const cf = fieldBuilder([]);
      const addCat = h('form', { class: 'form-grid', onsubmit: async (e) => {
        e.preventDefault();
        const btn = addCat.querySelector('button[type=submit]');
        try { await withBusy(btn, async () => { cats = (await api('POST', '/api/categories', { name: cn.value, description: cd.value, fields: cf.values() })).categories; await refreshPublic(); toast('Category added', 'ok'); draw(); }); } catch (x) { toast(x.message, 'bad'); }
      } }, h('h3', null, 'Add a category'), field('Name', cn), field('Description', cd), h('div', { class: 'field' }, h('span', { class: 'label' }, 'Extra form fields'), cf), h('div', null, h('button', { class: 'btn', type: 'submit' }, 'Add category')));
      catPanel.append(rows, addCat);

      const sample = JSON.stringify({ to: `${s.slug}@your-domain.com`, from: 'customer@example.com', from_name: 'Customer', subject: 'My order has not arrived', text: 'Hello, I ordered last week…' }, null, 2);
      const simName = h('input', { class: 'input', value: 'Sam Customer', maxlength: 80 });
      const simFrom = h('input', { class: 'input', type: 'email', value: 'sam@example.com', maxlength: 200 });
      const simSubject = h('input', { class: 'input', value: 'My order has not arrived', maxlength: 200 });
      const simText = h('textarea', { class: 'textarea' }, 'Hello, I ordered last week and it still has not arrived. Can you check where it is?');
      const simResult = h('div');
      const simulate = h('form', { class: 'form-grid', onsubmit: async (e) => {
        e.preventDefault();
        const btn = simulate.querySelector('button[type=submit]');
        try {
          await withBusy(btn, async () => {
            btn.textContent = 'Sending…';
            const r = await api('POST', '/api/simulate-email', { from: simFrom.value, from_name: simName.value, subject: simSubject.value, text: simText.value });
            toast(r.created ? `Ticket ${r.ticket_code} created from the test email` : `Added to ${r.ticket_code}`, 'ok');
            simResult.replaceChildren(h('div', { class: 'handler human' }, h('span', { class: 'grow' }, `${r.created ? 'Created' : 'Updated'} ${r.ticket_code}. It was assigned, given a priority and, if the assistant is on, answered like any other ticket.`),
              h('button', { class: 'btn small primary', type: 'button', onclick: async () => {
                try {
                  const d = await api('GET', `/api/tickets?status=all&q=${encodeURIComponent(r.ticket_code)}`);
                  if (d.tickets[0]) { state.openTicketId = d.tickets[0].id; state.staffTab = 'inbox'; render(); }
                } catch (x) { toast(x.message, 'bad'); }
              } }, 'Open ticket')));
          });
        } catch (x) { toast(x.message, 'bad'); }
      } },
        h('div', { class: 'form-grid two' }, field('From name', simName), field('From email', simFrom)),
        field('Subject', simSubject), field('Message', simText),
        h('div', null, h('button', { class: 'btn primary', type: 'submit' }, 'Simulate incoming email')));
      const email = h('div', { class: 'panel' }, h('h2', null, 'Email to ticket'),
        h('p', { class: 'sub' }, 'Each email becomes a request. Replies that keep the ticket code in the subject join the same conversation.'),
        h('div', { class: 'form-grid' },
          h('h3', null, 'Try it with a test email'),
          h('p', { class: 'muted small', style: 'margin:0' }, 'This sends a pretend email through the same path as the real webhook, so you can watch routing, priority and the assistant at work without connecting anything.'),
          simulate, simResult,
          h('details', null, h('summary', { style: 'cursor:pointer;font-weight:600' }, 'Connect a real email service'),
            h('div', { class: 'form-grid', style: 'margin-top:12px' },
              field('Webhook address (POST, JSON)', copyLine(`${location.origin}${s.inbound.endpoint}`)),
              field('Send this secret in the x-webhook-secret header', copyLine(s.inbound.secret)),
              h('div', { class: 'field' }, h('span', { class: 'label' }, 'Example body'), h('pre', { class: 'copyline', style: 'overflow:auto;margin:0' }, h('code', null, sample)),
                h('div', { class: 'hint' }, `Mail sent to ${s.slug}@ or support+${s.slug}@ on your domain is matched to this desk. Email providers that can post JSON work directly; others need a small relay that converts the email into this JSON.`))))));

      body.replaceChildren(share, business, assistant, sla, catPanel, email);
    }
    async function refreshPublic() {
      try { const d = await api('GET', '/api/me'); state.business = d.business; } catch { /* ignore */ }
    }
    Promise.all([api('GET', '/api/settings'), api('GET', '/api/categories'), state.niches ? null : ensureNiches()])
      .then(([sd, cd]) => { s = sd.settings; cats = cd.categories; if (!state.niches) throw new Error('Could not load templates'); draw(); })
      .catch((e) => body.replaceChildren(errorBox(e.message, () => render())));
    wrap.append(h('h1', { style: 'font-size:2rem;margin-bottom:6px' }, 'Setup'), body);
    return wrap;
  }

  /* ------------------------------------------------------------------- boot */
  render();
})();
