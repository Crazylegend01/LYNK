// ============================================================
// LYNK By Legends — Events Module (Phase 3)
// ============================================================

import { auth, db } from './firebase-config.js';
import { ThemeManager } from './theme.js';
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, serverTimestamp, increment, arrayUnion, arrayRemove, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged, signOut as firebaseSignOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { sendNotification } from './notifications.js';

ThemeManager.init();

let currentUser = null;
let currentUserData = null;
let currentFilter = 'upcoming';
let currentTypeFilter = 'all';
let allEvents = [];

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'auth.html'; return; }
  currentUser = user;
  const snap = await getDoc(doc(db, 'users', user.uid));
  currentUserData = snap.data() || {};

  const navAvatar = document.getElementById('nav-avatar');
  if (navAvatar) navAvatar.src = currentUserData.photoURL || `https://ui-avatars.com/api/?name=U&background=a855f7&color=fff`;
  if (currentUserData.role === 'admin' || currentUserData.adminRole) {
    document.getElementById('admin-link')?.classList.remove('hidden');
  }

  loadEvents();
});

async function loadEvents() {
  const list = document.getElementById('events-list');
  list.innerHTML = `<div class="text-center py-10" style="color:var(--text-muted)"><div class="spinner w-8 h-8 border-4 rounded-full mx-auto mb-3" style="border-color:var(--grad-1);border-top-color:transparent"></div>Loading events...</div>`;

  try {
    const now = new Date();
    let q;

    if (currentFilter === 'mine') {
      const rsvpSnap = await getDocs(query(collection(db, 'eventRsvps'), where('uid', '==', currentUser.uid), limit(30)));
      const ids = rsvpSnap.docs.map(d => d.data().eventId);
      if (ids.length === 0) { list.innerHTML = emptyState('No events yet', 'Browse upcoming events and RSVP to join them!'); return; }
      const snaps = await Promise.all(ids.map(id => getDoc(doc(db, 'events', id))));
      allEvents = snaps.filter(s => s.exists()).map(s => ({ id: s.id, ...s.data() }));
    } else if (currentFilter === 'created') {
      q = query(collection(db, 'events'), where('createdBy', '==', currentUser.uid), orderBy('date', 'desc'), limit(20));
      const snap = await getDocs(q);
      allEvents = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } else if (currentFilter === 'past') {
      q = query(collection(db, 'events'), where('university', '==', currentUserData.university || ''), where('date', '<', Timestamp.fromDate(now)), orderBy('date', 'desc'), limit(20));
      const snap = await getDocs(q);
      allEvents = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } else {
      // upcoming — global (no date filter to avoid composite index)
      q = query(collection(db, 'events'), orderBy('date', 'asc'), limit(40));
      const snap = await getDocs(q);
      allEvents = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(e => {
        const d = e.date?.toDate?.() || new Date(0);
        return d >= now;
      });
    }

    renderEvents(filterByType(allEvents));
  } catch (err) {
    console.warn('Events error:', err.message);
    // Fallback without composite index
    try {
      const q = query(collection(db, 'events'), limit(30));
      const snap = await getDocs(q);
      allEvents = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderEvents(filterByType(allEvents));
    } catch (e2) {
      list.innerHTML = `<div class="text-center py-10 text-sm" style="color:var(--text-muted)">Error loading events. Try again.</div>`;
    }
  }
}

function filterByType(events) {
  if (currentTypeFilter === 'all') return events;
  return events.filter(e => e.eventType === currentTypeFilter);
}

