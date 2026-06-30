// ============================================================
// LYNK By Legends — Clubs & Organizations Module (Phase 3)
// ============================================================

import { auth, db } from './firebase-config.js';
import { ThemeManager } from './theme.js';
import {
  collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, serverTimestamp, increment
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged, signOut as firebaseSignOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

ThemeManager.init();

let currentUser = null;
let currentUserData = null;
let currentFilter = 'all';
let allClubs = [];

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'auth.html'; return; }
  currentUser = user;
  const snap = await getDoc(doc(db, 'users', user.uid));
  currentUserData = snap.data() || {};

  const navAvatar = document.getElementById('nav-avatar');
  if (navAvatar) navAvatar.src = currentUserData.photoURL || `https://ui-avatars.com/api/?name=U&background=a855f7&color=fff`;
  if (currentUserData.role === 'admin' || currentUserData.adminRole) {
    document.getElementById('admin-link')?.classList.remove('hidden');
  }

  loadClubs();
});

async function loadClubs() {
  const grid = document.getElementById('clubs-grid');
  grid.innerHTML = skeletons();

  try {
    let q;
    if (currentFilter === 'mine') {
      const memberSnap = await getDocs(query(
        collection(db, 'clubMembers'),
        where('uid', '==', currentUser.uid),
        limit(20)
      ));
      const ids = memberSnap.docs.map(d => d.data().clubId);
      if (ids.length === 0) { grid.innerHTML = emptyState('No clubs joined', 'Browse and join clubs or create your own!'); return; }
      const snaps = await Promise.all(ids.map(id => getDoc(doc(db, 'clubs', id))));
      allClubs = snaps.filter(s => s.exists()).map(s => ({ id: s.id, ...s.data() }));
    } else if (currentFilter === 'all') {
      q = query(collection(db, 'clubs'), orderBy('memberCount', 'desc'), limit(40));
      const snap = await getDocs(q);
      allClubs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } else {
      q = query(collection(db, 'clubs'), where('category', '==', currentFilter), orderBy('memberCount', 'desc'), limit(30));
      const snap = await getDocs(q);
      allClubs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }

    renderClubs(allClubs);
  } catch (err) {
    console.warn('Clubs error:', err.message);
    try {
      const snap = await getDocs(query(collection(db, 'clubs'), limit(30)));
      allClubs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderClubs(allClubs);
    } catch {
      grid.innerHTML = `<div class="col-span-full text-center py-10 text-sm" style="color:var(--text-muted)">Error loading clubs.</div>`;
    }
  }
}

async function renderClubs(clubs) {
  const grid = document.getElementById('clubs-grid');
  if (clubs.length === 0) { grid.innerHTML = emptyState('No clubs found', 'Be the first to create a club for your campus!'); return; }

  const memberChecks = await Promise.all(clubs.map(c =>
    getDoc(doc(db, 'clubMembers', `${c.id}_${currentUser.uid}`))
  ));
  const memberMap = {};
  memberChecks.forEach((s, i) => { memberMap[clubs[i].id] = s.exists(); });

  const catColors = {
    academic: '#a855f7,#6366f1', tech: '#06b6d4,#3b82f6', sports: '#22c55e,#10b981',
    arts: '#f97316,#ec4899', religious: '#f59e0b,#d97706', social: '#818cf8,#c084fc',
    political: '#ef4444,#dc2626', other: '#64748b,#475569'
  };

  grid.innerHTML = '';
  clubs.forEach(c => {
    const colors = catColors[c.category] || '#a855f7,#06b6d4';
    const isMember = memberMap[c.id] || false;
    const catLabels = { academic: '📚', tech: '💻', sports: '⚽', arts: '🎨', religious: '🕌', social: '🤝', political: '🗳️', other: '📌' };

    grid.insertAdjacentHTML('beforeend', `
      <div class="community-card cursor-pointer" onclick="openClub('${c.id}')">
        <div class="community-banner" style="background:linear-gradient(135deg,${colors})">
          <span class="community-type-badge">${(c.category || 'club').toUpperCase()}</span>
        </div>
        <div class="p-4 mt-8 relative">
          <div class="absolute -top-8 left-4 text-3xl bg-white/10 backdrop-blur rounded-xl p-1">${c.icon || catLabels[c.category] || '⭐'}</div>
          <h3 class="font-bold text-sm mb-1 truncate">${escHtml(c.name)}</h3>
          <p class="text-xs mb-2 line-clamp-2" style="color:var(--text-secondary)">${escHtml(c.description || 'No description')}</p>
          <div class="flex items-center justify-between">
            <span class="text-xs" style="color:var(--text-muted)">${c.memberCount || 0} members</span>
            <button onclick="event.stopPropagation();joinLeaveClub('${c.id}',${!isMember})"
              class="lynk-btn text-xs py-1 px-3 ${isMember ? 'lynk-btn-secondary' : 'lynk-btn-primary'}"
              id="club-join-btn-${c.id}">
              ${isMember ? '✓ Joined' : 'Join'}
            </button>
          </div>
        </div>
      </div>`);
  });
}

