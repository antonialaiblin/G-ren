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
  for (const s of ['auth-start', 'login-form', 'register-form', 'auth-pick', 'bday-form']) $(s).hidden = s !== id;
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
  // Erst rein, wenn man weiß, wer man ist, und den Geburtstag eingetragen hat
  const needBday = !!(account && account.person && !state.people?.[account.person]?.birthday);
  const inside = !!(account && account.person) && !needBday;
  // Wichteln gibt es bis einschließlich Friendsmas (12.12.), danach verschwindet der Brief
  const wichtelOn = inside && !(state.friendsmas && isoDay(new Date()) > state.friendsmas);
  const revealing = !$('reveal').hidden;
  $('status').hidden = !wichtelOn;
  $('foot').hidden = !wichtelOn;
  $('tabbar').hidden = !inside;
  $('settings').hidden = !inside;
  $('wichtel').hidden = !wichtelOn || revealing;
  $('polls-box').hidden = !inside || revealing;
  if (inside) { renderPolls(); renderForms(); }
  document.body.classList.toggle('tabs', inside);
  const tab = !inside ? 'home' : location.hash === '#kalender' ? 'cal' : location.hash === '#chat' ? 'chat' : location.hash === '#einstellungen' ? 'set' : 'home';
  showTab(tab);
  // Auf der Übersicht steht das große Logo, da braucht es die Kopfzeile nicht
  document.body.classList.toggle('home-in', inside);
  if (inside) { renderSettings(); renderChats(); }
  if (tab !== 'chat' && openChat) leaveChat();
  if (inside) renderCal();
  $('admin-box').hidden = !(inside && state.isAdmin);
  if (inside && state.isAdmin) loadAccounts();

  if (!$('reveal').hidden) return;

  if (!account) {
    // Nicht angemeldet: Willkommen, Anmelden oder Registrieren
    $('ready').hidden = true;
    $('auth').hidden = false;
    show(authView === 'login' ? 'login-form' : authView === 'register' ? 'register-form' : 'auth-start');
  } else if (needBday) {
    // Einmalig: Geburtstag eintragen
    $('ready').hidden = true;
    $('auth').hidden = false;
    show('bday-form');
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
    setAvatar($('hello-avatar'), me);
    $('hello-avatar').hidden = !state.people[me]?.avatar;
    $('addr-name').textContent = shown;
    $('addr-name2').textContent = shown;
    $('ready-hint').textContent = first
      ? 'Dein Brief ist da! Tipp drauf und schau, wen du beschenkst.'
      : 'Tipp auf den Brief, um ihn noch mal zu öffnen und deine Wünsche zu ändern.';
    $('open-go').classList.toggle('new', first);
    // Nächster Termin aus dem Kalender
    const today = isoDay(new Date());
    const next = allEvents().find(e => (e.end || e.day) >= today);
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
  $('tab-chat').hidden = name !== 'chat';
  $('tab-set').hidden = name !== 'set';
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

// Kalender-Termine plus Geburtstage (jedes Jahr wieder)
function allEvents() {
  const out = [...(state.events || [])];
  const years = new Set([new Date().getFullYear(), new Date().getFullYear() + 1, calMonth.getFullYear()]);
  const today = isoDay(new Date());
  const inAYear = isoDay(new Date(Date.now() + 365 * 86400000));
  for (const [person, p] of Object.entries(state.people || {})) {
    if (!p.birthday) continue;
    for (const y of years) {
      const day = `${y}-${p.birthday}`;
      if (y !== calMonth.getFullYear() && (day < today || day > inAYear)) continue;
      const age = p.year ? ` (${y - p.year})` : '';
      out.push({ id: `bday-${person}-${y}`, day, title: `🎂 ${p.display || person}${age}`, by: null, bday: true });
    }
  }
  const seen = new Set();
  return out.filter(e => !seen.has(e.id) && seen.add(e.id)).sort((a, b) => a.day.localeCompare(b.day));
}

function renderCal() {
  const events = allEvents();
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
      const p = document.createElement('span'); p.className = 'pill-ev' + (ev.bday ? ' bday' : ''); p.textContent = ev.title; p.title = ev.title;
      cell.appendChild(p);
    }
    cell.onclick = () => openEventForm(key);
    grid.appendChild(cell);
  }
  // Liste der nächsten Termine
  const list = $('ev-list');
  list.innerHTML = '';
  const inAYear = isoDay(new Date(Date.now() + 365 * 86400000));
  const upcoming = events.filter(e => (e.end || e.day) >= today && (!e.bday || e.day <= inAYear));
  for (const ev of upcoming) {
    const [yy, mm, dd] = ev.day.split('-').map(Number);
    const wd = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][new Date(yy, mm - 1, dd).getDay()];
    const li = document.createElement('li');
    li.innerHTML = '<span class="date"></span><span class="txt"><span class="t"></span><span class="by"></span></span>';
    li.querySelector('.date').textContent = ev.end ? `${dd}.${mm}.\nbis ${shortDay(ev.end)}` : `${wd}\n${dd}.${mm}.`;
    li.querySelector('.date').style.whiteSpace = 'pre-line';
    li.querySelector('.t').textContent = ev.title;
    li.querySelector('.by').textContent = ev.bday ? 'Geburtstag' : `eingetragen von ${ev.by}`;
    if (ev.bday) li.classList.add('bday');
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
  $('poll-empty').hidden = polls.length > 0 || (state.forms || []).length > 0;
}

