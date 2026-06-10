// ============================================================
// LYNK By Legends — Feed Module
// ============================================================

import { auth, db, storage } from './firebase-config.js';
import { ThemeManager } from './theme.js';
import {
  collection, addDoc, getDocs, getDoc, doc, setDoc, updateDoc, deleteDoc,
  query, orderBy, limit, startAfter, where, onSnapshot, serverTimestamp,
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
let pollOptionCount = 2;
window._postMediaFile = null;

// Guard — require auth
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'auth.html'; return; }
  currentUser = user;
  const snap = await getDoc(doc(db, 'users', user.uid));
  currentUserData = snap.data() || {};
  populateSidebar();
  loadFeed();
  loadSuggestions();
  loadTrendingCommunities();
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
  // Show admin link if applicable
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
  let q;
  const postsRef = collection(db, 'posts');
  if (currentFilter === 'faculty' && currentUserData.faculty) {
    q = query(postsRef, where('faculty', '==', currentUserData.faculty), orderBy('createdAt', 'desc'), limit(10));
  } else if (currentFilter === 'trending') {
    q = query(postsRef, orderBy('likesCount', 'desc'), limit(10));
  } else {
    q = query(postsRef, orderBy('createdAt', 'desc'), limit(10));
  }
  if (lastPostDoc) q = query(postsRef, orderBy('createdAt', 'desc'), startAfter(lastPostDoc), limit(10));
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
      const html = buildPostCard(d.id, d.data());
      document.getElementById('feed-container').insertAdjacentHTML('beforeend', html);
    });
    document.getElementById('load-more-btn')?.classList.toggle('hidden', snap.docs.length < 10);
  } catch (e) {
    if (reset) document.getElementById('feed-container').innerHTML = `<div class="lynk-card p-6 text-center text-sm" style="color:var(--text-muted)">Error loading feed. Check your connection.</div>`;
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
  if (d.poll && d.poll.options) {
    const total = d.poll.votes ? Object.values(d.poll.votes).reduce((a,b) => a + (b?.length||0), 0) : 0;
    pollHtml = `<div class="mt-3 flex flex-col gap-2">
      ${d.poll.options.map((opt, i) => {
        const votes = d.poll.votes?.[i]?.length || 0;
        const pct = total > 0 ? Math.round((votes/total)*100) : 0;
        return `<div class="poll-option" onclick="votePoll('${postId}', ${i})">
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
            ${isOwn ? `<button onclick="deletePost('${postId}')" class="lynk-btn lynk-btn-ghost p-1 text-xs" style="color:var(--text-muted)">🗑</button>` : `<button onclick="reportPost('${postId}')" class="lynk-btn lynk-btn-ghost p-1 text-xs" style="color:var(--text-muted)">⚑</button>`}
          </div>
          ${d.content ? `<p class="text-sm mt-2 whitespace-pre-wrap">${escHtml(d.content)}</p>` : ''}
          ${mediaHtml}
          ${pollHtml}
          <div class="flex items-center gap-2 mt-4 pt-3 border-t" style="border-color:var(--border)">
            <button class="reaction-btn ${liked?'active':''}" onclick="toggleLike('${postId}')">
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

  // Collect poll options
  let poll = null;
  const pollContainer = document.getElementById('poll-options');
  if (!document.getElementById('poll-builder').classList.contains('hidden')) {
    const opts = Array.from(pollContainer.children).map(el => el.value.trim()).filter(Boolean);
    if (opts.length >= 2) {
      poll = { options: opts, votes: {} };
    }
  }

  if (!content && !window._postMediaFile && !poll) {
    alert('Write something or add media first!');
    return;
  }

  const btn = document.getElementById('btn-post');
  btn.disabled = true; btn.textContent = 'Posting...';

  let mediaUrl = null; let mediaType = null;
  if (window._postMediaFile) {
    const fileRef = ref(storage, `posts/${currentUser.uid}/${Date.now()}-${window._postMediaFile.name}`);
    await uploadBytes(fileRef, window._postMediaFile);
    mediaUrl = await getDownloadURL(fileRef);
    mediaType = window._postMediaFile.type.startsWith('video') ? 'video' : 'image';
  }

  await addDoc(collection(db, 'posts'), {
    content,
    authorId: currentUser.uid,
    authorName: currentUserData.displayName || 'LYNK User',
    authorPhoto: currentUserData.photoURL || '',
    university: currentUserData.university || '',
    faculty: currentUserData.faculty || '',
    department: currentUserData.department || '',
    visibility,
    mediaUrl,
    mediaType,
    poll,
    likes: [],
    likesCount: 0,
    commentsCount: 0,
    createdAt: serverTimestamp()
  });

  // Increment user post count
  await updateDoc(doc(db, 'users', currentUser.uid), { postsCount: increment(1) });

  document.getElementById('post-content').value = '';
  window._postMediaFile = null;
  document.getElementById('media-preview').classList.add('hidden');
  document.getElementById('poll-builder').classList.add('hidden');
  document.getElementById('poll-options').innerHTML = `
    <input type="text" class="lynk-input text-sm py-2" placeholder="Option 1" id="poll-opt-0" />
    <input type="text" class="lynk-input text-sm py-2" placeholder="Option 2" id="poll-opt-1" />`;

  btn.disabled = false; btn.textContent = 'Post';
  loadFeed();
};

// ===== LIKE =====
window.toggleLike = async (postId) => {
  if (!currentUser) return;
  const postRef = doc(db, 'posts', postId);
  const snap = await getDoc(postRef);
  const data = snap.data();
  const liked = data.likes?.includes(currentUser.uid);
  await updateDoc(postRef, {
    likes: liked ? arrayRemove(currentUser.uid) : arrayUnion(currentUser.uid),
    likesCount: liked ? Math.max((data.likesCount||1)-1,0) : (data.likesCount||0)+1
  });
  const el = document.getElementById(`likes-${postId}`);
  if (el) el.textContent = liked ? Math.max((data.likesCount||1)-1,0) : (data.likesCount||0)+1;
  const btn = el?.closest('.reaction-btn');
  if (btn) btn.classList.toggle('active', !liked);
};

// ===== VOTE POLL =====
window.votePoll = async (postId, optIndex) => {
  if (!currentUser) return;
  const postRef = doc(db, 'posts', postId);
  await updateDoc(postRef, { [`poll.votes.${optIndex}`]: arrayUnion(currentUser.uid) });
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
    postId,
    reportedBy: currentUser.uid,
    reason: 'User report',
    status: 'open',
    createdAt: serverTimestamp()
  });
  alert('Post reported. Our moderation team will review it.');
};

