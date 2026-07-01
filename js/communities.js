// ============================================================
// LYNK By Legends — Communities Module (Phase 3)
// ============================================================

import { auth, db } from './firebase-config.js';
import { ThemeManager } from './theme.js';
import { initNotifications, sendNotification } from './notifications.js';
import {
  collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, onSnapshot, serverTimestamp,
  arrayUnion, arrayRemove, increment, startAfter
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged, signOut as firebaseSignOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { uploadToCloudinary } from './cloudinary.js';

ThemeManager.init();

let currentUser = null;
let currentUserData = null;
let activeCommunityId = null;
let activeCommunity = null;
let currentTab = 'my';
let allCommunities = [];
let commPostsUnsub = null;

// ===== AUTH GUARD =====
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'auth.html'; return; }
  currentUser = user;
  const snap = await getDoc(doc(db, 'users', user.uid));
  currentUserData = snap.data() || {};

  const navAvatar = document.getElementById('nav-avatar');
  if (navAvatar) navAvatar.src = currentUserData.photoURL || `https://ui-avatars.com/api/?name=U&background=a855f7&color=fff`;
  const sidebarAvatar = document.getElementById('sidebar-avatar');
  if (sidebarAvatar) sidebarAvatar.src = currentUserData.photoURL || `https://ui-avatars.com/api/?name=U&background=a855f7&color=fff`;
  const sidebarName = document.getElementById('sidebar-name');
  if (sidebarName) sidebarName.textContent = currentUserData.displayName || 'LYNK User';
  const sidebarDept = document.getElementById('sidebar-dept');
  if (sidebarDept) sidebarDept.textContent = `${currentUserData.department || ''} · ${currentUserData.university || ''}`;
  if (currentUserData.role === 'admin' || currentUserData.adminRole) {
    document.getElementById('admin-link')?.classList.remove('hidden');
  }

  await initNotifications(user.uid);
  loadCommunities('my');
});

// ===== LOAD COMMUNITIES =====
async function loadCommunities(tab) {
  currentTab = tab;
  const grid = document.getElementById('communities-grid');
  grid.innerHTML = skeletons();

  try {
    let communities = [];

    if (tab === 'my') {
      const snap = await getDocs(query(
        collection(db, 'communityMembers'),
        where('uid', '==', currentUser.uid),
        limit(40)
      ));
      const ids = snap.docs.map(d => d.data().communityId);
      if (ids.length === 0) {
        grid.innerHTML = emptyState('You haven\'t joined any communities yet.', 'Explore faculty and department communities or create your own group.');
        return;
      }
      const commSnaps = await Promise.all(ids.map(id => getDoc(doc(db, 'communities', id))));
      communities = commSnaps.filter(s => s.exists()).map(s => ({ id: s.id, ...s.data() }));

    } else if (tab === 'faculty') {
      if (!currentUserData.faculty) {
        grid.innerHTML = emptyState('No faculty set', 'Complete your profile to see your faculty community.');
        return;
      }
      const snap = await getDocs(query(
        collection(db, 'communities'),
        where('type', '==', 'faculty'),
        where('university', '==', currentUserData.university || ''),
        limit(20)
      ));
      communities = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    } else if (tab === 'department') {
      const snap = await getDocs(query(
        collection(db, 'communities'),
        where('type', '==', 'department'),
        where('university', '==', currentUserData.university || ''),
        limit(30)
      ));
      communities = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    } else if (tab === 'groups') {
      const snap = await getDocs(query(
        collection(db, 'communities'),
        where('type', 'in', ['group', 'club', 'study', 'private']),
        limit(30)
      ));
      communities = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.memberCount || 0) - (a.memberCount || 0));

    } else {
      const snap = await getDocs(query(
        collection(db, 'communities'),
        limit(50)
      ));
      communities = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.memberCount || 0) - (a.memberCount || 0));
    }

    allCommunities = communities;

    if (communities.length === 0) {
      grid.innerHTML = emptyState('No communities found', tab === 'faculty' ? 'Your faculty community will appear here once set up.' : 'Be the first to create one!');
      return;
    }

    renderCommunities(communities);
  } catch (err) {
    console.warn('Load communities error:', err.message);
    grid.innerHTML = `<div class="col-span-full text-center py-10 text-sm" style="color:var(--text-muted)">Error loading communities. Try again.</div>`;
  }
}

