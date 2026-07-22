// ============================================================
// LYNK By Legends — Feed Module (with Notifications)
// ============================================================

import { auth, db } from './firebase-config.js';
import { ThemeManager } from './theme.js';
import { initNotifications, sendNotification, showToast } from './notifications.js';
import {
  collection, addDoc, getDocs, getDoc, doc, setDoc, updateDoc, deleteDoc,
  query, orderBy, limit, startAfter, where, serverTimestamp,
  arrayUnion, arrayRemove, increment, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { onAuthStateChanged, signOut as firebaseSignOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { uploadToCloudinary, optimizeCloudinaryUrl } from './cloudinary.js';
import { rankPosts, buildRankingContext } from './algorithm.js';

const _firestoreFns = { collection, query, where, getDocs };

ThemeManager.init();

// Expose quickTheme globally so onclick="quickTheme(...)" in feed.html works
window.quickTheme = (theme) => ThemeManager.apply(theme);

let currentUser = null;
let currentUserData = null;
let lastPostDoc = null;
let currentFilter = 'all';
let activePostId = null;
let _rankingCtx = null;
let commentsUnsub = null;
window._postMediaFile = null;

// ===== SET ONLINE STATUS =====
async function setOnlineStatus(online) {
  if (!currentUser) return;
  try {
    await setDoc(doc(db, 'users', currentUser.uid), {
      isOnline: online,
      lastSeen: serverTimestamp()
    }, { merge: true });
  } catch (e) { /* silent */ }
}

// Guard — require auth
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'auth.html'; return; }
  currentUser = user;
  const snap = await getDoc(doc(db, 'users', user.uid));
  currentUserData = snap.data() || {};

  // Set online status
  await setOnlineStatus(true);

  // Clear online status on page leave
  window.addEventListener('beforeunload', () => setOnlineStatus(false));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      setOnlineStatus(false);
    } else if (document.visibilityState === 'visible') {
      setOnlineStatus(true);
    }
  });

  populateSidebar();
  await initNotifications(user.uid);
  _rankingCtx = await buildRankingContext(db, user.uid, currentUserData, _firestoreFns);
  loadFeed();
  loadSuggestions();
  loadTrendingCommunities();
  loadOnlineFriends();
  loadSidebarAnnouncements();
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
    // Simple where-only query; sort client-side to avoid needing a composite index
    q = query(postsRef, where('faculty', '==', currentUserData.faculty), limit(50));
  } else if (currentFilter === 'trending') {
    q = query(postsRef, orderBy('likesCount', 'desc'), limit(50));
  } else if (!reset && lastPostDoc) {
    q = query(postsRef, orderBy('createdAt', 'desc'), startAfter(lastPostDoc), limit(30));
  } else {
    q = query(postsRef, orderBy('createdAt', 'desc'), limit(50));
  }

  try {
    const snap = await getDocs(q);
    lastPostDoc = snap.docs[snap.docs.length - 1];

    if (snap.empty && reset) {
      document.getElementById('feed-container').innerHTML = `
        <div class="lynk-card p-10 text-center">
          <svg class="mx-auto mb-3" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--text-muted)"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
          <h3 class="font-semibold mb-2">No posts yet</h3>
          <p style="color:var(--text-secondary);font-size:0.875rem">Be the first to share something with your campus!</p>
        </div>`;
      return;
    }

    const rawPosts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const ranked = (currentFilter === 'trending')
      ? rawPosts
      : (_rankingCtx ? rankPosts(rawPosts, _rankingCtx) : rawPosts);

    if (reset) document.getElementById('feed-container').innerHTML = '';
    ranked.forEach(post => {
      document.getElementById('feed-container').insertAdjacentHTML('beforeend', buildPostCard(post.id, post));
    });
    document.getElementById('load-more-btn')?.classList.toggle('hidden', snap.docs.length < 30);
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
      const optimized = optimizeCloudinaryUrl(d.mediaUrl, { width: 800, crop: 'limit' });
      mediaHtml = `<div class="post-media mt-3"><img src="${optimized}" alt="Post image" class="w-full rounded-xl cursor-pointer" loading="lazy" onclick="openPostModal('${postId}')" /></div>`;
    }
  }

  let pollHtml = '';
  if (d.poll?.options?.length) {
    const votes = d.poll.votes || {};
    const total = Object.values(votes).reduce((a, b) => a + (Array.isArray(b) ? b.length : 0), 0);
    const userVoted = Object.values(votes).some(arr => Array.isArray(arr) && arr.includes(currentUser?.uid));
    pollHtml = `<div class="mt-3 flex flex-col gap-2">
      ${d.poll.options.map((opt, i) => {
        const voteCount = Array.isArray(votes[i]) ? votes[i].length : 0;
        const pct = total > 0 ? Math.round((voteCount / total) * 100) : 0;
        const isMine = Array.isArray(votes[i]) && votes[i].includes(currentUser?.uid);
        return `<div class="poll-option${isMine ? ' voted' : ''}"
          onclick="${userVoted ? '' : `votePoll('${postId}', ${i}, '${d.authorId}', '${escHtml(opt)}')`}"
          style="${userVoted ? 'cursor:default' : 'cursor:pointer'}">
          <div class="poll-fill" style="width:${pct}%"></div>
          <div class="flex items-center justify-between" style="position:relative;z-index:1">
            <span class="text-sm font-medium">${escHtml(opt)}${isMine ? ' ✓' : ''}</span>
            <span class="text-xs" style="color:var(--text-muted)">${pct}%${total > 0 ? ` · ${voteCount}` : ''}</span>
          </div>
        </div>`;
      }).join('')}
      <p class="text-xs" style="color:var(--text-muted)">${total} vote${total !== 1 ? 's' : ''}${userVoted ? ' · You voted' : ' · Click to vote'}</p>
    </div>`;
  }

  const roleLabel = d.authorType === 'staff' ? 'Staff' : d.authorType === 'alumni' ? 'Alumni' : '';
  const visIcon = d.visibility === 'faculty'
    ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18"/><path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16"/></svg>`
    : d.visibility === 'friends'
    ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`
    : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;

  return `
    <div class="lynk-card p-5 fade-in" id="post-${postId}">
      <div class="flex gap-3">
        <a href="profile.html?uid=${d.authorId}">
          <img src="${avatarUrl}" class="lynk-avatar w-10 h-10 flex-shrink-0 cursor-pointer" />
        </a>
        <div class="flex-1 min-w-0">
          <div class="flex items-start justify-between gap-2">
            <div>
              <a href="profile.html?uid=${d.authorId}" class="font-semibold text-sm hover:underline">${escHtml(d.authorName || 'LYNK User')}</a>
              ${roleLabel ? `<span class="text-xs ml-1 lynk-badge" style="background:rgba(168,85,247,0.1);color:var(--grad-1)">${roleLabel}</span>` : ''}
              <span class="text-xs ml-1 lynk-badge" style="background:var(--bg-card-hover);color:var(--text-muted)">${escHtml(d.faculty || d.university || '')}</span>
              <p class="text-xs mt-0.5 flex items-center gap-1" style="color:var(--text-muted)">${ts} · ${visIcon}</p>
            </div>
            ${isOwn
              ? `<button onclick="deletePost('${postId}')" class="lynk-btn lynk-btn-ghost p-1" style="color:var(--text-muted)" data-tooltip="Delete">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                </button>`
              : `<button onclick="reportPost('${postId}')" class="lynk-btn lynk-btn-ghost p-1" style="color:var(--text-muted)" data-tooltip="Report">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
                </button>`}
          </div>
          ${d.content ? `<p class="text-sm mt-2 whitespace-pre-wrap">${escHtml(d.content)}</p>` : ''}
          ${mediaHtml}
          ${pollHtml}
          <div class="flex items-center gap-2 mt-4 pt-3 border-t" style="border-color:var(--border)">
            <button class="reaction-btn ${liked ? 'active' : ''}" onclick="toggleLike('${postId}', '${d.authorId}')">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="${liked ? 'var(--grad-1)' : 'none'}" stroke="${liked ? 'var(--grad-1)' : 'currentColor'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
              <span id="likes-${postId}">${d.likesCount || 0}</span>
            </button>
            <button class="reaction-btn" onclick="openPostModal('${postId}')">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              <span>${d.commentsCount || 0}</span>
            </button>
            <button class="reaction-btn" onclick="sharePost('${postId}')">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
              <span id="shares-${postId}">${d.sharesCount || 0}</span>
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
      .filter(el => el.tagName === 'INPUT')
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
    const isVideo = window._postMediaFile.type.startsWith('video');
    mediaType = isVideo ? 'video' : 'image';
    try {
      mediaUrl = await uploadToCloudinary(
        window._postMediaFile,
        `lynk/posts/${currentUser.uid}`,
        (pct) => { btn.textContent = `Uploading ${pct}%`; }
      );
    } catch (e) {
      showToast('Error', 'Error', '');
      btn.disabled = false; btn.textContent = 'Post';
      return;
    }
  }

  await addDoc(collection(db, 'posts'), {
    content, authorId: currentUser.uid,
    authorName: currentUserData.displayName || 'LYNK User',
    authorPhoto: currentUserData.photoURL || '',
    authorType: currentUserData.userType || 'student',
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

  // Hide POST button area again
  document.getElementById('post-actions-bar')?.classList.add('hidden');

  btn.disabled = false; btn.textContent = 'Post';
  showToast('Posted!', 'Your post is live on the feed.', currentUserData.photoURL || '');
  loadFeed();
};

// Show/hide post button based on content
window.onPostInput = (el) => {
  const bar = document.getElementById('post-actions-bar');
  if (!bar) return;
  if (el.value.trim() || window._postMediaFile) {
    bar.classList.remove('hidden');
  } else {
    // Keep showing if poll open
    const pollOpen = !document.getElementById('poll-builder')?.classList.contains('hidden');
    if (!pollOpen) bar.classList.add('hidden');
  }
};

// ===== LIKE =====
window.toggleLike = async (postId, authorId) => {
  if (!currentUser) return;

  const el = document.getElementById(`likes-${postId}`);
  const btn = el?.closest('.reaction-btn');
  const currentlyLiked = btn?.classList.contains('active');
  const currentCount = parseInt(el?.textContent || '0');
  if (el) el.textContent = currentlyLiked ? currentCount - 1 : currentCount + 1;
  if (btn) {
    btn.classList.toggle('active', !currentlyLiked);
    const heartSvg = btn.querySelector('svg');
    if (heartSvg) {
      const newColor = !currentlyLiked ? 'var(--grad-1)' : 'currentColor';
      heartSvg.setAttribute('fill', !currentlyLiked ? 'var(--grad-1)' : 'none');
      heartSvg.setAttribute('stroke', newColor);
    }
  }

  const postRef = doc(db, 'posts', postId);
  const snap = await getDoc(postRef);
  if (!snap.exists()) return;
  const data = snap.data();
  const liked = data.likes?.includes(currentUser.uid);

  await updateDoc(postRef, {
    likes: liked ? arrayRemove(currentUser.uid) : arrayUnion(currentUser.uid),
    likesCount: liked ? Math.max((data.likesCount || 1) - 1, 0) : (data.likesCount || 0) + 1
  });

  const newCount = liked ? Math.max((data.likesCount || 1) - 1, 0) : (data.likesCount || 0) + 1;
  if (el) el.textContent = newCount;
  if (btn) {
    btn.classList.toggle('active', !liked);
    const heartSvg = btn.querySelector('svg');
    if (heartSvg) {
      heartSvg.setAttribute('fill', !liked ? 'var(--grad-1)' : 'none');
      heartSvg.setAttribute('stroke', !liked ? 'var(--grad-1)' : 'currentColor');
    }
  }

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
  const postSnap = await getDoc(doc(db, 'posts', postId));
  if (postSnap.exists()) {
    const postEl = document.getElementById(`post-${postId}`);
    if (postEl) postEl.outerHTML = buildPostCard(postId, postSnap.data());
  }
  await sendNotification({
    toUid: authorId, fromUid: currentUser.uid,
    fromName: currentUserData.displayName || 'Someone',
    fromPhoto: currentUserData.photoURL || '',
    type: 'poll', message: 'voted on your poll', preview: optLabel
  });
};

// ===== DELETE / REPORT =====
window.deletePost = async (postId) => {
  if (!confirm('Delete this post?')) return;
  await deleteDoc(doc(db, 'posts', postId));
  document.getElementById(`post-${postId}`)?.remove();
};

window.reportPost = async (postId) => {
  await addDoc(collection(db, 'reports'), {
    postId, reportedBy: currentUser.uid,
    reason: 'User report', status: 'open',
    createdAt: serverTimestamp()
  });
  showToast('Reported', 'Our moderation team will review this post.', '');
};

window.sharePost = async (postId) => {
  const url = `${window.location.origin}${window.location.pathname.replace('feed.html', '')}feed.html?post=${postId}`;
  navigator.clipboard?.writeText(url).then(() => showToast('Copied!', 'Post link copied to clipboard.', ''));
  try {
    await updateDoc(doc(db, 'posts', postId), { sharesCount: increment(1) });
    const el = document.getElementById(`shares-${postId}`);
    if (el) el.textContent = parseInt(el.textContent || '0') + 1;
  } catch (_) {}
};

// ===== POST MODAL (Comments) =====
window.openPostModal = async (postId) => {
  activePostId = postId;
  const snap = await getDoc(doc(db, 'posts', postId));
  if (!snap.exists()) return;
  document.getElementById('post-modal-content').innerHTML = buildPostCard(postId, snap.data());
  document.getElementById('post-modal').classList.remove('hidden');
  const commentAvatar = document.getElementById('comment-avatar');
  if (commentAvatar) commentAvatar.src = currentUserData.photoURL || `https://ui-avatars.com/api/?name=U&background=a855f7&color=fff`;
  loadComments(postId);
};

