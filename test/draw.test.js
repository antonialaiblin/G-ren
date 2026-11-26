import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draw, hashPin } from '../src/draw.js';
import { PEOPLE } from '../src/config.js';

const names = PEOPLE.map(p => p.name);

test('niemand zieht sich selbst, jede wird genau einmal gezogen', () => {
  for (let i = 0; i < 5000; i++) {
    const pairs = draw(names);
    for (const n of names) assert.notEqual(pairs[n], n);
    assert.equal(new Set(Object.values(pairs)).size, names.length);
  }
});

test('alle Größen sind gesetzt', () => {
  for (const p of PEOPLE) assert.match(p.size, /^(XS|S|M|L|XL)$/);
});

test('PIN-Hash hängt von Name und PIN ab', async () => {
  const a = await hashPin('2026', 'Milli', '1234');
  assert.equal(a, await hashPin('2026', 'Milli', '1234'));
  assert.notEqual(a, await hashPin('2026', 'Emma', '1234'));
  assert.notEqual(a, await hashPin('2026', 'Milli', '1235'));
});

test('Gast nachträglich dazu und wieder raus: niemand zieht sich selbst, nur eine Person ändert sich', async () => {
  const { draw, addToPairs, removeFromPairs } = await import('../src/draw.js');
  for (let run = 0; run < 200; run++) {
    const names = ['A', 'B', 'C', 'D', 'E'];
    const pairs = draw(names);
    const before = { ...pairs };
    const opened = { A: 1, B: 1, C: 1 };
    const x = addToPairs(pairs, 'g1', opened);
    assert.ok(['D', 'E'].includes(x), 'nimmt bevorzugt jemanden ohne geöffneten Brief');
    assert.equal(pairs[x], 'g1');
    assert.equal(pairs.g1, before[x]);
    for (const n of names) if (n !== x) assert.equal(pairs[n], before[n]);
    addToPairs(pairs, 'g2', { A: 1, B: 1, C: 1, D: 1, E: 1, g1: 1 });
    const all = Object.keys(pairs);
    assert.equal(new Set(Object.values(pairs)).size, all.length, 'jede wird genau einmal beschenkt');
    for (const k of all) assert.notEqual(pairs[k], k);
    removeFromPairs(pairs, 'g1');
    removeFromPairs(pairs, 'g2');
    assert.deepEqual(pairs, before);
  }
});
