const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};

let state = null;
let token = store.get('goeren-session');   // Anmelde-Sitzung, bleibt auf dem Handy gespeichert
let account = null;                         // { username, person }
let authView = 'start';                     // start | login | register

async function api(path, body) {
  const headers = token ? { 'x-session': token } : {};
  const res = await fetch(path, body
    ? { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) }
    : { cache: 'no-store', headers });
  const data = await res.json().catch(() => ({}));
  if (data.auth) { setSession(null); }
  if (!res.ok) throw new Error(data.error || 'Etwas ist schiefgelaufen.');
  return data;
}

function setSession(t, acc = null) {
  token = t;
  account = t ? acc : null;
  store.set('goeren-session', t);
}

async function load() {
  try {
    state = await api('/api/state');
    $('load-error').hidden = true;
  } catch {
    $('load-error').hidden = false;
    return;
  }
  account = state.account;
  if (!account && token) setSession(null);
  render();
}

// ---------- Anzeige ----------
function show(id) {
  for (const s of ['auth-start', 'login-form', 'register-form', 'auth-pick']) $(s).hidden = s !== id;
}

function render() {
  const opened = new Set(state.opened);
  const claimed = new Set(state.claimed);

  // Fortschritt: wer hat schon nachgeschaut?
  const n = opened.size, total = state.names.length;
  $('bar').style.width = (n / total * 100) + '%';
  $('status-line').textContent = n === total
    ? 'Alle haben ihren Wichtel gesehen. Frohes Shoppen!'
    : `${n} von ${total} haben schon nachgeschaut. Noch offen: ${state.names.filter(x => !opened.has(x)).join(', ')}.`;
  // Leiste unten (Übersicht / Kalender) gibt es erst, wenn man angemeldet ist und weiß, wer man ist
  const inside = !!(account && account.person);
  // Wichteln gibt es bis einschließlich Friendsmas (12.12.), danach verschwindet der Brief
  const wichtelOn = inside && !(state.friendsmas && isoDay(new Date()) > state.friendsmas);
  const revealing = !$('reveal').hidden;
  $('status').hidden = !wichtelOn;
  $('foot').hidden = !wichtelOn;
  $('tabbar').hidden = !inside;
  $('settings').hidden = !inside || revealing;
  $('wichtel').hidden = !wichtelOn || revealing;
  $('polls-box').hidden = !inside || revealing;
  if (inside) renderPolls();
  document.body.classList.toggle('tabs', inside);
  const tab = inside && location.hash === '#kalender' ? 'cal' : 'home';
  showTab(tab);
  // Auf der Übersicht steht das große Logo, da braucht es die Kopfzeile nicht
  document.body.classList.toggle('home-in', inside && tab === 'home');
  if (inside) renderSettings();
  if (inside) renderCal();
  $('admin-box').hidden = !(inside && state.isAdmin);
  if (inside && state.isAdmin) loadAccounts();

  if (!$('reveal').hidden) return;

  if (!account) {
    // Nicht angemeldet: Willkommen, Anmelden oder Registrieren
    $('ready').hidden = true;
    $('auth').hidden = false;
    show(authView === 'login' ? 'login-form' : authView === 'register' ? 'register-form' : 'auth-start');
  } else if (!account.person) {
    // Angemeldet, aber noch keine Person gewählt
    $('ready').hidden = true;
    $('auth').hidden = false;
    show('auth-pick');
    const box = $('people');
    box.innerHTML = '';
    for (const name of state.names) {
      const b = document.createElement('button');
      b.type = 'button';
      const taken = claimed.has(name);
      if (taken) { b.className = 'taken'; b.disabled = true; }
      b.innerHTML = '<span class="nm"></span>' + (taken ? '<span class="seen">vergeben</span>' : '');
      b.querySelector('.nm').textContent = name;
      b.onclick = () => claim(name);
      box.appendChild(b);
    }
  } else {
    // Alles klar: Übersicht
    const me = account.person;
    const first = !opened.has(me);
    const shown = account.display || me;
    $('auth').hidden = true;
    $('ready').hidden = false;
    $('ready-error').hidden = true;
    $('ready-title').textContent = `Hallo ${shown}! 👋`;
    $('addr-name').textContent = shown;
    $('addr-name2').textContent = shown;
    $('ready-hint').textContent = first
      ? 'Dein Brief ist da! Tipp drauf und schau, wen du beschenkst.'
      : 'Tipp auf den Brief, um ihn noch mal zu öffnen und deine Wünsche zu ändern.';
    $('open-go').classList.toggle('new', first);
    // Nächster Termin aus dem Kalender
    const today = isoDay(new Date());
    const next = (state.events || []).find(e => (e.end || e.day) >= today);
    const waiting = (state.finds || []).filter(f => !f.done && !f.answers[me]).length;
    $('find-hint').hidden = !waiting;
    if (waiting) {
      $('find-hint').innerHTML = '🗳️ <b></b> <a href="#kalender">Abstimmen</a>';
      $('find-hint').querySelector('b').textContent = waiting === 1
        ? 'Eine Terminabstimmung wartet auf dich.' : `${waiting} Terminabstimmungen warten auf dich.`;
    }
    $('next-ev').hidden = !next;
    if (next) {
      const [, mm, dd] = next.day.split('-').map(Number);
      $('next-ev').innerHTML = '📅 Nächster Termin: <b></b> <a href="#kalender">Kalender</a>';
      $('next-ev').querySelector('b').textContent = `${dd}.${mm}. ${next.title}`;
    }
  }
}

