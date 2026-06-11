// ============================================================
// LYNK By Legends — Feed Module (with Notifications)
// ============================================================

import { auth, db, storage } from './firebase-config.js';
import { ThemeManager } from './theme.js';
import { initNotifications, sendNotification, showToast } from './notifications.js';
import {
  collection, addDoc, getDocs, getDoc, doc, setDoc, updateDoc, deleteDoc,
  query, orderBy, limit, startAfter, where, serverTimestamp,
  arrayUnion, arrayRemove, increment
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { onAuthStateChanged, signOut as firebaseSignOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

ThemeManager.init();

let currentUser = null;
let currentUserData = null;
let lastPostDoc = null;
let currentFilter = 'all';
let activePostId = null;
window._postMediaFile = null;

// Guard — require auth
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'auth.html'; return; }
  currentUser = user;
  const snap = await getDoc(doc(db, 'users', user.uid));
  currentUserData = snap.data() || {};
  populateSidebar();
  await initNotifications(user.uid);
  loadFeed();
  loadSuggestions();
  loadTrendingCommunities();
  checkOnboarding();
});

function populateSidebar() {
  const d = currentUserData;
  const avatarUrl = d.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(d.displayName||'U')}&background=a855f7&color=fff`;
  ['nav-avatar','sidebar-avatar','compose-avatar','comment-avatar'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.src = avatarUrl;
  });
  const sn = document.getElementById('sidebar-name');
  if (sn) sn.textContent = d.displayName || 'LYNK User';
  const sd = document.getElementById('sidebar-dept');
  if (sd) sd.textContent = `${d.department || ''} · ${d.university || ''}`;
  const fl = document.getElementById('faculty-link');
  if (fl) fl.textContent = d.faculty || 'My Faculty';
  const dl = document.getElementById('dept-link');
  if (dl) dl.textContent = d.department || 'My Department';
  if (d.adminRole || d.role === 'admin') {
    document.getElementById('admin-link')?.classList.remove('hidden');
  }
}

// ===== LOAD FEED =====
async function loadFeed(reset = true) {
  if (reset) {
    lastPostDoc = null;
    document.getElementById('feed-container').innerHTML = skeletons(3);
  }
  const postsRef = collection(db, 'posts');
  let q;
  if (currentFilter === 'faculty' && currentUserData.faculty) {
    q = query(postsRef, where('faculty', '==', currentUserData.faculty), orderBy('createdAt', 'desc'), limit(10));
  } else if (currentFilter === 'trending') {
    q = query(postsRef, orderBy('likesCount', 'desc'), limit(10));
  } else {
    q = query(postsRef, orderBy('createdAt', 'desc'), limit(10));
  }
  if (!reset && lastPostDoc) {
    q = query(postsRef, orderBy('createdAt', 'desc'), startAfter(lastPostDoc), limit(10));
  }
  try {
    const snap = await getDocs(q);
    lastPostDoc = snap.docs[snap.docs.length - 1];
    if (snap.empty && reset) {
      document.getElementById('feed-container').innerHTML = `
        <div class="lynk-card p-10 text-center">
          <div class="text-5xl mb-3">📭</div>
          <h3 class="font-semibold mb-2">No posts yet</h3>
          <p style="color:var(--text-secondary);font-size:0.875rem">Be the first to share something with your campus!</p>
        </div>`;
      return;
    }
    if (reset) document.getElementById('feed-container').innerHTML = '';
    snap.docs.forEach(d => {
      document.getElementById('feed-container').insertAdjacentHTML('beforeend', buildPostCard(d.id, d.data()));
    });
    document.getElementById('load-more-btn')?.classList.toggle('hidden', snap.docs.length < 10);
  } catch (e) {
    if (reset) document.getElementById('feed-container').innerHTML = `
      <div class="lynk-card p-6 text-center text-sm" style="color:var(--text-muted)">
        Error loading feed. Check your connection.
      </div>`;
  }
}

function skeletons(n) {
  return Array.from({length: n}, () => `
    <div class="lynk-card p-5 animate-pulse">
      <div class="flex gap-3">
        <div class="w-10 h-10 rounded-full flex-shrink-0" style="background:var(--border)"></div>
        <div class="flex-1">
          <div class="h-3 rounded w-1/3 mb-2" style="background:var(--border)"></div>
          <div class="h-3 rounded w-1/4 mb-4" style="background:var(--border)"></div>
          <div class="h-4 rounded w-full mb-2" style="background:var(--border)"></div>
          <div class="h-4 rounded w-2/3" style="background:var(--border)"></div>
        </div>
      </div>
    </div>`).join('');
}

function buildPostCard(postId, data) {
  const d = data;
  const isOwn = currentUser && d.authorId === currentUser.uid;
  const liked = d.likes?.includes(currentUser?.uid);
  const ts = d.createdAt?.toDate?.()?.toLocaleString() || 'just now';
  const avatarUrl = d.authorPhoto || `https://ui-avatars.com/api/?name=${encodeURIComponent(d.authorName||'U')}&background=a855f7&color=fff`;

  let mediaHtml = '';
  if (d.mediaUrl) {
    if (d.mediaType === 'video') {
      mediaHtml = `<div class="post-media mt-3"><video src="${d.mediaUrl}" controls class="w-full rounded-xl"></video></div>`;
    } else {
      mediaHtml = `<div class="post-media mt-3"><img src="${d.mediaUrl}" alt="Post image" class="w-full rounded-xl cursor-pointer" onclick="openPostModal('${postId}')" /></div>`;
    }
  }

  let pollHtml = '';
  if (d.poll?.options) {
    const total = d.poll.votes ? Object.values(d.poll.votes).reduce((a,b) => a + (b?.length||0), 0) : 0;
    pollHtml = `<div class="mt-3 flex flex-col gap-2">
      ${d.poll.options.map((opt, i) => {
        const votes = d.poll.votes?.[i]?.length || 0;
        const pct = total > 0 ? Math.round((votes/total)*100) : 0;
        return `<div class="poll-option" onclick="votePoll('${postId}', ${i}, '${d.authorId}', '${escHtml(opt)}')">
          <div class="poll-fill" style="width:${pct}%"></div>
          <div class="flex items-center justify-between">
            <span class="text-sm font-medium">${opt}</span>
            <span class="text-xs" style="color:var(--text-muted)">${pct}%</span>
          </div>
        </div>`;
      }).join('')}
      <p class="text-xs" style="color:var(--text-muted)">${total} vote${total!==1?'s':''}</p>
    </div>`;
  }

  return `
    <div class="lynk-card p-5 fade-in" id="post-${postId}">
      <div class="flex gap-3">
        <a href="profile.html?uid=${d.authorId}">
          <img src="${avatarUrl}" class="lynk-avatar w-10 h-10 flex-shrink-0 cursor-pointer" />
        </a>
        <div class="flex-1 min-w-0">
          <div class="flex items-start justify-between gap-2">
            <div>
              <a href="profile.html?uid=${d.authorId}" class="font-semibold text-sm hover:underline">${d.authorName || 'LYNK User'}</a>
              <span class="text-xs ml-2 lynk-badge" style="background:var(--bg-card-hover);color:var(--text-muted)">${d.faculty || d.university || ''}</span>
              <p class="text-xs mt-0.5" style="color:var(--text-muted)">${ts} · ${d.visibility === 'public' ? '🌍' : d.visibility === 'faculty' ? '🏛️' : '👥'}</p>
            </div>
            ${isOwn
              ? `<button onclick="deletePost('${postId}')" class="lynk-btn lynk-btn-ghost p-1 text-xs" style="color:var(--text-muted)">🗑</button>`
              : `<button onclick="reportPost('${postId}')" class="lynk-btn lynk-btn-ghost p-1 text-xs" style="color:var(--text-muted)" data-tooltip="Report post">⚑</button>`}
          </div>
          ${d.content ? `<p class="text-sm mt-2 whitespace-pre-wrap">${escHtml(d.content)}</p>` : ''}
          ${mediaHtml}
          ${pollHtml}
          <div class="flex items-center gap-2 mt-4 pt-3 border-t" style="border-color:var(--border)">
            <button class="reaction-btn ${liked?'active':''}" onclick="toggleLike('${postId}', '${d.authorId}', ${JSON.stringify(d.authorName||'')})">
              ❤️ <span id="likes-${postId}">${d.likesCount||0}</span>
            </button>
            <button class="reaction-btn" onclick="openPostModal('${postId}')">
              💬 <span>${d.commentsCount||0}</span>
            </button>
            <button class="reaction-btn" onclick="sharePost('${postId}')">
              ↗️ Share
            </button>
          </div>
        </div>
      </div>
    </div>`;
}

