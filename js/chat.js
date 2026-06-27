// ============================================================
// LYNK By Legends — Enhanced Chat Module (Phase 3)
// Group messaging, reactions, voice notes, read receipts, pin messages
// ============================================================

import { auth, db } from './firebase-config.js';
import { ThemeManager } from './theme.js';
import { initNotifications, sendNotification } from './notifications.js';
import {
  collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc, query,
  where, orderBy, limit, onSnapshot, serverTimestamp, arrayUnion, arrayRemove, increment
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged, signOut as firebaseSignOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { uploadToCloudinary } from './cloudinary.js';

ThemeManager.init();

let currentUser = null;
let currentUserData = null;
let activeConvId = null;
let activeConvData = null;
let activeOtherUid = null;
let messagesUnsub = null;
let convUnsub = null;
let typingTimeout = null;
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let pinnedMessages = [];

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

  convList.innerHTML = `${[1,2,3].map(() => `
    <div class="flex items-center gap-3 p-4 border-b animate-pulse" style="border-color:var(--border)">
      <div class="w-12 h-12 rounded-full flex-shrink-0 shimmer"></div>
      <div class="flex-1"><div class="h-3 rounded w-1/2 mb-2 shimmer"></div><div class="h-3 rounded w-3/4 shimmer"></div></div>
    </div>`).join('')}`;

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
          <button onclick="showNewChatModal()" class="lynk-btn lynk-btn-primary mt-3 text-sm">New Message</button>
        </div>`;
      return;
    }

    const convData = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.lastMessageAt?.toMillis?.() || 0) - (a.lastMessageAt?.toMillis?.() || 0));

    // Handle both DMs and group chats
    const allUids = new Set();
    convData.forEach(c => {
      if (c.type === 'group') return;
      const other = c.participants?.find(uid => uid !== currentUser.uid);
      if (other) allUids.add(other);
    });

    const userSnaps = await Promise.all([...allUids].map(uid => getDoc(doc(db, 'users', uid))));
    const userMap = {};
    userSnaps.forEach(s => { if (s.exists()) userMap[s.id] = s.data(); });

    convList.innerHTML = '';
    convData.forEach(conv => {
      const isGroup = conv.type === 'group';
      const otherUid = !isGroup ? conv.participants?.find(uid => uid !== currentUser.uid) : null;
      const other = otherUid ? (userMap[otherUid] || {}) : {};
      const name = isGroup ? (conv.groupName || 'Group') : (other.displayName || 'LYNK User');
      const ava = isGroup
        ? `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=6366f1&color=fff`
        : (other.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=a855f7&color=fff`);
      const ts = conv.lastMessageAt?.toDate?.()?.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) || '';
      const unread = conv.unread?.[currentUser.uid] || 0;
      const isActive = conv.id === activeConvId;

      convList.insertAdjacentHTML('beforeend', `
        <div class="conv-item flex items-center gap-3 p-4 cursor-pointer transition-colors border-b"
             style="border-color:var(--border);background:${isActive?'var(--bg-card-hover)':'transparent'}"
             id="conv-item-${conv.id}"
             onclick="selectConversation('${conv.id}', '${otherUid || ''}')">
          <div class="relative flex-shrink-0">
            <img src="${ava}" class="lynk-avatar w-12 h-12" />
            ${!isGroup && other.isOnline ? '<span class="online-dot"></span>' : ''}
            ${isGroup ? '<div class="absolute -bottom-1 -right-1 text-xs">👥</div>' : ''}
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between">
              <p class="font-semibold text-sm truncate">${escHtml(name)}</p>
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
    convList.innerHTML = `<div class="p-6 text-center text-sm" style="color:var(--text-muted)"><p>Setting up messages...</p><p class="text-xs mt-1">This may take a moment on first load.</p></div>`;
    console.warn('Conversations listener error:', err.message);
  });
}

// ===== SELECT CONVERSATION =====
window.selectConversation = async (convId, otherUid) => {
  activeConvId = convId;
  activeOtherUid = otherUid;

  if (messagesUnsub) { messagesUnsub(); messagesUnsub = null; }

  document.querySelectorAll('.conv-item').forEach(el => el.style.background = 'transparent');
  const item = document.getElementById(`conv-item-${convId}`);
  if (item) item.style.background = 'var(--bg-card-hover)';

  document.getElementById('chat-layout')?.classList.add('chat-active');

  const convSnap = await getDoc(doc(db, 'conversations', convId));
  activeConvData = convSnap.data() || {};
  const isGroup = activeConvData.type === 'group';

  let name = '', ava = '', isOnline = false;

  if (isGroup) {
    name = activeConvData.groupName || 'Group';
    ava = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=6366f1&color=fff`;
  } else {
    const usnap = await getDoc(doc(db, 'users', otherUid));
    const other = usnap.data() || {};
    name = other.displayName || 'LYNK User';
    ava = other.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=a855f7&color=fff`;
    isOnline = other.isOnline || false;
    const lastSeen = other.lastSeen?.toDate?.()?.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) || '';

    const headerProfile = document.getElementById('chat-header-profile');
    if (headerProfile) headerProfile.href = `profile.html?uid=${otherUid}`;

    const statusEl = document.getElementById('chat-header-status');
    const dotEl = document.getElementById('chat-online-dot');
    if (isOnline) {
      if (statusEl) { statusEl.textContent = 'Online'; statusEl.style.color = '#22c55e'; }
      dotEl?.classList.remove('hidden');
    } else {
      if (statusEl) { statusEl.textContent = lastSeen ? `Last seen ${lastSeen}` : 'Offline'; statusEl.style.color = 'var(--text-muted)'; }
      dotEl?.classList.add('hidden');
    }
  }

  document.getElementById('chat-empty-state')?.classList.add('hidden');
  document.getElementById('chat-header')?.classList.remove('hidden');
  document.getElementById('messages-area')?.classList.remove('hidden');
  document.getElementById('message-input-area')?.classList.remove('hidden');

  const headerAvatar = document.getElementById('chat-header-avatar');
  if (headerAvatar) headerAvatar.src = ava;
  const headerName = document.getElementById('chat-header-name');
  if (headerName) headerName.textContent = name;

  // Group badge
  const groupBadge = document.getElementById('chat-group-badge');
  if (groupBadge) groupBadge.classList.toggle('hidden', !isGroup);

  // Reset unread
  await updateDoc(doc(db, 'conversations', convId), {
    [`unread.${currentUser.uid}`]: 0
  }).catch(() => {});

  // Load pinned messages
  loadPinnedMessage(convId);

  // Messages listener
  const messagesArea = document.getElementById('messages-area');
  if (messagesArea) messagesArea.innerHTML = '';

  const msgQ = query(
    collection(db, 'conversations', convId, 'messages'),
    orderBy('createdAt', 'asc'),
    limit(100)
  );

  messagesUnsub = onSnapshot(msgQ, (snap) => {
    if (!messagesArea) return;
    const existingIds = new Set([...messagesArea.querySelectorAll('[data-msg-id]')].map(el => el.dataset.msgId));
    snap.docChanges().forEach(change => {
      if (change.type === 'added' && !existingIds.has(change.doc.id)) {
        messagesArea.insertAdjacentHTML('beforeend', renderMessageHtml(change.doc.id, change.doc.data()));
        existingIds.add(change.doc.id);
      } else if (change.type === 'modified') {
        const existing = messagesArea.querySelector(`[data-msg-id="${change.doc.id}"]`);
        if (existing) {
          const updated = renderMessageHtml(change.doc.id, change.doc.data());
          existing.outerHTML = updated;
        }
      } else if (change.type === 'removed') {
        messagesArea.querySelector(`[data-msg-id="${change.doc.id}"]`)?.remove();
      }
    });

    const threshold = 120;
    const nearBottom = messagesArea.scrollHeight - messagesArea.scrollTop - messagesArea.clientHeight < threshold;
    if (nearBottom || existingIds.size === 0) messagesArea.scrollTop = messagesArea.scrollHeight;

    // Mark all as read
    markMessagesRead(convId, snap.docs);
  }, (err) => console.warn('Messages listener error:', err.message));

  // Typing indicator
  onSnapshot(doc(db, 'conversations', convId), (snap) => {
    const data = snap.data();
    const typingUids = data?.typing || [];
    const othersTyping = typingUids.filter(uid => uid !== currentUser.uid);
    const ti = document.getElementById('typing-indicator');
    const tt = document.getElementById('typing-text');
    if (othersTyping.length > 0) {
      ti?.classList.remove('hidden');
      if (tt) tt.textContent = isGroup ? `Someone is typing...` : `${name.split(' ')[0]} is typing`;
    } else {
      ti?.classList.add('hidden');
    }
  });
};

// ===== READ RECEIPTS =====
async function markMessagesRead(convId, msgDocs) {
  const updates = msgDocs
    .filter(d => d.data().senderId !== currentUser.uid && !d.data().readBy?.includes(currentUser.uid))
    .slice(0, 20);

  await Promise.all(updates.map(d =>
    updateDoc(doc(db, 'conversations', convId, 'messages', d.id), {
      readBy: arrayUnion(currentUser.uid)
    }).catch(() => {})
  ));
}

// ===== RENDER MESSAGE =====
function renderMessageHtml(msgId, msg) {
  const isOwn = msg.senderId === currentUser.uid;
  const ts = msg.createdAt?.toDate?.()?.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) || '';
  const isDeleted = msg.deleted;
  const ava = msg.senderPhoto || `https://ui-avatars.com/api/?name=U&background=a855f7&color=fff`;
  const isRead = msg.readBy?.length > 0 && msg.readBy.some(uid => uid !== currentUser.uid);

  let content = '';
  if (isDeleted) {
    content = `<span class="text-xs italic" style="color:var(--text-muted)">🚫 Message deleted</span>`;
  } else if (msg.type === 'image') {
    content = `<img src="${msg.mediaUrl}" class="rounded-xl max-h-64 object-cover cursor-pointer" onclick="window.open('${msg.mediaUrl}')" loading="lazy" />`;
  } else if (msg.type === 'voice') {
    content = `<div class="voice-note-player">
      <button onclick="playVoiceNote('${msg.mediaUrl}', this)" class="lynk-icon-btn" style="width:32px;height:32px;background:rgba(255,255,255,0.2)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      </button>
      <div class="voice-note-wave"><div class="voice-note-progress" id="vp-${msgId}"></div></div>
      <span class="text-xs opacity-70">${msg.duration || '0:00'}</span>
    </div>`;
  } else if (msg.type === 'file') {
    content = `<a href="${msg.mediaUrl}" target="_blank" class="flex items-center gap-2 text-sm underline">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
      ${escHtml(msg.fileName || 'File')}
    </a>`;
  } else {
    content = `<span>${escHtml(msg.content)}</span>`;
  }

  // Reactions
  const reactions = msg.reactions || {};
  const reactionHtml = Object.entries(reactions).length > 0 ? `
    <div class="msg-reaction-row">
      ${Object.entries(reactions).map(([emoji, uids]) => `
        <button class="msg-reaction-chip ${uids.includes(currentUser.uid) ? 'mine' : ''}"
                onclick="addReaction('${msgId}', '${emoji}')">
          ${emoji} <span>${uids.length}</span>
        </button>`).join('')}
    </div>` : '';

  const pinBtn = isOwn ? `<button class="text-xs" onclick="pinMessage('${msgId}', '${(msg.content || '').slice(0,60).replace(/'/g,"\\'")}', ${msg.isPinned || false})" style="color:var(--text-muted)">📌</button>` : '';
  const deleteBtn = isOwn && !isDeleted ? `<button class="text-xs" onclick="deleteMessage('${msgId}')" style="color:#ef4444;opacity:0.7">Delete</button>` : '';
  const reactionPickerBtn = !isDeleted ? `<button class="text-xs lynk-icon-btn" onclick="showReactionPicker('${msgId}', this)" style="width:24px;height:24px;color:var(--text-muted)">😀</button>` : '';

  // Read receipt (for own messages)
  const readReceipt = isOwn ? `<span class="read-receipt">${isRead ? '✓✓' : '✓'}</span>` : '';

  if (isOwn) {
    return `
      <div class="flex justify-end items-end gap-2 fade-in" data-msg-id="${msgId}">
        <div class="flex flex-col items-end gap-1" style="max-width:75%">
          ${msg.isPinned ? '<span class="text-xs" style="color:var(--grad-1)">📌 Pinned</span>' : ''}
          <div class="chat-bubble-out">${content}</div>
          ${reactionHtml}
          <div class="flex items-center gap-2">
            ${reactionPickerBtn}
            ${pinBtn}
            ${deleteBtn}
            <span class="text-xs" style="color:var(--text-muted)">${ts}</span>
            ${readReceipt}
          </div>
        </div>
      </div>`;
  } else {
    const isGroup = activeConvData?.type === 'group';
    return `
      <div class="flex justify-start items-end gap-2 fade-in" data-msg-id="${msgId}">
        ${isGroup ? `<img src="${ava}" class="lynk-avatar w-7 h-7 flex-shrink-0 mb-1" />` : `<img src="${ava}" class="lynk-avatar w-7 h-7 flex-shrink-0 mb-1" />`}
        <div class="flex flex-col items-start gap-1" style="max-width:75%">
          ${isGroup ? `<span class="text-xs font-semibold px-1" style="color:var(--grad-1)">${escHtml(msg.senderName || 'User')}</span>` : ''}
          ${msg.isPinned ? '<span class="text-xs" style="color:var(--grad-1)">📌 Pinned</span>' : ''}
          <div class="chat-bubble-in">${content}</div>
          ${reactionHtml}
          <div class="flex items-center gap-2">
            ${reactionPickerBtn}
            <span class="text-xs" style="color:var(--text-muted)">${ts}</span>
          </div>
        </div>
      </div>`;
  }
}