// ---------- Seiten (Tabs) ----------
function showTab(name) {
  $('tab-home').hidden = name !== 'home';
  $('tab-cal').hidden = name !== 'cal';
  document.querySelectorAll('.tabbar a').forEach(a => a.classList.toggle('active', a.dataset.tab === name));
}
window.addEventListener('hashchange', () => { if (state) { render(); window.scrollTo(0, 0); } });

// ---------- Accounts verwalten (nur Admin) ----------
async function loadAccounts(r) {
  try { r = r || await api('/api/admin/accounts', {}); } catch (e2) { err('admin-error', e2.message); return; }
  err('admin-error', '');
  const list = $('acct-list');
  list.innerHTML = '';
  for (const a of r.accounts) {
    const li = document.createElement('li');
    li.innerHTML = '<div><span class="who"></span> <span class="user"></span></div>'
      + '<form class="pw-row"><input type="text" minlength="4" maxlength="100" placeholder="Neues Passwort" autocomplete="off" required>'
      + '<button type="submit">Setzen</button></form>';
    li.querySelector('.who').textContent = a.person || 'noch niemand gewählt';
    li.querySelector('.user').textContent = `Benutzername: ${a.username}`;
    if (a.forgot) {
      const f = document.createElement('span'); f.className = 'flag'; f.textContent = 'Passwort vergessen';
      li.querySelector('div').appendChild(f);
    }
    const form = li.querySelector('form');
    form.onsubmit = async (e) => {
      e.preventDefault();
      const pw = form.querySelector('input').value;
      try {
        const r2 = await api('/api/admin/password', { key: a.key, password: pw });
        await loadAccounts(r2);
        const okLi = [...$('acct-list').children].find(x => x.dataset.key === a.key);
        if (okLi) {
          const ok = document.createElement('p'); ok.className = 'ok';
          ok.textContent = `✓ Neues Passwort gesetzt. Sag ${a.person || a.username}: „${pw}“`;
          okLi.appendChild(ok);
        }
      } catch (e2) { err('admin-error', e2.message); }
    };
    li.dataset.key = a.key;
    list.appendChild(li);
  }
}

// ---------- Kalender ----------
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const pad = (n) => String(n).padStart(2, '0');
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
let calMonth = new Date(); calMonth.setDate(1);

