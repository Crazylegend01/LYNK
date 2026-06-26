// ============================================================
// LYNK By Legends — Real-time Chat Module
// ============================================================

import { auth, db } from './firebase-config.js';
import { ThemeManager } from './theme.js';
import { initNotifications, sendNotification } from './notifications.js';
import {
  collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, query,
  where, orderBy, limit, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged, signOut as firebaseSignOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { uploadToCloudinary } from './cloudinary.js';

ThemeManager.init();

let currentUser = null;
let currentUserData = null;
let activeConvId = null;
let activeOtherUid = null;
let messagesUnsub = null;
let convUnsub = null;
let typingTimeout = null;

// ===== ONLINE STATUS =====
async function setOnlineStatus(online) {
  if (!currentUser) return;
  try {
    await setDoc(doc(db, 'users', currentUser.uid), {
      isOnline: online, lastSeen: serverTimestamp()
    }, { merge: true });
  } catch (e) { /* silent */ }
}

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'auth.html'; return; }
  currentUser = user;
  const snap = await getDoc(doc(db, 'users', user.uid));
  currentUserData = snap.data() || {};

  // Update nav avatar
  const navAvatar = document.getElementById('nav-avatar');
  if (navAvatar) navAvatar.src = currentUserData.photoURL ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUserData.displayName||'U')}&background=a855f7&color=fff`;

  await setOnlineStatus(true);
  window.addEventListener('beforeunload', () => setOnlineStatus(false));
  document.addEventListener('visibilitychange', () => {
    setOnlineStatus(document.visibilityState !== 'hidden');
  });

  await initNotifications(user.uid);
  listenConversations();

  const params = new URLSearchParams(window.location.search);
  const deepUid = params.get('uid');
  if (deepUid) await openOrCreateConversation(deepUid);
});

// ===== LOAD CONVERSATIONS (real-time) =====
function listenConversations() {
  const convList = document.getElementById('conversations-list');
  if (!convList) return;

  // Show skeleton while loading
  convList.innerHTML = `
    ${[1,2,3].map(() => `
      <div class="flex items-center gap-3 p-4 border-b animate-pulse" style="border-color:var(--border)">
        <div class="w-12 h-12 rounded-full flex-shrink-0" style="background:var(--border)"></div>
        <div class="flex-1">
          <div class="h-3 rounded w-1/2 mb-2" style="background:var(--border)"></div>
          <div class="h-3 rounded w-3/4" style="background:var(--border)"></div>
        </div>
      </div>`).join('')}`;

  // No orderBy here — combining array-contains + orderBy requires a Firestore
  // composite index that may not be set up. We sort client-side instead.
  const q = query(
    collection(db, 'conversations'),
    where('participants', 'array-contains', currentUser.uid),
    limit(40)
  );

  if (convUnsub) convUnsub();
  convUnsub = onSnapshot(q, async (snap) => {
    if (snap.empty) {
      convList.innerHTML = `
        <div class="p-8 text-center">
          <svg class="mx-auto mb-3" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--text-muted)"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <p class="font-semibold mb-1">No conversations yet</p>
          <p class="text-sm" style="color:var(--text-muted)">Start chatting with a classmate!</p>
          <button onclick="showNewChatModal()" class="lynk-btn lynk-btn-primary mt-3 text-sm gap-1.5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            New Message
          </button>
        </div>`;
      return;
    }

    // Sort by most recent message client-side (avoids composite index requirement)
    const convData = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.lastMessageAt?.toMillis?.() || 0) - (a.lastMessageAt?.toMillis?.() || 0));
    const otherUids = [...new Set(convData.map(c => c.participants?.find(uid => uid !== currentUser.uid)).filter(Boolean))];
    const userSnaps = await Promise.all(otherUids.map(uid => getDoc(doc(db, 'users', uid))));
    const userMap = {};
    userSnaps.forEach(s => { if (s.exists()) userMap[s.id] = s.data(); });

    convList.innerHTML = '';
    convData.forEach(conv => {
      const otherUid = conv.participants?.find(uid => uid !== currentUser.uid);
      if (!otherUid) return;
      const other = userMap[otherUid] || {};
      const ava = other.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(other.displayName||'U')}&background=a855f7&color=fff`;
      const ts = conv.lastMessageAt?.toDate?.()?.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) || '';
      const unread = conv.unread?.[currentUser.uid] || 0;
      const isActive = conv.id === activeConvId;

      convList.insertAdjacentHTML('beforeend', `
        <div class="conv-item flex items-center gap-3 p-4 cursor-pointer transition-colors border-b"
             style="border-color:var(--border);background:${isActive?'var(--bg-card-hover)':'transparent'}"
             id="conv-item-${conv.id}"
             onclick="selectConversation('${conv.id}', '${otherUid}')">
          <div class="relative flex-shrink-0">
            <img src="${ava}" class="lynk-avatar w-12 h-12" />
            ${other.isOnline ? '<span class="online-dot"></span>' : ''}
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between">
              <p class="font-semibold text-sm truncate">${escHtml(other.displayName || 'LYNK User')}</p>
              <span class="text-xs flex-shrink-0 ml-2" style="color:var(--text-muted)">${ts}</span>
            </div>
            <p class="text-xs truncate mt-0.5 ${unread>0?'font-semibold':''}" style="color:${unread>0?'var(--text-primary)':'var(--text-muted)'}">
              ${escHtml(conv.lastMessage || 'Say hello!')}
            </p>
          </div>
          ${unread > 0 ? `<span class="lynk-badge lynk-gradient text-white ml-1 flex-shrink-0 text-xs px-2">${unread}</span>` : ''}
        </div>`);
    });
  }, (err) => {
    // Firestore index not ready yet — show a friendly message
    convList.innerHTML = `
      <div class="p-6 text-center text-sm" style="color:var(--text-muted)">
        <p>Setting up messages...</p>
        <p class="text-xs mt-1">This may take a moment on first load.</p>
      </div>`;
    console.warn('Conversations listener error:', err.message);
  });
}

