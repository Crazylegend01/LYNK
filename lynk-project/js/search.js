// ============================================================
// LYNK By Legends — Search Module
// ============================================================

import { auth, db } from './firebase-config.js';
import { ThemeManager } from './theme.js';
import { initNotifications, sendNotification, showToast } from './notifications.js';
import {
  collection, doc, getDoc, getDocs, setDoc,
  query, where, limit, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { onAuthStateChanged, signOut as firebaseSignOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

ThemeManager.init();

let currentUser = null;
let currentUserData = null;
let currentFilter = 'people';
let searchDebounceTimer = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'auth.html'; return; }
  currentUser = user;
  const snap = await getDoc(doc(db, 'users', user.uid));
  currentUserData = snap.data() || {};
  await initNotifications(user.uid);
  populateSidebar();

  const params = new URLSearchParams(window.location.search);
  const q = params.get('q');
  if (q) {
    const input = document.getElementById('search-input');
    if (input) input.value = q;
    runSearch(q);
  }
});

function populateSidebar() {
  const d = currentUserData;
  const ava = d.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(d.displayName||'U')}&background=a855f7&color=fff`;
  ['nav-avatar','sidebar-avatar'].forEach(id => { const el = document.getElementById(id); if (el) el.src = ava; });
  const sn = document.getElementById('sidebar-name'); if (sn) sn.textContent = d.displayName || 'LYNK User';
  const sd = document.getElementById('sidebar-dept'); if (sd) sd.textContent = `${d.department||''} · ${d.university||''}`;
  if (d.adminRole || d.role === 'admin') document.getElementById('admin-link')?.classList.remove('hidden');
}

window.onSearchInput = (value) => {
  clearTimeout(searchDebounceTimer);
  if (!value.trim()) {
    document.getElementById('results-container').innerHTML = `
      <div class="text-center py-16" style="color:var(--text-muted)">
        <div class="text-5xl mb-3">🔍</div>
        <p class="font-medium mb-1">Search LYNK</p>
        <p class="text-sm">Type to find people or posts</p>
      </div>`;
    document.getElementById('results-count').textContent = '';
    return;
  }
  if (value.trim().length < 2) return;
  document.getElementById('results-container').innerHTML = `
    <div class="lynk-card p-5 animate-pulse">
      <div class="h-3 rounded w-1/3 mb-2" style="background:var(--border)"></div>
      <div class="h-3 rounded w-1/2" style="background:var(--border)"></div>
    </div>`;
  searchDebounceTimer = setTimeout(() => runSearch(value.trim()), 500);
};

window.setSearchFilter = (filter, btn) => {
  currentFilter = filter;
  document.querySelectorAll('.search-filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const q = document.getElementById('search-input')?.value.trim();
  if (q && q.length >= 2) runSearch(q);
};

async function runSearch(searchQuery) {
  if (currentFilter === 'people') {
    await searchPeople(searchQuery);
  } else {
    await searchPosts(searchQuery);
  }
}

async function searchPeople(q) {
  const container = document.getElementById('results-container');
  const countEl   = document.getElementById('results-count');
  const lower = q.toLowerCase();
  try {
    const allSnap = await getDocs(query(collection(db, 'users'), limit(200)));
    const matched = new Map();
    allSnap.docs.forEach(d => {
      if (d.id === currentUser?.uid) return;
      const u = d.data();
      const hay = `${u.displayName||''} ${u.username||''} ${u.university||''} ${u.faculty||''} ${u.department||''} ${u.bio||''} ${(u.skills||[]).join(' ')} ${(u.interests||[]).join(' ')}`.toLowerCase();
      if (hay.includes(lower)) matched.set(d.id, u);
    });

    const results = [...matched.entries()].slice(0, 15);
    countEl.textContent = `${results.length} result${results.length !== 1 ? 's' : ''} for "${q}"`;

    if (results.length === 0) {
      container.innerHTML = `
        <div class="text-center py-16 lynk-card p-8" style="color:var(--text-muted)">
          <div class="text-4xl mb-3">😕</div>
          <p class="font-medium mb-1">No people found</p>
          <p class="text-sm">Try searching by name, username, university or skills</p>
        </div>`;
      return;
    }

    container.innerHTML = '';
    for (const [uid, u] of results) {
      const ava = u.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.displayName||'U')}&background=a855f7&color=fff&size=96`;
      const roleLabel = u.userType === 'staff' ? '👨‍🏫 Staff' : u.userType === 'alumni' ? '🏆 Alumni' : '🎓 Student';
      const roleColor = u.userType === 'staff' ? '#38bdf8' : u.userType === 'alumni' ? '#f59e0b' : 'var(--grad-1)';

      const [fromSnap, toSnap] = await Promise.all([
        getDoc(doc(db, 'friends', `${currentUser.uid}_${uid}`)),
        getDoc(doc(db, 'friends', `${uid}_${currentUser.uid}`))
      ]);

      let friendBtnText = '+ Add Friend';
      let friendBtnDisabled = false;
      if (fromSnap.exists()) {
        const st = fromSnap.data().status;
        if (st === 'accepted') { friendBtnText = '✓ Friends'; friendBtnDisabled = true; }
        else if (st === 'pending') { friendBtnText = '⏳ Sent'; friendBtnDisabled = true; }
      } else if (toSnap.exists() && toSnap.data().status === 'pending') {
        friendBtnText = '✅ Accept';
      }

      container.insertAdjacentHTML('beforeend', `
        <div class="lynk-card p-4 flex items-center gap-4 fade-in">
          <a href="profile.html?uid=${uid}" class="flex-shrink-0">
            <img src="${ava}" class="lynk-avatar w-14 h-14" />
          </a>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5 flex-wrap mb-0.5">
              <a href="profile.html?uid=${uid}" class="font-semibold hover:underline">${escHtml(u.displayName||'User')}</a>
              <span class="lynk-badge text-xs" style="background:rgba(168,85,247,0.1);color:${roleColor}">${roleLabel}</span>
              ${u.academicLevel ? `<span class="lynk-badge text-xs" style="background:var(--bg-card-hover);color:var(--text-muted)">${escHtml(u.academicLevel)}</span>` : ''}
            </div>
            <p class="text-xs mb-1" style="color:var(--text-muted)">@${u.username||''}</p>
            <p class="text-xs" style="color:var(--text-secondary)">${[u.faculty, u.department, u.university].filter(Boolean).join(' · ')}</p>
            ${u.skills?.length ? `<div class="flex flex-wrap gap-1 mt-1.5">${u.skills.slice(0,4).map(s=>`<span class="lynk-badge text-xs" style="background:rgba(168,85,247,0.08);color:var(--grad-1)">${escHtml(s)}</span>`).join('')}</div>` : ''}
          </div>
          <div class="flex flex-col gap-1 flex-shrink-0">
            <button onclick="searchAddFriend('${uid}','${escHtml(u.displayName||'')}','${ava}')"
                    id="srch-btn-${uid}"
                    ${friendBtnDisabled ? 'disabled' : ''}
                    class="lynk-btn lynk-btn-primary text-xs py-1.5 px-3 rounded-lg">${friendBtnText}</button>
            <a href="chat.html?uid=${uid}" class="lynk-btn lynk-btn-secondary text-xs py-1.5 px-3 rounded-lg text-center">💬 Message</a>
          </div>
        </div>`);
    }
  } catch (e) {
    container.innerHTML = `<div class="lynk-card p-6 text-center text-sm" style="color:var(--text-muted)">Error searching. Please try again.</div>`;
    console.error(e);
  }
}