function renderCal() {
  const events = state.events || [];
  const y = calMonth.getFullYear(), m = calMonth.getMonth();
  $('cal-title').textContent = `${MONTHS[m]} ${y}`;
  const grid = $('cal-grid');
  grid.innerHTML = '';
  for (const d of ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']) {
    const el = document.createElement('div'); el.className = 'dow'; el.textContent = d; grid.appendChild(el);
  }
  // Start am Montag vor dem 1. des Monats
  const start = new Date(y, m, 1);
  start.setDate(1 - ((start.getDay() + 6) % 7));
  const today = isoDay(new Date());
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    if (i >= 35 && d.getMonth() !== m) break;
    const key = isoDay(d);
    const cell = document.createElement('div');
    cell.className = 'day' + (d.getMonth() !== m ? ' out' : '') + (key === today ? ' today' : '');
    cell.innerHTML = '<span class="n"></span>';
    cell.querySelector('.n').textContent = d.getDate();
    for (const ev of events.filter(e => e.day <= key && key <= (e.end || e.day))) {
      const p = document.createElement('span'); p.className = 'pill-ev'; p.textContent = ev.title; p.title = ev.title;
      cell.appendChild(p);
    }
    cell.onclick = () => openEventForm(key);
    grid.appendChild(cell);
  }
  // Liste der nächsten Termine
  const list = $('ev-list');
  list.innerHTML = '';
  const upcoming = events.filter(e => (e.end || e.day) >= today);
  for (const ev of upcoming) {
    const [yy, mm, dd] = ev.day.split('-').map(Number);
    const wd = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][new Date(yy, mm - 1, dd).getDay()];
    const li = document.createElement('li');
    li.innerHTML = '<span class="date"></span><span class="txt"><span class="t"></span><span class="by"></span></span>';
    li.querySelector('.date').textContent = ev.end ? `${dd}.${mm}.\nbis ${shortDay(ev.end)}` : `${wd}\n${dd}.${mm}.`;
    li.querySelector('.date').style.whiteSpace = 'pre-line';
    li.querySelector('.t').textContent = ev.title;
    li.querySelector('.by').textContent = `eingetragen von ${ev.by}`;
    if (ev.by === account.person) {
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'del'; del.textContent = '✕'; del.setAttribute('aria-label', 'Termin löschen');
      del.onclick = () => deleteEvent(ev.id);
      li.appendChild(del);
    }
    list.appendChild(li);
  }
  $('ev-empty').hidden = upcoming.length > 0;
  renderFinds();
}

const shortDay = (iso) => { const [, m, d] = iso.split('-').map(Number); return `${d}.${m}.`; };
const rangeText = (o) => {
  const [y, m, d] = o.day.split('-').map(Number);
  const wd = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][new Date(y, m - 1, d).getDay()];
  return o.end && o.end !== o.day ? `${shortDay(o.day)} bis ${shortDay(o.end)}` : `${wd} ${shortDay(o.day)}`;
};

// ---------- „Wann könnt ihr?“ ----------
const draftPicks = {};   // noch nicht abgeschickte Kreuzchen, pro Abstimmung