function renderCommunities(communities) {
  const grid = document.getElementById('communities-grid');
  grid.innerHTML = '';
  communities.forEach(c => {
    const colors = ['#a855f7,#3b82f6', '#06b6d4,#6366f1', '#22c55e,#06b6d4', '#f97316,#ec4899', '#818cf8,#c084fc'];
    const colorPair = colors[Math.abs(hashStr(c.id)) % colors.length];
    const typeLabel = { faculty: 'Faculty', department: 'Department', group: 'Group', club: 'Club', study: 'Study Group', private: 'Private' }[c.type] || 'Community';

    grid.insertAdjacentHTML('beforeend', `
      <div class="community-card cursor-pointer" onclick="openCommunity('${c.id}')">
        <div class="community-banner" style="background:linear-gradient(135deg,${colorPair})">
          <span class="community-type-badge">${typeLabel}</span>
        </div>
        <div class="p-4 mt-8 relative">
          <div class="absolute -top-8 left-4 text-3xl bg-white/10 backdrop-blur rounded-xl p-1">${c.icon || '👥'}</div>
          <h3 class="font-bold text-sm mb-1 truncate">${escHtml(c.name)}</h3>
          <p class="text-xs mb-3 line-clamp-2" style="color:var(--text-secondary)">${escHtml(c.description || 'No description')}</p>
          <div class="flex items-center justify-between">
            <span class="text-xs" style="color:var(--text-muted)">${c.memberCount || 0} members</span>
            <button class="lynk-btn lynk-btn-primary text-xs py-1 px-3" onclick="event.stopPropagation();quickJoin('${c.id}')">View</button>
          </div>
        </div>
      </div>`);
  });
}

// ===== OPEN COMMUNITY MODAL =====
window.openCommunity = async (communityId) => {
  activeCommunityId = communityId;
  const snap = await getDoc(doc(db, 'communities', communityId));
  if (!snap.exists()) return;
  activeCommunity = { id: snap.id, ...snap.data() };

  const modal = document.getElementById('community-modal');
  modal.classList.remove('hidden');

  document.getElementById('comm-name').textContent = activeCommunity.name;
  document.getElementById('comm-type-badge').textContent = `${(activeCommunity.type || 'community').toUpperCase()} · ${activeCommunity.university || ''}`;
  document.getElementById('comm-desc').textContent = activeCommunity.description || 'No description provided.';
  document.getElementById('comm-members').textContent = `${activeCommunity.memberCount || 0} members`;
  document.getElementById('comm-posts-count').textContent = `${activeCommunity.postsCount || 0} posts`;

  const colors = ['#a855f7,#3b82f6', '#06b6d4,#6366f1', '#22c55e,#06b6d4', '#f97316,#ec4899'];
  const colorPair = colors[Math.abs(hashStr(communityId)) % colors.length];
  document.getElementById('comm-banner').style.background = `linear-gradient(135deg,${colorPair})`;
  document.getElementById('comm-icon').textContent = activeCommunity.icon || '👥';

  const isMember = await checkMembership(communityId);
  const joinBtn = document.getElementById('comm-join-btn');
  if (isMember) {
    joinBtn.textContent = 'Joined ✓';
    joinBtn.className = 'lynk-btn lynk-btn-secondary text-sm';
    document.getElementById('comm-compose').classList.remove('hidden');
    const composeAvatar = document.getElementById('comm-compose-avatar');
    if (composeAvatar) composeAvatar.src = currentUserData.photoURL || `https://ui-avatars.com/api/?name=U&background=a855f7&color=fff`;
  } else {
    joinBtn.textContent = 'Join';
    joinBtn.className = 'lynk-btn lynk-btn-primary text-sm';
    document.getElementById('comm-compose').classList.add('hidden');
  }

  switchCommModalTab('feed');
};