// ===== SUBMIT POST =====
window.submitPost = async () => {
  if (!currentUser) return;
  const content = document.getElementById('post-content').value.trim();
  const visibility = document.getElementById('post-visibility').value;

  let poll = null;
  if (!document.getElementById('poll-builder').classList.contains('hidden')) {
    const opts = Array.from(document.getElementById('poll-options').children)
      .map(el => el.value.trim()).filter(Boolean);
    if (opts.length >= 2) poll = { options: opts, votes: {} };
  }

  if (!content && !window._postMediaFile && !poll) {
    showToast('Oops!', 'Write something or add media first.', '');
    return;
  }

  const btn = document.getElementById('btn-post');
  btn.disabled = true; btn.textContent = 'Posting...';

  let mediaUrl = null, mediaType = null;
  if (window._postMediaFile) {
    const fileRef = ref(storage, `posts/${currentUser.uid}/${Date.now()}-${window._postMediaFile.name}`);
    await uploadBytes(fileRef, window._postMediaFile);
    mediaUrl = await getDownloadURL(fileRef);
    mediaType = window._postMediaFile.type.startsWith('video') ? 'video' : 'image';
  }

  await addDoc(collection(db, 'posts'), {
    content, authorId: currentUser.uid,
    authorName: currentUserData.displayName || 'LYNK User',
    authorPhoto: currentUserData.photoURL || '',
    university: currentUserData.university || '',
    faculty: currentUserData.faculty || '',
    department: currentUserData.department || '',
    visibility, mediaUrl, mediaType, poll,
    likes: [], likesCount: 0, commentsCount: 0,
    createdAt: serverTimestamp()
  });

  await updateDoc(doc(db, 'users', currentUser.uid), { postsCount: increment(1) });

  document.getElementById('post-content').value = '';
  window._postMediaFile = null;
  document.getElementById('media-preview').classList.add('hidden');
  document.getElementById('poll-builder').classList.add('hidden');
  document.getElementById('poll-options').innerHTML = `
    <input type="text" class="lynk-input text-sm py-2" placeholder="Option 1" id="poll-opt-0" />
    <input type="text" class="lynk-input text-sm py-2" placeholder="Option 2" id="poll-opt-1" />`;

  btn.disabled = false; btn.textContent = 'Post';
  showToast('Posted!', 'Your post is live on the feed.', currentUserData.photoURL || '');
  loadFeed();
};