async function renderEvents(events) {
  const list = document.getElementById('events-list');
  if (events.length === 0) { list.innerHTML = emptyState('No events found', 'Create the first event for your campus!'); return; }

  // Load RSVP status for all events
  const rsvpChecks = await Promise.all(events.map(e =>
    getDoc(doc(db, 'eventRsvps', `${e.id}_${currentUser.uid}`))
  ));
  const rsvpMap = {};
  rsvpChecks.forEach((s, i) => { rsvpMap[events[i].id] = s.exists(); });

  list.innerHTML = '';
  events.forEach(ev => {
    const date = ev.date?.toDate?.() || new Date();
    const isPast = date < new Date();
    const isGoing = rsvpMap[ev.id] || false;
    const typeEmojis = { social: '🎉', hackathon: '🖥️', seminar: '🎤', workshop: '🔧', sports: '⚽', election: '🗳️', other: '📌' };
    const emoji = typeEmojis[ev.eventType] || '📌';

    list.insertAdjacentHTML('beforeend', `
      <div class="event-card p-5 fade-in" onclick="openEvent('${ev.id}')">
        <div class="flex gap-4">
          <div class="event-date-badge">
            <div class="day">${date.getDate()}</div>
            <div class="mon">${date.toLocaleString('en', {month:'short'})}</div>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-start justify-between gap-2">
              <div class="flex-1">
                <div class="flex items-center gap-2 mb-1">
                  <span class="text-sm">${emoji}</span>
                  <span class="text-xs px-2 py-0.5 rounded-md font-medium" style="background:var(--bg-card-hover);color:var(--text-muted)">${(ev.eventType || 'event').toUpperCase()}</span>
                  ${isPast ? '<span class="text-xs px-2 py-0.5 rounded-md" style="background:rgba(71,85,105,0.3);color:var(--text-muted)">Ended</span>' : ''}
                </div>
                <h3 class="font-bold mb-1 text-sm md:text-base">${escHtml(ev.title)}</h3>
                <p class="text-xs mb-2 line-clamp-2" style="color:var(--text-secondary)">${escHtml(ev.description || '')}</p>
                <div class="flex flex-wrap gap-3 text-xs" style="color:var(--text-muted)">
                  <span>📍 ${escHtml(ev.location || 'TBD')}</span>
                  <span>🕐 ${date.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span>
                  <span>👥 ${ev.rsvpCount || 0} going</span>
                  ${ev.maxAttendees > 0 ? `<span>🎫 ${ev.maxAttendees} max</span>` : ''}
                </div>
              </div>
              <div class="flex-shrink-0">
                ${!isPast ? `
                  <button onclick="event.stopPropagation();rsvpEvent('${ev.id}',${!isGoing})"
                    class="lynk-btn text-xs py-2 px-3 ${isGoing ? 'lynk-btn-secondary' : 'lynk-btn-primary'}"
                    id="rsvp-btn-${ev.id}">
                    ${isGoing ? '✓ Going' : 'RSVP'}
                  </button>` : `<span class="text-xs" style="color:var(--text-muted)">${ev.rsvpCount || 0} attended</span>`}
              </div>
            </div>
          </div>
        </div>
        ${ev.createdBy === currentUser.uid ? `
          <div class="flex gap-2 mt-3 pt-3 border-t" style="border-color:var(--border)">
            <button onclick="event.stopPropagation();deleteEvent('${ev.id}')" class="lynk-btn lynk-btn-ghost text-xs py-1 px-2" style="color:#ef4444">Delete</button>
          </div>` : ''}
      </div>`);
  });
}

// ===== RSVP =====
window.rsvpEvent = async (eventId, going) => {
  const rsvpId = `${eventId}_${currentUser.uid}`;
  const btn = document.getElementById(`rsvp-btn-${eventId}`);

  if (going) {
    await updateDoc(doc(db, 'events', eventId), { rsvpCount: increment(1) });
    await updateDoc(doc(db, 'events', eventId), {
      attendees: arrayUnion(currentUser.uid)
    }).catch(() => {});
    import('./firebase-config.js').then(({ db }) => {
      import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js").then(({ doc: d, setDoc: sd, serverTimestamp: st }) => {
        sd(d(db, 'eventRsvps', rsvpId), {
          eventId, uid: currentUser.uid,
          displayName: currentUserData.displayName || '',
          createdAt: st()
        });
      });
    });
    if (btn) { btn.textContent = '✓ Going'; btn.className = 'lynk-btn lynk-btn-secondary text-xs py-2 px-3'; }
  } else {
    await updateDoc(doc(db, 'events', eventId), { rsvpCount: increment(-1) });
    import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js").then(({ doc: d, deleteDoc: dd }) => {
      import('./firebase-config.js').then(({ db }) => dd(d(db, 'eventRsvps', rsvpId)));
    });
    if (btn) { btn.textContent = 'RSVP'; btn.className = 'lynk-btn lynk-btn-primary text-xs py-2 px-3'; }
  }
};