window.closeCommunityModal = (e) => {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('community-modal').classList.add('hidden');
  if (commPostsUnsub) { commPostsUnsub(); commPostsUnsub = null; }
  activeCommunityId = null;
  activeCommunity = null;
};

async function checkMembership(communityId) {
  const snap = await getDoc(doc(db, 'communityMembers', `${communityId}_${currentUser.uid}`));
  return snap.exists();
}

// ===== JOIN / LEAVE =====
window.toggleJoinCommunity = async () => {
  if (!activeCommunityId) return;
  const isMember = await checkMembership(activeCommunityId);
  const memberId = `${activeCommunityId}_${currentUser.uid}`;
  const joinBtn = document.getElementById('comm-join-btn');

  if (isMember) {
    await deleteDoc(doc(db, 'communityMembers', memberId));
    await updateDoc(doc(db, 'communities', activeCommunityId), { memberCount: increment(-1) });
    joinBtn.textContent = 'Join';
    joinBtn.className = 'lynk-btn lynk-btn-primary text-sm';
    document.getElementById('comm-compose').classList.add('hidden');
  } else {
    await setDoc(doc(db, 'communityMembers', memberId), {
      communityId: activeCommunityId, uid: currentUser.uid,
      displayName: currentUserData.displayName || '', photoURL: currentUserData.photoURL || '',
      role: 'member', joinedAt: serverTimestamp()
    });
    await updateDoc(doc(db, 'communities', activeCommunityId), { memberCount: increment(1) });
    joinBtn.textContent = 'Joined ✓';
    joinBtn.className = 'lynk-btn lynk-btn-secondary text-sm';
    document.getElementById('comm-compose').classList.remove('hidden');
    const composeAvatar = document.getElementById('comm-compose-avatar');
    if (composeAvatar) composeAvatar.src = currentUserData.photoURL || `https://ui-avatars.com/api/?name=U&background=a855f7&color=fff`;
  }
};

window.quickJoin = (communityId) => window.openCommunity(communityId);

// ===== MODAL TABS =====
window.switchCommModalTab = async (tab) => {
  ['feed', 'announcements', 'resources', 'events', 'members'].forEach(t => {
    const el = document.getElementById(`ctab-${t}`);
    if (el) {
      el.classList.toggle('active', t === tab);
      el.style.borderBottomColor = t === tab ? 'var(--grad-1)' : 'transparent';
    }
  });

  const content = document.getElementById('comm-modal-content');
  if (tab === 'feed') await loadCommunityFeed(content);
  else if (tab === 'announcements') await loadCommunityAnnouncements(content);
  else if (tab === 'resources') await loadCommunityResources(content);
  else if (tab === 'events') await loadCommunityEvents(content);
  else if (tab === 'members') await loadCommunityMembers(content);
};