function renderFinds() {
  const me = account.person;
  const finds = state.finds || [];
  $('finds-box').hidden = !finds.length;
  const box = $('find-list');
  box.innerHTML = '';
  for (const f of finds) {
    const el = document.createElement('div');
    el.className = 'find' + (f.done ? ' done' : '');
    const missing = state.names.filter(n => !f.answers[n]);
    const picks = draftPicks[f.id] || f.answers[me] || [];
    el.innerHTML = '<div class="find-head"><b class="t"></b><span class="by muted small"></span></div><ul class="opts"></ul><p class="muted small status"></p><div class="row end acts"></div>';
    el.querySelector('.t').textContent = f.title;
    el.querySelector('.by').textContent = ` von ${f.by}`;
    const ul = el.querySelector('.opts');
    f.options.forEach((o, i) => {
      const yes = state.names.filter(n => (f.answers[n] || []).includes(i));
      const li = document.createElement('li');
      li.innerHTML = '<label><input type="checkbox"><span class="when"></span><span class="who small muted"></span></label>';
      const cb = li.querySelector('input');
      cb.checked = picks.includes(i);
      cb.disabled = !!f.done;
      cb.onchange = () => {
        const cur = new Set(draftPicks[f.id] || f.answers[me] || []);
        cb.checked ? cur.add(i) : cur.delete(i);
        draftPicks[f.id] = [...cur];
      };
      li.querySelector('.when').textContent = rangeText(o);
      li.querySelector('.who').textContent = yes.length ? `✓ ${yes.join(', ')}` : '';
      if (f.done && f.done.option === i) li.classList.add('win');
      if (yes.length === state.names.length) li.classList.add('all');
      ul.appendChild(li);
    });
    el.querySelector('.status').textContent = f.done
      ? `🎉 Alle können am ${rangeText(f.options[f.done.option])} Das steht jetzt im Kalender!`
      : missing.length
        ? `Noch nicht abgestimmt: ${missing.join(', ')}.`
        : 'Alle haben abgestimmt, aber es gibt keinen Termin, an dem alle können. Schlagt neue Termine vor.';
    const acts = el.querySelector('.acts');
    if (!f.done) {
      const send = document.createElement('button');
      send.type = 'button';
      send.textContent = f.answers[me] ? 'Antwort ändern' : 'Abschicken';
      send.onclick = async () => {
        send.disabled = true;
        try {
          const r = await api('/api/finds/answer', { id: f.id, picks: draftPicks[f.id] || f.answers[me] || [] });
          delete draftPicks[f.id];
          state.finds = r.finds; state.events = r.events;
          renderCal(); render();
        } catch (e2) { alert(e2.message); send.disabled = false; }
      };
      acts.appendChild(send);
    }
    if (f.by === me) {
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'ghost'; del.textContent = 'Löschen';
      del.onclick = async () => {
        if (!confirm(`„${f.title}“ wirklich löschen?`)) return;
        try { const r = await api('/api/finds/delete', { id: f.id }); state.finds = r.finds; renderCal(); render(); } catch (e2) { alert(e2.message); }
      };
      acts.appendChild(del);
    }
    box.appendChild(el);
  }
}

// ---------- Umfragen ----------
let pollMode = 'choice';

function renderPolls() {
  const me = account.person;
  const polls = state.polls || [];
  const box = $('poll-list');
  box.innerHTML = '';
  for (const p of polls) {
    const el = document.createElement('div');
    el.className = 'poll' + (p.closed ? ' closed' : '');
    el.innerHTML = '<div class="find-head"><b class="t"></b><span class="by muted small"></span></div><ul class="opts"></ul><form class="idea-row" hidden><input maxlength="80" placeholder="Deine Idee …" required><button type="submit">+</button></form><p class="muted small status"></p><div class="row end acts"></div>';
    el.querySelector('.t').textContent = p.q;
    el.querySelector('.by').textContent = ` von ${p.by}${p.ideas ? ' · Ideen erwünscht' : ''}`;
    const total = p.options.reduce((n, o) => n + o.votes.length, 0);
    const max = Math.max(0, ...p.options.map(o => o.votes.length));
    const ul = el.querySelector('.opts');
    for (const o of p.options) {
      const li = document.createElement('li');
      const mine = o.votes.includes(me);
      li.innerHTML = '<button type="button" class="vote"><span class="bar"></span><span class="txt"></span><span class="n"></span></button><span class="who small muted"></span>';
      const b = li.querySelector('.vote');
      b.classList.toggle('mine', mine);
      b.classList.toggle('top', !!p.closed && max > 0 && o.votes.length === max);
      b.disabled = !!p.closed;
      li.querySelector('.bar').style.width = total ? `${o.votes.length / total * 100}%` : '0';
      li.querySelector('.txt').textContent = (mine ? '✓ ' : '') + o.t;
      li.querySelector('.n').textContent = o.votes.length || '';
      li.querySelector('.who').textContent = o.votes.length ? o.votes.join(', ') + (p.ideas && o.by ? ` · Idee von ${o.by}` : '') : (p.ideas ? `Idee von ${o.by}` : '');
      b.onclick = async () => {
        try { const r = await api('/api/polls/vote', { id: p.id, option: o.id }); state.polls = r.polls; renderPolls(); } catch (e2) { alert(e2.message); }
      };
      ul.appendChild(li);
    }
    const form = el.querySelector('.idea-row');
    form.hidden = !p.ideas || !!p.closed;
    form.onsubmit = async (e) => {
      e.preventDefault();
      try { const r = await api('/api/polls/idea', { id: p.id, text: form.querySelector('input').value }); state.polls = r.polls; renderPolls(); } catch (e2) { alert(e2.message); }
    };
    const voted = state.names.filter(n => p.options.some(o => o.votes.includes(n)));
    el.querySelector('.status').textContent = p.closed
      ? 'Beendet.'
      : !p.options.length ? 'Noch keine Ideen. Schreib die erste rein!'
      : `${voted.length} von ${state.names.length} haben abgestimmt. Tipp auf eine Antwort, um zu wählen.`;
    if (p.by === me) {
      const acts = el.querySelector('.acts');
      if (!p.closed) {
        const c = document.createElement('button');
        c.type = 'button'; c.className = 'ghost'; c.textContent = 'Beenden';
        c.onclick = async () => { try { const r = await api('/api/polls/close', { id: p.id }); state.polls = r.polls; renderPolls(); } catch (e2) { alert(e2.message); } };
        acts.appendChild(c);
      }
      const d = document.createElement('button');
      d.type = 'button'; d.className = 'ghost'; d.textContent = 'Löschen';
      d.onclick = async () => {
        if (!confirm('Umfrage wirklich löschen?')) return;
        try { const r = await api('/api/polls/delete', { id: p.id }); state.polls = r.polls; renderPolls(); } catch (e2) { alert(e2.message); }
      };
      acts.appendChild(d);
    }
    box.appendChild(el);
  }
  $('poll-empty').hidden = polls.length > 0;
}

