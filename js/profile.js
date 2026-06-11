// ============================================================
// LYNK By Legends — Profile Module
// ============================================================

import { auth, db, storage } from './firebase-config.js';
import { ThemeManager } from './theme.js';
import { initNotifications, sendNotification, showToast } from './notifications.js';
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
let schoolsData = {};

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'auth.html'; return; }
  currentUser = user;
  const snap = await getDoc(doc(db, 'users', user.uid));
  currentUserData = snap.data() || {};

  const params = new URLSearchParams(window.location.search);
  profileUid = params.get('uid') || user.uid;
  isOwnProfile = profileUid === user.uid;

  await initNotifications(user.uid);
  await loadProfile();
  await loadSchoolsForEdit();
  loadProfilePosts();
  loadFriends();
});

// ===== LOAD SCHOOLS FOR EDIT MODAL =====
async function loadSchoolsForEdit() {
  const select = document.getElementById('edit-university-select');
  if (!select) return;
  const snap = await getDocs(collection(db, 'schools'));
  snap.docs.forEach(d => {
    const s = d.data();
    schoolsData[d.id] = s;
    const opt = document.createElement('option');
    opt.value = s.name; opt.textContent = s.name; opt.dataset.id = d.id;
    select.appendChild(opt);
  });
}

window.loadEditFaculties = (universityName) => {
  const facSelect = document.getElementById('edit-faculty-select');
  const deptSelect = document.getElementById('edit-dept-select');
  const school = Object.values(schoolsData).find(s => s.name === universityName);
  facSelect.innerHTML = '<option value="">-- Select --</option>';
  deptSelect.innerHTML = '<option value="">-- Select --</option>';
  if (school) {
    Object.keys(school.faculties || {}).forEach(f => {
      const opt = document.createElement('option');
      opt.value = f; opt.textContent = f;
      facSelect.appendChild(opt);
    });
  }
  document.getElementById('edit-university').value = universityName || '';
};

window.loadEditDepartments = (faculty) => {
  const universityName = document.getElementById('edit-university-select').value || document.getElementById('edit-university').value;
  const deptSelect = document.getElementById('edit-dept-select');
  const school = Object.values(schoolsData).find(s => s.name === universityName);
  deptSelect.innerHTML = '<option value="">-- Select --</option>';
  if (school && faculty) {
    (school.faculties[faculty] || []).forEach(d => {
      const opt = document.createElement('option');
      opt.value = d; opt.textContent = d;
      deptSelect.appendChild(opt);
    });
  }
  document.getElementById('edit-faculty').value = faculty || '';
};