async function loadCommunityFeed(container) {
  container.innerHTML = '<div class="text-center py-8" style="color:var(--text-muted)"><div class="spinner w-7 h-7 border-4 rounded-full mx-auto mb-2" style="border-color:var(--grad-1);border-top-color:transparent"></div></div>';
  if (commPostsUnsub) { commPostsUnsub(); commPostsUnsub = null; }
  const q = query(
    collection(db, 'communities', activeCommunityId, 'posts'),
    orderBy('createdAt', 'desc'),
    limit(20)
  );
  commPostsUnsub = onSnapshot(q, (snap) => {
    if (snap.empty) {
      container.innerHTML = '<div class="text-center py-10" style="color:var(--text-muted)"><p>No posts yet. Be the first to share!</p></div>';
      return;
    }
    container.innerHTML = '';
    snap.docs.forEach(d => {
      const p = d.data();
      const ts = p.createdAt?.toDate?.()?.toLocaleString() || 'just now';
      const ava = p.authorPhoto || `https://ui-avatars.com/api/?name=U&background=a855f7&color=fff`;
      container.insertAdjacentHTML('beforeend', `
        <div class="lynk-card p-4 mb-3 fade-in">
          <div class="flex gap-3">
            <img src="${ava}" class="lynk-avatar w-9 h-9 flex-shrink-0" />
            <div class="flex-1">
              <div class="flex items-center gap-2 mb-1">
                <span class="font-semibold text-sm">${escHtml(p.authorName || 'User')}</span>
                <span class="text-xs" style="color:var(--text-muted)">${ts}</span>
              </div>
              ${p.type === 'announcement' ? '<span class="lynk-badge text-xs px-2 py-0.5 mb-2 inline-block" style="background:rgba(168,85,247,0.1);color:var(--grad-1)">📢 Announcement</span>' : ''}
              <p class="text-sm whitespace-pre-wrap">${escHtml(p.content)}</p>
              ${p.mediaUrl ? `<img src="${p.mediaUrl}" class="w-full rounded-xl mt-2 max-h-64 object-cover" loading="lazy"/>` : ''}
              <div class="flex items-center gap-3 mt-3 pt-2 border-t" style="border-color:var(--border)">
                <button onclick="likeCommunityPost('${activeCommunityId}','${d.id}')" class="reaction-btn text-xs">
                  ❤️ ${p.likesCount || 0}
                </button>
                ${p.authorId === currentUser.uid ? `<button onclick="deleteCommunityPost('${d.id}')" class="reaction-btn text-xs" style="color:#ef4444">Delete</button>` : ''}
              </div>
            </div>
          </div>
        </div>`);
    });
  });
}

async function loadCommunityAnnouncements(container) {
  container.innerHTML = '<div class="text-center py-6" style="color:var(--text-muted)">Loading...</div>';
  const snap = await getDocs(query(
    collection(db, 'communities', activeCommunityId, 'posts'),
    where('type', '==', 'announcement'),
    limit(20)
  ));
  snap.docs.sort((a, b) => (b.data().createdAt?.toMillis?.() || 0) - (a.data().createdAt?.toMillis?.() || 0));
  if (snap.empty) { container.innerHTML = '<div class="text-center py-10" style="color:var(--text-muted)">No announcements yet.</div>'; return; }
  container.innerHTML = '';
  snap.docs.forEach(d => {
    const p = d.data();
    const ts = p.createdAt?.toDate?.()?.toLocaleDateString() || '';
    container.insertAdjacentHTML('beforeend', `
      <div class="announcement-card mb-3">
        <p class="text-xs font-semibold mb-1" style="color:var(--grad-1)">📢 ${ts}</p>
        <p class="font-semibold text-sm mb-1">${escHtml(p.title || '')}</p>
        <p class="text-sm" style="color:var(--text-secondary)">${escHtml(p.content)}</p>
      </div>`);
  });
}

async function loadCommunityResources(container) {
  container.innerHTML = '<div class="text-center py-6" style="color:var(--text-muted)">Loading...</div>';
  const snap = await getDocs(query(
    collection(db, 'communities', activeCommunityId, 'resources'),
    orderBy('createdAt', 'desc'),
    limit(20)
  ));
  const isMember = await checkMembership(activeCommunityId);
  let html = '';
  if (isMember) {
    html += `<div class="mb-4 flex gap-2">
      <input id="res-name" class="lynk-input flex-1 text-sm" placeholder="Resource name..." />
      <input id="res-url" class="lynk-input flex-1 text-sm" placeholder="URL or link..." />
      <button onclick="addResource()" class="lynk-btn lynk-btn-primary text-sm py-2 px-3">Add</button>
    </div>`;
  }
  if (snap.empty) {
    html += '<div class="text-center py-8" style="color:var(--text-muted)">No resources shared yet.</div>';
  } else {
    snap.docs.forEach(d => {
      const r = d.data();
      html += `<a href="${r.url}" target="_blank" rel="noopener" class="resource-item mb-2 block">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--grad-2);flex-shrink:0"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
        <span class="text-sm font-medium">${escHtml(r.name)}</span>
        <span class="text-xs ml-auto" style="color:var(--text-muted)">by ${escHtml(r.uploaderName || '')}</span>
      </a>`;
    });
  }
  container.innerHTML = html;
}