// ---------- Fragebögen ----------
const QTYPES = [
  ['short', '✏️ Kurze Antwort'], ['long', '📄 Absatz'], ['single', '🔘 Eine Auswahl'], ['multi', '☑️ Mehrfachauswahl'],
  ['dropdown', '🔽 Dropdown'], ['scale', '⭐ Skala'], ['yesno', '👍 Ja / Nein'], ['date', '📅 Datum'],
];
const hasOpts = (t) => t === 'single' || t === 'multi' || t === 'dropdown';
let fq = [];                    // Fragen im Baukasten
const openForms = {};           // id -> 'fill' | 'results'

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

function newQ(type = 'single') { return { type, text: '', required: false, options: ['', ''], other: false, max: 5, low: '', high: '' }; }

function renderBuilder() {
  const box = $('fb-questions');
  box.innerHTML = '';
  fq.forEach((q, i) => {
    const card = el('div', 'q-card');
    const head = el('div', 'q-head');
    head.append(el('b', null, `Frage ${i + 1}`));
    const tools = el('div', 'q-tools');
    const tool = (label, title, fn, off) => { const b = el('button', 'ghost tiny', label); b.type = 'button'; b.title = title; b.setAttribute('aria-label', title); b.disabled = !!off; b.onclick = fn; tools.append(b); };
    tool('↑', 'Nach oben', () => { [fq[i - 1], fq[i]] = [fq[i], fq[i - 1]]; renderBuilder(); }, i === 0);
    tool('↓', 'Nach unten', () => { [fq[i + 1], fq[i]] = [fq[i], fq[i + 1]]; renderBuilder(); }, i === fq.length - 1);
    tool('⧉', 'Frage kopieren', () => { fq.splice(i + 1, 0, JSON.parse(JSON.stringify(q))); renderBuilder(); });
    tool('🗑', 'Frage löschen', () => { fq.splice(i, 1); renderBuilder(); }, fq.length === 1);
    head.append(tools);
    card.append(head);

    const text = el('input', 'q-text'); text.maxLength = 200; text.placeholder = 'Deine Frage'; text.value = q.text;
    text.oninput = () => { q.text = text.value; };
    card.append(text);

    const sel = el('select', 'q-type');
    for (const [v, label] of QTYPES) sel.add(new Option(label, v, false, v === q.type));
    sel.onchange = () => { q.type = sel.value; if (hasOpts(q.type) && q.options.length < 2) q.options = ['', '']; renderBuilder(); };
    card.append(sel);

    if (hasOpts(q.type)) {
      const list = el('div', 'q-opts');
      q.options.forEach((o, k) => {
        const row = el('div', 'q-opt');
        row.append(el('span', 'q-mark', q.type === 'multi' ? '☐' : q.type === 'dropdown' ? `${k + 1}.` : '○'));
        const inp = el('input'); inp.maxLength = 80; inp.placeholder = `Antwort ${k + 1}`; inp.value = o;
        inp.oninput = () => { q.options[k] = inp.value; };
        inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); q.options.push(''); renderBuilder(); focusLast(i); } };
        row.append(inp);
        if (q.options.length > 2) { const x = el('button', 'ghost tiny', '✕'); x.type = 'button'; x.setAttribute('aria-label', 'Antwort entfernen'); x.onclick = () => { q.options.splice(k, 1); renderBuilder(); }; row.append(x); }
        list.append(row);
      });
      const add = el('button', 'link', '+ Antwort hinzufügen'); add.type = 'button';
      add.onclick = () => { q.options.push(''); renderBuilder(); focusLast(i); };
      list.append(add);
      card.append(list);
      if (q.type !== 'dropdown') card.append(checkRow('„Sonstiges“ mit eigenem Text erlauben', q.other, v => { q.other = v; }));
    }
    if (q.type === 'scale') {
      const row = el('div', 'q-scale');
      const max = el('select');
      for (const n of [3, 5, 7, 10]) max.add(new Option(`1 bis ${n}`, n, false, n === q.max));
      max.onchange = () => { q.max = Number(max.value); };
      const low = el('input'); low.placeholder = 'Text bei 1 (optional)'; low.maxLength = 30; low.value = q.low; low.oninput = () => { q.low = low.value; };
      const high = el('input'); high.placeholder = 'Text beim Höchsten (optional)'; high.maxLength = 30; high.value = q.high; high.oninput = () => { q.high = high.value; };
      row.append(max, low, high);
      card.append(row);
    }
    card.append(checkRow('Pflichtfrage', q.required, v => { q.required = v; }));
    box.append(card);
  });
}
function focusLast(i) { const c = $('fb-questions').children[i]; const ins = c && c.querySelectorAll('.q-opt input'); if (ins && ins.length) ins[ins.length - 1].focus(); }
function checkRow(label, checked, onChange) {
  const l = el('label', 'check-row');
  const c = el('input'); c.type = 'checkbox'; c.checked = checked; c.onchange = () => onChange(c.checked);
  l.append(c, document.createTextNode(' ' + label));
  return l;
}

