// ============================================================
// LYNK By Legends — Real-time Chat Module (with Notifications)
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
let typingTimeout = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'auth.html'; return; }
  currentUser = user;
  const snap = await getDoc(doc(db, 'users', user.uid));
  currentUserData = snap.data() || {};
  await setDoc(doc(db, 'users', user.uid), { isOnline: true, lastSeen: serverTimestamp() }, { merge: true });
  await initNotifications(user.uid);
  loadConversations();

  const params = new URLSearchParams(window.location.search);
  const deepUid = params.get('uid');
  if (deepUid) await openOrCreateConversation(deepUid);
});

// ===== LOAD CONVERSATIONS =====
async function loadConversations() {
  const convList = document.getElementById('conversations-list');
  if (!convList) return;

  const q = query(
    collection(db, 'conversations'),
    where('participants', 'array-contains', currentUser.uid),
    orderBy('lastMessageAt', 'desc'),
    limit(30)
  );

  onSnapshot(q, async (snap) => {
    convList.innerHTML = '';
    if (snap.empty) {
      convList.innerHTML = '<div class="p-6 text-sm text-center" style="color:var(--text-muted)">No conversations yet.<br/>Start chatting with a friend!</div>';
      return;
    }
    for (const d of snap.docs) {
      const conv = d.data();
      const otherUid = conv.participants.find(uid => uid !== currentUser.uid);
      if (!otherUid) continue;
      const usnap = await getDoc(doc(db, 'users', otherUid));
      const other = usnap.data() || {};
      const ava = other.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(other.displayName||'U')}&background=a855f7&color=fff`;
      const ts = conv.lastMessageAt?.toDate?.()?.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) || '';
      const unread = conv.unread?.[currentUser.uid] || 0;
      const isActive = d.id === activeConvId;

      convList.insertAdjacentHTML('beforeend', `
        <div class="conv-item flex items-center gap-3 p-4 cursor-pointer transition-colors border-b"
             style="border-color:var(--border);background:${isActive?'var(--bg-card-hover)':'transparent'}"
             id="conv-item-${d.id}"
             onclick="selectConversation('${d.id}', '${otherUid}')">
          <div class="relative flex-shrink-0">
            <img src="${ava}" class="lynk-avatar w-12 h-12" />
            ${other.isOnline ? '<span class="online-dot"></span>' : ''}
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between">
              <p class="font-semibold text-sm truncate">${other.displayName || 'LYNK User'}</p>
              <span class="text-xs flex-shrink-0 ml-2" style="color:var(--text-muted)">${ts}</span>
            </div>
            <p class="text-xs truncate mt-0.5 ${unread>0?'font-semibold':''}" style="color:${unread>0?'var(--text-primary)':'var(--text-muted)'}">
              ${conv.lastMessage || 'Say hello! 👋'}
            </p>
          </div>
          ${unread > 0 ? `<span class="lynk-badge lynk-gradient text-white ml-1 flex-shrink-0">${unread}</span>` : ''}
        </div>`);
    }
  });
}

// ===== SELECT CONVERSATION =====
window.selectConversation = async (convId, otherUid) => {
  activeConvId = convId;
  activeOtherUid = otherUid;
  if (messagesUnsub) messagesUnsub();

  document.querySelectorAll('.conv-item').forEach(el => {
    el.style.background = 'transparent';
  });
  const item = document.getElementById(`conv-item-${convId}`);
  if (item) item.style.background = 'var(--bg-card-hover)';

  const usnap = await getDoc(doc(db, 'users', otherUid));
  const other = usnap.data() || {};
  const ava = other.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(other.displayName||'U')}&background=a855f7&color=fff`;

  document.getElementById('chat-empty-state').classList.add('hidden');
  document.getElementById('chat-header').classList.remove('hidden');
  document.getElementById('messages-area').classList.remove('hidden');
  document.getElementById('message-input-area').classList.remove('hidden');

  document.getElementById('chat-header-avatar').src = ava;
  document.getElementById('chat-header-name').textContent = other.displayName || 'LYNK User';
  document.getElementById('chat-header-profile').href = `profile.html?uid=${otherUid}`;

  const statusEl = document.getElementById('chat-header-status');
  const dotEl = document.getElementById('chat-online-dot');
  if (other.isOnline) {
    statusEl.textContent = 'Online';
    statusEl.style.color = '#22c55e';
    dotEl.classList.remove('hidden');
  } else {
    const lastSeen = other.lastSeen?.toDate?.()?.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) || '';
    statusEl.textContent = lastSeen ? `Last seen ${lastSeen}` : 'Offline';
    statusEl.style.color = 'var(--text-muted)';
    dotEl.classList.add('hidden');
  }

  // Reset unread count
  await updateDoc(doc(db, 'conversations', convId), {
    [`unread.${currentUser.uid}`]: 0
  });

  // Real-time messages
  const msgQ = query(
    collection(db, 'conversations', convId, 'messages'),
    orderBy('createdAt', 'asc'),
    limit(100)
  );
  const messagesArea = document.getElementById('messages-area');
  messagesUnsub = onSnapshot(msgQ, (snap) => {
    messagesArea.innerHTML = '';
    snap.docs.forEach(d => renderMessage(d.data()));
    messagesArea.scrollTop = messagesArea.scrollHeight;
  });

  // Typing indicator listener
  onSnapshot(doc(db, 'conversations', convId), (snap) => {
    const data = snap.data();
    const typingUids = data?.typing || [];
    const othersTyping = typingUids.filter(uid => uid !== currentUser.uid);
    const ti = document.getElementById('typing-indicator');
    const tt = document.getElementById('typing-text');
    if (othersTyping.length > 0) {
      ti.classList.remove('hidden');
      tt.textContent = `${other.displayName?.split(' ')[0] || 'Someone'} is typing`;
    } else {
      ti.classList.add('hidden');
    }
  });
};

function renderMessage(msg) {
  const isOwn = msg.senderId === currentUser.uid;
  const ts = msg.createdAt?.toDate?.()?.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) || '';
  const area = document.getElementById('messages-area');
  let content = '';
  if (msg.type === 'image') {
    content = `<img src="${msg.mediaUrl}" class="rounded-xl max-h-64 object-cover cursor-pointer" onclick="window.open('${msg.mediaUrl}')" />`;
  } else {
    content = `<span>${escHtml(msg.content)}</span>`;
  }
  area.insertAdjacentHTML('beforeend', `
    <div class="flex ${isOwn ? 'justify-end' : 'justify-start'} items-end gap-2 fade-in">
      ${!isOwn ? `<img src="${msg.senderPhoto || `https://ui-avatars.com/api/?name=U&background=a855f7&color=fff`}" class="lynk-avatar w-7 h-7 flex-shrink-0 mb-1" />` : ''}
      <div class="flex flex-col ${isOwn ? 'items-end' : 'items-start'} gap-1">
        <div class="${isOwn ? 'chat-bubble-out' : 'chat-bubble-in'}">${content}</div>
        <span class="text-xs" style="color:var(--text-muted)">${ts}</span>
      </div>
    </div>`);
}

