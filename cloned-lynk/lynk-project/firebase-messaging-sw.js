// ============================================================
// LYNK By Legends — Firebase Cloud Messaging Service Worker
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

// Handle background push messages (app closed / tab hidden)
messaging.onBackgroundMessage((payload) => {
  const notif = payload.notification || {};
  // IMPORTANT: url always lives in data payload, not notification payload
  const data  = payload.data  || {};

  const title = notif.title || 'LYNK By Legends';
  const body  = notif.body  || 'You have a new notification';
  const icon  = notif.icon  || '/LYNK/assets/logo.jpg';

  // For DM messages, deep-link straight to the conversation
  let url = data.url || '/LYNK/feed.html';
  if (data.type === 'message' && data.convId) {
    url = '/LYNK/chat.html?conv=' + data.convId;
  } else if (data.type === 'message') {
    url = '/LYNK/chat.html';
  }

  const notifOptions = {
    body,
    icon,
    badge: '/LYNK/assets/logo.jpg',
    tag: data.type === 'message' ? 'lynk-dm-' + (data.convId || data.fromUid || '') : 'lynk-notif',
    renotify: data.type === 'message',
    data: { url, type: data.type || 'general', convId: data.convId || '' },
    actions: [
      { action: 'open', title: data.type === 'message' ? 'Open Chat' : 'Open LYNK' },
      { action: 'dismiss', title: 'Dismiss' }
    ],
    vibrate: [200, 100, 200],
    requireInteraction: false
  };

  self.registration.showNotification(title, notifOptions);
});

// Handle notification click — route to the correct page
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'dismiss') return;

  // url was stored in data when showNotification was called
  const url = event.notification.data?.url || '/LYNK/chat.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If a LYNK tab is already open for this conversation, focus it
      for (const client of clientList) {
        if (client.url.includes('chat.html') && event.notification.data?.type === 'message') {
          client.postMessage({ type: 'OPEN_CONV', convId: event.notification.data?.convId });
          return client.focus();
        }
        if (client.url.includes('LYNK') && 'focus' in client) {
          return client.navigate(url).then(c => c?.focus());
        }
      }
      return clients.openWindow(url);
    })
  );
});
