// ============================================================
// LYNK By Legends — Firebase Cloud Messaging (Push Notifications)
// ============================================================

import { db } from './firebase-config.js';
import {
  doc, setDoc, serverTimestamp, addDoc, collection
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js";

const FCM_VAPID_KEY = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SvmO5l-4EhPJKGjXHvU-GzJxRzT3MIz6eLY-FBGv3mGHRoZ7Rfk1k0';

const firebaseConfig = {
  apiKey: "AIzaSyCjwWg4FcMGv3utGjQZ9PXRor8NqO0bMno",
  authDomain: "lynk-a6c6e.firebaseapp.com",
  projectId: "lynk-a6c6e",
  storageBucket: "lynk-a6c6e.firebasestorage.app",
  messagingSenderId: "415646266101",
  appId: "1:415646266101:web:d5d2685dfbeb1455860bbc",
  measurementId: "G-PTYKWXVY60"
};

let messaging = null;

function getMessagingInstance() {
  if (messaging) return messaging;
  try {
    const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    messaging = getMessaging(app);
    return messaging;
  } catch (e) {
    console.warn('FCM init failed:', e.message);
    return null;
  }
}

// ===== REQUEST PERMISSION & SAVE TOKEN =====
export async function initFCM(uid) {
  if (!('Notification' in window)) return;
  if (!('serviceWorker' in navigator)) return;

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    const msg = getMessagingInstance();
    if (!msg) return;

    const token = await getToken(msg, { vapidKey: FCM_VAPID_KEY });
    if (!token) return;

    await setDoc(doc(db, 'fcmTokens', uid), {
      token,
      uid,
      updatedAt: serverTimestamp(),
      platform: 'web',
      userAgent: navigator.userAgent.slice(0, 100)
    });

    listenForeground(msg);
    return token;
  } catch (e) {
    console.warn('FCM setup skipped:', e.message);
  }
}

// ===== FOREGROUND MESSAGE HANDLER =====
function listenForeground(msg) {
  onMessage(msg, (payload) => {
    const { title, body, icon } = payload.notification || {};
    const data = payload.data || {};
    showToast(title || 'LYNK', body || '', icon, data.url);
  });
}

// ===== IN-APP TOAST NOTIFICATION =====
export function showToast(title, body, icon, url) {
  const existing = document.getElementById('lynk-fcm-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'lynk-fcm-toast';
  toast.style.cssText = `
    position:fixed;bottom:24px;right:24px;z-index:9999;
    background:var(--bg-card,#1e1e2e);border:1px solid var(--border,rgba(255,255,255,.1));
    border-radius:16px;padding:14px 18px;max-width:320px;width:calc(100vw - 48px);
    box-shadow:0 8px 32px rgba(0,0,0,.4);display:flex;gap:12px;align-items:flex-start;
    animation:slideInRight .3s ease;cursor:pointer;
  `;
  toast.innerHTML = `
    <img src="${icon || 'assets/logo.jpg'}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;flex-shrink:0">
    <div style="flex:1;min-width:0">
      <p style="font-weight:600;font-size:.85rem;margin:0 0 3px">${escHtml(title)}</p>
      <p style="font-size:.78rem;color:var(--text-muted,#888);margin:0;line-height:1.4;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${escHtml(body)}</p>
    </div>
    <button onclick="this.closest('#lynk-fcm-toast').remove()" style="background:none;border:none;color:var(--text-muted,#888);font-size:1.1rem;cursor:pointer;padding:0;flex-shrink:0">×</button>
  `;

  if (!document.getElementById('fcm-toast-style')) {
    const style = document.createElement('style');
    style.id = 'fcm-toast-style';
    style.textContent = `@keyframes slideInRight{from{transform:translateX(110%);opacity:0}to{transform:translateX(0);opacity:1}}`;
    document.head.appendChild(style);
  }

  if (url) toast.addEventListener('click', (e) => { if (e.target.tagName !== 'BUTTON') window.location.href = url; });
  document.body.appendChild(toast);
  setTimeout(() => toast?.remove(), 6000);
}

// ===== QUEUE PUSH NOTIFICATION (for Cloud Functions to pick up) =====
export async function queuePushNotification({ toUid, title, body, url = '', icon = '', type = 'general' }) {
  try {
    await addDoc(collection(db, 'pushQueue'), {
      toUid, title, body, url, icon, type,
      sent: false,
      createdAt: serverTimestamp()
    });
  } catch (e) {
    console.warn('Push queue write failed:', e.message);
  }
}

// ===== NOTIFY MARKETPLACE MESSAGE =====
export async function notifyMarketplaceMessage({ toUid, fromName, listingTitle }) {
  await queuePushNotification({
    toUid,
    title: `💬 New message from ${fromName}`,
    body: `About: ${listingTitle}`,
    url: 'marketplace.html',
    type: 'marketplace_message'
  });
}

// ===== NOTIFY EVENT REMINDER =====
export async function notifyEventReminder({ toUid, eventTitle, eventDate }) {
  await queuePushNotification({
    toUid,
    title: `📅 Reminder: ${eventTitle}`,
    body: `Coming up: ${eventDate}`,
    url: 'events.html',
    type: 'event_reminder'
  });
}

// ===== NOTIFY AI LIMIT REACHED =====
export async function notifyAILimitReached({ toUid }) {
  await queuePushNotification({
    toUid,
    title: '🤖 LYNK AI — Daily Limit Reached',
    body: 'Upgrade to Premium for unlimited AI access.',
    url: 'premium.html',
    type: 'ai_limit'
  });
  showToast('🤖 Daily Limit Reached', 'You\'ve used your free 30 min of AI today. Upgrade to Premium for unlimited access.', 'assets/logo.jpg', 'premium.html');
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