$('form-new').onclick = () => {
  $('poll-form').hidden = true;
  $('form-builder').hidden = false;
  $('fb-title').value = ''; $('fb-desc').value = ''; $('fb-anon').checked = false;
  fq = [newQ('single')];
  err('fb-error', '');
  renderBuilder();
  setTimeout(() => $('fb-title').focus(), 50);
};
$('fb-add').onclick = () => { fq.push(newQ('short')); renderBuilder(); const cards = $('fb-questions').children; cards[cards.length - 1].querySelector('.q-text').focus(); };
$('fb-cancel').onclick = () => { $('form-builder').hidden = true; };
$('form-builder').addEventListener('submit', async (e) => {
  e.preventDefault();
  err('fb-error', '');
  const questions = fq.map(q => ({ ...q, options: hasOpts(q.type) ? q.options.map(o => o.trim()).filter(Boolean) : undefined }));
  const btn = e.submitter; if (btn) btn.disabled = true;
  try {
    const r = await api('/api/forms/add', { title: $('fb-title').value, desc: $('fb-desc').value, anonymous: $('fb-anon').checked, questions });
    state.forms = r.forms;
    $('form-builder').hidden = true;
    renderForms(); renderPolls();
  } catch (e2) { err('fb-error', e2.message); }
  finally { if (btn) btn.disabled = false; }
});

