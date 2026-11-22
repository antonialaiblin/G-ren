import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Sonnenauf- und -untergang in Berlin stimmen ungefähr', () => {
  const window = {}, document = { documentElement: { dataset: {} }, querySelector: () => null, addEventListener() {} };
  new Function('window', 'document', 'localStorage', 'setInterval', readFileSync(new URL('../public/theme.js', import.meta.url), 'utf8'))(
    window, document, { getItem: () => null, setItem() {} }, () => {});
  const hm = (d) => d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
  const near = (d, want) => {
    const [h, m] = hm(d).split(':').map(Number), [wh, wm] = want.split(':').map(Number);
    assert.ok(Math.abs(h * 60 + m - (wh * 60 + wm)) <= 5, `${hm(d)} statt ${want}`);
  };
  const winter = window.goerenTheme.sunTimes(new Date('2026-12-12T12:00:00Z'));
  near(winter.rise, '08:10'); near(winter.set, '15:52');
  const summer = window.goerenTheme.sunTimes(new Date('2026-06-21T12:00:00Z'));
  near(summer.rise, '04:43'); near(summer.set, '21:33');
});