// ===== SELECT CONVERSATION =====
window.selectConversation = async (convId, otherUid) => {
  activeConvId = convId;
  activeOtherUid = otherUid;

  // Clean up old listeners
  if (messagesUnsub) { messagesUnsub(); messagesUnsub = null; }

  // Highlight active conversation
  document.querySelectorAll('.conv-item').forEach(el => el.style.background = 'transparent');
  const item = document.getElementById(`conv-item-${convId}`);
  if (item) item.style.background = 'var(--bg-card-hover)';

  // Activate mobile panel slide-in
  document.getElementById('chat-layout')?.classList.add('chat-active');

  const usnap = await getDoc(doc(db, 'users', otherUid));
  const other = usnap.data() || {};
  const ava = other.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(other.displayName||'U')}&background=a855f7&color=fff`;

  // Show chat panels
  document.getElementById('chat-empty-state')?.classList.add('hidden');
  document.getElementById('chat-header')?.classList.remove('hidden');
  document.getElementById('messages-area')?.classList.remove('hidden');
  document.getElementById('message-input-area')?.classList.remove('hidden');

  const headerAvatar = document.getElementById('chat-header-avatar');
  if (headerAvatar) headerAvatar.src = ava;
  const headerName = document.getElementById('chat-header-name');
  if (headerName) headerName.textContent = other.displayName || 'LYNK User';
  const headerProfile = document.getElementById('chat-header-profile');
  if (headerProfile) headerProfile.href = `profile.html?uid=${otherUid}`;

  const statusEl = document.getElementById('chat-header-status');
  const dotEl = document.getElementById('chat-online-dot');
  if (other.isOnline) {
    if (statusEl) { statusEl.textContent = 'Online'; statusEl.style.color = '#22c55e'; }
    dotEl?.classList.remove('hidden');
  } else {
    const lastSeen = other.lastSeen?.toDate?.()?.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) || '';
    if (statusEl) { statusEl.textContent = lastSeen ? `Last seen ${lastSeen}` : 'Offline'; statusEl.style.color = 'var(--text-muted)'; }
    dotEl?.classList.add('hidden');
  }

  // Reset unread count
  await updateDoc(doc(db, 'conversations', convId), {
    [`unread.${currentUser.uid}`]: 0
  }).catch(() => {});

  // Real-time messages listener
  const messagesArea = document.getElementById('messages-area');
  if (messagesArea) messagesArea.innerHTML = '';

  const msgQ = query(
    collection(db, 'conversations', convId, 'messages'),
    orderBy('createdAt', 'asc'),
    limit(100)
  );

  messagesUnsub = onSnapshot(msgQ, (snap) => {
    if (!messagesArea) return;
    // Use incremental append: only add messages not yet rendered
    const existingIds = new Set([...messagesArea.querySelectorAll('[data-msg-id]')].map(el => el.dataset.msgId));
    snap.docs.forEach(d => {
      if (!existingIds.has(d.id)) {
        messagesArea.insertAdjacentHTML('beforeend', renderMessageHtml(d.id, d.data()));
      }
    });
    // Scroll to bottom only if near bottom
    const threshold = 120;
    const nearBottom = messagesArea.scrollHeight - messagesArea.scrollTop - messagesArea.clientHeight < threshold;
    if (nearBottom || existingIds.size === 0) {
      messagesArea.scrollTop = messagesArea.scrollHeight;
    }
  }, (err) => {
    console.warn('Messages listener error:', err.message);
  });

  // Typing indicator
  onSnapshot(doc(db, 'conversations', convId), (snap) => {
    const data = snap.data();
    const typingUids = data?.typing || [];
    const othersTyping = typingUids.filter(uid => uid !== currentUser.uid);
    const ti = document.getElementById('typing-indicator');
    const tt = document.getElementById('typing-text');
    if (othersTyping.length > 0) {
      ti?.classList.remove('hidden');
      if (tt) tt.textContent = `${other.displayName?.split(' ')[0] || 'Someone'} is typing`;
    } else {
      ti?.classList.add('hidden');
    }
  });
};

function renderMessageHtml(msgId, msg) {
  const isOwn = msg.senderId === currentUser.uid;
  const ts = msg.createdAt?.toDate?.()?.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) || '';
  let content = '';
  if (msg.type === 'image') {
    content = `<img src="${msg.mediaUrl}" class="rounded-xl max-h-64 object-cover cursor-pointer" onclick="window.open('${msg.mediaUrl}')" loading="lazy" />`;
  } else {
    content = `<span>${escHtml(msg.content)}</span>`;
  }
  const ava = msg.senderPhoto || `https://ui-avatars.com/api/?name=U&background=a855f7&color=fff`;
  return `
    <div class="flex ${isOwn ? 'justify-end' : 'justify-start'} items-end gap-2 fade-in" data-msg-id="${msgId}">
      ${!isOwn ? `<img src="${ava}" class="lynk-avatar w-7 h-7 flex-shrink-0 mb-1" />` : ''}
      <div class="flex flex-col ${isOwn ? 'items-end' : 'items-start'} gap-1" style="max-width:75%">
        <div class="${isOwn ? 'chat-bubble-out' : 'chat-bubble-in'}">${content}</div>
        <span class="text-xs" style="color:var(--text-muted)">${ts}</span>
      </div>
    </div>`;
}

