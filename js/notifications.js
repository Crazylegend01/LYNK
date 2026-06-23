// ============================================================
// LYNK By Legends — Notification System
// Real-time in-app badge + dropdown + FCM background push
// ============================================================

import { auth, db } from './firebase-config.js';
import {
  collection, doc, addDoc, updateDoc, onSnapshot, query,
  where, orderBy, limit, serverTimestamp, writeBatch, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";
import app from './firebase-config.js';

const VAPID_KEY = 'BKbN3IxNBozzZdG1P2vJVyb-LJzyaHMRoapJ2wDapc7aFNHm2Uylb3Vs4S3Jh5WfAWrOIIViUHGznyNCBdyBysQ';

// Service worker path — works on GitHub Pages (/LYNK/) and Replit (/)
const SW_PATH = window.location.hostname.endsWith('.github.io')
  ? '/LYNK/firebase-messaging-sw.js'
  : '/firebase-messaging-sw.js';

// API base — relative on Replit, undefined on GitHub Pages (server not available)
const _isGitHubPages = window.location.hostname.endsWith('.github.io');
const API_BASE = _isGitHubPages ? null : '';

let messaging = null;
let currentUid = null;
let unsubNotifications = null;
let _baseTitleSet = false;

// ===== INIT — call on every page after auth =====
export async function initNotifications(uid) {
  currentUid = uid;
  renderNotificationBell();
  injectSidebarBadges();
  listenForNotifications(uid);
  await setupFCM(uid);
  // Subtle push permission prompt (shown once, respects prior decisions)
  if (Notification.permission === 'default') {
    setTimeout(() => showPushPromptBanner(uid), 3000);
  }
}

// ===== NAVBAR BELL (dropdown) =====
function renderNotificationBell() {
  const nav = document.querySelector('nav');
  if (!nav || document.getElementById('notif-bell')) return;

  const themeBtn = document.getElementById('theme-toggle');
  const bellWrapper = document.createElement('div');
  bellWrapper.className = 'relative';
  bellWrapper.id = 'notif-bell-wrapper';
  bellWrapper.innerHTML = `
    <button id="notif-bell" onclick="toggleNotifDropdown()"
            class="lynk-btn lynk-btn-ghost p-2 rounded-full relative" aria-label="Notifications">
      🔔
      <span id="notif-bell-badge" class="hidden absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full
            text-white text-[10px] font-bold flex items-center justify-center lynk-gradient px-1">0</span>
    </button>
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

  document.addEventListener('click', (e) => {
    const dd   = document.getElementById('notif-dropdown');
    const bell = document.getElementById('notif-bell');
    if (dd && !dd.contains(e.target) && !bell?.contains(e.target)) {
      dd.classList.add('hidden');
    }
  });
}

// ===== SIDEBAR BADGES — auto-inject into every notification link =====
function injectSidebarBadges() {
  // Find every sidebar link that goes to notifications (sidebar links have class lynk-sidebar-link)
  document.querySelectorAll('a.lynk-sidebar-link[href*="notifications"]').forEach(link => {
    if (link.querySelector('.lynk-sidebar-notif-badge')) return; // already injected
    link.style.display = 'flex';
    link.style.alignItems = 'center';
    const badge = document.createElement('span');
    badge.className = 'lynk-sidebar-notif-badge hidden ml-auto min-w-[18px] h-[18px] rounded-full text-white text-[10px] font-bold flex items-center justify-center lynk-gradient px-1';
    badge.style.cssText = 'display:none;margin-left:auto;min-width:18px;height:18px;border-radius:9999px;color:white;font-size:10px;font-weight:700;align-items:center;justify-content:center;background:linear-gradient(135deg,var(--grad-1),var(--grad-3));padding:0 4px;';
    badge.textContent = '0';
    link.appendChild(badge);
  });
}

// ===== TOGGLE DROPDOWN =====
window.toggleNotifDropdown = () => {
  document.getElementById('notif-dropdown')?.classList.toggle('hidden');
};

// ===== REAL-TIME LISTENER (onSnapshot — works on GitHub Pages) =====
function listenForNotifications(uid) {
  if (unsubNotifications) unsubNotifications();
  const q = query(
    collection(db, 'notifications'),
    where('toUid', '==', uid),
    orderBy('createdAt', 'desc'),
    limit(20)
  );
  unsubNotifications = onSnapshot(q, (snap) => {
    const all    = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const unread = all.filter(n => !n.read).length;
    updateAllBadges(unread);
    renderNotifList(all);
  });
}

// ===== UPDATE ALL BADGES ON THE PAGE =====
function updateAllBadges(count) {
  const show = count > 0;
  const label = count > 99 ? '99+' : String(count);

  // 1. Navbar dropdown bell badge
  const bellBadge = document.getElementById('notif-bell-badge');
  if (bellBadge) {
    bellBadge.textContent = label;
    bellBadge.style.display = show ? 'flex' : 'none';
    show ? bellBadge.classList.remove('hidden') : bellBadge.classList.add('hidden');
  }

  // 2. Static navbar bell badge (feed.html hardcoded bell with id="notif-bell")
  //    Its inner badge has id="notif-badge"
  const staticBadge = document.getElementById('notif-badge');
  if (staticBadge) {
    staticBadge.textContent = show ? label : '!';
    show ? staticBadge.classList.remove('hidden') : staticBadge.classList.add('hidden');
  }

  // 3. All sidebar notification link badges (injected by injectSidebarBadges)
  document.querySelectorAll('.lynk-sidebar-notif-badge').forEach(el => {
    el.textContent = label;
    el.style.display = show ? 'flex' : 'none';
  });

  // 4. Document title — shows "(3) Feed — LYNK By Legends"
  if (!_baseTitleSet) {
    document._lynkBaseTitle = document.title.replace(/^\(\d+\+?\)\s/, '');
    _baseTitleSet = true;
  }
  document.title = show
    ? `(${label}) ${document._lynkBaseTitle || document.title}`
    : (document._lynkBaseTitle || document.title);
}

// ===== RENDER NOTIFICATION LIST (dropdown) =====
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
    friend_accepted: '✅', message: '💌', mention: '📣', poll: '📊',
    announcement: '📢'
  };
  const links = {
    like: 'feed.html', comment: 'feed.html', poll: 'feed.html', mention: 'feed.html',
    friend_request: `profile.html?uid=${n.fromUid}`,
    friend_accepted: `profile.html?uid=${n.fromUid}`,
    message: `chat.html?uid=${n.fromUid}`,
    announcement: 'announcements.html'
  };
  const ts  = n.createdAt?.toDate?.()?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) || '';
  const ago = n.createdAt?.toDate ? getTimeAgo(n.createdAt.toDate()) : '';
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
          <strong>${escHtml(n.fromName || 'LYNK')}</strong>
          <span style="color:var(--text-secondary)"> ${n.message || 'interacted with you'}</span>
        </p>
        ${n.preview ? `<p class="text-xs mt-0.5 truncate" style="color:var(--text-muted)">"${escHtml(n.preview)}"</p>` : ''}
        <p class="text-xs mt-1" style="color:var(--text-muted)">${ago || ts}</p>
      </div>
      ${!n.read ? `<span class="w-2 h-2 rounded-full flex-shrink-0 mt-1.5" style="background:var(--grad-2)"></span>` : ''}
    </a>`;
}

// ===== MARK READ =====
window.markRead = async (notifId) => {
  await updateDoc(doc(db, 'notifications', notifId), { read: true });
};

window.markAllRead = async () => {
  if (!currentUid) return;
  const q = query(
    collection(db, 'notifications'),
    where('toUid', '==', currentUid),
    where('read', '==', false)
  );
  const snap  = await getDocs(q);
  const batch = writeBatch(db);
  snap.docs.forEach(d => batch.update(d.ref, { read: true }));
  await batch.commit();
};

// ===== SEND NOTIFICATION (Firestore + FCM push) =====
export async function sendNotification({ toUid, fromUid, fromName, fromPhoto, type, message, preview = '', icon = '', url = '' }) {
  if (!toUid || toUid === fromUid) return;
  await addDoc(collection(db, 'notifications'), {
    toUid, fromUid,
    fromName, fromPhoto: fromPhoto || '',
    type, message, preview,
    read: false,
    createdAt: serverTimestamp()
  });
  // Also trigger a device push (works when app is closed)
  const pushTitle = `LYNK — ${fromName || 'Someone'}`;
  const pushBody  = message || 'You have a new notification';
  triggerPush({ toUid, title: pushTitle, body: pushBody, icon: fromPhoto || icon, url });
}

// ===== PUSH PROMPT BANNER (shown once after login if permission not decided) =====
function showPushPromptBanner(uid) {
  if (document.getElementById('lynk-push-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'lynk-push-banner';
  banner.style.cssText = 'position:fixed;bottom:72px;left:50%;transform:translateX(-50%);z-index:8888;max-width:380px;width:calc(100% - 32px);background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:14px 16px;display:flex;align-items:center;gap:12px;box-shadow:var(--shadow);animation:fadeIn 0.3s ease';
  banner.innerHTML = `
    <span style="font-size:1.6rem;flex-shrink:0">🔔</span>
    <div style="flex:1;min-width:0">
      <p style="font-weight:600;font-size:0.85rem;margin-bottom:2px">Enable push notifications</p>
      <p style="color:var(--text-muted);font-size:0.75rem">Get notified of likes, messages, and more — even when you're away.</p>
    </div>
    <div style="display:flex;gap:6px;flex-shrink:0">
      <button id="lynk-push-deny" style="background:none;border:none;color:var(--text-muted);font-size:0.8rem;cursor:pointer;padding:6px 8px;border-radius:8px">Not now</button>
      <button id="lynk-push-allow" class="lynk-btn lynk-btn-primary" style="font-size:0.8rem;padding:6px 14px;border-radius:8px">Allow</button>
    </div>`;
  document.body.appendChild(banner);
  document.getElementById('lynk-push-allow').onclick = async () => {
    banner.remove();
    const ok = await requestPushPermission(uid);
    if (ok) showToast('🔔 Push enabled', 'You\'ll now receive notifications even when away.');
  };
  document.getElementById('lynk-push-deny').onclick = () => banner.remove();
  setTimeout(() => banner?.remove(), 20000);
}

// ===== FCM SETUP (background push — works on GitHub Pages via service worker) =====
async function setupFCM(uid) {
  if (!('serviceWorker' in navigator) || !('Notification' in window)) return;
  try {
    messaging = getMessaging(app);
    const swReg = await navigator.serviceWorker.register(SW_PATH);
    if (Notification.permission === 'granted') {
      const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: swReg });
      if (token) await saveFCMToken(uid, token);
    }
    onMessage(messaging, (payload) => {
      showToast(
        payload.notification?.title || 'LYNK',
        payload.notification?.body  || '',
        payload.notification?.icon  || ''
      );
    });
  } catch (e) {
    // FCM not critical — in-app onSnapshot badge works without it
  }
}

export async function requestPushPermission(uid) {
  if (!('Notification' in window)) { showToast('❌ Not supported', 'Your browser does not support push notifications.'); return false; }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;
  try {
    messaging = messaging || getMessaging(app);
    const swReg = await navigator.serviceWorker.register(SW_PATH);
    const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: swReg });
    if (token) await saveFCMToken(uid, token);
    return true;
  } catch (e) { console.error('FCM token error:', e); return false; }
}

async function saveFCMToken(uid, token) {
  await updateDoc(doc(db, 'users', uid), { fcmTokens: { [token]: true }, pushEnabled: true });
}

// ===== SERVER PUSH — calls Express API to trigger FCM when app is in background =====
export async function triggerPush({ toUid, title, body, icon = '', url = '' }) {
  if (API_BASE === null || !toUid) return;
  try {
    await fetch(`${API_BASE}/api/notify/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toUid, title, body, icon, url }),
    });
  } catch (_) {
    // Server not available — in-app notification still works via Firestore
  }
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
  if (diff < 60)     return 'just now';
  if (diff < 3600)   return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400)  return `${Math.floor(diff/3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff/86400)}d ago`;
  return date.toLocaleDateString();
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
