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

const SW_PATH = window.location.hostname.endsWith('.github.io')
  ? '/LYNK/firebase-messaging-sw.js'
  : '/firebase-messaging-sw.js';

const _isGitHubPages = window.location.hostname.endsWith('.github.io');
const API_BASE = _isGitHubPages ? null : '';

// Only show notification bell on the feed/home page
const _isFeedPage = window.location.pathname.endsWith('feed.html')
  || window.location.pathname.endsWith('/')
  || window.location.pathname === '';

let messaging = null;
let currentUid = null;
let unsubNotifications = null;
let _baseTitleSet = false;

// ===== INIT — call on every page after auth =====
export async function initNotifications(uid) {
  currentUid = uid;
  // Only inject bell on home/feed page
  if (_isFeedPage) {
    renderNotificationBell();
    injectSidebarBadges();
  }
  listenForNotifications(uid);
  await setupFCM(uid);
  if (Notification.permission === 'default') {
    setTimeout(() => showPushPromptBanner(uid), 3000);
  }
}

// ===== NAVBAR BELL (dropdown) — only on feed page =====
function renderNotificationBell() {
  const nav = document.querySelector('nav');
  if (!nav || document.getElementById('notif-bell')) return;

  const bellWrapper = document.createElement('div');
  bellWrapper.className = 'relative';
  bellWrapper.id = 'notif-bell-wrapper';
  bellWrapper.innerHTML = `
    <button id="notif-bell" onclick="toggleNotifDropdown()"
            class="lynk-icon-btn relative" aria-label="Notifications">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
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
        <a href="notifications.html" class="text-xs lynk-gradient-text font-medium">View all notifications</a>
      </div>
    </div>`;

  // Insert before avatar (last child of right icons section)
  const navRight = nav.querySelector('.flex.items-center.gap-2');
  if (navRight) {
    navRight.insertBefore(bellWrapper, navRight.firstChild);
  } else {
    nav.appendChild(bellWrapper);
  }

  document.addEventListener('click', (e) => {
    const wrapper = document.getElementById('notif-bell-wrapper');
    if (wrapper && !wrapper.contains(e.target)) {
      document.getElementById('notif-dropdown')?.classList.add('hidden');
    }
  });
}

// ===== SIDEBAR BADGE =====
function injectSidebarBadges() {
  // Badge on Messages link
  const chatLink = document.querySelector('a[href="chat.html"]');
  if (chatLink && !chatLink.querySelector('.msg-badge')) {
    const badge = document.createElement('span');
    badge.className = 'msg-badge hidden ml-auto min-w-[18px] h-[18px] rounded-full text-white text-[10px] font-bold flex items-center justify-center lynk-gradient px-1';
    badge.id = 'sidebar-msg-badge';
    chatLink.appendChild(badge);
  }
}

// ===== LISTEN FOR REAL-TIME NOTIFICATIONS =====
function listenForNotifications(uid) {
  if (unsubNotifications) unsubNotifications();
  const q = query(
    collection(db, 'users', uid, 'notifications'),
    where('read', '==', false),
    orderBy('createdAt', 'desc'),
    limit(30)
  );
  unsubNotifications = onSnapshot(q, (snap) => {
    const count = snap.docs.length;
    updateBadges(count);
    renderNotifList(snap.docs);
    updateTabTitle(count);
  });
}

function updateBadges(count) {
  const badge = document.getElementById('notif-bell-badge');
  if (badge) {
    badge.textContent = count > 99 ? '99+' : count;
    badge.classList.toggle('hidden', count === 0);
  }
  const oldBadge = document.getElementById('notif-badge');
  if (oldBadge) {
    oldBadge.textContent = count;
    oldBadge.classList.toggle('hidden', count === 0);
  }
}

function updateTabTitle(count) {
  if (!_baseTitleSet) { _baseTitleSet = true; }
  const base = document.title.replace(/^\(\d+\)\s*/, '');
  document.title = count > 0 ? `(${count}) ${base}` : base;
}

function renderNotifList(docs) {
  const list = document.getElementById('notif-list');
  if (!list) return;
  if (docs.length === 0) {
    list.innerHTML = '<div class="p-6 text-center text-sm" style="color:var(--text-muted)">No new notifications</div>';
    return;
  }
  list.innerHTML = '';
  docs.slice(0, 10).forEach(d => {
    const n = d.data();
    const ts = n.createdAt?.toDate?.()?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) || '';
    const ava = n.fromPhoto || `https://ui-avatars.com/api/?name=${encodeURIComponent(n.fromName||'U')}&background=a855f7&color=fff&size=48`;
    const icons = { like: '❤', comment: '💬', friend_request: '🤝', poll: '📊', message: '✉', announcement: '📢' };
    list.insertAdjacentHTML('beforeend', `
      <div class="flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors border-b"
           style="border-color:var(--border);background:var(--bg-card-hover)"
           onclick="markOneRead('${d.id}')">
        <div class="relative flex-shrink-0">
          <img src="${ava}" class="lynk-avatar w-9 h-9" />
          <span class="absolute -bottom-1 -right-1 text-xs leading-none">${icons[n.type] || '🔔'}</span>
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm"><strong>${escHtml(n.fromName || 'Someone')}</strong> ${escHtml(n.message || '')}</p>
          ${n.preview ? `<p class="text-xs mt-0.5 truncate" style="color:var(--text-muted)">${escHtml(n.preview)}</p>` : ''}
          <p class="text-xs mt-1" style="color:var(--text-muted)">${ts}</p>
        </div>
      </div>`);
  });
}

