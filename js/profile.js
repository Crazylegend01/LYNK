// ============================================================
// LYNK By Legends — Profile Module
// ============================================================

import { auth, db } from './firebase-config.js';
import { ThemeManager } from './theme.js';
import { initNotifications, sendNotification, showToast } from './notifications.js';
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc,
  query, where, orderBy, limit, serverTimestamp, increment, deleteField
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { uploadToCloudinary } from './cloudinary.js';
import {
  onAuthStateChanged,
  signOut as firebaseSignOut,
  deleteUser,
  reauthenticateWithCredential,
  EmailAuthProvider
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

ThemeManager.init();

let currentUser = null;
let currentUserData = null;
let profileData = null;
let profileUid = null;
let isOwnProfile = false;

// ===== AUTH GUARD =====
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'auth.html'; return; }
  currentUser = user;
  const snap = await getDoc(doc(db, 'users', user.uid));
  currentUserData = snap.data() || {};
  await initNotifications(user.uid);
  await loadProfile();
  loadEditSchools();
});

// ===== LOAD PROFILE =====
async function loadProfile() {
  const params = new URLSearchParams(window.location.search);
  profileUid = params.get('uid') || currentUser.uid;
  isOwnProfile = profileUid === currentUser.uid;

  const snap = await getDoc(doc(db, 'users', profileUid));
  if (!snap.exists()) {
    document.querySelector('main')?.insertAdjacentHTML('afterbegin', `
      <div class="text-center py-20">
        <div class="text-5xl mb-4">👻</div>
        <h2 class="text-2xl font-bold mb-2">User not found</h2>
        <a href="feed.html" class="lynk-btn lynk-btn-primary px-6 py-3 rounded-xl mt-4">Back to Feed</a>
      </div>`);
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

  // Role badges
  if (d.userType === 'staff') {
    document.getElementById('staff-badge')?.classList.remove('hidden');
    if (d.position) {
      const posEl = document.getElementById('profile-position');
      posEl.textContent = d.position;
      posEl.classList.remove('hidden');
    }
  } else if (d.userType === 'alumni') {
    document.getElementById('alumni-badge')?.classList.remove('hidden');
  }

  // Academic level
  if (d.academicLevel && d.userType !== 'staff') {
    const lvlEl = document.getElementById('profile-level');
    if (lvlEl) { lvlEl.textContent = d.academicLevel; lvlEl.style.display = 'inline-block'; }
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

  // Skills
  if (d.skills?.length) {
    const wrap = document.getElementById('profile-skills-wrap');
    const list = document.getElementById('profile-skills-list');
    if (wrap && list) {
      wrap.classList.remove('hidden');
      list.innerHTML = d.skills.map(s => `<span class="lynk-badge text-xs" style="background:rgba(168,85,247,0.1);color:var(--grad-1)">${escHtml(s)}</span>`).join('');
    }
  }

  // Interests
  if (d.interests?.length) {
    const wrap = document.getElementById('profile-interests-wrap');
    const list = document.getElementById('profile-interests-list');
    if (wrap && list) {
      wrap.classList.remove('hidden');
      list.innerHTML = d.interests.map(s => `<span class="lynk-badge text-xs" style="background:rgba(6,182,212,0.1);color:var(--grad-2)">${escHtml(s)}</span>`).join('');
    }
  }

  // Social links
  let hasLinks = false;
  if (d.website) {
    const el = document.getElementById('profile-website');
    if (el) { el.href = d.website; el.classList.remove('hidden'); hasLinks = true; }
  }
  if (d.linkedin) {
    const el = document.getElementById('profile-linkedin');
    const url = d.linkedin.startsWith('http') ? d.linkedin : `https://${d.linkedin}`;
    if (el) { el.href = url; el.classList.remove('hidden'); hasLinks = true; }
  }
  if (d.twitter) {
    const el = document.getElementById('profile-twitter');
    const handle = d.twitter.replace('@','');
    if (el) { el.href = `https://twitter.com/${handle}`; el.classList.remove('hidden'); hasLinks = true; }
  }
  if (hasLinks) document.getElementById('profile-links')?.classList.remove('hidden');

  // About tab
  document.getElementById('about-name').textContent = d.displayName || '—';
  document.getElementById('about-username').textContent = `@${d.username || '—'}`;
  const typeLabels = { staff: '👨‍🏫 Staff', alumni: '🏆 Alumni', student: '🎓 Student' };
  document.getElementById('about-type').textContent = typeLabels[d.userType] || '🎓 Student';
  if (d.position) {
    const posRow = document.getElementById('about-position-row');
    if (posRow) { posRow.style.display = 'flex'; posRow.classList.remove('hidden'); }
    document.getElementById('about-position').textContent = d.position;
  }
  if (d.academicLevel) {
    const lvlRow = document.getElementById('about-level-row');
    if (lvlRow) { lvlRow.style.display = 'flex'; lvlRow.classList.remove('hidden'); }
    document.getElementById('about-level').textContent = d.academicLevel;
  }
  document.getElementById('about-university').textContent = d.university || '—';
  document.getElementById('about-faculty').textContent = d.faculty || '—';
  document.getElementById('about-dept').textContent = d.department || '—';
  document.getElementById('about-joined').textContent = joined || '—';
  if (d.skills?.length) {
    const row = document.getElementById('about-skills-row');
    const list = document.getElementById('about-skills');
    if (row && list) {
      row.classList.remove('hidden');
      list.innerHTML = d.skills.map(s => `<span class="lynk-badge text-xs" style="background:rgba(168,85,247,0.1);color:var(--grad-1)">${escHtml(s)}</span>`).join('');
    }
  }
  if (d.interests?.length) {
    const row = document.getElementById('about-interests-row');
    const list = document.getElementById('about-interests');
    if (row && list) {
      row.classList.remove('hidden');
      list.innerHTML = d.interests.map(s => `<span class="lynk-badge text-xs" style="background:rgba(6,182,212,0.1);color:var(--grad-2)">${escHtml(s)}</span>`).join('');
    }
  }

  // Sidebar
  const fl = document.getElementById('faculty-link');
  if (fl) fl.textContent = currentUserData.faculty || 'My Faculty';
  const dl = document.getElementById('dept-link');
  if (dl) dl.textContent = currentUserData.department || 'My Department';

  if (isOwnProfile) {
    document.getElementById('btn-edit-profile')?.classList.remove('hidden');
    const avatarEdit = document.getElementById('avatar-edit');
    if (avatarEdit) avatarEdit.style.display = 'flex';
    const coverEdit = document.getElementById('cover-edit');
    if (coverEdit) coverEdit.style.display = 'flex';
    document.getElementById('btn-delete-account')?.classList.remove('hidden');

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
    if (document.getElementById('edit-level')) document.getElementById('edit-level').value = d.academicLevel || '';
    if (document.getElementById('edit-skills')) document.getElementById('edit-skills').value = (d.skills || []).join(', ');
    if (document.getElementById('edit-interests')) document.getElementById('edit-interests').value = (d.interests || []).join(', ');

    const posWrapper = document.getElementById('edit-position-wrapper');
    if (posWrapper) posWrapper.style.display = d.userType === 'staff' ? 'block' : 'none';
    const levelWrapper = document.getElementById('edit-level-wrapper');
    if (levelWrapper) levelWrapper.style.display = d.userType !== 'staff' ? 'block' : 'none';

  } else {
    // Show friend + message + block buttons
    const [friendSnap, reverseSnap] = await Promise.all([
      getDoc(doc(db, 'friends', `${currentUser.uid}_${profileUid}`)),
      getDoc(doc(db, 'friends', `${profileUid}_${currentUser.uid}`))
    ]);
    const btn = document.getElementById('btn-friend-action');
    btn?.classList.remove('hidden');
    document.getElementById('btn-message')?.classList.remove('hidden');
    document.getElementById('btn-message').href = `chat.html?uid=${profileUid}`;
    document.getElementById('btn-block-user')?.classList.remove('hidden');

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

    // Check block status
    const blockSnap = await getDoc(doc(db, 'blocks', `${currentUser.uid}_${profileUid}`));
    const blockBtn = document.getElementById('btn-block-user');
    if (blockBtn) {
      blockBtn.textContent = blockSnap.exists() ? '🚫 Blocked' : '🚫';
      blockBtn.title = blockSnap.exists() ? 'Unblock user' : 'Block user';
    }
  }

  loadProfilePosts();
  loadFriends();
}

// ===== BLOCK USER =====
window.toggleBlockUser = async () => {
  if (!currentUser || isOwnProfile) return;
  const blockId = `${currentUser.uid}_${profileUid}`;
  const blockRef = doc(db, 'blocks', blockId);
  const snap = await getDoc(blockRef);
  const btn = document.getElementById('btn-block-user');
  if (snap.exists()) {
    await deleteDoc(blockRef);
    if (btn) { btn.textContent = '🚫'; btn.title = 'Block user'; }
    showToast('Unblocked', `${profileData.displayName} has been unblocked.`, '');
  } else {
    if (!confirm(`Block ${profileData.displayName}? They won't be able to see your posts or send you messages.`)) return;
    await setDoc(blockRef, {
      blockedBy: currentUser.uid, blockedUser: profileUid, createdAt: serverTimestamp()
    });
    if (btn) { btn.textContent = '🚫 Blocked'; btn.title = 'Unblock user'; }
    showToast('Blocked', `${profileData.displayName} has been blocked.`, '');
  }
};

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

// ===== LOAD SCHOOLS FOR EDIT MODAL =====
let editSchoolsData = {};
async function loadEditSchools() {
  const uniSelect = document.getElementById('edit-university-select');
  if (!uniSelect) return;
  try {
    const snap = await getDocs(collection(db, 'schools'));
    snap.docs.forEach(d => {
      editSchoolsData[d.id] = d.data();
      const opt = document.createElement('option');
      opt.value = d.data().name; opt.textContent = d.data().name;
      uniSelect.appendChild(opt);
    });
  } catch { /* ignore */ }
}

window.loadEditFaculties = (schoolName) => {
  const school = Object.values(editSchoolsData).find(s => s.name === schoolName);
  const facSelect = document.getElementById('edit-faculty-select');
  if (!school || !facSelect) return;
  const faculties = Object.keys(school.faculties || {});
  facSelect.innerHTML = '<option value="">-- Select --</option>';
  faculties.forEach(f => { const o = document.createElement('option'); o.value = f; o.textContent = f; facSelect.appendChild(o); });
};

window.loadEditDepartments = (faculty) => {
  const uniVal = document.getElementById('edit-university-select').value || document.getElementById('edit-university').value;
  const school = Object.values(editSchoolsData).find(s => s.name === uniVal);
  const deptSelect = document.getElementById('edit-dept-select');
  if (!school || !faculty || !deptSelect) return;
  const depts = school.faculties?.[faculty] || [];
  deptSelect.innerHTML = '<option value="">-- Select --</option>';
  depts.forEach(d => { const o = document.createElement('option'); o.value = d; o.textContent = d; deptSelect.appendChild(o); });
};

// ===== PROFILE POSTS =====
async function loadProfilePosts() {
  const container = document.getElementById('tab-posts');
  container.innerHTML = `<div class="lynk-card p-5 animate-pulse"><div class="h-4 rounded w-3/4 mb-2" style="background:var(--border)"></div><div class="h-4 rounded w-1/2" style="background:var(--border)"></div></div>`;
  try {
  const q = query(collection(db, 'posts'), where('authorId','==',profileUid), limit(20));
  const snap = await getDocs(q);
  const docs = [...snap.docs].sort((a,b) => (b.data().createdAt?.toMillis?.() || 0) - (a.data().createdAt?.toMillis?.() || 0));
  if (snap.empty) {
    container.innerHTML = `<div class="lynk-card p-8 text-center"><div class="text-4xl mb-3">📭</div><p style="color:var(--text-secondary);font-size:0.875rem">${isOwnProfile ? "You haven't posted anything yet." : "No posts yet."}</p></div>`;
    return;
  }
  container.innerHTML = '';
  docs.forEach(d => {
    const data = d.data();
    const ts = data.createdAt?.toDate?.()?.toLocaleString() || '';
    container.insertAdjacentHTML('beforeend', `
      <div class="lynk-card p-5 fade-in">
        <p class="text-xs mb-2" style="color:var(--text-muted)">${ts}</p>
        ${data.content ? `<p class="text-sm whitespace-pre-wrap">${escHtml(data.content)}</p>` : ''}
        ${data.mediaUrl && data.mediaType !== 'video' ? `<img src="${data.mediaUrl}" class="rounded-xl mt-3 max-h-64 object-cover w-full" />` : ''}
        ${data.mediaUrl && data.mediaType === 'video' ? `<video src="${data.mediaUrl}" controls class="w-full rounded-xl mt-3"></video>` : ''}
        <div class="flex gap-4 mt-3 pt-3 border-t text-xs" style="border-color:var(--border);color:var(--text-muted)">
          <span>❤️ ${data.likesCount||0}</span><span>💬 ${data.commentsCount||0}</span>
        </div>
      </div>`);
  });
  } catch (err) {
    container.innerHTML = `<div class="lynk-card p-8 text-center"><p style="color:var(--text-muted);font-size:0.875rem">Error loading posts. Try again.</p></div>`;
  }
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
      const roleLabel = u.userType === 'staff' ? '👨‍🏫 Staff' : u.userType === 'alumni' ? '🏆 Alumni' : '';
      grid.insertAdjacentHTML('beforeend', `
        <a href="profile.html?uid=${uid}" class="lynk-card p-4 text-center hover:scale-105 transition-transform block">
          <img src="${ava}" class="lynk-avatar w-16 h-16 mx-auto mb-2" />
          <p class="text-sm font-semibold truncate">${escHtml(u.displayName)}</p>
          <p class="text-xs" style="color:var(--text-muted)">@${u.username || ''}</p>
          ${roleLabel ? `<span class="text-xs" style="color:#38bdf8">${roleLabel}</span>` : ''}
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
            <p class="text-sm font-semibold">${escHtml(u.displayName)}</p>
            <p class="text-xs mb-1" style="color:var(--text-muted)">@${u.username || ''}</p>
            <p class="text-xs mb-3" style="color:var(--text-muted)">${escHtml(u.position || u.department || '')}</p>
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
  const username   = document.getElementById('edit-username').value.trim().toLowerCase();
  const name       = document.getElementById('edit-name').value.trim();
  const bio        = document.getElementById('edit-bio').value.trim();
  const position   = document.getElementById('edit-position').value.trim();
  const academicLevel = document.getElementById('edit-level')?.value || '';
  const skillsRaw  = document.getElementById('edit-skills')?.value || '';
  const interestsRaw = document.getElementById('edit-interests')?.value || '';
  const university = document.getElementById('edit-university-select').value || document.getElementById('edit-university').value.trim();
  const faculty    = document.getElementById('edit-faculty-select').value || document.getElementById('edit-faculty').value.trim();
  const dept       = document.getElementById('edit-dept-select').value || document.getElementById('edit-dept').value.trim();

  const skills     = skillsRaw.split(',').map(s => s.trim()).filter(Boolean).slice(0,15);
  const interests  = interestsRaw.split(',').map(s => s.trim()).filter(Boolean).slice(0,15);

  if (username && username.length < 3) { showToast('Error', 'Username must be at least 3 characters.', ''); return; }

  await updateDoc(doc(db, 'users', currentUser.uid), {
    displayName: name, username, bio, position, academicLevel,
    skills, interests, university, faculty, department: dept,
    profileComplete: !!(university && faculty && dept)
  });

  closeEditModal();
  currentUserData = { ...currentUserData, displayName: name, username, bio, position, academicLevel, skills, interests, university, faculty, department: dept };
  await loadProfile();
  showToast('Profile Updated!', 'Your changes have been saved.', currentUserData.photoURL||'');
};

// ===== AVATAR UPLOAD =====
window.updateAvatar = async (input) => {
  const file = input.files[0];
  if (!file || !currentUser) return;
  showToast('Uploading...', 'Your photo is being uploaded.', '');
  try {
    const url = await uploadToCloudinary(file, `lynk/avatars`);
    await updateDoc(doc(db, 'users', currentUser.uid), { photoURL: url });
    document.getElementById('profile-avatar').src = url;
    showToast('Photo Updated!', 'Your profile picture has been changed.', url);
  } catch (e) {
    showToast('Upload Failed', 'Could not upload photo. Check your Cloudinary preset.', '');
  }
};

// ===== COVER UPLOAD =====
window.updateCover = async (input) => {
  const file = input.files[0];
  if (!file || !currentUser) return;
  showToast('Uploading cover...', 'Please wait.', '');
  try {
    const url = await uploadToCloudinary(file, `lynk/covers`);
    await updateDoc(doc(db, 'users', currentUser.uid), { coverURL: url });
    document.getElementById('cover-container').style.background = `url(${url}) center/cover`;
    showToast('Cover Updated!', 'Your cover photo has been changed.', url);
  } catch (e) {
    showToast('Upload Failed', 'Could not upload cover. Check your Cloudinary preset.', '');
  }
};

// ===== SIGN OUT =====
window.signOut = async () => {
  if (currentUser) await updateDoc(doc(db, 'users', currentUser.uid), { isOnline: false, lastSeen: serverTimestamp() });
  await firebaseSignOut(auth);
  window.location.href = 'auth.html';
};

window.closeEditModal = () => document.getElementById('edit-modal')?.classList.add('hidden');
window.openEditModal  = () => document.getElementById('edit-modal')?.classList.remove('hidden');

// ===== DELETE ACCOUNT =====
window.openDeleteModal  = () => { document.getElementById('delete-password').value = ''; document.getElementById('delete-error').classList.add('hidden'); document.getElementById('delete-modal')?.classList.remove('hidden'); };
window.closeDeleteModal = () => document.getElementById('delete-modal')?.classList.add('hidden');

window.confirmDeleteAccount = async () => {
  const password = document.getElementById('delete-password').value;
  const errEl = document.getElementById('delete-error');
  const btn   = document.getElementById('btn-confirm-delete');
  if (!password) { errEl.textContent = 'Please enter your password to confirm.'; errEl.classList.remove('hidden'); return; }
  btn.disabled = true; btn.textContent = '⏳ Deleting...'; errEl.classList.add('hidden');
  try {
    const credential = EmailAuthProvider.credential(currentUser.email, password);
    await reauthenticateWithCredential(currentUser, credential);
    const uid = currentUser.uid;
    const postsSnap = await getDocs(query(collection(db, 'posts'), where('authorId','==',uid)));
    await Promise.all(postsSnap.docs.map(d => d.ref.delete()));
    const [fromSnap, toSnap] = await Promise.all([
      getDocs(query(collection(db, 'friends'), where('from','==',uid))),
      getDocs(query(collection(db, 'friends'), where('to','==',uid)))
    ]);
    await Promise.all([...fromSnap.docs, ...toSnap.docs].map(d => d.ref.delete()));
    const notifSnap = await getDocs(query(collection(db, 'notifications'), where('toUid','==',uid)));
    await Promise.all(notifSnap.docs.map(d => d.ref.delete()));
    await deleteDoc(doc(db, 'users', uid));
    await deleteUser(currentUser);
    window.location.href = 'auth.html';
  } catch (err) {
    btn.disabled = false; btn.textContent = '🗑️ Yes, Delete My Account';
    const msgs = { 'auth/wrong-password':'Incorrect password.', 'auth/invalid-credential':'Incorrect password.', 'auth/too-many-requests':'Too many attempts. Wait a few minutes.' };
    errEl.textContent = msgs[err.code] || err.message;
    errEl.classList.remove('hidden');
  }
};

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
