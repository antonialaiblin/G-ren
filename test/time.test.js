import { test } from 'node:test';
import assert from 'node:assert/strict';

// worker.js importiert cloudflare:workers, darum hier nur die Zeit-Helfer nachgebaut über einen dynamischen Import-Trick
const src = (await import('node:fs')).readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
const code = src.slice(src.indexOf('// Heute in Berlin'), src.indexOf('export { berlinNow, addDays };'));
const { berlinNow, addDays } = new Function(`${code}; return { berlinNow, addDays };`)();

test('Berliner Zeit und Wochentag', () => {
  assert.deepEqual(berlinNow(new Date('2026-11-22T16:02:00Z')), { day: '2026-11-22', wd: 7, hour: 17 });
  assert.deepEqual(berlinNow(new Date('2026-11-22T23:30:00Z')), { day: '2026-11-23', wd: 1, hour: 0 });
  assert.equal(berlinNow(new Date('2026-07-01T22:30:00Z')).day, '2026-07-02'); // Sommerzeit
});

test('Tage addieren, auch über Monatsgrenzen', () => {
  assert.equal(addDays('2026-11-26', 4), '2026-11-30');
  assert.equal(addDays('2026-11-26', 5), '2026-12-01');
  assert.equal(addDays('2026-12-28', 8 - 1), '2027-01-04');
});