// ===== LOAD PROFILE =====
async function loadProfile() {
  const snap = await getDoc(doc(db, 'users', profileUid));
  if (!snap.exists()) {
    document.getElementById('profile-name').textContent = 'User not found';
    return;
  }
  profileData = snap.data();
  const d = profileData;

  const avatarUrl = d.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(d.displayName||'U')}&background=a855f7&color=fff&size=200`;
  if (d.coverURL) {
    document.getElementById('cover-container').style.background = `url(${d.coverURL}) center/cover`;
  }
  document.getElementById('profile-avatar').src = avatarUrl;
  document.getElementById('profile-name').textContent = d.displayName || 'LYNK User';
  document.getElementById('profile-handle').textContent = `@${d.username || (d.displayName||'').toLowerCase().replace(/\s/g,'')}`;

  // Staff badge & position
  if (d.userType === 'staff') {
    document.getElementById('staff-badge')?.classList.remove('hidden');
    if (d.position) {
      const posEl = document.getElementById('profile-position');
      posEl.textContent = d.position;
      posEl.classList.remove('hidden');
    }
  }

  document.getElementById('profile-bio').textContent = d.bio || (isOwnProfile ? 'Add a bio from Edit Profile' : '');
  document.getElementById('profile-university').textContent = `🎓 ${d.university || '—'}`;
  document.getElementById('profile-faculty').textContent = `🏛️ ${d.faculty || '—'}`;
  document.getElementById('profile-dept').textContent = `📚 ${d.department || '—'}`;

  const joined = d.createdAt?.toDate?.()?.toLocaleDateString('en-US', { month:'long', year:'numeric' });
  document.getElementById('profile-joined').textContent = `📅 Joined ${joined || 'LYNK'}`;

  document.getElementById('friends-count').textContent = d.friendsCount || 0;
  document.getElementById('posts-count').textContent = d.postsCount || 0;
  document.getElementById('communities-count').textContent = 2;

  // About tab
  document.getElementById('about-name').textContent = d.displayName || '—';
  document.getElementById('about-username').textContent = `@${d.username || '—'}`;
  document.getElementById('about-type').textContent = d.userType === 'staff' ? '👨‍🏫 Staff' : '🎓 Student';
  if (d.position) {
    document.getElementById('about-position').textContent = d.position;
    document.getElementById('about-position-row')?.classList.remove('hidden');
    document.getElementById('about-position-row').style.display = 'flex';
  }
  document.getElementById('about-university').textContent = d.university || '—';
  document.getElementById('about-faculty').textContent = d.faculty || '—';
  document.getElementById('about-dept').textContent = d.department || '—';
  document.getElementById('about-joined').textContent = joined || '—';

  // Sidebar
  const fl = document.getElementById('faculty-link');
  if (fl) fl.textContent = currentUserData.faculty || 'My Faculty';
  const dl = document.getElementById('dept-link');
  if (dl) dl.textContent = currentUserData.department || 'My Department';

  if (isOwnProfile) {
    // Show edit button
    document.getElementById('btn-edit-profile')?.classList.remove('hidden');

    // AVATAR EDIT — use style.display = 'flex' not classList to avoid Tailwind override
    const avatarEdit = document.getElementById('avatar-edit');
    if (avatarEdit) avatarEdit.style.display = 'flex';

    // COVER EDIT
    const coverEdit = document.getElementById('cover-edit');
    if (coverEdit) coverEdit.style.display = 'flex';

    // Show incomplete banner if missing university
    if (!d.university || !d.faculty) {
      document.getElementById('incomplete-banner')?.classList.remove('hidden');
    }

    // Pre-fill edit modal
    document.getElementById('edit-name').value = d.displayName || '';
    document.getElementById('edit-username').value = d.username || '';
    document.getElementById('edit-bio').value = d.bio || '';
    document.getElementById('edit-university').value = d.university || '';
    document.getElementById('edit-faculty').value = d.faculty || '';
    document.getElementById('edit-dept').value = d.department || '';
    document.getElementById('edit-position').value = d.position || '';

    // Show position field only if staff
    const posWrapper = document.getElementById('edit-position-wrapper');
    if (posWrapper) posWrapper.style.display = d.userType === 'staff' ? 'block' : 'none';
  } else {
    // Determine friend status
    const [friendSnap, reverseSnap] = await Promise.all([
      getDoc(doc(db, 'friends', `${currentUser.uid}_${profileUid}`)),
      getDoc(doc(db, 'friends', `${profileUid}_${currentUser.uid}`))
    ]);
    const btn = document.getElementById('btn-friend-action');
    btn?.classList.remove('hidden');
    document.getElementById('btn-message')?.classList.remove('hidden');
    document.getElementById('btn-message').href = `chat.html?uid=${profileUid}`;

    if (friendSnap.exists()) {
      const status = friendSnap.data().status;
      if (status === 'accepted') { btn.textContent = '✓ Friends'; btn.disabled = true; }
      else if (status === 'pending') { btn.textContent = '⏳ Sent'; btn.disabled = true; }
      else btn.textContent = '+ Add Friend';
    } else if (reverseSnap.exists() && reverseSnap.data().status === 'pending') {
      btn.textContent = '✅ Accept Request';
    } else {
      btn.textContent = '+ Add Friend';
    }
  }
}

// ===== USERNAME CHECK IN EDIT MODAL =====
let editUsernameTimer = null;
window.checkEditUsername = (value) => {
  const status = document.getElementById('edit-username-status');
  const clean = value.toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (value !== clean) document.getElementById('edit-username').value = clean;
  if (!status || clean.length < 3) return;
  clearTimeout(editUsernameTimer);
  status.textContent = 'Checking...'; status.style.color = 'var(--text-muted)';
  editUsernameTimer = setTimeout(async () => {
    if (clean === (currentUserData.username || '')) {
      status.textContent = '✓ Your current username'; status.style.color = '#4ade80'; return;
    }
    const snap = await getDocs(query(collection(db, 'users'), where('username','==',clean), limit(1)));
    if (snap.empty) { status.textContent = `✓ @${clean} is available`; status.style.color = '#4ade80'; }
    else { status.textContent = `✗ @${clean} is taken`; status.style.color = '#f87171'; }
  }, 600);
};

// ===== PROFILE POSTS =====
async function loadProfilePosts() {
  const container = document.getElementById('tab-posts');
  container.innerHTML = `<div class="lynk-card p-5 animate-pulse"><div class="h-4 rounded w-3/4 mb-2" style="background:var(--border)"></div><div class="h-4 rounded w-1/2" style="background:var(--border)"></div></div>`;
  const q = query(collection(db, 'posts'), where('authorId','==',profileUid), orderBy('createdAt','desc'), limit(20));
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
        <p class="text-xs mb-2" style="color:var(--text-muted)">${ts}</p>
        ${data.content ? `<p class="text-sm whitespace-pre-wrap">${data.content}</p>` : ''}
        ${data.mediaUrl && data.mediaType !== 'video' ? `<img src="${data.mediaUrl}" class="rounded-xl mt-3 max-h-64 object-cover w-full" />` : ''}
        ${data.mediaUrl && data.mediaType === 'video' ? `<video src="${data.mediaUrl}" controls class="w-full rounded-xl mt-3"></video>` : ''}
        <div class="flex gap-4 mt-3 pt-3 border-t text-xs" style="border-color:var(--border);color:var(--text-muted)">
          <span>❤️ ${data.likesCount||0}</span><span>💬 ${data.commentsCount||0}</span>
        </div>
      </div>`);
  });
}