// ===== OPEN CLUB MODAL =====
window.openClub = async (clubId) => {
  const snap = await getDoc(doc(db, 'clubs', clubId));
  if (!snap.exists()) return;
  const club = { id: snap.id, ...snap.data() };

  const isMember = (await getDoc(doc(db, 'clubMembers', `${clubId}_${currentUser.uid}`))).exists();
  const membersSnap = await getDocs(query(collection(db, 'clubMembers'), where('clubId', '==', clubId), limit(20)));
  const postsSnap = await getDocs(query(collection(db, 'clubPosts'), where('clubId', '==', clubId), orderBy('createdAt', 'desc'), limit(10)));

  const membersHtml = membersSnap.docs.map(d => {
    const m = d.data();
    const ava = m.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(m.displayName||'U')}&background=a855f7&color=fff`;
    return `<div class="flex items-center gap-3 p-2 rounded-xl hover:opacity-80"><img src="${ava}" class="lynk-avatar w-8 h-8" /><span class="text-sm">${escHtml(m.displayName || 'Member')}</span>${m.role === 'admin' ? '<span class="lynk-badge text-xs px-2 ml-auto" style="background:rgba(168,85,247,0.1);color:var(--grad-1)">Admin</span>' : ''}</div>`;
  }).join('');

  const postsHtml = postsSnap.docs.length === 0
    ? '<p class="text-sm text-center py-4" style="color:var(--text-muted)">No posts yet.</p>'
    : postsSnap.docs.map(d => {
        const p = d.data();
        const ava = p.authorPhoto || `https://ui-avatars.com/api/?name=U&background=a855f7&color=fff`;
        const ts = p.createdAt?.toDate?.()?.toLocaleDateString() || '';
        return `<div class="flex gap-3 p-3 border-b" style="border-color:var(--border)"><img src="${ava}" class="lynk-avatar w-8 h-8 flex-shrink-0"/><div><p class="text-xs font-semibold">${escHtml(p.authorName || 'Member')} <span style="color:var(--text-muted);font-weight:400">${ts}</span></p><p class="text-sm mt-1">${escHtml(p.content)}</p></div></div>`;
      }).join('');

  document.getElementById('club-modal-content').innerHTML = `
    <div class="p-5">
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-3">
          <div class="w-12 h-12 rounded-xl lynk-gradient flex items-center justify-center text-2xl">${club.icon || '⭐'}</div>
          <div><h2 class="font-bold">${escHtml(club.name)}</h2><p class="text-xs" style="color:var(--text-muted)">${(club.category || 'club').toUpperCase()} · ${club.memberCount || 0} members</p></div>
        </div>
        <div class="flex items-center gap-2">
          <button onclick="joinLeaveClub('${clubId}',${!isMember})"
            class="lynk-btn text-sm ${isMember ? 'lynk-btn-secondary' : 'lynk-btn-primary'}"
            id="modal-club-btn-${clubId}">${isMember ? '✓ Joined' : 'Join Club'}</button>
          <button onclick="closeClubModal()" class="lynk-icon-btn"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
      </div>
      <p class="text-sm mb-4" style="color:var(--text-secondary)">${escHtml(club.description || 'No description.')}</p>

      ${isMember ? `<div class="mb-4 flex gap-2">
        <img src="${currentUserData.photoURL || `https://ui-avatars.com/api/?name=U&background=a855f7&color=fff`}" class="lynk-avatar w-9 h-9 flex-shrink-0" />
        <div class="flex-1 flex gap-2">
          <input id="club-post-input-${clubId}" class="lynk-input flex-1 text-sm" placeholder="Post to this club..." />
          <button onclick="postToClub('${clubId}')" class="lynk-btn lynk-btn-primary text-sm py-2 px-3">Post</button>
        </div>
      </div>` : ''}

      <div class="mb-4">
        <h4 class="font-semibold text-sm mb-2">Recent Posts</h4>
        ${postsHtml}
      </div>
      <div>
        <h4 class="font-semibold text-sm mb-2">Members (${membersSnap.size})</h4>
        ${membersHtml}
      </div>
    </div>`;

  document.getElementById('club-modal').classList.remove('hidden');
};