// ===== REACTIONS =====
window.showReactionPicker = (msgId, btn) => {
  // Remove existing pickers
  document.querySelectorAll('.reaction-picker').forEach(p => p.remove());

  const emojis = ['❤️', '👍', '😂', '🔥', '😮', '🙏', '👏', '🎉'];
  const picker = document.createElement('div');
  picker.className = 'reaction-picker';
  picker.style.position = 'fixed';

  const rect = btn.getBoundingClientRect();
  picker.style.top = (rect.top - 60) + 'px';
  picker.style.left = Math.max(8, rect.left - 80) + 'px';

  picker.innerHTML = emojis.map(e =>
    `<span class="reaction-emoji" onclick="addReaction('${msgId}', '${e}');this.closest('.reaction-picker').remove()">${e}</span>`
  ).join('');

  document.body.appendChild(picker);
  setTimeout(() => document.addEventListener('click', () => picker.remove(), { once: true }), 50);
};

window.addReaction = async (msgId, emoji) => {
  if (!activeConvId) return;
  const msgRef = doc(db, 'conversations', activeConvId, 'messages', msgId);
  const snap = await getDoc(msgRef);
  if (!snap.exists()) return;

  const reactions = snap.data().reactions || {};
  const uids = reactions[emoji] || [];

  if (uids.includes(currentUser.uid)) {
    // Remove reaction
    reactions[emoji] = uids.filter(uid => uid !== currentUser.uid);
    if (reactions[emoji].length === 0) delete reactions[emoji];
  } else {
    reactions[emoji] = [...uids, currentUser.uid];
  }

  await updateDoc(msgRef, { reactions });
};

