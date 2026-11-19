import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPw, pwHash, pwOk, cleanUsername } from '../src/auth.js';

test('Passwort-Hash passt nur zum richtigen Passwort', async () => {
  const { salt, hash } = await hashPw('geheim');
  assert.equal(await pwHash('geheim', salt), hash);
  assert.notEqual(await pwHash('Geheim', salt), hash);
});

test('gleiches Passwort ergibt dank Salz verschiedene Hashes', async () => {
  const a = await hashPw('geheim');
  const b = await hashPw('geheim');
  assert.notEqual(a.hash, b.hash);
});

test('Passwort braucht 4 bis 100 Zeichen, Namen werden aufgeräumt', () => {
  assert.equal(pwOk('abc'), false);
  assert.equal(pwOk('abcd'), true);
  assert.equal(cleanUsername('  Lilly   M  '), 'Lilly M');
});