// ===== LIKE — fires notification =====
window.toggleLike = async (postId, authorId, authorName) => {
  if (!currentUser) return;
  const postRef = doc(db, 'posts', postId);
  const snap = await getDoc(postRef);
  const data = snap.data();
  const liked = data.likes?.includes(currentUser.uid);

  await updateDoc(postRef, {
    likes: liked ? arrayRemove(currentUser.uid) : arrayUnion(currentUser.uid),
    likesCount: liked ? Math.max((data.likesCount||1)-1, 0) : (data.likesCount||0)+1
  });

  const newCount = liked ? Math.max((data.likesCount||1)-1, 0) : (data.likesCount||0)+1;
  const el = document.getElementById(`likes-${postId}`);
  if (el) el.textContent = newCount;
  const btn = el?.closest('.reaction-btn');
  if (btn) btn.classList.toggle('active', !liked);

  // Send notification if newly liked (not un-liking)
  if (!liked) {
    await sendNotification({
      toUid: authorId,
      fromUid: currentUser.uid,
      fromName: currentUserData.displayName || 'Someone',
      fromPhoto: currentUserData.photoURL || '',
      type: 'like',
      message: 'liked your post',
      preview: data.content?.slice(0, 80) || ''
    });
  }
};

// ===== POLL VOTE =====
window.votePoll = async (postId, optIndex, authorId, optLabel) => {
  if (!currentUser) return;
  await updateDoc(doc(db, 'posts', postId), {
    [`poll.votes.${optIndex}`]: arrayUnion(currentUser.uid)
  });
  await sendNotification({
    toUid: authorId,
    fromUid: currentUser.uid,
    fromName: currentUserData.displayName || 'Someone',
    fromPhoto: currentUserData.photoURL || '',
    type: 'poll',
    message: 'voted on your poll',
    preview: optLabel
  });
};

