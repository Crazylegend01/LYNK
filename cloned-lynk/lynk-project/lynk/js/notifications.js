// ============================================================
// LYNK By Legends — Notification System
// Uses Firestore real-time listeners for in-app notifications
// Uses FCM for background push (when tab is closed)
// 100% Firebase — no third-party services required
// ============================================================

import { auth, db } from './firebase-config.js';
import {
  collection, doc, addDoc, updateDoc, onSnapshot, query,
  where, orderBy, limit, serverTimestamp, writeBatch, getDocs
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js";
import app from './firebase-config.js';

// ===== VAPID KEY =====
// Get this from Firebase Console → Project Settings → Cloud Messaging → Web Push Certificates
// Click "Generate key pair" and paste it here
const VAPID_KEY = 'BKbN3IxNBozzZdG1P2vJVyb-LJzyaHMRoapJ2wDapc7aFNHm2Uylb3Vs4S3Jh5WfAWrOIIViUHGznyNCBdyBysQ';

let messaging = null;
let currentUid = null;
let unsubNotifications = null;

// ===== INIT — call this on every page after auth =====
export async function initNotifications(uid) {
  currentUid = uid;
  renderNotificationBell();
  listenForNotifications(uid);
  await setupFCM(uid);
}

// ===== RENDER NOTIFICATION BELL IN NAVBAR =====
function renderNotificationBell() {
  const nav = document.querySelector('nav');
  if (!nav || document.getElementById('notif-bell')) return;

  // Find the theme toggle button to insert before it
  const themeBtn = document.getElementById('theme-toggle');
  const bellWrapper = document.createElement('div');
  bellWrapper.className = 'relative';
  bellWrapper.innerHTML = `
    <button id="notif-bell" onclick="toggleNotifDropdown()"
            class="lynk-btn lynk-btn-ghost p-2 rounded-full relative" aria-label="Notifications">
      🔔
      <span id="notif-badge" class="hidden absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full
            text-white text-[10px] font-bold flex items-center justify-center lynk-gradient px-1">0</span>
    </button>
    <!-- Dropdown -->
    <div id="notif-dropdown"
         class="hidden absolute right-0 top-12 w-80 lynk-card shadow-2xl z-50 overflow-hidden"
         style="max-height:420px">
      <div class="flex items-center justify-between px-4 py-3 border-b" style="border-color:var(--border)">
        <h3 class="font-semibold text-sm">Notifications</h3>
        <button onclick="markAllRead()" class="text-xs lynk-gradient-text font-medium">Mark all read</button>
      </div>
      <div id="notif-list" class="overflow-y-auto" style="max-height:340px">
        <div class="p-6 text-center text-sm" style="color:var(--text-muted)">Loading...</div>
      </div>
      <div class="px-4 py-2 border-t text-center" style="border-color:var(--border)">
        <a href="notifications.html" class="text-xs lynk-gradient-text font-medium">View all notifications →</a>
      </div>
    </div>`;

  if (themeBtn) {
    themeBtn.parentNode.insertBefore(bellWrapper, themeBtn);
  } else {
    nav.appendChild(bellWrapper);
  }

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('notif-dropdown');
    const bell = document.getElementById('notif-bell');
    if (dropdown && !dropdown.contains(e.target) && !bell?.contains(e.target)) {
      dropdown.classList.add('hidden');
    }
  });
}

// ===== TOGGLE DROPDOWN =====
window.toggleNotifDropdown = () => {
  const dd = document.getElementById('notif-dropdown');
  dd?.classList.toggle('hidden');
};

// ===== REAL-TIME LISTENER =====
function listenForNotifications(uid) {
  if (unsubNotifications) unsubNotifications();
  const q = query(
    collection(db, 'notifications'),
    where('toUid', '==', uid),
    orderBy('createdAt', 'desc'),
    limit(20)
  );
  unsubNotifications = onSnapshot(q, (snap) => {
    const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const unread = all.filter(n => !n.read);
    updateBadge(unread.length);
    renderNotifList(all);
  });
}

function updateBadge(count) {
  const badge = document.getElementById('notif-badge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : count;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function renderNotifList(notifications) {
  const list = document.getElementById('notif-list');
  if (!list) return;
  if (notifications.length === 0) {
    list.innerHTML = `<div class="p-8 text-center">
      <div class="text-4xl mb-2">🔔</div>
      <p class="text-sm" style="color:var(--text-muted)">You're all caught up!</p>
    </div>`;
    return;
  }
  list.innerHTML = notifications.map(n => buildNotifItem(n)).join('');
}

function buildNotifItem(n) {
  const icons = {
    like: '❤️', comment: '💬', friend_request: '🤝',
    friend_accepted: '✅', message: '💌', mention: '📣', poll: '📊'
  };
  const links = {
    like: `feed.html`,
    comment: `feed.html`,
    friend_request: `profile.html?uid=${n.fromUid}`,
    friend_accepted: `profile.html?uid=${n.fromUid}`,
    message: `chat.html?uid=${n.fromUid}`,
    mention: `feed.html`,
    poll: `feed.html`
  };
  const ts = n.createdAt?.toDate?.()?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) || '';
  const fromDate = n.createdAt?.toDate?.();
  const timeAgo = fromDate ? getTimeAgo(fromDate) : '';
  const ava = n.fromPhoto || `https://ui-avatars.com/api/?name=${encodeURIComponent(n.fromName||'U')}&background=a855f7&color=fff&size=40`;

  return `
    <a href="${links[n.type] || 'feed.html'}"
       onclick="markRead('${n.id}')"
       class="flex items-start gap-3 px-4 py-3 hover:bg-opacity-80 transition-colors border-b cursor-pointer block"
       style="background:${n.read ? 'transparent' : 'linear-gradient(135deg,var(--grad-1)08,var(--grad-3)08)'};border-color:var(--border);text-decoration:none;color:inherit">
      <div class="relative flex-shrink-0">
        <img src="${ava}" class="lynk-avatar w-9 h-9" />
        <span class="absolute -bottom-1 -right-1 text-sm leading-none">${icons[n.type] || '🔔'}</span>
      </div>
      <div class="flex-1 min-w-0">
        <p class="text-sm leading-snug">
          <strong>${escHtml(n.fromName || 'Someone')}</strong>
          <span style="color:var(--text-secondary)"> ${n.message || 'interacted with you'}</span>
        </p>
        ${n.preview ? `<p class="text-xs mt-0.5 truncate" style="color:var(--text-muted)">"${escHtml(n.preview)}"</p>` : ''}
        <p class="text-xs mt-1" style="color:var(--text-muted)">${timeAgo || ts}</p>
      </div>
      ${!n.read ? `<span class="w-2 h-2 rounded-full flex-shrink-0 mt-1" style="background:var(--grad-2)"></span>` : ''}
    </a>`;
}

