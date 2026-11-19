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
    $('open-go').textContent = first ? 'Umschlag öffnen 💌' : 'Brief noch mal ansehen';
  }
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
    const r = await api('/api/forgot', { username: name });
    t.textContent = (r.hint ? `Deine Merkhilfe: „${r.hint}“. ` : '')
      + 'Wenn du es trotzdem nicht mehr weißt, sag der Organisatorin Bescheid. Sie kann deinen Account zurücksetzen, deine Auslosung und Wünsche bleiben dabei erhalten.';
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