function renderForms() {
  const me = account.person;
  const box = $('form-list');
  box.innerHTML = '';
  for (const f of state.forms || []) {
    const card = el('div', 'poll form-item' + (f.closed ? ' closed' : ''));
    const head = el('div', 'find-head');
    head.append(el('b', 't', `📝 ${f.title}`), el('span', 'by muted small', ` von ${displayName(f.by)}${f.anonymous ? ' · anonym' : ''}`));
    card.append(head);
    if (f.desc) card.append(el('p', 'muted small pre', f.desc));
    const missing = state.names.filter(n => !f.answered.includes(n));
    card.append(el('p', 'muted small', `${f.questions.length} ${f.questions.length === 1 ? 'Frage' : 'Fragen'} · ${f.answered.length} von ${state.names.length} haben geantwortet`
      + (missing.length && !f.closed ? ` · offen: ${missing.map(displayName).join(', ')}` : '') + (f.closed ? ' · beendet' : '')));

    const acts = el('div', 'row acts');
    const btn = (label, cls, fn) => { const b = el('button', cls, label); b.type = 'button'; b.onclick = fn; acts.append(b); return b; };
    const mode = openForms[f.id];
    if (!f.closed) btn(mode === 'fill' ? 'Schließen' : f.mine ? 'Antwort ändern' : 'Ausfüllen ✍️', mode === 'fill' ? 'ghost' : '', () => { openForms[f.id] = mode === 'fill' ? null : 'fill'; renderForms(); });
    if (f.canSee) btn(mode === 'results' ? 'Ergebnisse zu' : '📊 Ergebnisse', 'ghost', () => { openForms[f.id] = mode === 'results' ? null : 'results'; renderForms(); });
    if (f.by === me) {
      if (!f.closed) btn('Beenden', 'ghost', async () => { try { const r = await api('/api/forms/close', { id: f.id }); state.forms = r.forms; renderForms(); } catch (e2) { alert(e2.message); } });
      btn('Löschen', 'ghost', async () => {
        if (!confirm(`Fragebogen „${f.title}“ mit allen Antworten löschen?`)) return;
        try { const r = await api('/api/forms/delete', { id: f.id }); state.forms = r.forms; renderForms(); renderPolls(); } catch (e2) { alert(e2.message); }
      });
    }
    if (!f.canSee && !f.closed) card.append(el('p', 'muted small', 'Die Ergebnisse siehst du, sobald du selbst geantwortet hast.'));
    card.append(acts);
    if (mode === 'fill' && !f.closed) card.append(fillView(f));
    if (mode === 'results' && f.canSee) card.append(resultsView(f));
    box.append(card);
  }
}

function fillView(f) {
  const form = el('form', 'fill');
  form.noValidate = true;
  const mine = f.mine || {};
  const getters = {};
  f.questions.forEach((q, i) => {
    const wrap = el('fieldset', 'fq');
    const lg = el('legend', null, `${i + 1}. ${q.text}`);
    if (q.required) lg.append(el('span', 'req', ' *'));
    wrap.append(lg);
    const cur = mine[q.id];
    const name = `${f.id}-${q.id}`;
    if (q.type === 'short' || q.type === 'long' || q.type === 'date') {
      const inp = el(q.type === 'long' ? 'textarea' : 'input', 'fq-input');
      if (q.type === 'date') inp.type = 'date';
      if (q.type === 'long') inp.rows = 3;
      inp.maxLength = q.type === 'long' ? 2000 : 200;
      inp.placeholder = q.type === 'date' ? '' : 'Deine Antwort';
      inp.value = cur || '';
      wrap.append(inp);
      getters[q.id] = () => inp.value;
    } else if (q.type === 'dropdown') {
      const sel = el('select', 'fq-input');
      sel.add(new Option('Bitte wählen …', ''));
      for (const o of q.options) sel.add(new Option(o, o, false, o === cur));
      wrap.append(sel);
      getters[q.id] = () => sel.value;
    } else if (q.type === 'single' || q.type === 'multi' || q.type === 'yesno') {
      const opts = q.type === 'yesno' ? ['Ja', 'Nein'] : q.options;
      const multi = q.type === 'multi';
      const curArr = multi ? (cur || []) : [cur];
      const otherCur = curArr.find(x => typeof x === 'string' && x.startsWith('Sonstiges: '));
      const list = el('div', 'fq-opts' + (q.type === 'yesno' ? ' yn' : ''));
      const inputs = [];
      for (const o of opts) {
        const l = el('label', 'fq-opt');
        const c = el('input'); c.type = multi ? 'checkbox' : 'radio'; c.name = name; c.value = o; c.checked = curArr.includes(o);
        l.append(c, el('span', null, o));
        list.append(l); inputs.push(c);
      }
      let otherBox = null, otherText = null;
      if (q.other) {
        const l = el('label', 'fq-opt other');
        otherBox = el('input'); otherBox.type = multi ? 'checkbox' : 'radio'; otherBox.name = name; otherBox.checked = !!otherCur;
        otherText = el('input'); otherText.placeholder = 'Sonstiges …'; otherText.maxLength = 180; otherText.value = otherCur ? otherCur.slice(11) : '';
        otherText.oninput = () => { if (otherText.value) otherBox.checked = true; };
        l.append(otherBox, otherText);
        list.append(l);
      }
      wrap.append(list);
      getters[q.id] = () => {
        const picked = inputs.filter(c => c.checked).map(c => c.value);
        if (otherBox && otherBox.checked && otherText.value.trim()) picked.push(`Sonstiges: ${otherText.value.trim()}`);
        return multi ? picked : (picked[0] || '');
      };
    } else if (q.type === 'scale') {
      const row = el('div', 'fq-scale');
      let val = cur || null;
      const btns = [];
      for (let n = 1; n <= q.max; n++) {
        const b = el('button', 'scale-btn' + (n === val ? ' on' : ''), n); b.type = 'button';
        b.onclick = () => { val = val === n ? null : n; btns.forEach((x, k) => x.classList.toggle('on', k + 1 === val)); };
        btns.push(b); row.append(b);
      }
      wrap.append(row);
      if (q.low || q.high) { const lab = el('div', 'fq-scale-lab small muted'); lab.append(el('span', null, q.low), el('span', null, q.high)); wrap.append(lab); }
      getters[q.id] = () => val;
    }
    form.append(wrap);
  });
  const e = el('p', 'error'); e.hidden = true;
  const row = el('div', 'row end');
  const send = el('button', null, f.mine ? 'Antwort speichern' : 'Abschicken'); send.type = 'submit';
  row.append(send);
  form.append(e, row);
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    e.hidden = true;
    const answers = {};
    for (const [id, get] of Object.entries(getters)) answers[id] = get();
    send.disabled = true;
    try {
      const r = await api('/api/forms/answer', { id: f.id, answers });
      state.forms = r.forms;
      openForms[f.id] = 'results';
      renderForms();
    } catch (e2) { e.textContent = e2.message; e.hidden = false; send.disabled = false; }
  };
  return form;
}