// ===== DELETE POST =====
window.deletePost = async (postId) => {
  if (!confirm('Delete this post?')) return;
  await deleteDoc(doc(db, 'posts', postId));
  document.getElementById(`post-${postId}`)?.remove();
};

// ===== REPORT =====
window.reportPost = async (postId) => {
  await addDoc(collection(db, 'reports'), {
    postId, reportedBy: currentUser.uid,
    reason: 'User report', status: 'open',
    createdAt: serverTimestamp()
  });
  showToast('Reported', 'Our moderation team will review this post.', '');
};

// ===== SHARE =====
window.sharePost = (postId) => {
  const url = `${window.location.origin}${window.location.pathname.replace('feed.html', '')}feed.html?post=${postId}`;
  navigator.clipboard?.writeText(url).then(() => showToast('Copied!', 'Post link copied to clipboard.', ''));
};

// ===== POST MODAL (Comments) =====
window.openPostModal = async (postId) => {
  activePostId = postId;
  const snap = await getDoc(doc(db, 'posts', postId));
  if (!snap.exists()) return;
  document.getElementById('post-modal-content').innerHTML = buildPostCard(postId, snap.data());
  document.getElementById('post-modal').classList.remove('hidden');
  document.getElementById('comment-avatar').src = currentUserData.photoURL || `https://ui-avatars.com/api/?name=U&background=a855f7&color=fff`;
  loadComments(postId);
};

window.closePostModal = () => {
  document.getElementById('post-modal').classList.add('hidden');
  activePostId = null;
};

async function loadComments(postId) {
  const list = document.getElementById('comments-list');
  list.innerHTML = '<div class="text-xs" style="color:var(--text-muted)">Loading...</div>';
  const snap = await getDocs(query(
    collection(db, 'posts', postId, 'comments'),
    orderBy('createdAt', 'asc'), limit(50)
  ));
  if (snap.empty) {
    list.innerHTML = '<div class="text-xs" style="color:var(--text-muted)">No comments yet. Be first!</div>';
    return;
  }
  list.innerHTML = '';
  snap.docs.forEach(d => {
    const c = d.data();
    const ava = c.authorPhoto || `https://ui-avatars.com/api/?name=${encodeURIComponent(c.authorName||'U')}&background=a855f7&color=fff`;
    list.insertAdjacentHTML('beforeend', `
      <div class="flex gap-2 items-start">
        <img src="${ava}" class="lynk-avatar w-7 h-7 flex-shrink-0" />
        <div style="background:var(--bg-card-hover);padding:8px 12px;border-radius:12px;flex:1">
          <p class="text-xs font-semibold mb-0.5">${c.authorName}</p>
          <p class="text-xs">${escHtml(c.content)}</p>
        </div>
      </div>`);
  });
}

// ===== COMMENT — fires notification =====
window.submitComment = async () => {
  if (!activePostId || !currentUser) return;
  const input = document.getElementById('comment-input');
  const content = input.value.trim();
  if (!content) return;

  await addDoc(collection(db, 'posts', activePostId, 'comments'), {
    content, authorId: currentUser.uid,
    authorName: currentUserData.displayName || 'User',
    authorPhoto: currentUserData.photoURL || '',
    createdAt: serverTimestamp()
  });

  const postSnap = await getDoc(doc(db, 'posts', activePostId));
  const postData = postSnap.data();
  await updateDoc(doc(db, 'posts', activePostId), { commentsCount: increment(1) });

  // Notify post author
  if (postData?.authorId) {
    await sendNotification({
      toUid: postData.authorId,
      fromUid: currentUser.uid,
      fromName: currentUserData.displayName || 'Someone',
      fromPhoto: currentUserData.photoURL || '',
      type: 'comment',
      message: 'commented on your post',
      preview: content.slice(0, 80)
    });
  }

  input.value = '';
  loadComments(activePostId);
};

