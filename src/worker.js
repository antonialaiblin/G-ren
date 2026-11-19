import { DurableObject } from 'cloudflare:workers';
import { PEOPLE, BUDGET, BESCHERUNG, ROUND, RESET } from './config.js';
import { draw, hashPin } from './draw.js';
import { pwHash, hashPw, pwOk, newToken, cleanUsername } from './auth.js';

const MAX_TRIES = 5;          // falsche Passwörter, bevor gesperrt wird
const LOCK_MS = 10 * 60_000;  // 10 Minuten Sperre

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

export class Wichtel extends DurableObject {
  async load() {
    let s = await this.ctx.storage.get('state');
    let changed = false;
    const names = PEOPLE.map(p => p.name);
    const sameNames = s && s.names && s.names.join('|') === names.join('|');
    if (!s || s.round !== ROUND || !sameNames) {
      // Neue Runde: neu auslosen. Accounts bleiben erhalten, nur Brief-Status und Wünsche starten neu.
      s = {
        round: ROUND, names, pairs: draw(names), pins: {}, opened: {}, wishes: {},
        accounts: s?.accounts || {}, sessions: s?.sessions || {}, fails: {}, resets: s?.resets || {},
      };
      changed = true;
    }
    s.accounts ||= {};
    s.sessions ||= {};
    s.fails ||= {};
    s.wishes ||= {};
    s.resets ||= {};
    // Account einer Person zurücksetzen (Passwort vergessen): Zahl in RESET in config.js erhöhen
    for (const [person, n] of Object.entries(RESET || {})) {
      if ((s.resets[person] || 0) >= n) continue;
      for (const [key, a] of Object.entries(s.accounts)) {
        if (a.person !== person) continue;
        delete s.accounts[key];
        for (const [t, sess] of Object.entries(s.sessions)) if (sess.user === key) delete s.sessions[t];
      }
      delete s.pins[person];
      s.resets[person] = n;
      changed = true;
    }
    if (changed) await this.ctx.storage.put('state', s);
    return s;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const s = await this.load();
    const save = () => this.ctx.storage.put('state', s);

    // Wer ist angemeldet?
    const token = request.headers.get('x-session') || '';
    const sess = /^[0-9a-f]{48}$/.test(token) ? s.sessions[token] : null;
    const acct = sess ? s.accounts[sess.user] : null;
    const me = acct?.person && s.names.includes(acct.person) ? acct.person : null;
    const claimed = () => new Set(Object.values(s.accounts).map(a => a.person).filter(p => s.names.includes(p)));
    const findAcct = (name) => {
      const n = String(name || '').trim().toLowerCase();
      return s.accounts[n] || Object.values(s.accounts).find(a => a.person?.toLowerCase() === n) || null;
    };
    const startSession = (key) => {
      const t = newToken();
      s.sessions[t] = { user: key, at: Date.now() };
      return t;
    };
    const accountInfo = (a) => a ? { username: a.username, person: a.person && s.names.includes(a.person) ? a.person : null } : null;

    if (path === '/api/state' && request.method === 'GET') {
      return json({
        names: s.names,
        opened: Object.keys(s.opened),
        claimed: [...claimed()],
        account: accountInfo(acct),
        budget: BUDGET,
        bescherung: BESCHERUNG,
      });
    }

    if (request.method !== 'POST') return json({ error: 'Nicht gefunden.' }, 404);
    let body;
    try { body = await request.json(); } catch { return json({ error: 'Ungültige Anfrage.' }, 400); }

    // ---------- Registrieren ----------
    if (path === '/api/register') {
      const username = cleanUsername(body.username);
      if (username.length < 2) return json({ error: 'Bitte einen Namen mit mindestens 2 Zeichen angeben.' }, 400);
      if (!pwOk(body.password)) return json({ error: 'Das Passwort braucht mindestens 4 Zeichen.' }, 400);
      const key = username.toLowerCase();
      const takenPerson = Object.values(s.accounts).some(a => a.person?.toLowerCase() === key);
      if (s.accounts[key] || takenPerson) return json({ error: 'Diesen Namen gibt es schon. Bitte einen anderen wählen.' }, 400);
      const hint = typeof body.hint === 'string' ? body.hint.trim().slice(0, 100) : '';
      s.accounts[key] = { username, ...(await hashPw(body.password)), person: null, hint: hint || null, at: Date.now() };
      const t = startSession(key);
      await save();
      return json({ token: t, account: accountInfo(s.accounts[key]) });
    }

    // ---------- Anmelden ----------
    if (path === '/api/login') {
      const name = String(body.username || '').trim().toLowerCase();
      const f = s.fails[name] || { n: 0, until: 0 };
      if (f.until > Date.now()) {
        const min = Math.ceil((f.until - Date.now()) / 60_000);
        return json({ error: `Zu viele falsche Versuche. Probier es in ${min} Min. noch mal.` }, 429);
      }
      let a = findAcct(name);
      // Wer schon mit der alten PIN geschaut hat: Name + alte PIN funktioniert einmal als Passwort
      const legacy = !a && s.names.find(p => p.toLowerCase() === name);
      if (legacy && s.pins[legacy] && !claimed().has(legacy) && /^\d{4}$/.test(String(body.password))
          && (await hashPin(s.round, legacy, String(body.password))) === s.pins[legacy]) {
        a = { username: legacy, ...(await hashPw(String(body.password))), person: legacy, hint: null, at: Date.now() };
        s.accounts[legacy.toLowerCase()] = a;
        delete s.pins[legacy];
      }
      if (!a || typeof body.password !== 'string' || (await pwHash(body.password, a.salt)) !== a.hash) {
        f.n += 1;
        if (f.n >= MAX_TRIES) { f.n = 0; f.until = Date.now() + LOCK_MS; }
        s.fails[name] = f;
        await save();
        return json({ error: 'Name oder Passwort stimmt nicht.' }, 401);
      }
      delete s.fails[name];
      const t = startSession(a.username.toLowerCase());
      await save();
      return json({ token: t, account: accountInfo(a) });
    }

    // ---------- Passwort vergessen: Merkhilfe zeigen ----------
    if (path === '/api/forgot') {
      const a = findAcct(body.username);
      return json({ hint: a?.hint || null });
    }

    // Ab hier muss man angemeldet sein
    if (!acct) return json({ error: 'Bitte melde dich an.', auth: true }, 401);

    if (path === '/api/logout') {
      delete s.sessions[token];
      await save();
      return json({ ok: true });
    }

    // ---------- Person wählen ("Wer bist du?") ----------
    if (path === '/api/claim') {
      if (me) return json({ error: 'Dein Account ist schon mit einer Person verbunden.' }, 400);
      if (!s.names.includes(body.person)) return json({ error: 'Diesen Namen gibt es nicht.' }, 404);
      if (claimed().has(body.person)) return json({ error: `${body.person} ist schon mit einem anderen Account verbunden.` }, 400);
      if (s.pins[body.person]) return json({ error: `${body.person} hat schon mit einer PIN geschaut. Bitte melde dich mit deinem Namen und der alten PIN als Passwort an.` }, 400);
      acct.person = body.person;
      await save();
      return json({ ok: true, account: accountInfo(acct) });
    }

    if (!me) return json({ error: 'Bitte wähl zuerst aus, wer du bist.' }, 403);

    // ---------- Umschlag öffnen ----------
    if (path === '/api/reveal') {
      const first = !s.opened[me];
      if (first) s.opened[me] = Date.now();
      await save();
      const to = s.pairs[me];
      const person = PEOPLE.find(p => p.name === to);
      return json({
        first, to,
        size: person ? person.size : '',
        theirWishes: s.wishes[to] || null,
        mine: s.wishes[me] || null,
        budget: BUDGET, bescherung: BESCHERUNG,
      });
    }

    // ---------- Eigene Wünsche speichern ----------
    if (path === '/api/wishes') {
      if (!s.opened[me]) return json({ error: 'Bitte zuerst den Umschlag öffnen.' }, 403);
      const w = body.wishes || {};
      const clean = (v) => String(v || '').trim().slice(0, 300);
      s.wishes[me] = { farbe: clean(w.farbe), schnitt: clean(w.schnitt), sonst: clean(w.sonst), at: Date.now() };
      await save();
      return json({ ok: true, mine: s.wishes[me] });
    }

    return json({ error: 'Nicht gefunden.' }, 404);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      const stub = env.WICHTEL.get(env.WICHTEL.idFromName('gruppe'));
      return stub.fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};
