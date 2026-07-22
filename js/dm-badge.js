// ============================================================
// LYNK By Legends — Real-time DM badge on bottom nav chat icon
// Self-contained: works on every page with a bottom nav.
// ============================================================

import { auth, db } from './firebase-config.js';
import {
  collection, query, where, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

let _dmUnsub = null;

function injectBadgeCSS() {
  if (document.getElementById('dm-badge-style')) return;
  const s = document.createElement('style');
  s.id = 'dm-badge-style';
  s.textContent = `
    .bnav-chat-wrap { position: relative; display: flex; flex-direction: column; align-items: center; gap: 2px; }
    .bnav-dm-badge {
      position: absolute; top: -3px; right: -6px;
      min-width: 16px; height: 16px; border-radius: 99px;
      background: #ef4444; color: #fff; font-size: 10px; font-weight: 700;
      display: none; align-items: center; justify-content: center;
      padding: 0 4px; box-shadow: 0 0 0 2px var(--bg-base, #0f0f1a);
      line-height: 1;
    }
    .bnav-dm-badge.show { display: flex; }
  `;
  document.head.appendChild(s);
}

function attachBadge() {
  // Find chat link in bottom nav
  const nav  = document.querySelector('.lynk-bottom-nav');
  if (!nav) return null;
  const link = nav.querySelector('a[href="chat.html"]');
  if (!link) return null;

  // Wrap contents for badge positioning
  const icon = link.querySelector('.bnav-icon');
  if (!icon) return null;

  if (link.querySelector('.bnav-dm-badge')) return link.querySelector('.bnav-dm-badge');

  // Wrap the icon in a relative container
  const wrap = document.createElement('span');
  wrap.className = 'bnav-chat-wrap';
  icon.parentNode.insertBefore(wrap, icon);
  wrap.appendChild(icon);

  const badge = document.createElement('span');
  badge.className = 'bnav-dm-badge';
  badge.id = 'bnav-dm-badge';
  wrap.appendChild(badge);
  return badge;
}

function listenDMCount(uid) {
  if (_dmUnsub) { _dmUnsub(); _dmUnsub = null; }

  const badge = attachBadge();
  if (!badge) return;

  const q = query(
    collection(db, 'conversations'),
    where('participants', 'array-contains', uid)
  );

  _dmUnsub = onSnapshot(q, (snap) => {
    let total = 0;
    snap.forEach(d => { total += d.data().unread?.[uid] || 0; });
    if (total > 0) {
      badge.textContent = total > 99 ? '99+' : String(total);
      badge.classList.add('show');
    } else {
      badge.classList.remove('show');
    }
  }, () => {});
}

injectBadgeCSS();

onAuthStateChanged(auth, (user) => {
  if (user) listenDMCount(user.uid);
  else if (_dmUnsub) { _dmUnsub(); _dmUnsub = null; }
});