window.closePostModal = () => {
  document.getElementById('post-modal').classList.add('hidden');
  // Clean up the comments real-time listener
  if (commentsUnsub) { commentsUnsub(); commentsUnsub = null; }
  activePostId = null;
};

function loadComments(postId) {
  const list = document.getElementById('comments-list');
  if (!list) return;

  // Cancel any previous listener to prevent duplicate renders
  if (commentsUnsub) { commentsUnsub(); commentsUnsub = null; }

  list.innerHTML = '<div class="text-xs py-2" style="color:var(--text-muted)">Loading comments...</div>';

  const q = query(
    collection(db, 'posts', postId, 'comments'),
    orderBy('createdAt', 'asc'),
    limit(100)
  );

  commentsUnsub = onSnapshot(q, (snap) => {
    if (!list) return;
    if (snap.empty) {
      list.innerHTML = '<div class="text-xs py-2" style="color:var(--text-muted)">No comments yet. Be the first!</div>';
      return;
    }
    // Full re-render on every snapshot (list is small, <100 comments)
    list.innerHTML = '';
    snap.docs.forEach(d => {
      const c = d.data();
      const ava = c.authorPhoto || `https://ui-avatars.com/api/?name=${encodeURIComponent(c.authorName||'U')}&background=a855f7&color=fff`;
      const ts2 = c.createdAt?.toDate?.()?.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) || '';
      list.insertAdjacentHTML('beforeend', `
        <div class="flex gap-2 items-start">
          <img src="${ava}" class="lynk-avatar w-7 h-7 flex-shrink-0" />
          <div class="flex-1 min-w-0">
            <div class="inline-block rounded-2xl rounded-tl-sm px-3 py-2" style="background:var(--bg-card-hover)">
              <p class="text-xs font-semibold mb-0.5">${escHtml(c.authorName || 'User')}</p>
              <p class="text-sm">${escHtml(c.content)}</p>
            </div>
            <p class="text-xs mt-1" style="color:var(--text-muted)">${ts2}</p>
          </div>
        </div>`);
    });
    // Scroll to bottom
    list.scrollTop = list.scrollHeight;
  }, (err) => {
    list.innerHTML = `<div class="text-xs py-2" style="color:var(--text-muted)">Could not load comments.</div>`;
    console.warn('Comments listener error:', err.message);
  });
}