function addOptInput(boxId, type, placeholder) {
  const wrap = document.createElement('div');
  wrap.className = type === 'date' ? 'two-col opt' : 'opt';
  if (type === 'date') {
    wrap.innerHTML = '<label class="field"><span>Von</span><input type="date" class="o-day"></label><label class="field"><span>Bis (optional)</span><input type="date" class="o-end"></label>';
  } else {
    wrap.innerHTML = '<label class="field"><input class="o-t" maxlength="80"></label>';
    wrap.querySelector('input').placeholder = placeholder;
  }
  $(boxId).appendChild(wrap);
}

function setPollMode(mode) {
  pollMode = mode;
  document.querySelectorAll('[data-poll-mode]').forEach(b => { const on = b.dataset.pollMode === mode; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
  $('poll-ideas-note').hidden = mode !== 'ideas';
}
document.querySelectorAll('[data-poll-mode]').forEach(b => b.onclick = () => setPollMode(b.dataset.pollMode));

$('poll-new').onclick = () => {
  $('poll-form').hidden = false;
  $('poll-q').value = '';
  $('poll-opts').innerHTML = '';
  setPollMode('choice');
  ['z. B. Pasta', 'z. B. Curry', 'z. B. Pizza bestellen'].forEach(ph => addOptInput('poll-opts', 'text', ph));
  err('poll-error', '');
  setTimeout(() => $('poll-q').focus(), 50);
};
$('poll-add-opt').onclick = () => addOptInput('poll-opts', 'text', 'Noch ein Vorschlag');
$('poll-cancel').onclick = () => { $('poll-form').hidden = true; };
$('poll-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  err('poll-error', '');
  const options = [...$('poll-opts').querySelectorAll('.o-t')].map(i => i.value.trim()).filter(Boolean);
  try {
    const r = await api('/api/polls/add', { question: $('poll-q').value, ideas: pollMode === 'ideas', options });
    state.polls = r.polls;
    $('poll-form').hidden = true;
    renderPolls();
  } catch (e2) { err('poll-error', e2.message); }
});

let evMode = 'fixed';
function setEvMode(mode) {
  evMode = mode;
  document.querySelectorAll('[data-ev-mode]').forEach(b => { const on = b.dataset.evMode === mode; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
  $('ev-fixed').hidden = mode !== 'fixed';
  $('ev-find').hidden = mode !== 'find';
  $('ev-day').required = mode === 'fixed';
  if (mode === 'find' && !$('find-opts').children.length) { addOptInput('find-opts', 'date'); addOptInput('find-opts', 'date'); }
}
document.querySelectorAll('[data-ev-mode]').forEach(b => b.onclick = () => setEvMode(b.dataset.evMode));
$('find-add-opt').onclick = () => addOptInput('find-opts', 'date');

function openEventForm(day) {
  $('ev-form').hidden = false;
  $('find-opts').innerHTML = '';
  setEvMode('fixed');
  $('ev-end').value = '';
  $('ev-day').value = day || isoDay(new Date());
  $('ev-title').value = '';
  err('ev-error', '');
  $('ev-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => $('ev-title').focus({ preventScroll: true }), 300);
}

$('cal-prev').onclick = () => { calMonth.setMonth(calMonth.getMonth() - 1); renderCal(); };
$('cal-next').onclick = () => { calMonth.setMonth(calMonth.getMonth() + 1); renderCal(); };
$('ev-open').onclick = () => openEventForm();
$('ev-cancel').onclick = () => { $('ev-form').hidden = true; };

$('ev-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  err('ev-error', '');
  const btn = e.submitter; if (btn) btn.disabled = true;
  try {
    if (evMode === 'find') {
      const options = [...$('find-opts').querySelectorAll('.opt')]
        .map(o => ({ day: o.querySelector('.o-day').value, end: o.querySelector('.o-end').value || o.querySelector('.o-day').value }))
        .filter(o => o.day);
      const r = await api('/api/finds/add', { title: $('ev-title').value, options });
      state.finds = r.finds;
      $('ev-form').hidden = true;
      renderCal();
      $('finds-box').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const r = await api('/api/events/add', { day: $('ev-day').value, end: $('ev-end').value, title: $('ev-title').value });
    state.events = r.events;
    $('ev-form').hidden = true;
    const [yy, mm] = $('ev-day').value.split('-').map(Number);
    calMonth = new Date(yy, mm - 1, 1);
    renderCal();
  } catch (e2) { err('ev-error', e2.message); }
  finally { if (btn) btn.disabled = false; }
});

async function deleteEvent(id) {
  try {
    const r = await api('/api/events/delete', { id });
    state.events = r.events;
    renderCal();
  } catch (e2) { /* Liste neu laden, falls sich etwas geändert hat */ await load(); }
}

function err(id, msg) { $(id).textContent = msg; $(id).hidden = !msg; }

// ---------- Einstellungen ----------
function renderSettings() {
  const shown = account.display || account.person;
  $('set-name-now').textContent = `(${shown})`;
  $('set-username').textContent = account.username;
  const choice = window.goerenTheme.getChoice();
  document.querySelectorAll('[data-theme-choice]').forEach(b => {
    const on = b.dataset.themeChoice === choice;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', on);
  });
  const { rise, set } = window.goerenTheme.sunTimes(new Date());
  const hm = (d) => d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
  $('theme-note').textContent = choice === 'auto'
    ? `Hell ab Sonnenaufgang (heute ${hm(rise)} Uhr), dunkel ab Sonnenuntergang (${hm(set)} Uhr).`
    : choice === 'dark' ? 'Die App ist immer dunkel.' : 'Die App ist immer hell.';
}

document.querySelectorAll('[data-theme-choice]').forEach(b => b.onclick = () => {
  window.goerenTheme.set(b.dataset.themeChoice);
  renderSettings();
});

$('name-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  err('name-error', ''); $('name-ok').textContent = '';
  try {
    const r = await api('/api/me/name', { name: $('set-name').value });
    account = r.account; state.account = r.account;
    render();
    $('name-ok').textContent = 'Gespeichert ✓';
  } catch (e2) { err('name-error', e2.message); }
});
$('name-form').closest('details').addEventListener('toggle', (e) => {
  if (e.target.open) { $('set-name').value = account.display || account.person; $('name-ok').textContent = ''; }
});

$('pw-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  err('pw-error', ''); $('pw-ok').textContent = '';
  if ($('pw-new').value !== $('pw-new2').value) { err('pw-error', 'Die beiden neuen Passwörter sind nicht gleich.'); return; }
  try {
    await api('/api/me/password', { old: $('pw-old').value, password: $('pw-new').value });
    for (const id of ['pw-old', 'pw-new', 'pw-new2']) $(id).value = '';
    $('pw-ok').textContent = 'Neues Passwort gespeichert ✓';
  } catch (e2) { err('pw-error', e2.message); }
});

// Benachrichtigungen (Web Push)
const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent);
const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const b64ToBytes = (b64) => {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - b64.length % 4) % 4));
  return Uint8Array.from(s, c => c.charCodeAt(0));
};
let swReg = null;