// ===== OPEN EVENT MODAL =====
window.openEvent = async (eventId) => {
  const snap = await getDoc(doc(db, 'events', eventId));
  if (!snap.exists()) return;
  const ev = { id: snap.id, ...snap.data() };
  const date = ev.date?.toDate?.() || new Date();
  const isGoing = (await getDoc(doc(db, 'eventRsvps', `${eventId}_${currentUser.uid}`))).exists();

  document.getElementById('event-modal-content').innerHTML = `
    <div class="p-5">
      <div class="flex items-center justify-between mb-4">
        <span class="lynk-badge text-xs px-3 py-1" style="background:rgba(168,85,247,0.1);color:var(--grad-1)">${(ev.eventType || 'event').toUpperCase()}</span>
        <button onclick="closeEventModal()" class="lynk-icon-btn"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
      <h2 class="text-xl font-bold mb-3">${escHtml(ev.title)}</h2>
      <p class="text-sm mb-4 whitespace-pre-wrap" style="color:var(--text-secondary)">${escHtml(ev.description)}</p>
      <div class="flex flex-col gap-3 mb-5 p-4 rounded-xl" style="background:var(--bg-card-hover)">
        <div class="flex items-center gap-3 text-sm"><div class="event-date-badge flex-shrink-0"><div class="day">${date.getDate()}</div><div class="mon">${date.toLocaleString('en',{month:'short'})}</div></div><div><p class="font-semibold">${date.toLocaleDateString('en', {weekday:'long',year:'numeric',month:'long',day:'numeric'})}</p><p style="color:var(--text-muted)">${date.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</p></div></div>
        <div class="flex items-center gap-3 text-sm"><span class="text-xl">📍</span><p>${escHtml(ev.location || 'TBD')}</p></div>
        <div class="flex items-center gap-3 text-sm"><span class="text-xl">👥</span><p>${ev.rsvpCount || 0} going${ev.maxAttendees > 0 ? ` · ${ev.maxAttendees} max` : ''}</p></div>
      </div>
      <div class="flex items-center gap-3 mb-4 p-3 rounded-xl" style="background:var(--bg-card-hover)">
        <img src="${ev.creatorPhoto || `https://ui-avatars.com/api/?name=U&background=a855f7&color=fff`}" class="lynk-avatar w-9 h-9" />
        <div><p class="text-xs" style="color:var(--text-muted)">Organised by</p><p class="font-semibold text-sm">${escHtml(ev.creatorName || 'Organizer')}</p></div>
      </div>
      ${date >= new Date() && ev.createdBy !== currentUser.uid ? `
        <button onclick="rsvpEvent('${eventId}',${!isGoing})" id="modal-rsvp-btn-${eventId}" class="lynk-btn w-full ${isGoing ? 'lynk-btn-secondary' : 'lynk-btn-primary'}">
          ${isGoing ? '✓ Cancel RSVP' : '🎉 RSVP — I\'m Going!'}
        </button>` : ev.createdBy === currentUser.uid ? `
        <div class="flex gap-3">
          <div class="lynk-btn lynk-btn-secondary flex-1 text-center text-sm">${ev.rsvpCount || 0} people going</div>
          <button onclick="deleteEvent('${eventId}')" class="lynk-btn lynk-btn-danger flex-1 text-sm">Delete Event</button>
        </div>` : ''}
    </div>`;

  document.getElementById('event-modal').classList.remove('hidden');
};

window.closeEventModal = (e) => {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('event-modal').classList.add('hidden');
};

// ===== CREATE EVENT =====
window.showCreateEvent = () => {
  const dateInput = document.getElementById('event-date');
  if (dateInput) dateInput.min = new Date().toISOString().slice(0, 10);
  document.getElementById('create-event-modal').classList.remove('hidden');
};
window.closeCreateEvent = (e) => {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('create-event-modal').classList.add('hidden');
};

window.submitEvent = async () => {
  const title = document.getElementById('event-title').value.trim();
  const desc = document.getElementById('event-desc').value.trim();
  const dateVal = document.getElementById('event-date').value;
  const timeVal = document.getElementById('event-time').value;
  const location = document.getElementById('event-location').value.trim();
  const type = document.getElementById('event-type').value;
  const maxAttendees = Number(document.getElementById('event-max').value || 0);
  const isOnline = document.getElementById('event-online').checked;

  if (!title || !desc || !dateVal || !timeVal || !location) {
    alert('Please fill in all required fields.');
    return;
  }

  const date = new Date(`${dateVal}T${timeVal}`);
  await addDoc(collection(db, 'events'), {
    title, description: desc, location,
    date: Timestamp.fromDate(date),
    eventType: type, maxAttendees, isOnline,
    university: currentUserData.university || '',
    faculty: currentUserData.faculty || '',
    createdBy: currentUser.uid,
    creatorName: currentUserData.displayName || 'Organizer',
    creatorPhoto: currentUserData.photoURL || '',
    rsvpCount: 0, attendees: [],
    status: 'active',
    createdAt: serverTimestamp()
  });

  closeCreateEvent();
  loadEvents();
};

window.deleteEvent = async (eventId) => {
  if (!confirm('Delete this event?')) return;
  await deleteDoc(doc(db, 'events', eventId));
  closeEventModal();
  loadEvents();
};

// ===== FILTERS =====
window.filterEvents = (filter, btn) => {
  document.querySelectorAll('.lynk-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentFilter = filter;
  loadEvents();
};

window.filterEventType = (type, btn) => {
  document.querySelectorAll('.category-chip').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentTypeFilter = type;
  renderEvents(filterByType(allEvents));
};

// ===== HELPERS =====
function emptyState(title, sub) {
  return `<div class="text-center py-16"><div class="text-5xl mb-3">📅</div><h3 class="font-bold mb-2">${title}</h3><p class="text-sm" style="color:var(--text-muted)">${sub}</p><button onclick="showCreateEvent()" class="lynk-btn lynk-btn-primary mt-4 text-sm">Create Event</button></div>`;
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

window.signOut = async () => {
  await firebaseSignOut(auth);
  window.location.href = 'auth.html';
};