function resultsView(f) {
  const box = el('div', 'results');
  if (!f.responses.length) { box.append(el('p', 'muted small', 'Noch keine Antworten.')); return box; }
  f.questions.forEach((q, i) => {
    const sec = el('div', 'res-q');
    sec.append(el('b', null, `${i + 1}. ${q.text}`));
    const answers = f.responses.map(x => ({ who: x.who, v: x.r[q.id] })).filter(x => x.v !== undefined && x.v !== '' && x.v !== null);
    sec.append(el('span', 'muted small', ` · ${answers.length} ${answers.length === 1 ? 'Antwort' : 'Antworten'}`));
    if (['single', 'multi', 'dropdown', 'yesno', 'scale'].includes(q.type)) {
      const labels = q.type === 'yesno' ? ['Ja', 'Nein'] : q.type === 'scale' ? Array.from({ length: q.max }, (_, k) => String(k + 1)) : [...q.options];
      const counts = new Map(labels.map(l => [l, []]));
      for (const a of answers) for (const v of (Array.isArray(a.v) ? a.v : [a.v])) {
        const key = String(v);
        if (!counts.has(key)) counts.set(key, []);
        counts.get(key).push(a.who);
      }
      const maxN = Math.max(1, ...[...counts.values()].map(x => x.length));
      const list = el('div', 'res-bars');
      for (const [label, whos] of counts) {
        const row = el('div', 'res-bar');
        const bar = el('span', 'bar'); bar.style.width = `${whos.length / maxN * 100}%`;
        row.append(bar, el('span', 'lbl', label), el('span', 'n', whos.length));
        list.append(row);
        if (whos.length && !f.anonymous) list.append(el('span', 'who small muted', whos.map(displayName).join(', ')));
      }
      sec.append(list);
      if (q.type === 'scale' && answers.length) {
        const avg = answers.reduce((s, a) => s + a.v, 0) / answers.length;
        sec.append(el('p', 'small', `Durchschnitt: ${avg.toLocaleString('de-DE', { maximumFractionDigits: 1 })} von ${q.max}`
          + (q.low || q.high ? ` (1 = ${q.low || '…'}, ${q.max} = ${q.high || '…'})` : '')));
      }
    } else {
      const ul = el('ul', 'res-text');
      for (const a of answers) {
        const li = el('li');
        if (!f.anonymous) li.append(el('b', null, `${displayName(a.who)}: `));
        li.append(document.createTextNode(q.type === 'date' ? shortDay(a.v) + a.v.slice(0, 4) : a.v));
        ul.append(li);
      }
      sec.append(ul);
    }
    box.append(sec);
  });
  return box;
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
  $('form-builder').hidden = true;
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

// ---------- Profilbilder ----------
const avatarCache = {};   // person -> { v, url }
function initials(name) { return (name || '?').trim().slice(0, 1).toUpperCase(); }
function setAvatar(el, person) {
  const p = state.people?.[person] || {};
  el.textContent = '';
  el.style.backgroundImage = '';
  el.dataset.person = person;
  const c = avatarCache[person];
  if (p.avatar && c && c.v === p.avatar && c.url) { el.style.backgroundImage = `url("${c.url}")`; return; }
  el.textContent = initials(p.display || person);
  if (!p.avatar) return;
  if (!c || c.v !== p.avatar) {
    avatarCache[person] = { v: p.avatar, url: null };
    api('/api/avatar', { person }).then(r => {
      if (!r.image) return;
      avatarCache[person].url = r.image;
      document.querySelectorAll(`.avatar[data-person="${CSS.escape(person)}"]`).forEach(x => { x.textContent = ''; x.style.backgroundImage = `url("${r.image}")`; });
    }).catch(() => { delete avatarCache[person]; });
  }
}
const displayName = (person) => state.people?.[person]?.display || person;

// Bild verkleinern (quadratisch, 256 px), damit es schnell lädt
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const size = 256, c = document.createElement('canvas');
      c.width = c.height = size;
      const k = Math.min(img.width, img.height);
      c.getContext('2d').drawImage(img, (img.width - k) / 2, (img.height - k) / 2, k, k, 0, 0, size, size);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => reject(new Error('Das Bild konnte nicht gelesen werden.'));
    img.src = URL.createObjectURL(file);
  });
}
$('avatar-file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  err('avatar-error', '');
  try {
    const image = await shrinkImage(f);
    const r = await api('/api/me/avatar', { image });
    state.people = r.people;
    avatarCache[account.person] = { v: r.people[account.person].avatar, url: image };
    render();
  } catch (e2) { err('avatar-error', e2.message); }
});
$('avatar-del').onclick = async () => {
  try { const r = await api('/api/me/avatar', { image: null }); state.people = r.people; delete avatarCache[account.person]; render(); }
  catch (e2) { err('avatar-error', e2.message); }
};

