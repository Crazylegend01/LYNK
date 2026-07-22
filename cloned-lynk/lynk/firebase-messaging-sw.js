// ============================================================
// LYNK By Legends — Firebase Cloud Messaging Service Worker
// This file MUST be at the root of your site (same level as index.html)
// GitHub Pages serves it correctly from the repo root.
// ============================================================

importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyCjwWg4FcMGv3utGjQZ9PXRor8NqO0bMno",
  authDomain: "lynk-a6c6e.firebaseapp.com",
  projectId: "lynk-a6c6e",
  storageBucket: "lynk-a6c6e.firebasestorage.app",
  messagingSenderId: "415646266101",
  appId: "1:415646266101:web:d5d2685dfbeb1455860bbc",
  measurementId: "G-PTYKWXVY60"
});

const messaging = firebase.messaging();

// Handle background push messages (when tab is closed/hidden)
messaging.onBackgroundMessage((payload) => {
  const { title, body, icon, url } = payload.notification || {};
  const notifTitle = title || 'LYNK By Legends';
  const notifOptions = {
    body: body || 'You have a new notification',
    icon: icon || '/LYNK/assets/logo.jpg',
    badge: '/LYNK/assets/logo.jpg',
    data: { url: url || '/LYNK/feed.html' },
    actions: [
      { action: 'open', title: 'Open LYNK' },
      { action: 'dismiss', title: 'Dismiss' }
    ],
    vibrate: [200, 100, 200],
    requireInteraction: false
  };
  self.registration.showNotification(notifTitle, notifOptions);
});

// Handle notification click — open LYNK tab
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  const url = event.notification.data?.url || '/LYNK/feed.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('LYNK') && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
