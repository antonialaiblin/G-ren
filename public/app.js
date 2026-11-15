const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};

let state = null;
let me = store.get('wichtel-name');

async function api(path, body) {
  const res = await fetch(path, body
    ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
    : { cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Etwas ist schiefgelaufen.');
  return data;
}

async function load() {
  try {
    state = await api('/api/state');
    $('load-error').hidden = true;
  } catch {
    $('load-error').hidden = false;
    return;
  }
  if (me && !state.names.includes(me)) { me = null; store.set('wichtel-name', null); }
  render();
}

function render() {
  const opened = new Set(state.opened);
  const box = $('people');
  box.innerHTML = '';
  for (const name of state.names) {
    const b = document.createElement('button');
    b.type = 'button';
    if (opened.has(name)) b.className = 'done';
    b.innerHTML = '<span class="nm"></span>' + (opened.has(name) ? '<span class="seen">✓ hat geschaut</span>' : '');
    b.querySelector('.nm').textContent = name;
    b.onclick = () => choose(name);
    box.appendChild(b);
  }
  const n = opened.size, total = state.names.length;
  $('bar').style.width = (n / total * 100) + '%';
  $('status-line').textContent = n === total
    ? 'Alle haben ihren Wichtel gesehen. Frohes Shoppen!'
    : `${n} von ${total} haben schon nachgeschaut. Noch offen: ${state.names.filter(x => !opened.has(x)).join(', ')}.`;
  $('status').hidden = false;

  if ($('reveal').hidden) {
    if (me) showPin(me); else { $('pick').hidden = false; $('pin-form').hidden = true; }
  }
}

function choose(name) {
  me = name;
  store.set('wichtel-name', name);
  showPin(name);
}

function showPin(name) {
  const first = !state.opened.includes(name);
  $('pick').hidden = true;
  $('pin-form').hidden = false;
  $('pin-error').hidden = true;
  $('pin').value = '';
  $('pin-title').textContent = `Hallo ${name}! 👋`;
  $('pin-hint').textContent = first
    ? 'Du bist zum ersten Mal hier. Denk dir eine 4-stellige PIN aus und merk sie dir gut. Damit kannst nur du deinen Brief wieder öffnen.'
    : 'Gib deine PIN ein, um deinen Brief noch einmal zu öffnen.';
  $('pin-go').textContent = first ? 'PIN festlegen und öffnen' : 'Umschlag öffnen';
  setTimeout(() => $('pin').focus(), 50);
}

$('pin').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4); });

$('pin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pin = $('pin').value;
  if (!/^\d{4}$/.test(pin)) { showError('Die PIN hat genau 4 Ziffern.'); return; }
  $('pin-go').disabled = true;
  try {
    const r = await api('/api/reveal', { name: me, pin });
    reveal(r);
    if (r.first) state.opened.push(me);
    render();
  } catch (err) {
    showError(err.message);
  } finally {
    $('pin-go').disabled = false;
  }
});

function showError(msg) { $('pin-error').textContent = msg; $('pin-error').hidden = false; }

$('pin-back').onclick = () => {
  me = null; store.set('wichtel-name', null);
  $('pin-form').hidden = true; $('pick').hidden = false;
};

function reveal(r) {
  $('pin-form').hidden = true;
  $('pick').hidden = true;
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
  $('reveal-note').textContent = r.first
    ? 'Deine PIN ist gespeichert. Mit ihr kannst du jederzeit wieder nachschauen.'
    : '';
  const env = $('envelope');
  env.classList.remove('open');
  requestAnimationFrame(() => requestAnimationFrame(() => env.classList.add('open')));
  window.scrollTo(0, 0);
}

$('logout').onclick = () => {
  $('reveal').hidden = true;
  $('envelope').classList.remove('open');
  me = null; store.set('wichtel-name', null);
  render();
};

load();