window.submitComment = async () => {
  const input = document.getElementById('comment-input');
  const text = input?.value.trim();
  if (!text || !activePostId || !currentUser) return;
  const btn = document.getElementById('btn-comment');
  if (btn) btn.disabled = true;
  try {
    const snap = await getDoc(doc(db, 'posts', activePostId));
    const authorId = snap.data()?.authorId;
    await addDoc(collection(db, 'posts', activePostId, 'comments'), {
      content: text,
      authorId: currentUser.uid,
      authorName: currentUserData.displayName || 'LYNK User',
      authorPhoto: currentUserData.photoURL || '',
      createdAt: serverTimestamp()
    });
    await updateDoc(doc(db, 'posts', activePostId), { commentsCount: increment(1) });
    if (input) input.value = '';
    // Fire-and-forget — notification failure must never block the comment
    if (authorId && authorId !== currentUser.uid) {
      sendNotification({
        toUid: authorId, fromUid: currentUser.uid,
        fromName: currentUserData.displayName || 'Someone',
        fromPhoto: currentUserData.photoURL || '',
        type: 'comment', message: 'commented on your post', preview: text.slice(0, 80)
      }).catch(e => console.warn('Notification error:', e));
    }
  } catch (e) {
    console.error('Comment failed:', e);
    showToast('Error', 'Could not post your comment. Please try again.', '');
  } finally {
    if (btn) btn.disabled = false;
  }
  // onSnapshot listener auto-updates the list — no manual reload needed
};

