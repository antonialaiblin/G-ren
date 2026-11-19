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
  $('status').hidden = false;

  // Leiste unten (Übersicht / Kalender) gibt es erst, wenn man angemeldet ist und weiß, wer man ist
  const inside = !!(account && account.person);
  $('tabbar').hidden = !inside;
  document.body.classList.toggle('tabs', inside);
  showTab(inside && location.hash === '#kalender' ? 'cal' : 'home');
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
    // Alles klar: Umschlag öffnen
    const me = account.person;
    const first = !opened.has(me);
    $('auth').hidden = true;
    $('ready').hidden = false;
    $('ready-error').hidden = true;
    $('ready-title').textContent = `Hallo ${me}! 👋`;
    $('ready-hint').textContent = first
      ? 'Dein Umschlag wartet auf dich. Schau nach, wen du beschenkst!'
      : 'Du kannst deinen Brief jederzeit noch einmal öffnen und deine Wünsche ändern.';
    // Nächster Termin aus dem Kalender
    const today = isoDay(new Date());
    const next = (state.events || []).find(e => e.day >= today);
    $('next-ev').hidden = !next;
    if (next) {
      const [, mm, dd] = next.day.split('-').map(Number);
      $('next-ev').innerHTML = '📅 Nächster Termin: <b></b> <a href="#kalender">Kalender</a>';
      $('next-ev').querySelector('b').textContent = `${dd}.${mm}. ${next.title}`;
    }
    $('open-go').textContent = first ? 'Umschlag öffnen 💌' : 'Brief noch mal ansehen';
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
    for (const ev of events.filter(e => e.day === key)) {
      const p = document.createElement('span'); p.className = 'pill-ev'; p.textContent = ev.title; p.title = ev.title;
      cell.appendChild(p);
    }
    cell.onclick = () => openEventForm(key);
    grid.appendChild(cell);
  }
  // Liste der nächsten Termine
  const list = $('ev-list');
  list.innerHTML = '';
  const upcoming = events.filter(e => e.day >= today);
  for (const ev of upcoming) {
    const [yy, mm, dd] = ev.day.split('-').map(Number);
    const wd = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][new Date(yy, mm - 1, dd).getDay()];
    const li = document.createElement('li');
    li.innerHTML = '<span class="date"></span><span class="txt"><span class="t"></span><span class="by"></span></span>';
    li.querySelector('.date').textContent = `${wd}\n${dd}.${mm}.`;
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
}

function openEventForm(day) {
  $('ev-form').hidden = false;
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
    const r = await api('/api/events/add', { day: $('ev-day').value, title: $('ev-title').value });
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