async function initPush() {
  const t = $('push-toggle');
  if (!pushSupported) {
    t.disabled = true;
    $('push-note').textContent = isIos && !standalone
      ? 'Auf dem iPhone geht das nur, wenn du die App auf den Home-Bildschirm legst (Teilen → „Zum Home-Bildschirm“) und sie von dort öffnest.'
      : 'Dieser Browser kann leider keine Benachrichtigungen empfangen.';
    return;
  }
  try {
    swReg = await navigator.serviceWorker.register('/sw.js');
    const sub = await swReg.pushManager.getSubscription();
    t.checked = !!sub && Notification.permission === 'granted';
  } catch { t.disabled = true; }
}

$('push-toggle').addEventListener('change', async (e) => {
  const t = e.target;
  t.disabled = true;
  try {
    if (t.checked) {
      if (await Notification.requestPermission() !== 'granted') {
        t.checked = false;
        $('push-note').textContent = 'Du hast Benachrichtigungen nicht erlaubt. Du kannst das in den Einstellungen deines Handys ändern.';
        return;
      }
      const { key } = await api('/api/push/key', {});
      swReg = swReg || await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const sub = await swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
      await api('/api/push/subscribe', { subscription: sub.toJSON() });
      $('push-note').textContent = 'An ✓ Du bekommst eine Nachricht, wenn jemand einen Termin einträgt.';
    } else {
      const sub = swReg && await swReg.pushManager.getSubscription();
      if (sub) {
        await api('/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
        await sub.unsubscribe();
      }
      $('push-note').textContent = 'Aus. Du bekommst keine Nachrichten mehr.';
    }
  } catch (e2) {
    t.checked = !t.checked;
    $('push-note').textContent = e2.message || 'Das hat leider nicht geklappt.';
  } finally { t.disabled = false; }
});

// ---------- Anmelden / Registrieren ----------
$('go-login').onclick = () => { authView = 'login'; render(); setTimeout(() => $('login-user').focus(), 50); };
$('go-register').onclick = () => { authView = 'register'; render(); setTimeout(() => $('reg-user').focus(), 50); };
document.querySelectorAll('[data-auth-back]').forEach(b => b.onclick = () => {
  authView = 'start'; err('login-error', ''); err('reg-error', ''); $('forgot-text').hidden = true; render();
});

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  err('login-error', '');
  const btn = e.submitter; if (btn) btn.disabled = true;
  try {
    const r = await api('/api/login', { username: $('login-user').value, password: $('login-pw').value });
    setSession(r.token, r.account);
    $('login-pw').value = '';
    authView = 'start';
    await load();
  } catch (e2) {
    err('login-error', e2.message);
  } finally { if (btn) btn.disabled = false; }
});