// ===== MEDIA UPLOAD for Compose =====
window.pickPostMedia = (input) => {
  const file = input.files[0];
  if (!file) return;
  window._postMediaFile = file;
  const prev = document.getElementById('media-preview');
  const img = document.getElementById('preview-img');
  const vid = document.getElementById('preview-vid');
  prev.classList.remove('hidden');
  if (file.type.startsWith('video')) {
    img.classList.add('hidden');
    vid.classList.remove('hidden');
    vid.src = URL.createObjectURL(file);
  } else {
    vid.classList.add('hidden');
    img.classList.remove('hidden');
    img.src = URL.createObjectURL(file);
  }
  document.getElementById('post-actions-bar')?.classList.remove('hidden');
};

window.clearMediaPreview = () => {
  window._postMediaFile = null;
  document.getElementById('media-preview').classList.add('hidden');
  document.getElementById('preview-img').src = '';
  document.getElementById('preview-vid').src = '';
};

// ===== POLL BUILDER =====
window.togglePollBuilder = () => {
  const builder = document.getElementById('poll-builder');
  builder.classList.toggle('hidden');
  document.getElementById('post-actions-bar')?.classList.remove('hidden');
};

window.addPollOption = () => {
  const container = document.getElementById('poll-options');
  const count = container.children.length;
  if (count >= 5) return;
  container.insertAdjacentHTML('beforeend', `
    <input type="text" class="lynk-input text-sm py-2" placeholder="Option ${count + 1}" id="poll-opt-${count}" />`);
};

