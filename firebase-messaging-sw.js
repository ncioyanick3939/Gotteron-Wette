/* Service Worker für d'Mitteilige im Hintergrund.
   Mues im gliiche Ordner lige wie index.html. */
importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyAPZ8RYp5pBvWnZ1e7-FfPY5-nUjoLDcQg",
  authDomain: "gotteron-wette.firebaseapp.com",
  projectId: "gotteron-wette",
  storageBucket: "gotteron-wette.firebasestorage.app",
  messagingSenderId: "533433020688",
  appId: "1:533433020688:web:831aa6c069811c8ef53595"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(m => {
  const d = m.data || {};
  const n = m.notification || {};
  self.registration.showNotification(n.title || d.title || 'Gottéron Spielwette', {
    body: n.body || d.body || '',
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: d.tag || 'gott',
    renotify: true,
    data: { url: d.url || './' }
  });
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.includes('Gotteron-Wette') && 'focus' in c) { await c.focus(); if (c.navigate) await c.navigate(url).catch(() => {}); return; }
    }
    if (clients.openWindow) await clients.openWindow(url);
  })());
});