// ---------- Geburtstag ----------
function fillBdaySelects(dId, mId) {
  const d = $(dId), m = $(mId);
  if (d.options.length) return;
  d.add(new Option('Tag', ''));
  for (let i = 1; i <= 31; i++) d.add(new Option(i, pad(i)));
  m.add(new Option('Monat', ''));
  MONTHS.forEach((name, i) => m.add(new Option(name, pad(i + 1))));
}
fillBdaySelects('bday-d', 'bday-m');
fillBdaySelects('bday-d2', 'bday-m2');
async function saveBday(d, m, y, errId) {
  err(errId, '');
  if (!d || !m) { err(errId, 'Bitte Tag und Monat wählen.'); return false; }
  try {
    const r = await api('/api/me/profile', { birthday: `${m}-${d}`, year: y.trim() || null });
    state.people = r.people;
    return true;
  } catch (e2) { err(errId, e2.message); return false; }
}
$('bday-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (await saveBday($('bday-d').value, $('bday-m').value, $('bday-y').value, 'bday-error')) render();
});
$('bday-set-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('bday2-ok').textContent = '';
  if (await saveBday($('bday-d2').value, $('bday-m2').value, $('bday-y2').value, 'bday2-error')) {
    render();
    $('bday2-ok').textContent = 'Gespeichert ✓';
  }
});
$('bday-set-form').closest('details').addEventListener('toggle', (e) => {
  if (!e.target.open) return;
  const p = state.people[account.person] || {};
  const [mm, dd] = (p.birthday || '-').split('-');
  $('bday-d2').value = dd || ''; $('bday-m2').value = mm || ''; $('bday-y2').value = p.year || '';
  $('bday2-ok').textContent = '';
});