// ===== FEED FILTERS =====
window.setFilter = (filter, btn) => {
  currentFilter = filter;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn?.classList.add('active');
  loadFeed();
};

window.loadMorePosts = () => loadFeed(false);

// ===== ONLINE FRIENDS (right sidebar) =====
async function loadOnlineFriends() {
  const list = document.getElementById('online-friends-list');
  if (!list) return;
  try {
    const snap = await getDocs(query(
      collection(db, 'users'),
      where('isOnline', '==', true),
      limit(8)
    ));
    const friends = snap.docs.filter(d => d.id !== currentUser.uid);
    if (friends.length === 0) {
      list.innerHTML = '<p class="text-xs" style="color:var(--text-muted)">No one online right now.</p>';
      return;
    }
    list.innerHTML = '';
    friends.forEach(d => {
      const u = d.data();
      const ava = u.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.displayName||'U')}&background=a855f7&color=fff&size=32`;
      list.insertAdjacentHTML('beforeend', `
        <div class="online-friend-item">
          <div class="relative flex-shrink-0">
            <img src="${ava}" class="lynk-avatar w-8 h-8" />
            <span class="online-dot" style="width:8px;height:8px"></span>
          </div>
          <div class="flex-1 min-w-0">
            <p class="name truncate">${escHtml(u.displayName || 'LYNK User')}</p>
            <p class="status">● Online</p>
          </div>
          <a href="chat.html?uid=${d.id}" class="lynk-icon-btn w-7 h-7 flex-shrink-0" style="color:var(--grad-2)" data-tooltip="Message">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          </a>
        </div>`);
    });
  } catch (e) {
    list.innerHTML = '<p class="text-xs" style="color:var(--text-muted)">Could not load.</p>';
  }
}

// ===== SIDEBAR ANNOUNCEMENTS =====
async function loadSidebarAnnouncements() {
  const list = document.getElementById('sidebar-announcements');
  if (!list) return;
  try {
    const snap = await getDocs(query(
      collection(db, 'announcements'),
      orderBy('createdAt', 'desc'),
      limit(3)
    ));
    if (snap.empty) { list.innerHTML = '<p class="text-xs" style="color:var(--text-muted)">No announcements.</p>'; return; }
    list.innerHTML = '';
    snap.docs.forEach(d => {
      const a = d.data();
      const priorityDot = a.priority === 'high' ? '#ef4444' : a.priority === 'medium' ? '#f59e0b' : '#22c55e';
      list.insertAdjacentHTML('beforeend', `
        <a href="announcements.html" class="block py-2 border-b" style="border-color:var(--border)">
          <div class="flex items-start gap-2">
            <span class="w-2 h-2 rounded-full flex-shrink-0 mt-1.5" style="background:${priorityDot}"></span>
            <div class="min-w-0">
              <p class="text-xs font-semibold truncate">${escHtml(a.title || '')}</p>
              <p class="text-xs truncate" style="color:var(--text-muted)">${escHtml((a.body||'').slice(0,50))}</p>
            </div>
          </div>
        </a>`);
    });
  } catch (e) {/* silent */}
}

// ===== PEOPLE SUGGESTIONS =====
async function loadSuggestions() {
  const deskList = document.getElementById('suggestions-list');
  const mobList = document.getElementById('mobile-suggestions');
  if (!deskList && !mobList) return;

  // Build a set of UIDs to exclude: self + existing friends + pending requests
  const excludeUids = new Set([currentUser.uid]);
  try {
    const [fromSnap, toSnap] = await Promise.all([
      getDocs(query(collection(db, 'friends'), where('from', '==', currentUser.uid))),
      getDocs(query(collection(db, 'friends'), where('to',   '==', currentUser.uid))),
    ]);
    fromSnap.docs.forEach(d => excludeUids.add(d.data().to));
    toSnap.docs.forEach(d => excludeUids.add(d.data().from));
  } catch (_) {}

  const snap = await getDocs(query(
    collection(db, 'users'),
    where('university', '==', currentUserData.university || ''),
    limit(20)
  ));
  const users = snap.docs.filter(d => !excludeUids.has(d.id)).slice(0, 6);
  if (users.length === 0) return;

  [deskList, mobList].forEach(list => {
    if (!list) return;
    const isMob = list.id === 'mobile-suggestions';
    list.innerHTML = '';
    users.forEach(d => {
      const u = d.data();
      const ava = u.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.displayName||'U')}&background=a855f7&color=fff&size=64`;
      const uid = d.id;
      const label = u.faculty ? `${u.faculty} · ${u.university||''}` : (u.university || '');
      if (isMob) {
        list.insertAdjacentHTML('beforeend', `
          <div class="flex-shrink-0 w-24 text-center">
            <div class="relative inline-block mb-1">
              <img src="${ava}" class="lynk-avatar w-12 h-12 mx-auto" />
              ${u.isOnline ? '<span class="online-dot" style="width:8px;height:8px;right:0;bottom:0"></span>' : ''}
            </div>
            <p class="text-xs font-semibold truncate mb-0.5">${escHtml(u.displayName||'User')}</p>
            <p class="text-xs mb-2" style="color:var(--text-muted);font-size:10px;line-height:1.2">${escHtml(label.slice(0,30))}</p>
            <button onclick="quickAddFriend('${uid}','${escHtml(u.displayName||'')}','${ava}')"
                    id="mob-sugg-btn-${uid}"
                    class="lynk-btn lynk-btn-primary w-full text-xs py-1 rounded-lg">+Add</button>
          </div>`);
      } else {
        list.insertAdjacentHTML('beforeend', `
          <div class="flex items-center gap-3 py-2 border-b" style="border-color:var(--border)">
            <div class="relative flex-shrink-0">
              <img src="${ava}" class="lynk-avatar w-9 h-9" />
              ${u.isOnline ? '<span class="online-dot" style="width:8px;height:8px"></span>' : ''}
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium truncate">${escHtml(u.displayName||'User')}</p>
              <p class="text-xs truncate" style="color:var(--text-muted)">${escHtml(label.slice(0,30))}</p>
            </div>
            <button onclick="quickAddFriend('${uid}','${escHtml(u.displayName||'')}','${ava}')"
                    id="sugg-btn-${uid}"
                    class="lynk-btn lynk-btn-primary text-xs py-1 px-3 rounded-lg flex-shrink-0">Add</button>
          </div>`);
      }
    });
  });
}

