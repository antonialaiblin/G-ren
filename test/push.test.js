import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newVapidKeys, vapidJwt, pushEndpointOk } from '../src/push.js';

test('Push-Schlüssel und signiertes Kärtchen haben das richtige Format', async () => {
  const keys = await newVapidKeys();
  assert.equal(Buffer.from(keys.publicKey, 'base64url').length, 65);
  const jwt = await vapidJwt(keys, 'https://fcm.googleapis.com/fcm/send/abc', 'https://goeren.example');
  const [head, body, sig] = jwt.split('.');
  assert.equal(JSON.parse(Buffer.from(head, 'base64url')).alg, 'ES256');
  assert.equal(JSON.parse(Buffer.from(body, 'base64url')).aud, 'https://fcm.googleapis.com');
  assert.equal(Buffer.from(sig, 'base64url').length, 64);
});

test('nur echte Push-Dienste werden angenommen', () => {
  assert.equal(pushEndpointOk('https://web.push.apple.com/xyz'), true);
  assert.equal(pushEndpointOk('https://fcm.googleapis.com/fcm/send/x'), true);
  assert.equal(pushEndpointOk('https://evil.example/x'), false);
  assert.equal(pushEndpointOk('http://fcm.googleapis.com/x'), false);
});
