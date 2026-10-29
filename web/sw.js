// Service worker: keeps the app shell offline and shows Zona's pushes. API data is never cached.
const SHELL = 'zona-shell-v2';
const FILES = ['/', '/app.css', '/app.js', '/views.js', '/charts.js', '/manifest.webmanifest', '/icon-192.png'];

self.addEventListener('install', e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// network first for the shell so a new deploy shows up at once; the cache only covers being offline
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok && FILES.includes(url.pathname)) { const copy = res.clone(); caches.open(SHELL).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(hit => hit || caches.match('/'))));
});

self.addEventListener('push', e => {
  let msg = { title: 'Zona', body: '', url: '/', tag: 'zona' };
  try { msg = { ...msg, ...e.data.json() }; } catch { /* plain or empty payload */ }
  e.waitUntil(self.registration.showNotification(msg.title, { body: msg.body, tag: msg.tag, icon: '/icon-192.png', badge: '/icon-192.png', data: { url: msg.url } }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || '/', location.origin);
  if (target.origin !== location.origin) return;  // only ever open Zona itself
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wins => {
    const open = wins.find(w => new URL(w.url).origin === location.origin);
    // navigate() rejects for a window this worker doesn't control yet; fall back to a fresh one
    return open ? open.navigate(target.href).then(w => (w || open).focus()).catch(() => self.clients.openWindow(target.href))
      : self.clients.openWindow(target.href);
  }));
});