async function loadCommunityEvents(container) {
  container.innerHTML = '<div class="text-center py-6" style="color:var(--text-muted)">Loading...</div>';
  const snap = await getDocs(query(
    collection(db, 'events'),
    where('communityId', '==', activeCommunityId),
    limit(10)
  ));
  snap.docs.sort((a, b) => {
    const aDate = a.data().date?.toMillis?.() || 0;
    const bDate = b.data().date?.toMillis?.() || 0;
    return aDate - bDate;
  });
  if (snap.empty) { container.innerHTML = '<div class="text-center py-10" style="color:var(--text-muted)">No events for this community yet.</div>'; return; }
  container.innerHTML = '';
  snap.docs.forEach(d => {
    const ev = d.data();
    const date = ev.date?.toDate?.() || new Date();
    container.insertAdjacentHTML('beforeend', `
      <div class="event-card p-4 mb-3">
        <div class="flex gap-3">
          <div class="event-date-badge">
            <div class="day">${date.getDate()}</div>
            <div class="mon">${date.toLocaleString('en', {month:'short'})}</div>
          </div>
          <div class="flex-1">
            <h4 class="font-semibold text-sm">${escHtml(ev.title)}</h4>
            <p class="text-xs mt-1" style="color:var(--text-muted)">📍 ${escHtml(ev.location || 'TBD')} · ${ev.rsvpCount || 0} going</p>
          </div>
        </div>
      </div>`);
  });
}

