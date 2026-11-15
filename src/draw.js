// Zufällige Zuteilung, bei der niemand sich selbst zieht.
export function randomInt(max) {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % max;
}

export function draw(names, rand = randomInt) {
  if (names.length < 2) throw new Error('Mindestens zwei Leute');
  let p;
  do {
    p = names.map((_, i) => i);
    for (let i = p.length - 1; i > 0; i--) {
      const j = rand(i + 1);
      [p[i], p[j]] = [p[j], p[i]];
    }
  } while (p.some((v, i) => v === i));
  const pairs = {};
  names.forEach((n, i) => { pairs[n] = names[p[i]]; });
  return pairs;
}

export async function hashPin(round, name, pin) {
  const data = new TextEncoder().encode(`wichteln|${round}|${name}|${pin}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
