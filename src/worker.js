import { DurableObject } from 'cloudflare:workers';
import { PEOPLE, BUDGET, BESCHERUNG, ROUND } from './config.js';
import { draw, hashPin } from './draw.js';

const MAX_TRIES = 5;          // falsche PINs, bevor gesperrt wird
const LOCK_MS = 10 * 60_000;  // 10 Minuten Sperre

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

export class Wichtel extends DurableObject {
  async load() {
    let s = await this.ctx.storage.get('state');
    const names = PEOPLE.map(p => p.name);
    const sameNames = s && s.names && s.names.join('|') === names.join('|');
    if (!s || s.round !== ROUND || !sameNames) {
      s = { round: ROUND, names, pairs: draw(names), pins: {}, opened: {}, fails: {} };
      await this.ctx.storage.put('state', s);
    }
    return s;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const s = await this.load();

    if (url.pathname === '/api/state' && request.method === 'GET') {
      return json({
        names: s.names,
        opened: Object.keys(s.opened),
        budget: BUDGET,
        bescherung: BESCHERUNG,
      });
    }

    if (url.pathname === '/api/reveal' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Ungültige Anfrage.' }, 400); }
      const name = String(body.name || '');
      const pin = String(body.pin || '');
      if (!s.names.includes(name)) return json({ error: 'Diesen Namen gibt es nicht.' }, 404);
      if (!/^\d{4}$/.test(pin)) return json({ error: 'Die PIN hat genau 4 Ziffern.' }, 400);

      const f = s.fails[name] || { n: 0, until: 0 };
      if (f.until > Date.now()) {
        const min = Math.ceil((f.until - Date.now()) / 60_000);
        return json({ error: `Zu viele falsche Versuche. Probier es in ${min} Min. noch mal.` }, 429);
      }

      const h = await hashPin(s.round, name, pin);
      const first = !s.pins[name];
      if (first) {
        s.pins[name] = h;
        s.opened[name] = Date.now();
      } else if (s.pins[name] !== h) {
        f.n += 1;
        if (f.n >= MAX_TRIES) { f.n = 0; f.until = Date.now() + LOCK_MS; }
        s.fails[name] = f;
        await this.ctx.storage.put('state', s);
        return json({ error: 'Falsche PIN.' }, 403);
      }
      delete s.fails[name];
      await this.ctx.storage.put('state', s);

      const to = s.pairs[name];
      const person = PEOPLE.find(p => p.name === to);
      return json({ first, to, size: person ? person.size : '', budget: BUDGET, bescherung: BESCHERUNG });
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