async function loadCommunityMembers(container) {
  container.innerHTML = '<div class="text-center py-6" style="color:var(--text-muted)">Loading...</div>';
  const snap = await getDocs(query(
    collection(db, 'communityMembers'),
    where('communityId', '==', activeCommunityId),
    limit(30)
  ));
  if (snap.empty) { container.innerHTML = '<div class="text-center py-10" style="color:var(--text-muted)">No members found.</div>'; return; }
  container.innerHTML = '<div class="flex flex-col gap-2">';
  snap.docs.forEach(d => {
    const m = d.data();
    const ava = m.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(m.displayName||'U')}&background=a855f7&color=fff`;
    container.insertAdjacentHTML('beforeend', `
      <div class="flex items-center gap-3 p-2 rounded-xl hover:bg-card-hover">
        <img src="${ava}" class="lynk-avatar w-9 h-9" />
        <span class="text-sm font-medium">${escHtml(m.displayName || 'User')}</span>
        ${m.role === 'admin' ? '<span class="lynk-badge text-xs px-2" style="background:rgba(168,85,247,0.1);color:var(--grad-1)">Admin</span>' : ''}
        <a href="chat.html?uid=${m.uid}" class="ml-auto lynk-btn lynk-btn-ghost text-xs py-1 px-2">Message</a>
      </div>`);
  });
  container.innerHTML += '</div>';
}

// ===== SUBMIT COMMUNITY POST =====
window.submitCommunityPost = async () => {
  const input = document.getElementById('comm-post-input');
  const content = input?.value.trim();
  if (!content || !activeCommunityId) return;

  input.value = '';
  await addDoc(collection(db, 'communities', activeCommunityId, 'posts'), {
    content, type: 'post',
    authorId: currentUser.uid,
    authorName: currentUserData.displayName || 'LYNK User',
    authorPhoto: currentUserData.photoURL || '',
    communityId: activeCommunityId,
    likesCount: 0, commentsCount: 0,
    createdAt: serverTimestamp()
  });
  await updateDoc(doc(db, 'communities', activeCommunityId), { postsCount: increment(1) });
};

window.likeCommunityPost = async (communityId, postId) => {
  await updateDoc(doc(db, 'communities', communityId, 'posts', postId), {
    likesCount: increment(1)
  });
};

window.deleteCommunityPost = async (postId) => {
  if (!confirm('Delete this post?')) return;
  await deleteDoc(doc(db, 'communities', activeCommunityId, 'posts', postId));
};

window.addResource = async () => {
  const name = document.getElementById('res-name')?.value.trim();
  const url = document.getElementById('res-url')?.value.trim();
  if (!name || !url) return;
  await addDoc(collection(db, 'communities', activeCommunityId, 'resources'), {
    name, url, uploaderId: currentUser.uid,
    uploaderName: currentUserData.displayName || 'User',
    createdAt: serverTimestamp()
  });
  document.getElementById('res-name').value = '';
  document.getElementById('res-url').value = '';
  switchCommModalTab('resources');
};

// ===== CREATE COMMUNITY =====
window.showCreateCommunityModal = () => document.getElementById('create-community-modal').classList.remove('hidden');
window.closeCreateModal = (e) => {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('create-community-modal').classList.add('hidden');
};

window.createCommunity = async () => {
  const name = document.getElementById('create-comm-name').value.trim();
  const desc = document.getElementById('create-comm-desc').value.trim();
  const type = document.getElementById('create-comm-type').value;
  const icon = document.getElementById('create-comm-icon').value.trim() || '👥';

  if (!name) { alert('Please enter a community name.'); return; }

  const communityId = `${Date.now()}_${currentUser.uid.slice(0, 6)}`;
  await setDoc(doc(db, 'communities', communityId), {
    name, description: desc, type, icon,
    university: currentUserData.university || '',
    faculty: currentUserData.faculty || '',
    department: currentUserData.department || '',
    createdBy: currentUser.uid,
    memberCount: 1, postsCount: 0,
    createdAt: serverTimestamp()
  });

  await setDoc(doc(db, 'communityMembers', `${communityId}_${currentUser.uid}`), {
    communityId, uid: currentUser.uid,
    displayName: currentUserData.displayName || '',
    photoURL: currentUserData.photoURL || '',
    role: 'admin', joinedAt: serverTimestamp()
  });

  document.getElementById('create-community-modal').classList.add('hidden');
  document.getElementById('create-comm-name').value = '';
  document.getElementById('create-comm-desc').value = '';
  loadCommunities('my');
};

// ===== FILTER / SEARCH =====
window.switchCommTab = (tab, btn) => {
  document.querySelectorAll('.lynk-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  loadCommunities(tab);
};

window.filterCommunities = (term) => {
  const filtered = allCommunities.filter(c =>
    c.name.toLowerCase().includes(term.toLowerCase()) ||
    (c.description || '').toLowerCase().includes(term.toLowerCase())
  );
  renderCommunities(filtered);
};

// ===== HELPERS =====
function skeletons() {
  return Array(6).fill(0).map(() => `
    <div class="community-card overflow-hidden animate-pulse">
      <div class="h-20 shimmer"></div>
      <div class="p-4 mt-8">
        <div class="h-4 rounded w-2/3 mb-2 shimmer"></div>
        <div class="h-3 rounded w-full mb-1 shimmer"></div>
        <div class="h-3 rounded w-4/5 shimmer"></div>
      </div>
    </div>`).join('');
}

function emptyState(title, sub) {
  return `<div class="col-span-full text-center py-16">
    <div class="text-5xl mb-3">👥</div>
    <h3 class="font-bold mb-2">${title}</h3>
    <p class="text-sm" style="color:var(--text-muted)">${sub}</p>
    <button onclick="showCreateCommunityModal()" class="lynk-btn lynk-btn-primary mt-4 text-sm">Create Community</button>
  </div>`;
}

function hashStr(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return h;
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

window.signOut = async () => {
  await firebaseSignOut(auth);
  window.location.href = 'auth.html';
};