async function searchPosts(q) {
  const container = document.getElementById('results-container');
  const countEl   = document.getElementById('results-count');
  try {
    const snap = await getDocs(query(collection(db, 'posts'), orderBy('createdAt','desc'), limit(200)));
    const lower = q.toLowerCase();
    const matched = snap.docs.filter(d => (d.data().content||'').toLowerCase().includes(lower));
    countEl.textContent = `${matched.length} post${matched.length !== 1 ? 's' : ''} for "${q}"`;

    if (matched.length === 0) {
      container.innerHTML = `
        <div class="text-center py-16 lynk-card p-8" style="color:var(--text-muted)">
          <div class="text-4xl mb-3">📭</div>
          <p class="font-medium mb-1">No posts found</p>
          <p class="text-sm">Try different keywords</p>
        </div>`;
      return;
    }

    container.innerHTML = '';
    matched.slice(0, 20).forEach(d => {
      const p = d.data();
      const ava = p.authorPhoto || `https://ui-avatars.com/api/?name=${encodeURIComponent(p.authorName||'U')}&background=a855f7&color=fff`;
      const ts = p.createdAt?.toDate?.()?.toLocaleDateString() || '';
      const content = escHtml(p.content || '');
      const highlighted = content.replace(new RegExp(escHtml(q).replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&'), 'gi'),
        m => `<mark style="background:rgba(168,85,247,0.25);color:var(--grad-1);border-radius:3px">${m}</mark>`);
      container.insertAdjacentHTML('beforeend', `
        <div class="lynk-card p-5 fade-in">
          <div class="flex items-center gap-2 mb-3">
            <img src="${ava}" class="lynk-avatar w-8 h-8" />
            <div>
              <a href="profile.html?uid=${p.authorId}" class="text-sm font-semibold hover:underline">${escHtml(p.authorName||'User')}</a>
              <p class="text-xs" style="color:var(--text-muted)">${ts}</p>
            </div>
          </div>
          <p class="text-sm">${highlighted.slice(0,300)}${content.length > 300 ? '…' : ''}</p>
          <div class="flex gap-4 mt-3 text-xs" style="color:var(--text-muted)">
            <span>❤️ ${p.likesCount||0}</span><span>💬 ${p.commentsCount||0}</span>
          </div>
        </div>`);
    });
  } catch (e) {
    container.innerHTML = `<div class="lynk-card p-6 text-center text-sm" style="color:var(--text-muted)">Error searching posts.</div>`;
  }
}

window.searchAddFriend = async (toUid, toName, toPhoto) => {
  const btn = document.getElementById(`srch-btn-${toUid}`);
  if (btn) { btn.textContent = '⏳ Sent'; btn.disabled = true; }
  await setDoc(doc(db, 'friends', `${currentUser.uid}_${toUid}`), {
    from: currentUser.uid, to: toUid, status: 'pending', createdAt: serverTimestamp()
  });
  await sendNotification({
    toUid, fromUid: currentUser.uid,
    fromName: currentUserData.displayName || 'Someone',
    fromPhoto: currentUserData.photoURL || '',
    type: 'friend_request', message: 'sent you a friend request',
    preview: `${currentUserData.faculty||''} · ${currentUserData.university||''}`
  });
  showToast('Request Sent! 🤝', `Friend request sent to ${toName}.`, toPhoto);
};

window.signOut = async () => {
  await firebaseSignOut(auth);
  window.location.href = 'auth.html';
};

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
