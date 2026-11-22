// Service Worker: nur für Benachrichtigungen. Er speichert nichts zwischen, die App bleibt immer aktuell.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let text = 'Es gibt Neuigkeiten bei den Gören.', link = '/';
    try {
      const sub = await self.registration.pushManager.getSubscription();
      const res = await fetch('/api/push/latest', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint: sub ? sub.endpoint : '' }),
      });
      const j = await res.json();
      text = j.text || text;
      link = j.link || link;
    } catch {}
    await self.registration.showNotification('Gören', {
      body: text, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { url: link },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) { if ('focus' in w) { w.navigate(url).catch(() => {}); return w.focus(); } }
    return self.clients.openWindow(url);
  })());
});