// ===== SEND MESSAGE — fires notification =====
window.sendMessage = async () => {
  if (!activeConvId || !currentUser) return;
  const input = document.getElementById('msg-input');
  const content = input.value.trim();
  if (!content) return;

  input.value = '';
  input.style.height = 'auto';

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

  // Send notification to recipient
  if (otherUid) {
    await sendNotification({
      toUid: otherUid,
      fromUid: currentUser.uid,
      fromName: currentUserData.displayName || 'Someone',
      fromPhoto: currentUserData.photoURL || '',
      type: 'message',
      message: 'sent you a message',
      preview: content.slice(0, 80)
    });
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
  const q = query(collection(db, 'conversations'), where('participants', 'array-contains', currentUser.uid));
  const snap = await getDocs(q);
  let existingId = null;
  snap.docs.forEach(d => {
    if (d.data().participants.includes(otherUid)) existingId = d.id;
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
  window.hideNewChatModal();
};

// ===== SEARCH CONVERSATIONS =====
window.searchConversations = (term) => {
  document.querySelectorAll('.conv-item').forEach(item => {
    const name = item.querySelector('p')?.textContent?.toLowerCase() || '';
    item.style.display = name.includes(term.toLowerCase()) ? '' : 'none';
  });
};

// ===== SEARCH FRIENDS FOR NEW CHAT =====
window.searchFriendsForChat = async (term) => {
  const results = document.getElementById('friend-search-results');
  if (!term) {
    results.innerHTML = '<p class="text-sm text-center py-4" style="color:var(--text-muted)">Start typing to search your friends...</p>';
    return;
  }
  const q = query(collection(db, 'users'), where('university', '==', currentUserData.university || ''), limit(20));
  const snap = await getDocs(q);
  results.innerHTML = '';
  const filtered = snap.docs.filter(d => {
    if (d.id === currentUser.uid) return false;
    return (d.data().displayName || '').toLowerCase().includes(term.toLowerCase());
  });
  if (filtered.length === 0) {
    results.innerHTML = '<p class="text-sm text-center py-4" style="color:var(--text-muted)">No users found.</p>';
    return;
  }
  filtered.forEach(d => {
    const u = d.data();
    const ava = u.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.displayName||'U')}&background=a855f7&color=fff`;
    results.insertAdjacentHTML('beforeend', `
      <div class="flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-colors"
           style="background:var(--bg-card-hover)"
           onclick="openOrCreateConversation('${d.id}')">
        <img src="${ava}" class="lynk-avatar w-10 h-10" />
        <div class="flex-1 min-w-0">
          <p class="font-semibold text-sm truncate">${u.displayName}</p>
          <p class="text-xs truncate" style="color:var(--text-muted)">${u.department || u.faculty || u.university || ''}</p>
        </div>
        <span style="color:var(--grad-2)">→</span>
      </div>`);
  });
};

// ===== ATTACH FILE =====
window.attachFile = async (input) => {
  const file = input.files[0];
  if (!file || !activeConvId) return;
  let url;
  try {
    url = await uploadToCloudinary(file, `lynk/chat/${activeConvId}`);
  } catch (e) {
    console.error('Cloudinary upload failed:', e);
    return;
  }
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
    lastMessage: '📎 Sent an attachment',
    lastMessageAt: serverTimestamp(),
    [`unread.${otherUid}`]: currentUnread + 1
  });
  if (otherUid) {
    await sendNotification({
      toUid: otherUid,
      fromUid: currentUser.uid,
      fromName: currentUserData.displayName || 'Someone',
      fromPhoto: currentUserData.photoURL || '',
      type: 'message',
      message: 'sent you an attachment',
      preview: '📎 Image'
    });
  }
};

// ===== SIGN OUT =====
window.signOut = async () => {
  if (currentUser) {
    await setDoc(doc(db, 'users', currentUser.uid), { isOnline: false, lastSeen: serverTimestamp() }, { merge: true });
  }
  await firebaseSignOut(auth);
  window.location.href = 'auth.html';
};

window.hideNewChatModal = () => document.getElementById('new-chat-modal')?.classList.add('hidden');
window.showNewChatModal = () => document.getElementById('new-chat-modal')?.classList.remove('hidden');

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