// ===== SEND MESSAGE =====
window.sendMessage = async () => {
  if (!activeConvId || !currentUser) return;
  const input = document.getElementById('msg-input');
  const content = input?.value.trim();
  if (!content) return;

  input.value = '';
  if (input.style) input.style.height = 'auto';

  const convSnap = await getDoc(doc(db, 'conversations', activeConvId));
  const otherUid = convSnap.data()?.participants?.find(uid => uid !== currentUser.uid);
  const currentUnread = convSnap.data()?.unread?.[otherUid] || 0;

  await addDoc(collection(db, 'conversations', activeConvId, 'messages'), {
    content, type: 'text',
    senderId: currentUser.uid,
    senderName: currentUserData.displayName || 'LYNK User',
    senderPhoto: currentUserData.photoURL || '',
    createdAt: serverTimestamp()
  });

  await updateDoc(doc(db, 'conversations', activeConvId), {
    lastMessage: content.length > 50 ? content.slice(0,50)+'…' : content,
    lastMessageAt: serverTimestamp(),
    lastSenderId: currentUser.uid,
    [`unread.${otherUid}`]: currentUnread + 1,
    typing: []
  });

  if (otherUid) {
    sendNotification({
      toUid: otherUid, fromUid: currentUser.uid,
      fromName: currentUserData.displayName || 'Someone',
      fromPhoto: currentUserData.photoURL || '',
      type: 'message', message: 'sent you a message',
      preview: content.slice(0, 80)
    }).catch(() => {});
  }

  clearTyping();
};

// ===== TYPING =====
window.handleTyping = async () => {
  if (!activeConvId || !currentUser) return;
  await updateDoc(doc(db, 'conversations', activeConvId), {
    typing: [currentUser.uid]
  }).catch(() => {});
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(clearTyping, 2500);
};

async function clearTyping() {
  if (!activeConvId || !currentUser) return;
  await updateDoc(doc(db, 'conversations', activeConvId), { typing: [] }).catch(() => {});
}

// ===== OPEN OR CREATE CONVERSATION =====
window.openOrCreateConversation = async (otherUid) => {
  window.hideNewChatModal();
  // Check for existing conversation
  const q = query(collection(db, 'conversations'), where('participants', 'array-contains', currentUser.uid));
  const snap = await getDocs(q);
  let existingId = null;
  snap.docs.forEach(d => {
    if (d.data().participants?.includes(otherUid)) existingId = d.id;
  });

  if (existingId) {
    window.selectConversation(existingId, otherUid);
  } else {
    const newConv = await addDoc(collection(db, 'conversations'), {
      participants: [currentUser.uid, otherUid],
      createdAt: serverTimestamp(),
      lastMessageAt: serverTimestamp(),
      lastMessage: '',
      unread: { [otherUid]: 0, [currentUser.uid]: 0 },
      typing: []
    });
    window.selectConversation(newConv.id, otherUid);
  }
};