// ===== SHARE =====
window.sharePost = (postId) => {
  const url = `${window.location.origin}/feed.html?post=${postId}`;
  navigator.clipboard?.writeText(url).then(() => alert('Link copied to clipboard!'));
};

// ===== POST MODAL (Comments) =====
window.openPostModal = async (postId) => {
  activePostId = postId;
  const snap = await getDoc(doc(db, 'posts', postId));
  if (!snap.exists()) return;
  const data = snap.data();
  document.getElementById('post-modal-content').innerHTML = buildPostCard(postId, data);
  document.getElementById('post-modal').classList.remove('hidden');
  const avatarUrl = currentUserData.photoURL || `https://ui-avatars.com/api/?name=U&background=a855f7&color=fff`;
  document.getElementById('comment-avatar').src = avatarUrl;
  loadComments(postId);
};

window.closePostModal = () => {
  document.getElementById('post-modal').classList.add('hidden');
  activePostId = null;
};

async function loadComments(postId) {
  const list = document.getElementById('comments-list');
  list.innerHTML = '<div class="text-xs" style="color:var(--text-muted)">Loading...</div>';
  const snap = await getDocs(query(collection(db, 'posts', postId, 'comments'), orderBy('createdAt', 'asc'), limit(50)));
  if (snap.empty) { list.innerHTML = '<div class="text-xs" style="color:var(--text-muted)">No comments yet. Be first!</div>'; return; }
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

window.submitComment = async () => {
  if (!activePostId || !currentUser) return;
  const input = document.getElementById('comment-input');
  const content = input.value.trim();
  if (!content) return;
  await addDoc(collection(db, 'posts', activePostId, 'comments'), {
    content,
    authorId: currentUser.uid,
    authorName: currentUserData.displayName || 'User',
    authorPhoto: currentUserData.photoURL || '',
    createdAt: serverTimestamp()
  });
  await updateDoc(doc(db, 'posts', activePostId), { commentsCount: increment(1) });
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

// ===== LOAD MORE =====
window.loadMorePosts = () => loadFeed(false);

// ===== MEDIA UPLOAD =====
window.handleMediaUpload = (input) => {
  const file = input.files[0];
  if (!file) return;
  window._postMediaFile = file;
  const preview = document.getElementById('media-preview');
  const previewImg = document.getElementById('media-preview-img');
  if (file.type.startsWith('image')) {
    previewImg.src = URL.createObjectURL(file);
    preview.classList.remove('hidden');
  }
};

// ===== SUGGESTIONS =====
async function loadSuggestions() {
  const list = document.getElementById('suggestions-list');
  if (!list) return;
  const q = query(collection(db, 'users'), where('university', '==', currentUserData.university || ''), limit(5));
  const snap = await getDocs(q);
  if (snap.empty) { list.innerHTML = '<div class="text-xs" style="color:var(--text-muted)">No suggestions yet.</div>'; return; }
  list.innerHTML = '';
  snap.docs.forEach(d => {
    if (d.id === currentUser.uid) return;
    const u = d.data();
    const ava = u.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.displayName||'U')}&background=a855f7&color=fff`;
    list.insertAdjacentHTML('beforeend', `
      <div class="flex items-center gap-2">
        <img src="${ava}" class="lynk-avatar w-8 h-8" />
        <div class="flex-1 min-w-0">
          <p class="text-xs font-semibold truncate">${u.displayName}</p>
          <p class="text-xs truncate" style="color:var(--text-muted)">${u.department || u.faculty || ''}</p>
        </div>
        <button onclick="sendFriendRequest('${d.id}')" class="lynk-btn lynk-btn-primary text-xs py-1 px-2 rounded-lg">+Add</button>
      </div>`);
  });
}

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

// ===== FRIEND REQUEST =====
window.sendFriendRequest = async (toUid) => {
  if (!currentUser) return;
  await setDoc(doc(db, 'friends', `${currentUser.uid}_${toUid}`), {
    from: currentUser.uid,
    to: toUid,
    status: 'pending',
    createdAt: serverTimestamp()
  });
  alert('Friend request sent!');
};

// ===== SIGN OUT =====
window.signOut = async () => {
  if (currentUser) await setDoc(doc(db, 'users', currentUser.uid), { isOnline: false, lastSeen: serverTimestamp() }, { merge: true });
  await firebaseSignOut(auth);
  window.location.href = 'auth.html';
};

// Helper
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