window.quickAddFriend = async (toUid, toName, toPhoto) => {
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
  showToast('Request Sent!', `Friend request sent to ${toName}.`, toPhoto);
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
        <span class="truncate flex items-center gap-1.5" style="color:var(--text-secondary)">
          ${c.type === 'faculty'
            ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18"/><path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16"/></svg>'
            : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>'}
          ${c.name}
        </span>
        <span class="text-xs lynk-badge ml-2 flex-shrink-0" style="background:var(--bg-card-hover);color:var(--text-muted)">${c.memberCount}</span>
      </div>`);
  });
  if (snap.empty) list.innerHTML = '<div class="text-xs" style="color:var(--text-muted)">No communities yet.</div>';
}

window.sendFriendRequest = async (toUid, toName) => {
  if (!currentUser) return;
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
  showToast('Request Sent!', `Friend request sent to ${toName || 'them'}.`, currentUserData.photoURL || '');
};

// ===== SIGN OUT =====
window.signOut = async () => {
  await setOnlineStatus(false);
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
  const alreadyDone = localStorage.getItem(`lynk_onboarded_${currentUser.uid}`);
  if (alreadyDone) return;
  if (currentUserData.university && currentUserData.faculty) return;

  const ava = currentUserData.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUserData.displayName||'U')}&background=a855f7&color=fff&size=96`;
  document.getElementById('onboard-avatar').src = ava;
  document.getElementById('onboard-name').textContent = currentUserData.displayName || 'LYNK User';
  document.getElementById('onboard-handle').textContent = `@${currentUserData.username || ''}`;

  const typeLabels = { staff: 'Staff Member', alumni: 'Alumni', student: 'Student' };
  document.getElementById('onboard-type').textContent = typeLabels[currentUserData.userType] || 'Student';

  if (currentUserData.userType === 'staff') {
    document.getElementById('onboard-position-wrap')?.classList.remove('hidden');
    document.getElementById('onboard-position').value = currentUserData.position || '';
  }

  await _loadOnboardSchools();
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
  [1,2,3].forEach(n => document.getElementById(`onboard-step-${n}`)?.classList.add('hidden'));
  document.getElementById(`onboard-step-${step}`)?.classList.remove('hidden');
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
    ['University', schoolName || 'Not selected'],
    ['Faculty', faculty || 'Not selected'],
    ['Department', dept || 'Not selected'],
  ];
  if (currentUserData.userType === 'staff') rows.push(['Position', position || 'Not set']);
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
    university: schoolName, faculty: faculty || '', department: dept || '',
    profileComplete: !!(schoolName && faculty && dept)
  };
  if (currentUserData.userType === 'staff' && position) updates.position = position;

  await setDoc(doc(db, 'users', currentUser.uid), updates, { merge: true });
  currentUserData = { ...currentUserData, ...updates };

  if (schoolName && faculty) {
    await setDoc(doc(db, 'communities', `${schoolName}-${faculty}`.replace(/\s+/g,'-').toLowerCase()), {
      name: `${faculty} — ${schoolName}`, type: 'faculty',
      university: schoolName, faculty, memberCount: 1, createdAt: serverTimestamp()
    }, { merge: true });
  }
  if (schoolName && dept) {
    await setDoc(doc(db, 'communities', `${schoolName}-${dept}`.replace(/\s+/g,'-').toLowerCase()), {
      name: `${dept} — ${schoolName}`, type: 'department',
      university: schoolName, faculty: faculty || '', department: dept, memberCount: 1, createdAt: serverTimestamp()
    }, { merge: true });
  }

  localStorage.setItem(`lynk_onboarded_${currentUser.uid}`, '1');
  document.getElementById('onboarding-modal').classList.add('hidden');
  populateSidebar();
  showToast('Profile Complete!', `Welcome to ${faculty || 'LYNK'}!`, currentUserData.photoURL || '');
};

window.dismissOnboarding = () => {
  localStorage.setItem(`lynk_onboarded_${currentUser.uid}`, '1');
  document.getElementById('onboarding-modal').classList.add('hidden');
};