$('auth-forgot').onclick = async () => {
  const name = $('login-user').value.trim();
  const t = $('forgot-text');
  if (!name) { t.textContent = 'Gib oben zuerst deinen Namen ein.'; t.hidden = false; return; }
  try {
    const r = await api('/api/forgot', { username: name, notify: true });
    t.textContent = (r.hint ? `Deine Merkhilfe: „${r.hint}“. ` : '')
      + `Wenn du es trotzdem nicht mehr weißt: ${r.admin} sieht jetzt, dass du ein neues Passwort brauchst, und kann dir eins geben. Deine Auslosung und Wünsche bleiben erhalten.`;
  } catch (e2) { t.textContent = e2.message; }
  t.hidden = false;
};

$('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  err('reg-error', '');
  if ($('reg-pw').value !== $('reg-pw2').value) { err('reg-error', 'Die beiden Passwörter sind nicht gleich.'); return; }
  const btn = e.submitter; if (btn) btn.disabled = true;
  try {
    const r = await api('/api/register', { username: $('reg-user').value, password: $('reg-pw').value, hint: $('reg-hint').value });
    setSession(r.token, r.account);
    for (const id of ['reg-user', 'reg-pw', 'reg-pw2', 'reg-hint']) $(id).value = '';
    authView = 'start';
    await load();
  } catch (e2) {
    err('reg-error', e2.message);
  } finally { if (btn) btn.disabled = false; }
});