// ===== PIN MESSAGE =====
window.pinMessage = async (msgId, preview, currentlyPinned) => {
  if (!activeConvId) return;
  const msgRef = doc(db, 'conversations', activeConvId, 'messages', msgId);
  await updateDoc(msgRef, { isPinned: !currentlyPinned });
  await updateDoc(doc(db, 'conversations', activeConvId), {
    pinnedMessage: currentlyPinned ? null : { msgId, preview }
  });
  loadPinnedMessage(activeConvId);
};

async function loadPinnedMessage(convId) {
  const snap = await getDoc(doc(db, 'conversations', convId));
  const pinned = snap.data()?.pinnedMessage;
  const banner = document.getElementById('pinned-message-banner');
  if (banner) {
    if (pinned?.msgId) {
      banner.classList.remove('hidden');
      const pinPreview = banner.querySelector('#pinned-preview');
      if (pinPreview) pinPreview.textContent = pinned.preview || 'Pinned message';
      banner.onclick = () => {
        const el = document.querySelector(`[data-msg-id="${pinned.msgId}"]`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      };
    } else {
      banner.classList.add('hidden');
    }
  }
}

// ===== DELETE MESSAGE =====
window.deleteMessage = async (msgId) => {
  if (!confirm('Delete this message?')) return;
  await updateDoc(doc(db, 'conversations', activeConvId, 'messages', msgId), {
    deleted: true, content: '', mediaUrl: ''
  });
};

// ===== SEND MESSAGE =====
window.sendMessage = async () => {
  if (!activeConvId || !currentUser) return;
  const input = document.getElementById('msg-input');
  const content = input?.value.trim();
  if (!content) return;

  input.value = '';
  if (input.style) input.style.height = 'auto';

  const isGroup = activeConvData?.type === 'group';

  await addDoc(collection(db, 'conversations', activeConvId, 'messages'), {
    content, type: 'text',
    senderId: currentUser.uid,
    senderName: currentUserData.displayName || 'LYNK User',
    senderPhoto: currentUserData.photoURL || '',
    readBy: [currentUser.uid],
    reactions: {},
    isPinned: false,
    createdAt: serverTimestamp()
  });

  // Update conversation
  const updates = {
    lastMessage: content.length > 50 ? content.slice(0, 50) + '…' : content,
    lastMessageAt: serverTimestamp(),
    lastSenderId: currentUser.uid,
    typing: []
  };

  if (isGroup) {
    const participants = activeConvData.participants || [];
    participants.forEach(uid => {
      if (uid !== currentUser.uid) updates[`unread.${uid}`] = (activeConvData.unread?.[uid] || 0) + 1;
    });
    await updateDoc(doc(db, 'conversations', activeConvId), updates);
  } else if (activeOtherUid) {
    const convSnap = await getDoc(doc(db, 'conversations', activeConvId));
    const currentUnread = convSnap.data()?.unread?.[activeOtherUid] || 0;
    updates[`unread.${activeOtherUid}`] = currentUnread + 1;
    await updateDoc(doc(db, 'conversations', activeConvId), updates);

    sendNotification({
      toUid: activeOtherUid, fromUid: currentUser.uid,
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
  await updateDoc(doc(db, 'conversations', activeConvId), { typing: [currentUser.uid] }).catch(() => {});
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(clearTyping, 2500);
};

async function clearTyping() {
  if (!activeConvId || !currentUser) return;
  await updateDoc(doc(db, 'conversations', activeConvId), { typing: [] }).catch(() => {});
}

// ===== VOICE NOTE =====
window.startRecording = async () => {
  if (!navigator.mediaDevices) { alert('Voice notes require a secure connection (HTTPS).'); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];
    isRecording = true;

    mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(audioChunks, { type: 'audio/webm' });
      const file = new File([blob], 'voice_note.webm', { type: 'audio/webm' });
      await sendVoiceNote(file);
    };

    mediaRecorder.start();
    const btn = document.getElementById('voice-btn');
    if (btn) { btn.style.color = '#ef4444'; btn.title = 'Stop recording (tap again)'; }
  } catch (e) {
    alert('Microphone access denied.');
  }
};

window.stopRecording = () => {
  if (mediaRecorder && isRecording) {
    mediaRecorder.stop();
    isRecording = false;
    const btn = document.getElementById('voice-btn');
    if (btn) { btn.style.color = ''; btn.title = 'Voice note'; }
  }
};

window.toggleRecording = () => {
  if (isRecording) stopRecording();
  else startRecording();
};

async function sendVoiceNote(file) {
  if (!activeConvId) return;
  const url = await uploadToCloudinary(file, `lynk/voice/${activeConvId}`);
  if (!url) return;

  await addDoc(collection(db, 'conversations', activeConvId, 'messages'), {
    content: '', type: 'voice', mediaUrl: url, duration: '0:10',
    senderId: currentUser.uid,
    senderName: currentUserData.displayName || '',
    senderPhoto: currentUserData.photoURL || '',
    readBy: [currentUser.uid], reactions: {},
    createdAt: serverTimestamp()
  });

  await updateDoc(doc(db, 'conversations', activeConvId), {
    lastMessage: '🎤 Voice message',
    lastMessageAt: serverTimestamp(),
    lastSenderId: currentUser.uid
  });
}

window.playVoiceNote = (url, btn) => {
  const audio = new Audio(url);
  const origHtml = btn.innerHTML;
  btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
  audio.play();
  audio.onended = () => { btn.innerHTML = origHtml; };
  audio.onerror = () => { btn.innerHTML = origHtml; };
};

// ===== OPEN OR CREATE CONVERSATION =====
window.openOrCreateConversation = async (otherUid) => {
  window.hideNewChatModal();
  const q = query(collection(db, 'conversations'), where('participants', 'array-contains', currentUser.uid));
  const snap = await getDocs(q);
  let existingId = null;
  snap.docs.forEach(d => {
    if (!d.data().type && d.data().participants?.includes(otherUid)) existingId = d.id;
  });

  if (existingId) {
    window.selectConversation(existingId, otherUid);
  } else {
    const newConv = await addDoc(collection(db, 'conversations'), {
      participants: [currentUser.uid, otherUid],
      type: 'dm',
      createdAt: serverTimestamp(),
      lastMessageAt: serverTimestamp(),
      lastMessage: '',
      unread: { [otherUid]: 0, [currentUser.uid]: 0 },
      typing: []
    });
    window.selectConversation(newConv.id, otherUid);
  }
};

// ===== CREATE GROUP CHAT =====
window.createGroupChat = async () => {
  const name = document.getElementById('group-name')?.value.trim();
  const selectedMembers = [...document.querySelectorAll('.group-member-check:checked')].map(c => c.value);

  if (!name) { alert('Enter a group name.'); return; }
  if (selectedMembers.length < 2) { alert('Select at least 2 members.'); return; }

  const participants = [currentUser.uid, ...selectedMembers];
  const newConv = await addDoc(collection(db, 'conversations'), {
    participants,
    type: 'group',
    groupName: name,
    groupAdmin: currentUser.uid,
    createdAt: serverTimestamp(),
    lastMessageAt: serverTimestamp(),
    lastMessage: `${currentUserData.displayName || 'User'} created the group`,
    unread: Object.fromEntries(participants.map(uid => [uid, 0])),
    typing: []
  });

  window.hideNewChatModal();
  window.selectConversation(newConv.id, '');
};

// ===== ATTACH FILE =====
window.attachFile = async (input) => {
  const file = input.files[0];
  if (!file || !activeConvId) return;

  const sendBtn = document.querySelector('#message-input-area button[onclick="sendMessage()"]');
  if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = '…'; }

  let url;
  try {
    const isImage = file.type.startsWith('image/');
    const folder = isImage ? `lynk/chat/${activeConvId}` : `lynk/files/${activeConvId}`;
    url = await uploadToCloudinary(file, folder, (pct) => {
      if (sendBtn) sendBtn.textContent = `${pct}%`;
    });
  } catch (e) {
    if (sendBtn) { sendBtn.disabled = false; sendBtn.innerHTML = sendSvg(); }
    return;
  }

  if (sendBtn) { sendBtn.disabled = false; sendBtn.innerHTML = sendSvg(); }

  const isImage = file.type.startsWith('image/');
  const type = isImage ? 'image' : 'file';

  await addDoc(collection(db, 'conversations', activeConvId, 'messages'), {
    content: '', type, mediaUrl: url,
    fileName: file.name, fileSize: file.size,
    senderId: currentUser.uid,
    senderName: currentUserData.displayName || '',
    senderPhoto: currentUserData.photoURL || '',
    readBy: [currentUser.uid], reactions: {},
    createdAt: serverTimestamp()
  });

  await updateDoc(doc(db, 'conversations', activeConvId), {
    lastMessage: isImage ? '📷 Image' : `📎 ${file.name}`,
    lastMessageAt: serverTimestamp(),
    lastSenderId: currentUser.uid
  });

  if (activeOtherUid) {
    sendNotification({
      toUid: activeOtherUid, fromUid: currentUser.uid,
      fromName: currentUserData.displayName || 'Someone',
      fromPhoto: currentUserData.photoURL || '',
      type: 'message', message: isImage ? 'sent you an image' : 'sent you a file', preview: isImage ? 'Image' : file.name
    }).catch(() => {});
  }
  input.value = '';
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

// ===== SIGN OUT / MODALS =====
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

// ===== HELPERS =====
function sendSvg() {
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