// ---------- Einstellungen ----------
function renderSettings() {
  const meP = state.people?.[account.person] || {};
  setAvatar($('me-avatar'), account.person);
  $('me-name').textContent = meP.display || account.person;
  $('avatar-del').hidden = !meP.avatar;
  if (meP.birthday) {
    const [mm, dd] = meP.birthday.split('-').map(Number);
    $('set-bday-now').textContent = `(${dd}. ${MONTHS[mm - 1]})`;
  }
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
    if (state.people[account.person]) state.people[account.person].display = r.account.display;
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
      $('push-note').textContent = 'An ✓ Du bekommst eine Nachricht, bei neuen Chat-Nachrichten, Terminen und Umfragen.';
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

// ---------- Chat ----------
let openChat = null;        // id des offenen Chats
let chatMsgs = [];
let pollTimer = null;
const readKey = (id) => `goeren-read-${account?.person}-${id}`;
const lastRead = (id) => Number(store.get(readKey(id)) || 0);

function renderChats() {
  const chats = state.chats || [];
  // Ungelesen-Zähler unten in der Leiste
  const unread = chats.filter(c => c.last && c.last.from !== account.person && c.last.at > lastRead(c.id)).length;
  $('chat-badge').hidden = !unread;
  $('chat-badge').textContent = unread;
  const list = $('chat-list');
  list.innerHTML = '';
  for (const c of chats) {
    const li = document.createElement('li');
    const isNew = c.last && c.last.from !== account.person && c.last.at > lastRead(c.id);
    li.innerHTML = '<button type="button"><span class="c-name"></span><span class="c-last small muted"></span><span class="c-time small muted"></span></button>';
    li.querySelector('.c-name').textContent = c.name;
    li.querySelector('.c-last').textContent = c.last
      ? `${c.last.from === account.person ? 'Du' : displayName(c.last.from)}: ${c.last.text}`
      : c.id === 'all' ? 'Alle Gören' : c.members.map(displayName).join(', ');
    li.querySelector('.c-time').textContent = c.last ? timeLabel(c.last.at) : '';
    if (isNew) li.classList.add('new');
    li.querySelector('button').onclick = () => enterChat(c.id);
    list.appendChild(li);
  }
  if (openChat && !chats.some(c => c.id === openChat)) leaveChat();
}

function timeLabel(at) {
  const d = new Date(at), now = new Date();
  const hm = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  if (isoDay(d) === isoDay(now)) return hm;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (isoDay(d) === isoDay(y)) return `gestern ${hm}`;
  return `${d.getDate()}.${d.getMonth() + 1}. ${hm}`;
}

async function enterChat(id) {
  const c = state.chats.find(x => x.id === id);
  if (!c) return;
  openChat = id;
  chatMsgs = [];
  $('chat-home').hidden = true;
  $('chat-room').hidden = false;
  document.body.classList.add('in-room');
  $('room-name').textContent = c.name;
  $('room-members').textContent = c.members.map(displayName).join(', ');
  $('room-del').hidden = !(c.by === account.person && c.id !== 'all');
  $('msgs').innerHTML = '<p class="muted small center">Lädt …</p>';
  await fetchMsgs(true);
  startPolling();
}

function leaveChat() {
  openChat = null;
  stopPolling();
  $('chat-home').hidden = false;
  $('chat-room').hidden = true;
  document.body.classList.remove('in-room');
  if (state) renderChats();
}

async function fetchMsgs(first = false) {
  if (!openChat) return;
  const id = openChat;
  try {
    const since = chatMsgs.length ? chatMsgs[chatMsgs.length - 1].at : 0;
    const r = await api('/api/chat/messages', { chat: id, since });
    if (id !== openChat) return;
    state.chats = r.chats;
    const known = new Set(chatMsgs.map(m => m.id));
    const fresh = r.messages.filter(m => !known.has(m.id));
    if (first || fresh.length) {
      chatMsgs.push(...fresh);
      drawMsgs(first);
    }
    if (chatMsgs.length) store.set(readKey(id), chatMsgs[chatMsgs.length - 1].at);
    renderChats();
  } catch (e2) {
    if (first) $('msgs').innerHTML = '';
  }
}

function drawMsgs(jump) {
  const box = $('msgs');
  const nearBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 120;
  box.innerHTML = '';
  if (!chatMsgs.length) box.innerHTML = '<p class="muted small center">Noch keine Nachrichten. Schreib die erste!</p>';
  let lastDay = '', lastFrom = '';
  for (const m of chatMsgs) {
    const day = isoDay(new Date(m.at));
    if (day !== lastDay) {
      const d = document.createElement('p'); d.className = 'day-sep small muted';
      const [y, mo, dd] = day.split('-').map(Number);
      d.textContent = day === isoDay(new Date()) ? 'Heute' : `${dd}. ${MONTHS[mo - 1]}${y !== new Date().getFullYear() ? ' ' + y : ''}`;
      box.appendChild(d);
      lastDay = day; lastFrom = '';
    }
    const mine = m.from === account.person;
    const row = document.createElement('div');
    row.className = 'msg' + (mine ? ' mine' : '') + (m.from === lastFrom ? ' cont' : '');
    row.innerHTML = '<span class="avatar"></span><div class="bubble"><span class="from small"></span><span class="txt"></span><span class="t small"></span></div>';
    setAvatar(row.querySelector('.avatar'), m.from);
    row.querySelector('.from').textContent = displayName(m.from);
    row.querySelector('.txt').textContent = m.text;
    row.querySelector('.t').textContent = new Date(m.at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    box.appendChild(row);
    lastFrom = m.from;
  }
  if (jump || nearBottom) window.scrollTo(0, document.body.scrollHeight);
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => { if (!document.hidden) fetchMsgs(); }, 4000);
}
function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }
// Chat-Liste ab und zu auffrischen, damit der Zähler unten stimmt
setInterval(async () => {
  if (document.hidden || !account?.person || openChat) return;
  try { const r = await api('/api/state'); state.chats = r.chats; state.people = r.people; renderChats(); } catch {}
}, 30000);