window.toggleNotifDropdown = () => {
  document.getElementById('notif-dropdown')?.classList.toggle('hidden');
};

window.markAllRead = async () => {
  if (!currentUid) return;
  const snap = await getDocs(query(
    collection(db, 'users', currentUid, 'notifications'),
    where('read', '==', false), limit(50)
  ));
  if (snap.empty) return;
  const batch = writeBatch(db);
  snap.docs.forEach(d => batch.update(d.ref, { read: true }));
  await batch.commit();
  document.getElementById('notif-dropdown')?.classList.add('hidden');
};

window.markOneRead = async (notifId) => {
  if (!currentUid) return;
  await updateDoc(doc(db, 'users', currentUid, 'notifications', notifId), { read: true });
};

// ===== SEND NOTIFICATION =====
export async function sendNotification({ toUid, fromUid, fromName, fromPhoto, type, message, preview }) {
  if (!toUid || toUid === fromUid) return;
  try {
    await addDoc(collection(db, 'users', toUid, 'notifications'), {
      fromUid, fromName, fromPhoto, type, message, preview,
      read: false, createdAt: serverTimestamp()
    });
  } catch (e) { /* silent */ }
}

// ===== FCM SETUP =====
async function setupFCM(uid) {
  try {
    if (!('serviceWorker' in navigator) || !('Notification' in window)) return;
    messaging = getMessaging(app);
    onMessage(messaging, (payload) => {
      showToast(
        payload.notification?.title || 'New notification',
        payload.notification?.body || '',
        payload.notification?.image || ''
      );
    });
  } catch (e) { /* silent */ }
}

export async function requestPushPermission(uid) {
  try {
    if (!('serviceWorker' in navigator)) return false;
    const reg = await navigator.serviceWorker.register(SW_PATH);
    messaging = getMessaging(app);
    const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
    if (token) {
      await updateDoc(doc(db, 'users', uid), { fcmToken: token });
      return true;
    }
  } catch (e) { /* silent */ }
  return false;
}

// ===== PUSH PROMPT BANNER =====
function showPushPromptBanner(uid) {
  if (document.getElementById('push-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'push-banner';
  banner.style.cssText = 'position:fixed;bottom:72px;left:50%;transform:translateX(-50%);z-index:800;max-width:360px;width:calc(100% - 32px)';
  banner.innerHTML = `
    <div class="lynk-card p-4 flex items-center gap-3 shadow-2xl" style="border-left:3px solid var(--grad-1)">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
      <div class="flex-1 min-w-0">
        <p class="text-xs font-semibold">Stay in the loop</p>
        <p class="text-xs" style="color:var(--text-muted)">Enable notifications for likes and messages</p>
      </div>
      <button onclick="enablePush('${uid}')" class="lynk-btn lynk-btn-primary text-xs py-1.5 px-3 rounded-lg flex-shrink-0">Allow</button>
      <button onclick="document.getElementById('push-banner').remove()" class="lynk-icon-btn w-6 h-6 flex-shrink-0">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>`;
  document.body.appendChild(banner);
  setTimeout(() => banner.remove(), 10000);
}

window.enablePush = async (uid) => {
  document.getElementById('push-banner')?.remove();
  await requestPushPermission(uid);
};

// ===== TOAST =====
export function showToast(title, body, avatarUrl) {
  const existing = document.getElementById('lynk-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'lynk-toast';
  toast.style.cssText = 'position:fixed;bottom:80px;right:16px;z-index:9999;max-width:320px;animation:fadeIn 0.3s ease';
  const ava = avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(title||'L')}&background=a855f7&color=fff&size=40`;
  toast.innerHTML = `
    <div class="lynk-card p-3 flex items-start gap-3 shadow-2xl" style="border-left:3px solid var(--grad-1)">
      <img src="${ava}" class="lynk-avatar w-9 h-9 flex-shrink-0" onerror="this.src='https://ui-avatars.com/api/?name=L&background=a855f7&color=fff'" />
      <div class="flex-1 min-w-0">
        <p class="font-semibold text-sm truncate">${escHtml(title)}</p>
        <p class="text-xs truncate" style="color:var(--text-secondary)">${escHtml(body)}</p>
      </div>
      <button onclick="this.closest('#lynk-toast').remove()" class="lynk-icon-btn w-6 h-6 flex-shrink-0">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>`;
  document.body.appendChild(toast);
  setTimeout(() => toast?.remove(), 5000);
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