window.closeClubModal = (e) => {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('club-modal').classList.add('hidden');
};

// ===== JOIN/LEAVE CLUB =====
window.joinLeaveClub = async (clubId, join) => {
  const memberId = `${clubId}_${currentUser.uid}`;

  if (join) {
    await setDoc(doc(db, 'clubMembers', memberId), {
      clubId, uid: currentUser.uid,
      displayName: currentUserData.displayName || '',
      photoURL: currentUserData.photoURL || '',
      role: 'member', joinedAt: serverTimestamp()
    });
    await updateDoc(doc(db, 'clubs', clubId), { memberCount: increment(1) });
  } else {
    await deleteDoc(doc(db, 'clubMembers', memberId));
    await updateDoc(doc(db, 'clubs', clubId), { memberCount: increment(-1) });
  }

  // Update button states
  const gridBtn = document.getElementById(`club-join-btn-${clubId}`);
  const modalBtn = document.getElementById(`modal-club-btn-${clubId}`);
  [gridBtn, modalBtn].forEach(btn => {
    if (btn) {
      btn.textContent = join ? '✓ Joined' : 'Join';
      btn.className = `lynk-btn text-xs py-1 px-3 ${join ? 'lynk-btn-secondary' : 'lynk-btn-primary'}`;
    }
  });
};

// ===== POST TO CLUB =====
window.postToClub = async (clubId) => {
  const input = document.getElementById(`club-post-input-${clubId}`);
  const content = input?.value.trim();
  if (!content) return;

  await addDoc(collection(db, 'clubPosts'), {
    clubId, content,
    authorId: currentUser.uid,
    authorName: currentUserData.displayName || 'Member',
    authorPhoto: currentUserData.photoURL || '',
    createdAt: serverTimestamp()
  });
  input.value = '';
  openClub(clubId); // Refresh modal
};

// ===== CREATE CLUB =====
window.showCreateClub = () => document.getElementById('create-club-modal').classList.remove('hidden');
window.closeCreateClub = (e) => {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('create-club-modal').classList.add('hidden');
};

window.submitClub = async () => {
  const name = document.getElementById('club-name').value.trim();
  const desc = document.getElementById('club-desc').value.trim();
  const category = document.getElementById('club-category').value;
  const icon = document.getElementById('club-icon').value.trim() || '⭐';
  const membership = document.getElementById('club-membership').value;

  if (!name) { alert('Please enter a club name.'); return; }

  const clubRef = await addDoc(collection(db, 'clubs'), {
    name, description: desc, category, icon, membership,
    university: currentUserData.university || '',
    createdBy: currentUser.uid,
    memberCount: 1,
    postsCount: 0,
    createdAt: serverTimestamp()
  });

  await setDoc(doc(db, 'clubMembers', `${clubRef.id}_${currentUser.uid}`), {
    clubId: clubRef.id, uid: currentUser.uid,
    displayName: currentUserData.displayName || '',
    photoURL: currentUserData.photoURL || '',
    role: 'admin', joinedAt: serverTimestamp()
  });

  closeCreateClub();
  loadClubs();
};

// ===== FILTERS =====
window.filterClubs = (filter, btn) => {
  document.querySelectorAll('.lynk-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentFilter = filter;
  loadClubs();
};

window.searchClubs = (term) => {
  const filtered = allClubs.filter(c =>
    c.name.toLowerCase().includes(term.toLowerCase()) ||
    (c.description || '').toLowerCase().includes(term.toLowerCase())
  );
  renderClubs(filtered);
};

// ===== HELPERS =====
function skeletons() {
  return Array(6).fill(0).map(() => `
    <div class="community-card overflow-hidden animate-pulse">
      <div class="h-20 shimmer"></div>
      <div class="p-4 mt-8"><div class="h-4 rounded w-2/3 mb-2 shimmer"></div><div class="h-3 rounded w-full mb-1 shimmer"></div><div class="h-3 rounded w-4/5 shimmer"></div></div>
    </div>`).join('');
}

function emptyState(title, sub) {
  return `<div class="col-span-full text-center py-16"><div class="text-5xl mb-3">⭐</div><h3 class="font-bold mb-2">${title}</h3><p class="text-sm" style="color:var(--text-muted)">${sub}</p><button onclick="showCreateClub()" class="lynk-btn lynk-btn-primary mt-4 text-sm">Create Club</button></div>`;
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

window.signOut = async () => {
  await firebaseSignOut(auth);
  window.location.href = 'auth.html';
};
