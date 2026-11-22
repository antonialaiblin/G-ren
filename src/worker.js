import { DurableObject } from 'cloudflare:workers';
import { PEOPLE, BUDGET, BESCHERUNG, ROUND, RESET, ADMIN, FRIENDSMAS } from './config.js';
import { draw, hashPin } from './draw.js';
import { pwHash, hashPw, pwOk, newToken, cleanUsername } from './auth.js';
import { newVapidKeys, sendPush, pushEndpointOk } from './push.js';

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
        events: s?.events || [],
      };
      changed = true;
    }
    s.accounts ||= {};
    s.sessions ||= {};
    s.fails ||= {};
    s.wishes ||= {};
    s.resets ||= {};
    s.events ||= [];
    s.push ||= {};
    s.polls ||= [];
    s.finds ||= [];   // „Wann könnt ihr?“-Abstimmungen für den Kalender
    s.seeded ||= {};
    // Friendsmas steht automatisch im Kalender (nur einmal, danach kann Toni ihn wie jeden Termin löschen)
    if (FRIENDSMAS && !s.seeded[FRIENDSMAS]) {
      if (!s.events.some(e => e.day === FRIENDSMAS && /friendsmas/i.test(e.title))) {
        s.events.push({ id: `friendsmas-${FRIENDSMAS}`, day: FRIENDSMAS, title: 'Friendsmas 🎄🎁', by: ADMIN, at: Date.now() });
        s.events.sort((a, b) => a.day.localeCompare(b.day));
      }
      s.seeded[FRIENDSMAS] = true;
      changed = true;
    }
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
    const accountInfo = (a) => a ? {
      username: a.username,
      person: a.person && s.names.includes(a.person) ? a.person : null,
      display: a.display || null,   // selbst gewählter Name für „Hallo …“
    } : null;
    // Benachrichtigung an alle anderen schicken, die sie angeschaltet haben
    const notify = async (msg) => {
      if (!s.vapid) return;
      const subs = Object.entries(s.push).filter(([, p]) => s.accounts[p.user]?.person !== me);
      if (!subs.length) return;
      for (const [, p] of subs) p.msg = { text: msg, at: Date.now() };
      await save();
      const ok = await Promise.all(subs.map(([ep]) => sendPush(s.vapid, ep, url.origin)));
      let gone = false;
      subs.forEach(([ep], i) => { if (!ok[i]) { delete s.push[ep]; gone = true; } });
      if (gone) await save();
    };

    if (path === '/api/state' && request.method === 'GET') {
      return json({
        names: s.names,
        opened: Object.keys(s.opened),
        claimed: [...claimed()],
        account: accountInfo(acct),
        events: me ? s.events : [],
        polls: me ? s.polls : [],
        finds: me ? s.finds : [],
        admin: ADMIN,
        isAdmin: me === ADMIN,   // Kalender sehen nur Angemeldete
        budget: BUDGET,
        bescherung: BESCHERUNG,
        friendsmas: FRIENDSMAS,
      });
    }

    // ---------- Benachrichtigung abholen (fragt das Handy selbst, nachdem es geweckt wurde) ----------
    if (path === '/api/push/latest' && request.method === 'POST') {
      let b = {};
      try { b = await request.json(); } catch {}
      const p = s.push[String(b.endpoint || '')];
      const msg = p?.msg && Date.now() - p.msg.at < 2 * 86400_000 ? p.msg.text : null;
      return json({ text: msg || 'Es gibt Neuigkeiten bei den Gören.' });
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
      // Die Admin sieht dann in „Accounts verwalten“, wer ein neues Passwort braucht
      if (a && body.notify && !a.forgot) { a.forgot = Date.now(); await save(); }
      return json({ hint: a?.hint || null, admin: ADMIN });
    }

    // Ab hier muss man angemeldet sein
    if (!acct) return json({ error: 'Bitte melde dich an.', auth: true }, 401);

    if (path === '/api/logout') {
      delete s.sessions[token];
      await save();
      return json({ ok: true });
    }

    // ---------- Einstellungen: eigener Name ----------
    if (path === '/api/me/name') {
      const name = cleanUsername(body.name);
      if (name.length < 2) return json({ error: 'Der Name braucht mindestens 2 Zeichen.' }, 400);
      acct.display = name;
      await save();
      return json({ ok: true, account: accountInfo(acct) });
    }

    // ---------- Einstellungen: eigenes Passwort ----------
    if (path === '/api/me/password') {
      if (typeof body.old !== 'string' || (await pwHash(body.old, acct.salt)) !== acct.hash)
        return json({ error: 'Dein jetziges Passwort stimmt nicht.' }, 400);
      if (!pwOk(body.password)) return json({ error: 'Das neue Passwort braucht mindestens 4 Zeichen.' }, 400);
      Object.assign(acct, await hashPw(body.password), { forgot: null });
      // Auf anderen Geräten abmelden, hier angemeldet bleiben
      for (const [t, ss] of Object.entries(s.sessions)) if (ss.user === sess.user && t !== token) delete s.sessions[t];
      await save();
      return json({ ok: true });
    }

    // ---------- Einstellungen: Benachrichtigungen ----------
    if (path === '/api/push/key') {
      if (!s.vapid) { s.vapid = await newVapidKeys(); await save(); }
      return json({ key: s.vapid.publicKey });
    }
    if (path === '/api/push/subscribe') {
      const ep = String(body.subscription?.endpoint || '');
      if (!pushEndpointOk(ep)) return json({ error: 'Dieses Handy kann leider keine Benachrichtigungen empfangen.' }, 400);
      if (!s.push[ep] && Object.keys(s.push).length >= 100) return json({ error: 'Zu viele Geräte angemeldet.' }, 400);
      s.push[ep] = { user: sess.user, at: Date.now() };
      await save();
      return json({ ok: true });
    }
    if (path === '/api/push/unsubscribe') {
      const ep = String(body.endpoint || '');
      if (s.push[ep]?.user === sess.user) { delete s.push[ep]; await save(); }
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

    // ---------- Accounts verwalten (nur die Admin) ----------
    if (path.startsWith('/api/admin/')) {
      if (me !== ADMIN) return json({ error: 'Das darf nur die Admin.' }, 403);
      const list = () => json({
        accounts: Object.entries(s.accounts).map(([key, a]) => ({
          key, username: a.username, person: a.person && s.names.includes(a.person) ? a.person : null, forgot: !!a.forgot,
        })).sort((x, y) => (x.person || '~').localeCompare(y.person || '~')),
      });
      if (path === '/api/admin/accounts') return list();
      const target = s.accounts[String(body.key || '')];
      if (!target) return json({ error: 'Diesen Account gibt es nicht.' }, 404);
      if (path === '/api/admin/password') {
        if (!pwOk(body.password)) return json({ error: 'Das Passwort braucht mindestens 4 Zeichen.' }, 400);
        Object.assign(target, await hashPw(body.password), { forgot: null });
        // Überall abmelden, wo sie mit dem alten Passwort angemeldet war
        for (const [t, ss] of Object.entries(s.sessions)) if (ss.user === body.key && t !== token) delete s.sessions[t];
        delete s.fails[body.key];
        if (target.person) delete s.fails[target.person.toLowerCase()];
        await save();
        return list();
      }
      return json({ error: 'Nicht gefunden.' }, 404);
    }

    // ---------- Kalender ----------
    if (path === '/api/events/add') {
      const day = String(body.day || '');
      const end = body.end ? String(body.end) : '';
      const title = String(body.title || '').trim().slice(0, 80);
      if (!isDay(day)) return json({ error: 'Bitte ein Datum wählen.' }, 400);
      if (end && (!isDay(end) || end < day)) return json({ error: 'Das Ende muss nach dem Anfang liegen.' }, 400);
      if (!title) return json({ error: 'Bitte schreib kurz, was los ist.' }, 400);
      if (s.events.length >= 500) return json({ error: 'Der Kalender ist voll.' }, 400);
      const id = newId();
      s.events.push({ id, day, ...(end && end !== day ? { end } : {}), title, by: me, at: Date.now() });
      s.events.sort((a, b) => a.day.localeCompare(b.day));
      await save();
      const [, mm, dd] = day.split('-').map(Number);
      const who = acct.display || me;
      await notify(`📅 ${who} hat einen Termin eingetragen: ${dd}.${mm}. ${title}`);
      return json({ ok: true, events: s.events });
    }
    if (path === '/api/events/delete') {
      const ev = s.events.find(e => e.id === body.id);
      if (!ev) return json({ error: 'Diesen Termin gibt es nicht mehr.' }, 404);
      if (ev.by !== me) return json({ error: 'Nur wer den Termin eingetragen hat, kann ihn löschen.' }, 403);
      s.events = s.events.filter(e => e.id !== body.id);
      await save();
      return json({ ok: true, events: s.events });
    }

    // ---------- „Wann könnt ihr?“ ----------
    if (path === '/api/finds/add') {
      const title = String(body.title || '').trim().slice(0, 80);
      if (!title) return json({ error: 'Bitte schreib kurz, worum es geht.' }, 400);
      const opts = (Array.isArray(body.options) ? body.options : []).slice(0, 20)
        .map(o => ({ day: String(o?.day || ''), end: String(o?.end || o?.day || '') }))
        .filter(o => isDay(o.day) && isDay(o.end) && o.end >= o.day);
      if (opts.length < 2) return json({ error: 'Bitte mindestens zwei mögliche Termine angeben.' }, 400);
      if (s.finds.length >= 50) return json({ error: 'Es gibt schon zu viele Abstimmungen.' }, 400);
      s.finds.unshift({ id: newId(), title, by: me, options: opts, answers: {}, at: Date.now() });
      await save();
      await notify(`🗳️ ${acct.display || me} fragt: Wann könnt ihr? „${title}“`);
      return json({ ok: true, finds: s.finds, events: s.events });
    }
    if (path === '/api/finds/answer') {
      const f = s.finds.find(x => x.id === body.id);
      if (!f) return json({ error: 'Diese Abstimmung gibt es nicht mehr.' }, 404);
      if (f.done) return json({ error: 'Der Termin steht schon fest.' }, 400);
      const picks = [...new Set((Array.isArray(body.picks) ? body.picks : []).filter(i => Number.isInteger(i) && i >= 0 && i < f.options.length))];
      f.answers[me] = picks;
      // Haben alle geantwortet und gibt es einen Termin, an dem alle können? Dann ab in den Kalender.
      let added = null;
      if (s.names.every(n => f.answers[n])) {
        const i = f.options.findIndex((_, k) => s.names.every(n => f.answers[n].includes(k)));
        if (i >= 0) {
          const o = f.options[i];
          added = { id: newId(), day: o.day, ...(o.end !== o.day ? { end: o.end } : {}), title: f.title, by: f.by, at: Date.now() };
          s.events.push(added);
          s.events.sort((a, b) => a.day.localeCompare(b.day));
          f.done = { option: i, event: added.id };
        }
      }
      await save();
      if (added) {
        const [, mm, dd] = added.day.split('-').map(Number);
        await notify(`🎉 Alle können! „${f.title}“ steht jetzt am ${dd}.${mm}. im Kalender.`);
      }
      return json({ ok: true, finds: s.finds, events: s.events, added: !!added });
    }
    if (path === '/api/finds/delete') {
      const f = s.finds.find(x => x.id === body.id);
      if (!f) return json({ error: 'Diese Abstimmung gibt es nicht mehr.' }, 404);
      if (f.by !== me) return json({ error: 'Nur wer gefragt hat, kann die Abstimmung löschen.' }, 403);
      s.finds = s.finds.filter(x => x.id !== body.id);
      await save();
      return json({ ok: true, finds: s.finds, events: s.events });
    }

    // ---------- Umfragen ----------
    const cleanOpt = (t) => String(t || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    if (path === '/api/polls/add') {
      const q = String(body.question || '').trim().slice(0, 120);
      if (!q) return json({ error: 'Bitte schreib deine Frage auf.' }, 400);
      const ideas = !!body.ideas;   // true: jede darf Ideen reintippen
      const opts = [...new Set((Array.isArray(body.options) ? body.options : []).map(cleanOpt).filter(Boolean))].slice(0, 20);
      if (!ideas && opts.length < 2) return json({ error: 'Bitte mindestens zwei Vorschläge eintragen.' }, 400);
      if (s.polls.length >= 50) return json({ error: 'Es gibt schon zu viele Umfragen. Lösch erst eine alte.' }, 400);
      s.polls.unshift({ id: newId(), q, ideas, by: me, options: opts.map(t => ({ id: newId(), t, by: me, votes: [] })), at: Date.now() });
      await save();
      await notify(`📊 ${acct.display || me} fragt: ${q}`);
      return json({ ok: true, polls: s.polls });
    }
    const poll = s.polls.find(x => x.id === body.id);
    if (path.startsWith('/api/polls/') && !poll) return json({ error: 'Diese Umfrage gibt es nicht mehr.' }, 404);
    if (path === '/api/polls/idea') {
      if (!poll.ideas && poll.by !== me) return json({ error: 'Bei dieser Umfrage kann man nur auswählen.' }, 400);
      if (poll.closed) return json({ error: 'Die Umfrage ist schon beendet.' }, 400);
      const t = cleanOpt(body.text);
      if (!t) return json({ error: 'Bitte schreib deine Idee auf.' }, 400);
      if (poll.options.length >= 30) return json({ error: 'Es gibt schon genug Ideen.' }, 400);
      if (!poll.options.some(o => o.t.toLowerCase() === t.toLowerCase())) poll.options.push({ id: newId(), t, by: me, votes: [me] });
      await save();
      return json({ ok: true, polls: s.polls });
    }
    if (path === '/api/polls/vote') {
      if (poll.closed) return json({ error: 'Die Umfrage ist schon beendet.' }, 400);
      const o = poll.options.find(x => x.id === body.option);
      if (!o) return json({ error: 'Diese Antwort gibt es nicht mehr.' }, 404);
      const had = o.votes.includes(me);
      // Eine Stimme pro Person: Tippen auf die eigene Wahl nimmt sie zurück
      for (const x of poll.options) x.votes = x.votes.filter(v => v !== me);
      if (!had) o.votes.push(me);
      await save();
      return json({ ok: true, polls: s.polls });
    }
    if (path === '/api/polls/close' || path === '/api/polls/delete') {
      if (poll.by !== me) return json({ error: 'Nur wer die Umfrage gestartet hat, kann das.' }, 403);
      if (path === '/api/polls/close') poll.closed = Date.now();
      else s.polls = s.polls.filter(x => x.id !== poll.id);
      await save();
      return json({ ok: true, polls: s.polls });
    }

    return json({ error: 'Nicht gefunden.' }, 404);
  }
}

const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d));
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

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