async function claim(name) {
  err('pick-error', '');
  try {
    const r = await api('/api/claim', { person: name });
    account = r.account;
    await load();
  } catch (e2) { err('pick-error', e2.message); await load(); }
}

document.querySelectorAll('[data-logout]').forEach(b => b.onclick = async () => {
  // Wer sich abmeldet, bekommt auf diesem Gerät keine Benachrichtigungen mehr
  try {
    const sub = swReg && await swReg.pushManager.getSubscription();
    if (sub) { await api('/api/push/unsubscribe', { endpoint: sub.endpoint }); await sub.unsubscribe(); }
    $('push-toggle').checked = false;
  } catch {}
  try { await api('/api/logout', {}); } catch {}
  setSession(null);
  authView = 'start';
  render();
});

// ---------- Umschlag ----------
$('open-go').onclick = async () => {
  $('open-go').disabled = true;
  try {
    const r = await api('/api/reveal', {});
    reveal(r);
    if (r.first) state.opened.push(account.person);
    render();
  } catch (e2) {
    err('ready-error', e2.message);
    if (!account) render();
  } finally { $('open-go').disabled = false; }
};

function reveal(r) {
  $('auth').hidden = true;
  $('ready').hidden = true;
  $('settings').hidden = true;
  $('wichtel').hidden = true;
  document.body.classList.remove('home-in');
  $('reveal').hidden = false;
  $('who').textContent = r.to;
  const pills = $('pills');
  pills.innerHTML = '';
  const add = (label, value) => {
    if (!value) return;
    const s = document.createElement('span');
    s.className = 'pill';
    s.innerHTML = label + ': <b></b>';
    s.querySelector('b').textContent = value;
    pills.appendChild(s);
  };
  add('Größe', r.size);
  add('Budget', r.budget);
  add('Bescherung', r.bescherung);
  $('reveal-note').textContent = '';
  // Wünsche der gezogenen Person
  $('their-title').textContent = `${r.to}s Wünsche`;
  const dl = $('their-wishes');
  dl.innerHTML = '';
  const tw = r.theirWishes || {};
  for (const [k, label] of [['farbe', 'Farben'], ['schnitt', 'Schnitt'], ['sonst', 'Sonstiges']]) {
    if (!tw[k]) continue;
    const dt = document.createElement('dt'); dt.textContent = label;
    const dd = document.createElement('dd'); dd.textContent = tw[k];
    dl.append(dt, dd);
  }
  $('their-empty').hidden = dl.children.length > 0;
  $('their-empty').textContent = `${r.to} hat noch keine Wünsche eingetragen. Schau später noch mal rein.`;
  // Eigene Wünsche
  const mine = r.mine || {};
  $('w-farbe').value = mine.farbe || '';
  $('w-schnitt').value = mine.schnitt || '';
  $('w-sonst').value = mine.sonst || '';
  $('wish-status').textContent = '';

  const env = $('envelope');
  env.classList.remove('open');
  requestAnimationFrame(() => requestAnimationFrame(() => env.classList.add('open')));
  window.scrollTo(0, 0);
}

$('wish-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('wish-save').disabled = true;
  $('wish-status').textContent = '';
  try {
    await api('/api/wishes', { wishes: {
      farbe: $('w-farbe').value, schnitt: $('w-schnitt').value, sonst: $('w-sonst').value,
    } });
    $('wish-status').textContent = 'Gespeichert ✓';
  } catch (err) {
    $('wish-status').textContent = err.message;
  } finally {
    $('wish-save').disabled = false;
  }
});

$('close-reveal').onclick = () => {
  $('reveal').hidden = true;
  $('envelope').classList.remove('open');
  render();
  window.scrollTo(0, 0);
};

load();
initPush();