// ===== FILTER =====
window.setFilter = (filter, btn) => {
  currentFilter = filter;
  document.querySelectorAll('.lynk-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  loadFeed();
};

window.loadMorePosts = () => loadFeed(false);

// ===== MEDIA UPLOAD =====
window.handleMediaUpload = (input) => {
  const file = input.files[0];
  if (!file) return;
  window._postMediaFile = file;
  if (file.type.startsWith('image')) {
    document.getElementById('media-preview-img').src = URL.createObjectURL(file);
    document.getElementById('media-preview').classList.remove('hidden');
  }
};

// ===== SUGGESTIONS =====
async function loadSuggestions() {
  const list = document.getElementById('suggestions-list');
  const mobileList = document.getElementById('mobile-suggestions-list');
  if (!list && !mobileList) return;

  const d = currentUserData;

  // If user has no campus info yet, show a prompt
  if (!d.university && !d.faculty && !d.department) {
    const msg = `<div class="text-xs text-center py-2" style="color:var(--text-muted)">
      <p class="mb-2">Complete your profile to see classmates!</p>
      <button onclick="document.getElementById('onboarding-modal').classList.remove('hidden')"
              class="lynk-btn lynk-btn-primary text-xs py-1.5 px-3 rounded-lg">Set up profile</button>
    </div>`;
    if (list) list.innerHTML = msg;
    if (mobileList) mobileList.innerHTML = msg;
    return;
  }

  // Collect existing friend UIDs to exclude
  const [fromSnap, toSnap] = await Promise.all([
    getDocs(query(collection(db, 'friends'), where('from', '==', currentUser.uid))),
    getDocs(query(collection(db, 'friends'), where('to',   '==', currentUser.uid)))
  ]);
  const excludeUids = new Set([currentUser.uid]);
  fromSnap.docs.forEach(doc => excludeUids.add(doc.data().to));
  toSnap.docs.forEach(doc => excludeUids.add(doc.data().from));

  // Run parallel queries — dept (score 3) > faculty (score 2) > university (score 1)
  const queryDefs = [];
  if (d.department) queryDefs.push({ q: query(collection(db, 'users'), where('department', '==', d.department), limit(12)), score: 3, label: '📚 Same department' });
  if (d.faculty)    queryDefs.push({ q: query(collection(db, 'users'), where('faculty', '==', d.faculty), limit(12)), score: 2, label: '🏛️ Same faculty' });
  if (d.university) queryDefs.push({ q: query(collection(db, 'users'), where('university', '==', d.university), limit(12)), score: 1, label: '🎓 Same university' });

  const snaps = await Promise.all(queryDefs.map(def => getDocs(def.q)));

  // Score & deduplicate
  const scored = new Map();
  snaps.forEach((snap, i) => {
    const { score, label } = queryDefs[i];
    snap.docs.forEach(doc => {
      if (excludeUids.has(doc.id)) return;
      const existing = scored.get(doc.id);
      if (!existing || score > existing.score) {
        scored.set(doc.id, { uid: doc.id, data: doc.data(), score, label });
      }
    });
  });

  const sorted = [...scored.values()].sort((a, b) => b.score - a.score).slice(0, 6);

  const emptyMsg = `<div class="text-xs" style="color:var(--text-muted)">No suggestions yet — invite your classmates to join LYNK!</div>`;

  if (sorted.length === 0) {
    if (list) list.innerHTML = emptyMsg;
    if (mobileList) mobileList.innerHTML = emptyMsg;
    return;
  }

  // Build desktop sidebar cards
  if (list) {
    list.innerHTML = '';
    sorted.forEach(({ uid, data: u, label }) => {
      const ava = u.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.displayName||'U')}&background=a855f7&color=fff&size=64`;
      list.insertAdjacentHTML('beforeend', `
        <div class="flex items-center gap-2.5" id="suggestion-${uid}">
          <a href="profile.html?uid=${uid}" class="flex-shrink-0">
            <div class="relative">
              <img src="${ava}" class="lynk-avatar w-9 h-9" />
              ${u.isOnline ? '<span class="online-dot" style="width:8px;height:8px;right:0;bottom:0"></span>' : ''}
            </div>
          </a>
          <div class="flex-1 min-w-0">
            <p class="text-xs font-semibold truncate">
              ${escHtml(u.displayName||'User')}
              ${u.userType === 'staff' ? '<span style="color:#38bdf8;font-size:10px"> Staff</span>' : ''}
            </p>
            <p class="text-xs truncate lynk-gradient-text font-medium">${label}</p>
          </div>
          <button onclick="quickAddFriend('${uid}','${escHtml(u.displayName||'')}','${ava}')"
                  id="sugg-btn-${uid}"
                  class="lynk-btn lynk-btn-primary text-xs py-1 px-2 rounded-lg flex-shrink-0">+Add</button>
        </div>`);
    });
  }

  // Build mobile horizontal scroll row
  if (mobileList) {
    mobileList.innerHTML = '';
    sorted.forEach(({ uid, data: u, label }) => {
      const ava = u.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.displayName||'U')}&background=a855f7&color=fff&size=96`;
      mobileList.insertAdjacentHTML('beforeend', `
        <div class="flex-shrink-0 w-28 lynk-card p-3 text-center">
          <div class="relative inline-block mb-2">
            <img src="${ava}" class="lynk-avatar w-12 h-12 mx-auto" />
            ${u.isOnline ? '<span class="online-dot" style="width:8px;height:8px;right:0;bottom:0"></span>' : ''}
          </div>
          <p class="text-xs font-semibold truncate mb-0.5">${escHtml(u.displayName||'User')}</p>
          <p class="text-xs mb-2" style="color:var(--text-muted);font-size:10px;line-height:1.2">${label}</p>
          <button onclick="quickAddFriend('${uid}','${escHtml(u.displayName||'')}','${ava}')"
                  id="mob-sugg-btn-${uid}"
                  class="lynk-btn lynk-btn-primary w-full text-xs py-1 rounded-lg">+Add</button>
        </div>`);
    });
  }
}