$('room-back').onclick = leaveChat;
$('room-del').onclick = async () => {
  const c = state.chats.find(x => x.id === openChat);
  if (!c || !confirm(`Chat „${c.name}“ mit allen Nachrichten löschen?`)) return;
  try { const r = await api('/api/chats/delete', { chat: c.id }); state.chats = r.chats; leaveChat(); } catch (e2) { alert(e2.message); }
};
$('composer').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('msg-text').value.trim();
  if (!text || !openChat) return;
  const btn = e.submitter; if (btn) btn.disabled = true;
  try {
    const r = await api('/api/chat/send', { chat: openChat, text });
    $('msg-text').value = '';
    $('msg-text').style.height = '';
    if (!chatMsgs.some(m => m.id === r.message.id)) chatMsgs.push(r.message);
    store.set(readKey(openChat), r.message.at);
    drawMsgs(true);
  } catch (e2) { alert(e2.message); }
  finally { if (btn) btn.disabled = false; $('msg-text').focus(); }
});
// Enter schickt ab (am Computer), Umschalt+Enter macht eine neue Zeile
$('msg-text').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); $('composer').requestSubmit(); }
});
$('msg-text').addEventListener('input', (e) => {
  e.target.style.height = '';
  e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px';
});

// Neuer Chat
$('chat-new').onclick = () => {
  $('chat-form').hidden = false;
  $('chat-name').value = '';
  err('chat-error', '');
  const box = $('chat-members');
  box.innerHTML = '';
  for (const n of state.names) {
    if (n === account.person) continue;
    const l = document.createElement('label');
    l.innerHTML = '<input type="checkbox" checked><span class="avatar"></span><span class="nm"></span>';
    l.querySelector('input').value = n;
    setAvatar(l.querySelector('.avatar'), n);
    l.querySelector('.nm').textContent = displayName(n);
    box.appendChild(l);
  }
  // Schnell-Knöpfe: Geschenk-Chat für die nächsten Geburtstage
  const hint = $('chat-bday-hint');
  hint.innerHTML = '';
  const today = isoDay(new Date());
  const soon = allEvents().filter(e => e.bday && e.day >= today).slice(0, 3);
  const others = state.names.filter(n => n !== account.person);
  for (const ev of soon) {
    const person = ev.id.split('-').slice(1, -1).join('-');
    if (!others.includes(person)) continue;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip';
    b.textContent = `🎁 Geschenk für ${displayName(person)}`;
    b.onclick = () => {
      $('chat-name').value = `Geschenk für ${displayName(person)} 🎁`;
      box.querySelectorAll('input').forEach(i => { i.checked = i.value !== person; });
    };
    hint.appendChild(b);
  }
};
$('chat-cancel').onclick = () => { $('chat-form').hidden = true; };
$('chat-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  err('chat-error', '');
  const members = [...$('chat-members').querySelectorAll('input:checked')].map(i => i.value);
  try {
    const r = await api('/api/chats/add', { name: $('chat-name').value, members });
    state.chats = r.chats;
    $('chat-form').hidden = true;
    renderChats();
    enterChat(r.id);
  } catch (e2) { err('chat-error', e2.message); }
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
  $('wichtel').hidden = true;
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