// ===== FRIENDS =====
async function loadFriends() {
  const grid = document.getElementById('friends-grid');
  if (!grid) return;
  const [snap1, snap2] = await Promise.all([
    getDocs(query(collection(db, 'friends'), where('status','==','accepted'), where('from','==',profileUid))),
    getDocs(query(collection(db, 'friends'), where('status','==','accepted'), where('to','==',profileUid)))
  ]);
  const friendUids = new Set();
  snap1.docs.forEach(d => friendUids.add(d.data().to));
  snap2.docs.forEach(d => friendUids.add(d.data().from));

  document.getElementById('friends-list-count').textContent = friendUids.size;
  document.getElementById('friends-count').textContent = friendUids.size;

  if (friendUids.size === 0) {
    grid.innerHTML = `<div class="col-span-full lynk-card p-8 text-center"><div class="text-4xl mb-3">🤝</div><p style="color:var(--text-secondary);font-size:0.875rem">${isOwnProfile ? "No friends yet." : "No friends yet."}</p></div>`;
  } else {
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
          <p class="text-xs" style="color:var(--text-muted)">@${u.username || ''}</p>
          ${u.userType === 'staff' ? '<span class="text-xs" style="color:#38bdf8">👨‍🏫 Staff</span>' : ''}
        </a>`);
    }
  }

  // Pending incoming requests (own profile)
  if (isOwnProfile) {
    const reqSnap = await getDocs(query(collection(db, 'friends'), where('to','==',currentUser.uid), where('status','==','pending')));
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
            <p class="text-xs mb-1" style="color:var(--text-muted)">@${u.username || ''}</p>
            <p class="text-xs mb-3" style="color:var(--text-muted)">${u.position || u.department || ''}</p>
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
    const reqSnap = await getDocs(query(collection(db, 'friends'), where('from','==',profileUid), where('to','==',currentUser.uid)));
    if (!reqSnap.empty) {
      await updateDoc(reqSnap.docs[0].ref, { status: 'accepted' });
      await Promise.all([
        updateDoc(doc(db, 'users', currentUser.uid), { friendsCount: increment(1) }),
        updateDoc(doc(db, 'users', profileUid), { friendsCount: increment(1) })
      ]);
      await sendNotification({ toUid: profileUid, fromUid: currentUser.uid, fromName: currentUserData.displayName||'Someone', fromPhoto: currentUserData.photoURL||'', type:'friend_accepted', message:'accepted your friend request', preview: currentUserData.faculty||'' });
      btn.textContent = '✓ Friends'; btn.disabled = true;
      showToast('Connected!', `You and ${profileData.displayName} are now friends.`, profileData.photoURL||'');
    }
  } else {
    await setDoc(doc(db, 'friends', `${currentUser.uid}_${profileUid}`), {
      from: currentUser.uid, to: profileUid, status: 'pending', createdAt: serverTimestamp()
    });
    await sendNotification({ toUid: profileUid, fromUid: currentUser.uid, fromName: currentUserData.displayName||'Someone', fromPhoto: currentUserData.photoURL||'', type:'friend_request', message:'sent you a friend request', preview: currentUserData.faculty||'' });
    btn.textContent = '⏳ Sent'; btn.disabled = true;
    showToast('Request Sent!', `Friend request sent to ${profileData.displayName}.`, profileData.photoURL||'');
  }
};

window.respondToRequest = async (docId, fromUid, status) => {
  await updateDoc(doc(db, 'friends', docId), { status });
  if (status === 'accepted') {
    await Promise.all([
      updateDoc(doc(db, 'users', currentUser.uid), { friendsCount: increment(1) }),
      updateDoc(doc(db, 'users', fromUid), { friendsCount: increment(1) })
    ]);
    await sendNotification({ toUid: fromUid, fromUid: currentUser.uid, fromName: currentUserData.displayName||'Someone', fromPhoto: currentUserData.photoURL||'', type:'friend_accepted', message:'accepted your friend request', preview: '' });
    showToast('Friend Added!', 'You are now connected.', '');
  }
  loadFriends();
};

// ===== SAVE PROFILE =====
window.saveProfile = async () => {
  if (!currentUser) return;
  const username = document.getElementById('edit-username').value.trim().toLowerCase();
  const name     = document.getElementById('edit-name').value.trim();
  const bio      = document.getElementById('edit-bio').value.trim();
  const position = document.getElementById('edit-position').value.trim();
  const university = document.getElementById('edit-university-select').value || document.getElementById('edit-university').value.trim();
  const faculty    = document.getElementById('edit-faculty-select').value || document.getElementById('edit-faculty').value.trim();
  const dept       = document.getElementById('edit-dept-select').value || document.getElementById('edit-dept').value.trim();

  if (username && username.length < 3) { showToast('Error', 'Username must be at least 3 characters.', ''); return; }

  await updateDoc(doc(db, 'users', currentUser.uid), {
    displayName: name, username, bio, position,
    university, faculty, department: dept,
    profileComplete: !!(university && faculty && dept)
  });

  closeEditModal();
  currentUserData = { ...currentUserData, displayName: name, username, bio, position, university, faculty, department: dept };
  await loadProfile();
  showToast('Profile Updated!', 'Your changes have been saved.', currentUserData.photoURL||'');
};

// ===== AVATAR UPLOAD (FIXED) =====
window.updateAvatar = async (input) => {
  const file = input.files[0];
  if (!file || !currentUser) return;
  const toastId = showToast('Uploading...', 'Your photo is being uploaded.', '');
  try {
    const r = ref(storage, `avatars/${currentUser.uid}`);
    await uploadBytes(r, file);
    const url = await getDownloadURL(r);
    await updateDoc(doc(db, 'users', currentUser.uid), { photoURL: url });
    document.getElementById('profile-avatar').src = url;
    showToast('Photo Updated!', 'Your profile picture has been changed.', url);
  } catch (e) {
    showToast('Upload Failed', 'Check your Firebase Storage rules.', '');
    console.error('Avatar upload error:', e);
  }
};

// ===== COVER UPLOAD (FIXED) =====
window.updateCover = async (input) => {
  const file = input.files[0];
  if (!file || !currentUser) return;
  showToast('Uploading cover...', 'Please wait.', '');
  try {
    const r = ref(storage, `covers/${currentUser.uid}`);
    await uploadBytes(r, file);
    const url = await getDownloadURL(r);
    await updateDoc(doc(db, 'users', currentUser.uid), { coverURL: url });
    document.getElementById('cover-container').style.background = `url(${url}) center/cover`;
    showToast('Cover Updated!', 'Your cover photo has been changed.', url);
  } catch (e) {
    showToast('Upload Failed', 'Check your Firebase Storage rules.', '');
    console.error('Cover upload error:', e);
  }
};

// ===== SIGN OUT =====
window.signOut = async () => {
  if (currentUser) await updateDoc(doc(db, 'users', currentUser.uid), { isOnline: false, lastSeen: serverTimestamp() });
  await firebaseSignOut(auth);
  window.location.href = 'auth.html';
};

window.closeEditModal = () => document.getElementById('edit-modal')?.classList.add('hidden');
window.openEditModal = () => document.getElementById('edit-modal')?.classList.remove('hidden');