// ===== SEARCH CONVERSATIONS =====
window.searchConversations = (term) => {
  document.querySelectorAll('.conv-item').forEach(item => {
    const name = item.querySelector('p')?.textContent?.toLowerCase() || '';
    item.style.display = name.includes(term.toLowerCase()) ? '' : 'none';
  });
};

// ===== SEARCH USERS FOR NEW CHAT =====
window.searchFriendsForChat = async (term) => {
  const results = document.getElementById('friend-search-results');
  if (!term || term.length < 2) {
    results.innerHTML = '<p class="text-sm text-center py-4" style="color:var(--text-muted)">Start typing to search users...</p>';
    return;
  }
  results.innerHTML = '<p class="text-sm text-center py-2" style="color:var(--text-muted)">Searching...</p>';

  // Search by displayName prefix — try same university first, then global
  const uniQ = query(collection(db, 'users'), where('university', '==', currentUserData.university || ''), limit(30));
  const snap = await getDocs(uniQ);
  const filtered = snap.docs.filter(d => {
    if (d.id === currentUser.uid) return false;
    const name = (d.data().displayName || '').toLowerCase();
    const handle = (d.data().username || '').toLowerCase();
    return name.includes(term.toLowerCase()) || handle.includes(term.toLowerCase());
  });

  if (filtered.length === 0) {
    results.innerHTML = '<p class="text-sm text-center py-4" style="color:var(--text-muted)">No users found.</p>';
    return;
  }

  results.innerHTML = '';
  filtered.forEach(d => {
    const u = d.data();
    const ava = u.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.displayName||'U')}&background=a855f7&color=fff`;
    results.insertAdjacentHTML('beforeend', `
      <div class="flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-colors hover:opacity-80"
           style="background:var(--bg-card-hover)"
           onclick="openOrCreateConversation('${d.id}')">
        <div class="relative flex-shrink-0">
          <img src="${ava}" class="lynk-avatar w-10 h-10" />
          ${u.isOnline ? '<span class="online-dot" style="width:8px;height:8px"></span>' : ''}
        </div>
        <div class="flex-1 min-w-0">
          <p class="font-semibold text-sm truncate">${escHtml(u.displayName || 'User')}</p>
          <p class="text-xs truncate" style="color:var(--text-muted)">@${u.username || ''} · ${u.department || u.faculty || u.university || ''}</p>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--grad-2);flex-shrink:0"><polyline points="9 18 15 12 9 6"/></svg>
      </div>`);
  });
};

// ===== ATTACH FILE =====
window.attachFile = async (input) => {
  const file = input.files[0];
  if (!file || !activeConvId) return;

  // Show uploading state
  const sendBtn = document.querySelector('#message-input-area button[onclick="sendMessage()"]');
  if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = '…'; }

  let url;
  try {
    url = await uploadToCloudinary(file, `lynk/chat/${activeConvId}`, (pct) => {
      if (sendBtn) sendBtn.textContent = `${pct}%`;
    });
  } catch (e) {
    if (sendBtn) { sendBtn.disabled = false; sendBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`; }
    return;
  }

  if (sendBtn) { sendBtn.disabled = false; sendBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`; }

  const convSnap = await getDoc(doc(db, 'conversations', activeConvId));
  const otherUid = convSnap.data()?.participants?.find(uid => uid !== currentUser.uid);
  const currentUnread = convSnap.data()?.unread?.[otherUid] || 0;

  await addDoc(collection(db, 'conversations', activeConvId, 'messages'), {
    content: '', type: 'image', mediaUrl: url,
    senderId: currentUser.uid,
    senderName: currentUserData.displayName || '',
    senderPhoto: currentUserData.photoURL || '',
    createdAt: serverTimestamp()
  });
  await updateDoc(doc(db, 'conversations', activeConvId), {
    lastMessage: 'Sent an image',
    lastMessageAt: serverTimestamp(),
    [`unread.${otherUid}`]: currentUnread + 1
  });
  if (otherUid) {
    sendNotification({
      toUid: otherUid, fromUid: currentUser.uid,
      fromName: currentUserData.displayName || 'Someone',
      fromPhoto: currentUserData.photoURL || '',
      type: 'message', message: 'sent you an image', preview: 'Image'
    }).catch(() => {});
  }
  // Clear input so same file can be re-selected
  input.value = '';
};

// ===== SIGN OUT =====
window.signOut = async () => {
  await setOnlineStatus(false);
  await firebaseSignOut(auth);
  window.location.href = 'auth.html';
};

window.hideNewChatModal = () => document.getElementById('new-chat-modal')?.classList.add('hidden');
window.showNewChatModal = () => {
  document.getElementById('new-chat-modal')?.classList.remove('hidden');
  setTimeout(() => document.getElementById('new-chat-search')?.focus(), 100);
};

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
