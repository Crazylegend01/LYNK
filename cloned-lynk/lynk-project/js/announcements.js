// ============================================================
// LYNK By Legends — Announcements Module
// ============================================================

import { auth, db } from './firebase-config.js';
import { ThemeManager } from './theme.js';
import { initNotifications, showToast } from './notifications.js';
import {
  collection, doc, getDoc, getDocs, addDoc, deleteDoc,
  query, where, orderBy, limit, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged, signOut as firebaseSignOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

ThemeManager.init();

let currentUser = null;
let currentUserData = null;
let isAdmin = false;
let allAnnouncements = [];
let currentAudience = 'all';

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'auth.html'; return; }
  currentUser = user;
  const snap = await getDoc(doc(db, 'users', user.uid));
  currentUserData = snap.data() || {};
  isAdmin = !!(currentUserData.adminRole || currentUserData.role === 'admin');
  await initNotifications(user.uid);
  populateSidebar();
  if (isAdmin) document.getElementById('compose-section')?.classList.remove('hidden');
  loadAnnouncements();
});

function populateSidebar() {
  const d = currentUserData;
  const ava = d.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(d.displayName||'U')}&background=a855f7&color=fff`;
  ['nav-avatar','sidebar-avatar'].forEach(id => { const el = document.getElementById(id); if (el) el.src = ava; });
  const sn = document.getElementById('sidebar-name'); if (sn) sn.textContent = d.displayName || 'LYNK User';
  const sd = document.getElementById('sidebar-dept'); if (sd) sd.textContent = `${d.department||''} · ${d.university||''}`;
  if (isAdmin) document.getElementById('admin-link')?.classList.remove('hidden');
}

async function loadAnnouncements() {
  const list = document.getElementById('announcements-list');
  if (!list) return;
  list.innerHTML = `
    <div class="lynk-card p-5 animate-pulse">
      <div class="h-4 rounded w-1/3 mb-3" style="background:var(--border)"></div>
      <div class="h-3 rounded w-full mb-2" style="background:var(--border)"></div>
      <div class="h-3 rounded w-2/3" style="background:var(--border)"></div>
    </div>`;

  const snap = await getDocs(query(collection(db, 'announcements'), orderBy('createdAt','desc'), limit(50)));
  allAnnouncements = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  filterAnnouncements();
}

// Called by the tab buttons in announcements.html
window.filterAnn = (type, btn) => {
  document.querySelectorAll('.lynk-tab').forEach(b => b.classList.remove('active'));
  btn?.classList.add('active');
  const filtered = type === 'all'
    ? allAnnouncements
    : type === 'high'
    ? allAnnouncements.filter(a => a.priority === 'high')
    : allAnnouncements.filter(a => (a.category || '').toLowerCase() === type.toLowerCase());
  renderAnnouncements(filtered);
};

// Legacy select-based filter (kept for backward compatibility)
window.filterAnnouncements = () => {
  const audience = document.getElementById('filter-audience')?.value || 'all';
  currentAudience = audience;
  const filtered = audience === 'all'
    ? allAnnouncements
    : allAnnouncements.filter(a => a.audience === audience || a.audience === 'all');
  renderAnnouncements(filtered);
};

function renderAnnouncements(announcements) {
  const list = document.getElementById('announcements-list');
  if (!list) return;

  if (announcements.length === 0) {
    list.innerHTML = `
      <div class="lynk-card p-10 text-center">
        <div class="text-5xl mb-4">📭</div>
        <h3 class="font-semibold mb-2">No announcements yet</h3>
        <p style="color:var(--text-secondary);font-size:0.875rem">
          ${isAdmin ? 'Use the form above to post the first announcement.' : 'Check back later for platform updates.'}
        </p>
      </div>`;
    return;
  }

  list.innerHTML = '';
  announcements.forEach(a => {
    const priorityConfigs = {
      high:   { icon:'🔴', label:'Urgent',    bg:'rgba(239,68,68,0.08)',  border:'#ef4444', textColor:'#f87171' },
      medium: { icon:'🟡', label:'Important', bg:'rgba(245,158,11,0.08)', border:'#f59e0b', textColor:'#fbbf24' },
      low:    { icon:'🟢', label:'Info',       bg:'rgba(34,197,94,0.08)',  border:'#22c55e', textColor:'#4ade80' }
    };
    const pc = priorityConfigs[a.priority||'low'];
    const audienceLabels = { all:'🌍 Everyone', students:'🎓 Students', staff:'👨‍🏫 Staff', alumni:'🏆 Alumni' };
    const ts = a.createdAt?.toDate?.()?.toLocaleString() || '';

    list.insertAdjacentHTML('beforeend', `
      <div class="lynk-card p-5 fade-in" style="border-left:3px solid ${pc.border};background:${pc.bg}">
        <div class="flex items-start justify-between gap-3 mb-3">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="lynk-badge text-xs" style="background:${pc.bg};color:${pc.textColor};border:1px solid ${pc.border}">${pc.icon} ${pc.label}</span>
            ${a.category ? `<span class="lynk-badge text-xs" style="background:var(--bg-card-hover);color:var(--text-muted)">${escHtml(a.category)}</span>` : ''}
            <span class="lynk-badge text-xs" style="background:var(--bg-card-hover);color:var(--text-muted)">${audienceLabels[a.audience]||'🌍 Everyone'}</span>
          </div>
          ${isAdmin ? `<button onclick="deleteAnnouncement('${a.id}')" class="lynk-btn lynk-btn-ghost p-1 text-xs flex-shrink-0" style="color:var(--text-muted)" title="Delete">✕</button>` : ''}
        </div>
        <h3 class="font-bold text-base mb-2">${escHtml(a.title||'')}</h3>
        <p class="text-sm mb-3" style="color:var(--text-secondary);white-space:pre-wrap">${escHtml(a.body||'')}</p>
        ${a.link ? `<a href="${escHtml(a.link)}" target="_blank" class="inline-flex items-center gap-1 text-sm lynk-gradient-text font-medium hover:opacity-80 mb-3">🔗 ${escHtml(a.linkLabel||'Learn more')} →</a>` : ''}
        <div class="flex items-center justify-between mt-2 pt-2 border-t" style="border-color:var(--border)">
          <span class="text-xs" style="color:var(--text-muted)">Posted by ${escHtml(a.authorName||'Admin')}</span>
          <span class="text-xs" style="color:var(--text-muted)">${ts}</span>
        </div>
      </div>`);
  });
}

window.postAnnouncement = async () => {
  if (!isAdmin) return;
  const title    = document.getElementById('ann-title').value.trim();
  const body     = document.getElementById('ann-body').value.trim();
  const priority = document.getElementById('ann-priority').value;
  const audience = document.getElementById('ann-audience').value;
  const category = document.getElementById('ann-category').value.trim();
  const link     = document.getElementById('ann-link').value.trim();
  const linkLabel= document.getElementById('ann-link-label').value.trim();

  if (!title || !body) { showToast('Error', 'Title and body are required.', ''); return; }

  const btn = document.getElementById('btn-post-ann');
  btn.disabled = true; btn.textContent = 'Posting...';

  await addDoc(collection(db, 'announcements'), {
    title, body, priority, audience, category, link, linkLabel,
    authorId: currentUser.uid,
    authorName: currentUserData.displayName || 'Admin',
    createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  });

  ['ann-title','ann-body','ann-category','ann-link','ann-link-label'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  btn.disabled = false; btn.textContent = 'Post Announcement';
  showToast('Announcement Posted! 📢', `"${title}" has been published.`, '');
  loadAnnouncements();
};

window.deleteAnnouncement = async (id) => {
  if (!isAdmin || !confirm('Delete this announcement?')) return;
  await deleteDoc(doc(db, 'announcements', id));
  allAnnouncements = allAnnouncements.filter(a => a.id !== id);
  filterAnnouncements();
};

window.cancelEdit = () => {
  ['ann-title','ann-body','ann-category','ann-link','ann-link-label'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
};

window.signOut = async () => {
  await firebaseSignOut(auth);
  window.location.href = 'auth.html';
};

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
