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
    s.chats ||= [];
    s.forms ||= [];
    s.imgs ||= {};    // hochgeladene Bilder (Umfragen, Fragebögen): id -> { by, at }; das Bild selbst liegt unter img:<id>   // Fragebögen (wie Google Forms)
    // Der große Gören-Chat mit allen
    const all = s.chats.find(c => c.id === 'all');
    if (!all) { s.chats.unshift({ id: 'all', name: 'Gören-Chat 💬', members: [...s.names], at: Date.now() }); changed = true; }
    else if (all.members.join('|') !== s.names.join('|')) { all.members = [...s.names]; changed = true; }
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
    // onlyFor: nur an diese Personen (z. B. die Mitglieder eines Chats)
    const notify = async (msg, onlyFor = null, link = '/#kalender') => {
      if (!s.vapid) return;
      const subs = Object.entries(s.push).filter(([, p]) => {
        const who = s.accounts[p.user]?.person;
        return who !== me && (!onlyFor || onlyFor.includes(who));
      });
      if (!subs.length) return;
      for (const [, p] of subs) p.msg = { text: msg, at: Date.now(), link };
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
        forms: me ? s.forms.map(formView) : [],
        finds: me ? s.finds : [],
        people: me ? people() : {},
        chats: me ? myChats() : [],
        admin: ADMIN,
        isAdmin: me === ADMIN,   // Kalender sehen nur Angemeldete
        budget: BUDGET,
        bescherung: BESCHERUNG,
        friendsmas: FRIENDSMAS,
      });
    }

    // Profil-Infos aller (Anzeigename, Geburtstag, ob es ein Profilbild gibt)
    function people() {
      const out = {};
      for (const a of Object.values(s.accounts)) {
        if (!a.person || !s.names.includes(a.person)) continue;
        out[a.person] = { display: a.display || a.person, birthday: a.birthday || null, year: a.year || null, avatar: a.avatar || 0 };
      }
      return out;
    }
    // Fragebogen für die Anzeige: bei anonymen Fragebögen ohne Namen
    function formView(f) {
      const entries = Object.entries(f.responses || {});
      const answered = entries.map(([n]) => n);
      const open = !f.closed;
      // Ergebnisse sieht man, wenn man selbst geantwortet hat, wenn man den Fragebogen erstellt hat oder er beendet ist
      const canSee = !open || f.by === me || answered.includes(me);
      let responses = [];
      if (canSee) {
        responses = f.anonymous
          ? entries.map(([, r]) => ({ who: null, r })).sort(() => Math.random() - 0.5)
          : entries.map(([who, r]) => ({ who, r }));
      }
      return {
        id: f.id, title: f.title, desc: f.desc, by: f.by, at: f.at, closed: f.closed || null, anonymous: !!f.anonymous,
        questions: f.questions, answered, mine: f.responses?.[me] || null, canSee, responses,
      };
    }
    function myChats() {
      return s.chats.filter(c => c.members.includes(me)).map(c => ({
        id: c.id, name: c.name, members: c.members, by: c.by || null, last: c.last || null,
      })).sort((a, b) => (b.last?.at || 0) - (a.last?.at || 0));
    }

    // ---------- Benachrichtigung abholen (fragt das Handy selbst, nachdem es geweckt wurde) ----------
    if (path === '/api/push/latest' && request.method === 'POST') {
      let b = {};
      try { b = await request.json(); } catch {}
      const p = s.push[String(b.endpoint || '')];
      const msg = p?.msg && Date.now() - p.msg.at < 2 * 86400_000 ? p.msg.text : null;
      return json({ text: msg || 'Es gibt Neuigkeiten bei den Gören.', link: p?.msg?.link || '/' });
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

    // ---------- Profil: Geburtstag ----------
    if (path === '/api/me/profile') {
      const md = String(body.birthday || '');
      const m = /^(\d{2})-(\d{2})$/.exec(md);
      const ok = m && !isNaN(Date.parse(`2000-${md}`)) && new Date(`2000-${md}`).getUTCDate() === Number(m[2]);
      if (!ok) return json({ error: 'Bitte Tag und Monat von deinem Geburtstag wählen.' }, 400);
      const y = body.year ? Number(body.year) : null;
      if (y !== null && !(Number.isInteger(y) && y >= 1920 && y <= new Date().getFullYear())) return json({ error: 'Das Geburtsjahr stimmt nicht.' }, 400);
      acct.birthday = md;
      acct.year = y;
      await save();
      return json({ ok: true, people: people() });
    }

    // ---------- Profil: Profilbild ----------
    if (path === '/api/me/avatar') {
      const img = body.image;
      if (img === null) {
        await this.ctx.storage.delete(`avatar:${me}`);
        acct.avatar = 0;
      } else {
        if (typeof img !== 'string' || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(img) || img.length > 300_000)
          return json({ error: 'Das Bild ist zu groß oder kein Bild.' }, 400);
        await this.ctx.storage.put(`avatar:${me}`, img);
        acct.avatar = Date.now();
      }
      await save();
      return json({ ok: true, people: people() });
    }
    if (path === '/api/avatar') {
      const img = s.names.includes(body.person) ? await this.ctx.storage.get(`avatar:${body.person}`) : null;
      return json({ image: img || null });
    }

    // ---------- Chat ----------
    const chat = s.chats.find(c => c.id === body.chat && c.members.includes(me));
    if (path === '/api/chats/add') {
      const name = String(body.name || '').trim().slice(0, 60);
      if (!name) return json({ error: 'Bitte gib dem Chat einen Namen.' }, 400);
      const members = [...new Set([me, ...(Array.isArray(body.members) ? body.members : [])])].filter(n => s.names.includes(n));
      if (members.length < 2) return json({ error: 'Bitte wähl mindestens eine weitere Person aus.' }, 400);
      if (s.chats.length >= 60) return json({ error: 'Es gibt schon zu viele Chats. Lösch erst einen alten.' }, 400);
      const c = { id: newId(), name, members: s.names.filter(n => members.includes(n)), by: me, at: Date.now() };
      s.chats.push(c);
      await save();
      await notify(`💬 ${acct.display || me} hat dich in den Chat „${name}“ geholt.`, c.members, '/#chat');
      return json({ ok: true, chats: myChats(), id: c.id });
    }
    if (path === '/api/chats/delete') {
      if (!chat || chat.id === 'all') return json({ error: 'Diesen Chat kann man nicht löschen.' }, 400);
      if (chat.by !== me) return json({ error: 'Nur wer den Chat erstellt hat, kann ihn löschen.' }, 403);
      s.chats = s.chats.filter(c => c.id !== chat.id);
      await this.ctx.storage.delete(`chat:${chat.id}`);
      await save();
      return json({ ok: true, chats: myChats() });
    }
    if (path === '/api/chat/messages') {
      if (!chat) return json({ error: 'Diesen Chat gibt es nicht (mehr).' }, 404);
      const msgs = (await this.ctx.storage.get(`chat:${chat.id}`)) || [];
      const since = Number(body.since) || 0;
      return json({ messages: msgs.filter(x => x.at > since), chats: myChats() });
    }
    if (path === '/api/chat/send') {
      if (!chat) return json({ error: 'Diesen Chat gibt es nicht (mehr).' }, 404);
      const text = String(body.text || '').trim().slice(0, 2000);
      if (!text) return json({ error: 'Schreib erst etwas.' }, 400);
      const msgs = (await this.ctx.storage.get(`chat:${chat.id}`)) || [];
      const last = msgs.length ? msgs[msgs.length - 1].at : 0;
      const msg = { id: newId(), from: me, text, at: Math.max(Date.now(), last + 1) };
      msgs.push(msg);
      if (msgs.length > 1000) msgs.splice(0, msgs.length - 1000);
      chat.last = { at: msg.at, from: me, text: text.slice(0, 80) };
      await this.ctx.storage.put(`chat:${chat.id}`, msgs);
      await save();
      const short = text.length > 80 ? text.slice(0, 80) + '…' : text;
      await notify(`💬 ${acct.display || me} (${chat.name}): ${short}`, chat.members, '/#chat');
      return json({ ok: true, message: msg });
    }

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

    // ---------- Bilder für Umfragen und Fragebögen ----------
    const imgOk = (id) => (typeof id === 'string' && s.imgs[id] ? id : null);
    const dropImgs = async (ids) => {
      for (const id of ids.filter(imgOk)) { delete s.imgs[id]; await this.ctx.storage.delete(`img:${id}`); }
    };
    // Antworten kommen als Text oder als { t, img }
    const optList = (arr) => {
      const seen = new Set(), out = [];
      for (const o of (Array.isArray(arr) ? arr : [])) {
        const t = String((o && typeof o === 'object' ? o.t : o) || '').trim().replace(/\s+/g, ' ').slice(0, 80);
        if (!t || seen.has(t.toLowerCase())) continue;
        seen.add(t.toLowerCase());
        out.push({ t, img: imgOk(o?.img) });
      }
      return out.slice(0, 20);
    };
    if (path === '/api/img/upload') {
      const img = body.image;
      if (typeof img !== 'string' || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(img) || img.length > 400_000)
        return json({ error: 'Das Bild ist zu groß oder kein Bild.' }, 400);
      if (Object.keys(s.imgs).length >= 500) return json({ error: 'Der Bilder-Speicher ist voll. Löscht erst alte Umfragen.' }, 400);
      const id = newId() + newId();
      await this.ctx.storage.put(`img:${id}`, img);
      s.imgs[id] = { by: me, at: Date.now() };
      await save();
      return json({ ok: true, id });
    }
    if (path === '/api/img') {
      const img = imgOk(body.id) ? await this.ctx.storage.get(`img:${body.id}`) : null;
      return json({ image: img || null });
    }

    // ---------- Fragebögen ----------
    const QTYPES = ['short', 'long', 'single', 'multi', 'dropdown', 'scale', 'yesno', 'date'];
    if (path === '/api/forms/add') {
      const title = String(body.title || '').trim().slice(0, 120);
      if (!title) return json({ error: 'Bitte gib dem Fragebogen einen Titel.' }, 400);
      const qs = (Array.isArray(body.questions) ? body.questions : []).slice(0, 30).map(q => {
        const type = QTYPES.includes(q?.type) ? q.type : 'short';
        const ol = optList(q?.options);
        const max = Math.min(10, Math.max(3, Number(q?.max) || 5));
        return {
          id: newId(), type, text: String(q?.text || '').trim().slice(0, 200), required: !!q?.required, img: imgOk(q?.img),
          ...(['single', 'multi', 'dropdown'].includes(type) ? {
            options: ol.map(o => o.t), other: !!q?.other && type !== 'dropdown',
            ...(type !== 'dropdown' && ol.some(o => o.img) ? { optImgs: ol.map(o => o.img) } : {}),
          } : {}),
          ...(type === 'scale' ? { max, low: String(q?.low || '').slice(0, 30), high: String(q?.high || '').slice(0, 30) } : {}),
        };
      });
      if (!qs.length) return json({ error: 'Bitte mindestens eine Frage hinzufügen.' }, 400);
      const bad = qs.findIndex(q => !q.text || (q.options && q.options.length < 2));
      if (bad >= 0) return json({ error: `Frage ${bad + 1}: Bitte Fragetext und bei Auswahlfragen mindestens zwei Antworten eintragen.` }, 400);
      if (s.forms.length >= 30) return json({ error: 'Es gibt schon zu viele Fragebögen. Lösch erst einen alten.' }, 400);
      s.forms.unshift({ id: newId(), title, desc: String(body.desc || '').trim().slice(0, 500), by: me, at: Date.now(),
        anonymous: !!body.anonymous, questions: qs, responses: {} });
      await save();
      await notify(`📝 ${acct.display || me} hat einen Fragebogen erstellt: ${title}`, null, '/');
      return json({ ok: true, forms: s.forms.map(formView) });
    }
    const form = s.forms.find(x => x.id === body.id);
    if (path.startsWith('/api/forms/') && !form) return json({ error: 'Diesen Fragebogen gibt es nicht mehr.' }, 404);
    if (path === '/api/forms/answer') {
      if (form.closed) return json({ error: 'Der Fragebogen ist schon beendet.' }, 400);
      const a = body.answers || {};
      const out = {};
      for (const [i, q] of form.questions.entries()) {
        let v = a[q.id];
        if (q.type === 'short' || q.type === 'long' || q.type === 'date') {
          v = String(v ?? '').trim().slice(0, q.type === 'long' ? 2000 : 200);
          if (q.type === 'date' && v && !isDay(v)) v = '';
        } else if (q.type === 'single' || q.type === 'dropdown' || q.type === 'yesno') {
          const allowed = q.type === 'yesno' ? ['Ja', 'Nein'] : q.options;
          v = String(v ?? '');
          if (!allowed.includes(v)) v = q.other && v.startsWith('Sonstiges: ') ? v.slice(0, 200) : '';
        } else if (q.type === 'multi') {
          v = [...new Set((Array.isArray(v) ? v : []).map(String))]
            .filter(x => q.options.includes(x) || (q.other && x.startsWith('Sonstiges: '))).map(x => x.slice(0, 200));
        } else if (q.type === 'scale') {
          v = Number(v);
          if (!(Number.isInteger(v) && v >= 1 && v <= q.max)) v = null;
        }
        const empty = v === '' || v === null || (Array.isArray(v) && !v.length);
        if (q.required && empty) return json({ error: `Bitte beantworte Frage ${i + 1}: „${q.text}“.` }, 400);
        if (!empty) out[q.id] = v;
      }
      const first = !form.responses[me];
      form.responses[me] = out;
      await save();
      if (first && form.by !== me) {
        const n = Object.keys(form.responses).length;
        await notify(`📝 ${acct.display || me} hat „${form.title}“ ausgefüllt (${n} von ${s.names.length}).`, [form.by], '/');
      }
      return json({ ok: true, forms: s.forms.map(formView) });
    }
    if (path === '/api/forms/close' || path === '/api/forms/delete') {
      if (form.by !== me) return json({ error: 'Nur wer den Fragebogen erstellt hat, kann das.' }, 403);
      if (path === '/api/forms/close') form.closed = Date.now();
      else {
        s.forms = s.forms.filter(x => x.id !== form.id);
        await dropImgs(form.questions.flatMap(q => [q.img, ...(q.optImgs || [])]));
      }
      await save();
      return json({ ok: true, forms: s.forms.map(formView) });
    }

    // ---------- Umfragen ----------
    const cleanOpt = (t) => String(t || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    if (path === '/api/polls/add') {
      const q = String(body.question || '').trim().slice(0, 120);
      if (!q) return json({ error: 'Bitte schreib deine Frage auf.' }, 400);
      const ideas = !!body.ideas;   // true: jede darf Ideen reintippen
      const opts = optList(body.options);
      if (!ideas && opts.length < 2) return json({ error: 'Bitte mindestens zwei Vorschläge eintragen.' }, 400);
      if (s.polls.length >= 50) return json({ error: 'Es gibt schon zu viele Umfragen. Lösch erst eine alte.' }, 400);
      s.polls.unshift({ id: newId(), q, img: imgOk(body.img), ideas, by: me,
        options: opts.map(o => ({ id: newId(), t: o.t, img: o.img, by: me, votes: [] })), at: Date.now() });
      await save();
      await notify(`📊 ${acct.display || me} fragt: ${q}`, null, '/');
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
      if (!poll.options.some(o => o.t.toLowerCase() === t.toLowerCase())) poll.options.push({ id: newId(), t, img: imgOk(body.img), by: me, votes: [me] });
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
      else {
        s.polls = s.polls.filter(x => x.id !== poll.id);
        await dropImgs([poll.img, ...poll.options.map(o => o.img)]);
      }
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