// Inline add — button changes state without page reload
window.quickAddFriend = async (toUid, toName, toPhoto) => {
  // Update all buttons for this person (desktop + mobile)
  [`sugg-btn-${toUid}`, `mob-sugg-btn-${toUid}`].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.textContent = '✓ Sent';
      btn.disabled = true;
      btn.style.cssText = 'background:var(--bg-card-hover);color:var(--text-muted);cursor:default';
    }
  });
  await setDoc(doc(db, 'friends', `${currentUser.uid}_${toUid}`), {
    from: currentUser.uid, to: toUid, status: 'pending', createdAt: serverTimestamp()
  });
  await sendNotification({
    toUid, fromUid: currentUser.uid,
    fromName: currentUserData.displayName || 'Someone',
    fromPhoto: currentUserData.photoURL || '',
    type: 'friend_request', message: 'sent you a friend request',
    preview: `${currentUserData.faculty || ''} · ${currentUserData.university || ''}`
  });
  showToast('Request Sent! 🤝', `Friend request sent to ${toName}.`, toPhoto);
};

// ===== TRENDING COMMUNITIES =====
async function loadTrendingCommunities() {
  const list = document.getElementById('trending-communities');
  if (!list) return;
  const snap = await getDocs(query(collection(db, 'communities'), orderBy('memberCount', 'desc'), limit(5)));
  list.innerHTML = '';
  snap.docs.forEach(d => {
    const c = d.data();
    list.insertAdjacentHTML('beforeend', `
      <div class="flex items-center justify-between py-1.5 text-sm">
        <span class="truncate" style="color:var(--text-secondary)">${c.type === 'faculty' ? '🏛️' : '📚'} ${c.name}</span>
        <span class="text-xs lynk-badge" style="background:var(--bg-card-hover);color:var(--text-muted)">${c.memberCount}</span>
      </div>`);
  });
  if (snap.empty) list.innerHTML = '<div class="text-xs" style="color:var(--text-muted)">No communities yet.</div>';
}

