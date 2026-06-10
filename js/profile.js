// ============================================================
// LYNK By Legends — Profile Module
// ============================================================

import { auth, db, storage } from './firebase-config.js';
import { ThemeManager } from './theme.js';
import {
  doc, getDoc, getDocs, setDoc, updateDoc, collection, query,
  where, orderBy, limit, serverTimestamp, increment
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { onAuthStateChanged, signOut as firebaseSignOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

ThemeManager.init();

let currentUser = null;
let currentUserData = null;
let profileUid = null;
let profileData = null;
let isOwnProfile = false;

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'auth.html'; return; }
  currentUser = user;
  const snap = await getDoc(doc(db, 'users', user.uid));
  currentUserData = snap.data() || {};

  // Get target uid from URL ?uid= param
  const params = new URLSearchParams(window.location.search);
  profileUid = params.get('uid') || user.uid;
  isOwnProfile = profileUid === user.uid;

  await loadProfile();
  loadProfilePosts();
  loadFriends();
});

async function loadProfile() {
  const snap = await getDoc(doc(db, 'users', profileUid));
  if (!snap.exists()) {
    document.getElementById('profile-name').textContent = 'User not found';
    return;
  }
  profileData = snap.data();
  const d = profileData;

  const avatarUrl = d.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(d.displayName||'U')}&background=a855f7&color=fff&size=200`;
  document.getElementById('profile-avatar').src = avatarUrl;
  document.getElementById('profile-name').textContent = d.displayName || 'LYNK User';
  document.getElementById('profile-handle').textContent = `@${(d.displayName||'user').toLowerCase().replace(/\s/g,'')}`;
  document.getElementById('profile-bio').textContent = d.bio || (isOwnProfile ? 'Add a bio to tell your campus about yourself' : '');
  document.getElementById('profile-university').textContent = `🎓 ${d.university || '—'}`;
  document.getElementById('profile-faculty').textContent = `🏛️ ${d.faculty || '—'}`;
  document.getElementById('profile-dept').textContent = `📚 ${d.department || '—'}`;
  const joined = d.createdAt?.toDate?.()?.toLocaleDateString('en-US', { month:'long', year:'numeric' });
  document.getElementById('profile-joined').textContent = `📅 Joined ${joined || 'LYNK'}`;
  document.getElementById('friends-count').textContent = d.friendsCount || 0;
  document.getElementById('posts-count').textContent = d.postsCount || 0;
  document.getElementById('communities-count').textContent = 2; // faculty + dept

  // About tab
  document.getElementById('about-name').textContent = d.displayName || '—';
  document.getElementById('about-university').textContent = d.university || '—';
  document.getElementById('about-faculty').textContent = d.faculty || '—';
  document.getElementById('about-dept').textContent = d.department || '—';
  document.getElementById('about-joined').textContent = joined || '—';

  // Sidebar links
  const fl = document.getElementById('faculty-link');
  if (fl) fl.textContent = currentUserData.faculty || 'My Faculty';
  const dl = document.getElementById('dept-link');
  if (dl) dl.textContent = currentUserData.department || 'My Department';

  // Show correct action buttons
  if (isOwnProfile) {
    document.getElementById('btn-edit-profile')?.classList.remove('hidden');
    document.getElementById('avatar-edit')?.classList.remove('hidden');
    document.getElementById('cover-edit')?.classList.remove('hidden');
    // Pre-fill edit modal
    document.getElementById('edit-name').value = d.displayName || '';
    document.getElementById('edit-bio').value = d.bio || '';
    document.getElementById('edit-university').value = d.university || '';
    document.getElementById('edit-faculty').value = d.faculty || '';
    document.getElementById('edit-dept').value = d.department || '';
  } else {
    // Check friend status
    const friendSnap = await getDoc(doc(db, 'friends', `${currentUser.uid}_${profileUid}`));
    const reverseSnap = await getDoc(doc(db, 'friends', `${profileUid}_${currentUser.uid}`));
    const btn = document.getElementById('btn-friend-action');
    btn?.classList.remove('hidden');
    document.getElementById('btn-message')?.classList.remove('hidden');
    document.getElementById('btn-message').href = `chat.html?uid=${profileUid}`;
    if (friendSnap.exists()) {
      const status = friendSnap.data().status;
      if (status === 'accepted') btn.textContent = '✓ Friends';
      else if (status === 'pending') btn.textContent = '⏳ Request Sent';
      else btn.textContent = '+ Add Friend';
    } else if (reverseSnap.exists() && reverseSnap.data().status === 'pending') {
      btn.textContent = '✅ Accept Request';
    } else {
      btn.textContent = '+ Add Friend';
    }
  }
}

// ===== LOAD POSTS =====
async function loadProfilePosts() {
  const container = document.getElementById('tab-posts');
  container.innerHTML = '<div class="lynk-card p-5 animate-pulse"><div class="h-4 rounded w-3/4 mb-2" style="background:var(--border)"></div><div class="h-4 rounded w-1/2" style="background:var(--border)"></div></div>';
  const q = query(collection(db, 'posts'), where('authorId', '==', profileUid), orderBy('createdAt', 'desc'), limit(20));
  const snap = await getDocs(q);
  if (snap.empty) {
    container.innerHTML = `<div class="lynk-card p-8 text-center"><div class="text-4xl mb-3">📭</div><p style="color:var(--text-secondary);font-size:0.875rem">${isOwnProfile ? "You haven't posted anything yet." : "No posts yet."}</p></div>`;
    return;
  }
  container.innerHTML = '';
  snap.docs.forEach(d => {
    const data = d.data();
    const ts = data.createdAt?.toDate?.()?.toLocaleString() || '';
    container.insertAdjacentHTML('beforeend', `
      <div class="lynk-card p-5 fade-in">
        <p class="text-xs mb-3" style="color:var(--text-muted)">${ts}</p>
        ${data.content ? `<p class="text-sm">${data.content}</p>` : ''}
        ${data.mediaUrl && data.mediaType !== 'video' ? `<img src="${data.mediaUrl}" class="rounded-xl mt-3 max-h-64 object-cover w-full" />` : ''}
        <div class="flex gap-3 mt-3 pt-3 border-t text-xs" style="border-color:var(--border);color:var(--text-muted)">
          <span>❤️ ${data.likesCount||0}</span>
          <span>💬 ${data.commentsCount||0}</span>
        </div>
      </div>`);
  });
}

// ===== LOAD FRIENDS =====
async function loadFriends() {
  const grid = document.getElementById('friends-grid');
  if (!grid) return;
  const q = query(collection(db, 'friends'), where('status', '==', 'accepted'),
    where('from', 'in', [profileUid]));
  const q2 = query(collection(db, 'friends'), where('status', '==', 'accepted'),
    where('to', '==', profileUid));
  const [snap1, snap2] = await Promise.all([getDocs(q), getDocs(q2)]);
  const friendUids = new Set();
  snap1.docs.forEach(d => friendUids.add(d.data().to));
  snap2.docs.forEach(d => friendUids.add(d.data().from));

  document.getElementById('friends-list-count').textContent = friendUids.size;
  document.getElementById('friends-count').textContent = friendUids.size;

  if (friendUids.size === 0) {
    grid.innerHTML = `<div class="col-span-full lynk-card p-8 text-center"><div class="text-4xl mb-3">🤝</div><p style="color:var(--text-secondary);font-size:0.875rem">${isOwnProfile ? "You haven't connected with anyone yet." : "No friends yet."}</p></div>`;
    return;
  }

  grid.innerHTML = '';
  for (const uid of [...friendUids].slice(0,12)) {
    const usnap = await getDoc(doc(db, 'users', uid));
    if (!usnap.exists()) continue;
    const u = usnap.data();
    const ava = u.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.displayName||'U')}&background=a855f7&color=fff`;
    grid.insertAdjacentHTML('beforeend', `
      <a href="profile.html?uid=${uid}" class="lynk-card p-4 text-center hover:scale-105 transition-transform block">
        <img src="${ava}" class="lynk-avatar w-16 h-16 mx-auto mb-2" />
        <p class="text-sm font-semibold truncate">${u.displayName}</p>
        <p class="text-xs" style="color:var(--text-muted)">${u.department||u.faculty||''}</p>
      </a>`);
  }

  // Load pending requests (own profile only)
  if (isOwnProfile) {
    const reqSnap = await getDocs(query(collection(db, 'friends'), where('to', '==', currentUser.uid), where('status', '==', 'pending')));
    if (!reqSnap.empty) {
      document.getElementById('friend-requests-section')?.classList.remove('hidden');
      document.getElementById('requests-count').textContent = reqSnap.size;
      const reqList = document.getElementById('friend-requests-list');
      if (reqList) reqList.innerHTML = '';
      for (const d of reqSnap.docs) {
        const fromUid = d.data().from;
        const usnap = await getDoc(doc(db, 'users', fromUid));
        if (!usnap.exists()) continue;
        const u = usnap.data();
        const ava = u.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.displayName||'U')}&background=a855f7&color=fff`;
        reqList?.insertAdjacentHTML('beforeend', `
          <div class="lynk-card p-4 text-center">
            <img src="${ava}" class="lynk-avatar w-12 h-12 mx-auto mb-2" />
            <p class="text-sm font-semibold">${u.displayName}</p>
            <p class="text-xs mb-3" style="color:var(--text-muted)">${u.department||''}</p>
            <div class="flex gap-2">
              <button onclick="respondToRequest('${d.id}','${fromUid}','accepted')" class="lynk-btn lynk-btn-primary flex-1 text-xs py-1.5 rounded-lg">Accept</button>
              <button onclick="respondToRequest('${d.id}','${fromUid}','rejected')" class="lynk-btn lynk-btn-secondary flex-1 text-xs py-1.5 rounded-lg">Decline</button>
            </div>
          </div>`);
      }
    }
  }
}

// ===== FRIEND ACTIONS =====
window.handleFriendAction = async () => {
  if (!currentUser || !profileData) return;
  const btn = document.getElementById('btn-friend-action');
  const text = btn.textContent.trim();
  if (text.includes('Accept')) {
    // Accept incoming request
    const reqSnap = await getDocs(query(collection(db, 'friends'), where('from','==',profileUid), where('to','==',currentUser.uid)));
    if (!reqSnap.empty) {
      await updateDoc(reqSnap.docs[0].ref, { status: 'accepted' });
      await updateDoc(doc(db, 'users', currentUser.uid), { friendsCount: increment(1) });
      await updateDoc(doc(db, 'users', profileUid), { friendsCount: increment(1) });
      btn.textContent = '✓ Friends';
    }
  } else if (text.includes('Add')) {
    await setDoc(doc(db, 'friends', `${currentUser.uid}_${profileUid}`), {
      from: currentUser.uid,
      to: profileUid,
      status: 'pending',
      createdAt: serverTimestamp()
    });
    btn.textContent = '⏳ Request Sent';
  }
};

window.respondToRequest = async (docId, fromUid, status) => {
  await updateDoc(doc(db, 'friends', docId), { status });
  if (status === 'accepted') {
    await updateDoc(doc(db, 'users', currentUser.uid), { friendsCount: increment(1) });
    await updateDoc(doc(db, 'users', fromUid), { friendsCount: increment(1) });
  }
  loadFriends();
};

// ===== EDIT PROFILE =====
window.saveProfile = async () => {
  if (!currentUser) return;
  const name = document.getElementById('edit-name').value.trim();
  const bio = document.getElementById('edit-bio').value.trim();
  const university = document.getElementById('edit-university').value.trim();
  const faculty = document.getElementById('edit-faculty').value.trim();
  const dept = document.getElementById('edit-dept').value.trim();
  await updateDoc(doc(db, 'users', currentUser.uid), {
    displayName: name, bio, university, faculty, department: dept
  });
  closeEditModal();
  await loadProfile();
  alert('Profile updated!');
};

// ===== AVATAR UPLOAD =====
window.updateAvatar = async (input) => {
  const file = input.files[0];
  if (!file || !currentUser) return;
  const r = ref(storage, `avatars/${currentUser.uid}`);
  await uploadBytes(r, file);
  const url = await getDownloadURL(r);
  await updateDoc(doc(db, 'users', currentUser.uid), { photoURL: url });
  document.getElementById('profile-avatar').src = url;
};

// ===== COVER UPLOAD =====
window.updateCover = async (input) => {
  const file = input.files[0];
  if (!file || !currentUser) return;
  const r = ref(storage, `covers/${currentUser.uid}`);
  await uploadBytes(r, file);
  const url = await getDownloadURL(r);
  await updateDoc(doc(db, 'users', currentUser.uid), { coverURL: url });
};

// ===== SIGN OUT =====
window.signOut = async () => {
  if (currentUser) await updateDoc(doc(db, 'users', currentUser.uid), { isOnline: false, lastSeen: serverTimestamp() });
  await firebaseSignOut(auth);
  window.location.href = 'auth.html';
};

window.closeEditModal = () => document.getElementById('edit-modal')?.classList.add('hidden');
window.openEditModal = () => document.getElementById('edit-modal')?.classList.remove('hidden');
window.showFriends = () => {
  document.getElementById('tab-posts').classList.add('hidden');
  document.getElementById('tab-about').classList.add('hidden');
  document.getElementById('tab-friends').classList.remove('hidden');
};
