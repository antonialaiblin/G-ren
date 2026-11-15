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