// ===== FRIEND REQUEST — fires notification =====
window.sendFriendRequest = async (toUid, toName) => {
  if (!currentUser) return;
  await setDoc(doc(db, 'friends', `${currentUser.uid}_${toUid}`), {
    from: currentUser.uid,
    to: toUid,
    status: 'pending',
    createdAt: serverTimestamp()
  });
  await sendNotification({
    toUid,
    fromUid: currentUser.uid,
    fromName: currentUserData.displayName || 'Someone',
    fromPhoto: currentUserData.photoURL || '',
    type: 'friend_request',
    message: 'sent you a friend request',
    preview: `${currentUserData.faculty || ''} · ${currentUserData.university || ''}`
  });
  showToast('Request Sent!', `Friend request sent to ${toName || 'them'}.`, currentUserData.photoURL || '');
};

// ===== SIGN OUT =====
window.signOut = async () => {
  if (currentUser) {
    await setDoc(doc(db, 'users', currentUser.uid), { isOnline: false, lastSeen: serverTimestamp() }, { merge: true });
  }
  await firebaseSignOut(auth);
  window.location.href = 'auth.html';
};

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ============================================================
// ONBOARDING FLOW
// ============================================================
let _onboardSchools = {};

async function checkOnboarding() {
  if (!currentUser || !currentUserData) return;
  // Only show if university is missing AND user hasn't dismissed before
  const alreadyDone = localStorage.getItem(`lynk_onboarded_${currentUser.uid}`);
  if (alreadyDone) return;
  if (currentUserData.university && currentUserData.faculty) return;

  // Populate step 1 with user info
  const ava = currentUserData.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUserData.displayName||'U')}&background=a855f7&color=fff&size=96`;
  document.getElementById('onboard-avatar').src = ava;
  document.getElementById('onboard-name').textContent = currentUserData.displayName || 'LYNK User';
  document.getElementById('onboard-handle').textContent = `@${currentUserData.username || ''}`;
  document.getElementById('onboard-type').textContent = currentUserData.userType === 'staff' ? '👨‍🏫 Staff Member' : '🎓 Student';

  // Show position field for staff
  if (currentUserData.userType === 'staff') {
    document.getElementById('onboard-position-wrap')?.classList.remove('hidden');
    document.getElementById('onboard-position').value = currentUserData.position || '';
  }

  // Load schools for dropdown
  await _loadOnboardSchools();

  // Show the modal
  document.getElementById('onboarding-modal').classList.remove('hidden');
}

async function _loadOnboardSchools() {
  const select = document.getElementById('onboard-uni');
  if (!select) return;
  const snap = await getDocs(collection(db, 'schools'));
  if (snap.empty) {
    document.getElementById('onboard-no-schools')?.classList.remove('hidden');
    return;
  }
  snap.docs.forEach(d => {
    const s = d.data();
    _onboardSchools[d.id] = s;
    const opt = document.createElement('option');
    opt.value = d.id; opt.textContent = s.name;
    select.appendChild(opt);
  });
}

window.onboardLoadFaculties = (schoolId) => {
  const facSel = document.getElementById('onboard-faculty');
  const deptSel = document.getElementById('onboard-dept');
  const facWrap = document.getElementById('onboard-faculty-wrap');
  const deptWrap = document.getElementById('onboard-dept-wrap');
  if (!schoolId || !_onboardSchools[schoolId]) {
    facWrap?.classList.add('hidden');
    deptWrap?.classList.add('hidden');
    return;
  }
  const faculties = Object.keys(_onboardSchools[schoolId].faculties || {});
  facSel.innerHTML = '<option value="">-- Select faculty --</option>';
  faculties.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f; opt.textContent = f;
    facSel.appendChild(opt);
  });
  facWrap?.classList.remove('hidden');
  deptWrap?.classList.add('hidden');
};

window.onboardLoadDepts = (faculty) => {
  const schoolId = document.getElementById('onboard-uni').value;
  const deptSel = document.getElementById('onboard-dept');
  const deptWrap = document.getElementById('onboard-dept-wrap');
  if (!faculty || !schoolId) { deptWrap?.classList.add('hidden'); return; }
  const depts = _onboardSchools[schoolId]?.faculties?.[faculty] || [];
  deptSel.innerHTML = '<option value="">-- Select department --</option>';
  depts.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d; opt.textContent = d;
    deptSel.appendChild(opt);
  });
  deptWrap?.classList.remove('hidden');
};

window.onboardNext = (step) => {
  // Hide all steps
  [1,2,3].forEach(n => document.getElementById(`onboard-step-${n}`)?.classList.add('hidden'));
  document.getElementById(`onboard-step-${step}`)?.classList.remove('hidden');
  // Update progress bar
  const prog = { 1: '33%', 2: '66%', 3: '100%' };
  document.getElementById('onboard-progress').style.width = prog[step] || '33%';

  if (step === 3) _buildOnboardSummary();
};

window.onboardBack = (step) => window.onboardNext(step);

function _buildOnboardSummary() {
  const schoolId  = document.getElementById('onboard-uni')?.value;
  const faculty   = document.getElementById('onboard-faculty')?.value;
  const dept      = document.getElementById('onboard-dept')?.value;
  const position  = document.getElementById('onboard-position')?.value;
  const schoolName = schoolId ? (_onboardSchools[schoolId]?.name || '') : '';
  const summary = document.getElementById('onboard-summary');
  if (!summary) return;
  const rows = [
    ['🎓 University', schoolName || 'Not selected'],
    ['🏛️ Faculty', faculty || 'Not selected'],
    ['📚 Department', dept || 'Not selected'],
  ];
  if (currentUserData.userType === 'staff') rows.push(['👔 Position', position || 'Not set']);
  summary.innerHTML = rows.map(([label, val]) => `
    <div class="flex justify-between items-center text-sm">
      <span style="color:var(--text-muted)">${label}</span>
      <span class="font-medium ${val.includes('Not') ? '' : 'lynk-gradient-text'}">${val}</span>
    </div>`).join('<div class="h-px my-1" style="background:var(--border)"></div>');
}

window.finishOnboarding = async () => {
  if (!currentUser) return;
  const schoolId  = document.getElementById('onboard-uni')?.value;
  const faculty   = document.getElementById('onboard-faculty')?.value;
  const dept      = document.getElementById('onboard-dept')?.value;
  const position  = document.getElementById('onboard-position')?.value.trim();
  const schoolName = schoolId ? (_onboardSchools[schoolId]?.name || '') : '';

  const updates = {
    university: schoolName,
    faculty: faculty || '',
    department: dept || '',
    profileComplete: !!(schoolName && faculty && dept)
  };
  if (currentUserData.userType === 'staff' && position) updates.position = position;

  await setDoc(doc(db, 'users', currentUser.uid), updates, { merge: true });
  currentUserData = { ...currentUserData, ...updates };

  // Auto-join communities
  if (schoolName && faculty) {
    await setDoc(doc(db, 'communities', `${schoolName}-${faculty}`.replace(/\s+/g,'-').toLowerCase()), {
      name: `${faculty} — ${schoolName}`, type: 'faculty',
      university: schoolName, faculty, memberCount: 1, createdAt: serverTimestamp()
    }, { merge: true });
  }

  localStorage.setItem(`lynk_onboarded_${currentUser.uid}`, '1');
  document.getElementById('onboarding-modal').classList.add('hidden');
  populateSidebar();
  showToast('Profile Complete! 🎓', `Welcome to ${faculty || 'LYNK'}!`, currentUserData.photoURL || '');
};

window.dismissOnboarding = () => {
  localStorage.setItem(`lynk_onboarded_${currentUser.uid}`, '1');
  document.getElementById('onboarding-modal').classList.add('hidden');
};