// ===== MARK READ =====
window.markRead = async (notifId) => {
  await updateDoc(doc(db, 'notifications', notifId), { read: true });
};

window.markAllRead = async () => {
  if (!currentUid) return;
  const q = query(collection(db, 'notifications'), where('toUid', '==', currentUid), where('read', '==', false));
  const snap = await getDocs(q);
  const batch = writeBatch(db);
  snap.docs.forEach(d => batch.update(d.ref, { read: true }));
  await batch.commit();
};

// ===== SEND NOTIFICATION (write to Firestore) =====
export async function sendNotification({ toUid, fromUid, fromName, fromPhoto, type, message, preview = '' }) {
  if (!toUid || toUid === fromUid) return; // Don't notify yourself
  await addDoc(collection(db, 'notifications'), {
    toUid,
    fromUid,
    fromName,
    fromPhoto: fromPhoto || '',
    type,   // 'like' | 'comment' | 'friend_request' | 'friend_accepted' | 'message' | 'mention'
    message,
    preview,
    read: false,
    createdAt: serverTimestamp()
  });
}

// ===== FCM SETUP (background push) =====
async function setupFCM(uid) {
  if (!('serviceWorker' in navigator) || !('Notification' in window)) return;
  if (VAPID_KEY === 'YOUR_VAPID_KEY_HERE') return; // Skip if not configured

  try {
    messaging = getMessaging(app);

    // Register service worker
    const swReg = await navigator.serviceWorker.register('/LYNK/firebase-messaging-sw.js');

    // Get FCM token (only if permission already granted — don't auto-prompt)
    if (Notification.permission === 'granted') {
      const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: swReg });
      if (token) await saveFCMToken(uid, token);
    }

    // Handle foreground messages (app is open)
    onMessage(messaging, (payload) => {
      showToast(
        payload.notification?.title || 'LYNK',
        payload.notification?.body || '',
        payload.notification?.icon || ''
      );
    });
  } catch (e) {
    console.warn('FCM setup skipped:', e.message);
  }
}

// ===== REQUEST PUSH PERMISSION =====
export async function requestPushPermission(uid) {
  if (!('Notification' in window)) {
    alert('Your browser does not support push notifications.');
    return false;
  }
  if (VAPID_KEY === 'YOUR_VAPID_KEY_HERE') {
    alert('Push notifications need a VAPID key configured in js/notifications.js (see setup guide).');
    return false;
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;

  try {
    messaging = messaging || getMessaging(app);
    const swReg = await navigator.serviceWorker.register('/LYNK/firebase-messaging-sw.js');
    const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: swReg });
    if (token) await saveFCMToken(uid, token);
    return true;
  } catch (e) {
    console.error('FCM token error:', e);
    return false;
  }
}

async function saveFCMToken(uid, token) {
  await updateDoc(doc(db, 'users', uid), {
    fcmTokens: { [token]: true },
    pushEnabled: true
  });
}

// ===== FOREGROUND TOAST =====
export function showToast(title, body, icon = '', duration = 5000) {
  const existing = document.getElementById('lynk-toast-container');
  const container = existing || (() => {
    const el = document.createElement('div');
    el.id = 'lynk-toast-container';
    el.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:10px;max-width:320px';
    document.body.appendChild(el);
    return el;
  })();

  const toast = document.createElement('div');
  toast.style.cssText = 'background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:14px;display:flex;gap:12px;align-items:flex-start;box-shadow:var(--shadow);animation:fadeIn 0.3s ease;cursor:pointer';
  toast.innerHTML = `
    ${icon ? `<img src="${icon}" style="width:36px;height:36px;border-radius:50%;flex-shrink:0;object-fit:cover" />` : `<span style="font-size:1.5rem;flex-shrink:0">🔔</span>`}
    <div style="flex:1;min-width:0">
      <p style="font-weight:600;font-size:0.875rem;margin-bottom:2px">${escHtml(title)}</p>
      <p style="color:var(--text-secondary);font-size:0.8rem;line-height:1.3">${escHtml(body)}</p>
    </div>
    <button onclick="this.parentElement.remove()" style="color:var(--text-muted);background:none;border:none;cursor:pointer;font-size:1rem;flex-shrink:0;padding:0">✕</button>`;

  toast.addEventListener('click', (e) => { if (e.target.tagName !== 'BUTTON') toast.remove(); });
  container.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}

// ===== HELPERS =====
function getTimeAgo(date) {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff/86400)}d ago`;
  return date.toLocaleDateString();
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
