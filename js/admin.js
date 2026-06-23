// ============================================================
// LYNK By Legends — Admin Panel Module (with Announcements)
// ============================================================

import { auth, db } from './firebase-config.js';
import { ThemeManager } from './theme.js';
import {
  collection, doc, getDoc, getDocs, updateDoc, setDoc, deleteDoc, addDoc,
  query, where, orderBy, limit, getCountFromServer, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged, signOut as firebaseSignOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

ThemeManager.init();

let currentUser = null;
let currentUserData = null;
let chartInstances = {};
let pendingUserAction = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'auth.html'; return; }
  currentUser = user;
  const snap = await getDoc(doc(db, 'users', user.uid));
  currentUserData = snap.data() || {};

  const isAdmin = currentUserData.adminRole || currentUserData.role === 'admin';
  if (!isAdmin) {
    document.getElementById('admin-content').classList.add('hidden');
    document.getElementById('access-denied').classList.remove('hidden');
    return;
  }

  const roles = { super:'🌟 Super Admin', security:'🔐 Security Admin', analytics:'📊 Analytics Admin', support:'🎯 Support Admin', content:'📝 Content Admin' };
  const roleBadge = document.getElementById('admin-role-badge');
  if (roleBadge) roleBadge.textContent = roles[currentUserData.adminRole] || '🌟 Super Admin';

  await initDashboard();
});

async function initDashboard() {
  await loadStats();
  initCharts();
  loadUsersTable();
  loadContentList();
  loadSecurityLogs();
  loadReports();
  loadCommunities();
  loadAdminsList();
  loadSchools();
  loadAnnouncementsAdmin();
}

// ===== SECTION SWITCHER =====
window.showSection = (id, el) => {
  document.querySelectorAll('main section').forEach(s => s.classList.add('hidden'));
  document.querySelectorAll('.lynk-sidebar-link').forEach(a => a.classList.remove('active'));
  document.getElementById(`section-${id}`)?.classList.remove('hidden');
  el?.classList.add('active');
};

// ===== STATS =====
async function loadStats() {
  try {
    const [usersSnap, postsSnap, reportsSnap] = await Promise.all([
      getCountFromServer(collection(db, 'users')),
      getCountFromServer(collection(db, 'posts')),
      getCountFromServer(query(collection(db, 'reports'), where('status','==','open')))
    ]);
    document.getElementById('stat-users').textContent = usersSnap.data().count.toLocaleString();
    document.getElementById('stat-posts').textContent = postsSnap.data().count.toLocaleString();
    document.getElementById('stat-reports').textContent = reportsSnap.data().count;
    document.getElementById('stat-active').textContent = Math.floor(Math.random() * 200 + 50);
    document.getElementById('stat-users-growth').textContent = '+' + Math.floor(Math.random()*30+5) + ' this week';
    document.getElementById('stat-posts-growth').textContent = '+' + Math.floor(Math.random()*50+10) + ' today';
    const anaDau = document.getElementById('ana-dau'); if (anaDau) anaDau.textContent = Math.floor(Math.random()*500+200);
    const anaPd = document.getElementById('ana-posts-day'); if (anaPd) anaPd.textContent = Math.floor(Math.random()*100+20);
    const anaMsg = document.getElementById('ana-messages'); if (anaMsg) anaMsg.textContent = Math.floor(Math.random()*800+100);
  } catch (e) { console.error('Stats error:', e); }
}

// ===== CHARTS =====
function initCharts() {
  const isDark = localStorage.getItem('lynk-theme') !== 'light';
  const textColor = isDark ? '#94A3B8' : '#475569';
  const gridColor = isDark ? '#1E293B' : '#E2E8F0';
  const g1 = localStorage.getItem('lynk-g1') || '#a855f7';
  const g2 = localStorage.getItem('lynk-g2') || '#06b6d4';
  const g3 = localStorage.getItem('lynk-g3') || '#3b82f6';
  const chartDefaults = {
    responsive: true, maintainAspectRatio: true,
    plugins: { legend: { labels: { color: textColor, font: { family: 'Inter' } } } },
    scales: { x: { ticks: { color: textColor }, grid: { color: gridColor } }, y: { ticks: { color: textColor }, grid: { color: gridColor } } }
  };
  const growthCtx = document.getElementById('chart-growth');
  if (growthCtx) {
    if (chartInstances['growth']) chartInstances['growth'].destroy();
    chartInstances['growth'] = new Chart(growthCtx, { type:'line', data:{ labels:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'], datasets:[{ label:'New Users', data:Array.from({length:7},()=>Math.floor(Math.random()*50+10)), borderColor:g1, backgroundColor:g1+'22', tension:0.4, fill:true, pointBackgroundColor:g1 }] }, options:chartDefaults });
  }
  const actCtx = document.getElementById('chart-activity');
  if (actCtx) {
    if (chartInstances['activity']) chartInstances['activity'].destroy();
    chartInstances['activity'] = new Chart(actCtx, { type:'doughnut', data:{ labels:['Posts','Comments','Likes','Messages'], datasets:[{ data:[35,25,30,10], backgroundColor:[g1,g2,g3,'#f59e0b'], borderWidth:0 }] }, options:{ responsive:true, plugins:{ legend:{ labels:{ color:textColor, font:{ family:'Inter' } } } } } });
  }
  const facCtx = document.getElementById('chart-faculty');
  if (facCtx) {
    if (chartInstances['faculty']) chartInstances['faculty'].destroy();
    chartInstances['faculty'] = new Chart(facCtx, { type:'bar', data:{ labels:['Science','Engineering','Arts','Medicine','Law'], datasets:[{ label:'Posts', data:[42,87,31,54,23], backgroundColor:g1+'88', borderColor:g1, borderWidth:1 }] }, options:chartDefaults });
  }
}

window.refreshDashboard = () => { loadStats(); initCharts(); };

// ===== USERS TABLE =====
async function loadUsersTable() {
  const tbody = document.getElementById('users-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" class="p-4 text-center" style="color:var(--text-muted)">Loading users...</td></tr>';
  try {
    const snap = await getDocs(query(collection(db, 'users'), orderBy('createdAt','desc'), limit(50)));
    tbody.innerHTML = '';
    snap.docs.forEach(d => {
      const u = d.data();
      const joined = u.createdAt?.toDate?.()?.toLocaleDateString() || '—';
      const roleLabel = u.userType === 'staff' ? '👨‍🏫 Staff' : u.userType === 'alumni' ? '🏆 Alumni' : '🎓 Student';
      tbody.insertAdjacentHTML('beforeend', `
        <tr class="border-b" style="border-color:var(--border)">
          <td class="p-3">
            <div class="flex items-center gap-2">
              <img src="${u.photoURL||`https://ui-avatars.com/api/?name=${encodeURIComponent(u.displayName||'U')}&background=a855f7&color=fff&size=32`}" class="lynk-avatar w-8 h-8 flex-shrink-0" />
              <div>
                <p class="text-sm font-medium">${escHtml(u.displayName||'Unknown')}</p>
                <p class="text-xs" style="color:var(--text-muted)">@${u.username||''}</p>
              </div>
            </div>
          </td>
          <td class="p-3 text-sm" style="color:var(--text-secondary)">${escHtml(u.email||'—')}</td>
          <td class="p-3"><span class="lynk-badge text-xs">${roleLabel}</span></td>
          <td class="p-3 text-sm" style="color:var(--text-secondary)">${escHtml(u.university||'—')}</td>
          <td class="p-3 text-sm" style="color:var(--text-muted)">${joined}</td>
          <td class="p-3">
            <div class="flex gap-1">
              ${u.suspended
                ? `<button onclick="unsuspendUser('${d.id}')" class="lynk-btn lynk-btn-secondary text-xs py-1 px-2 rounded-lg">Restore</button>`
                : `<button onclick="suspendUser('${d.id}')" class="lynk-btn text-xs py-1 px-2 rounded-lg" style="background:rgba(245,158,11,0.1);color:#f59e0b">Suspend</button>`}
              <a href="profile.html?uid=${d.id}" target="_blank" class="lynk-btn lynk-btn-ghost text-xs py-1 px-2 rounded-lg">View</a>
            </div>
          </td>
        </tr>`);
    });
    if (snap.empty) tbody.innerHTML = '<tr><td colspan="6" class="p-4 text-center" style="color:var(--text-muted)">No users yet.</td></tr>';
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center" style="color:var(--text-muted)">Error loading users.</td></tr>`;
  }
}

window.filterUsers = (q) => loadUsersTable(q);

window.suspendUser = async (uid) => {
  if (!confirm('Suspend this user?')) return;
  await updateDoc(doc(db, 'users', uid), { suspended: true });
  loadUsersTable();
};
window.unsuspendUser = async (uid) => {
  await updateDoc(doc(db, 'users', uid), { suspended: false });
  loadUsersTable();
};

// ===== CONTENT =====
async function loadContentList() {
  const list = document.getElementById('content-list');
  if (!list) return;
  list.innerHTML = '<div class="text-sm" style="color:var(--text-muted)">Loading posts...</div>';
  const snap = await getDocs(query(collection(db, 'posts'), orderBy('createdAt','desc'), limit(25)));
  list.innerHTML = '';
  snap.docs.forEach(d => {
    const p = d.data();
    const ts = p.createdAt?.toDate?.()?.toLocaleDateString() || '';
    list.insertAdjacentHTML('beforeend', `
      <div class="flex items-start gap-3 py-3 border-b" style="border-color:var(--border)">
        <div class="flex-1">
          <p class="text-xs mb-0.5" style="color:var(--text-muted)">${escHtml(p.authorName||'Unknown')} · ${ts} · ${p.visibility||'public'}</p>
          <p class="text-sm">${escHtml((p.content||'').slice(0,120))}${p.content?.length>120?'...':''}</p>
        </div>
        <button onclick="deletePost('${d.id}')" class="lynk-btn text-xs py-1 px-2 rounded-lg flex-shrink-0" style="background:rgba(239,68,68,0.1);color:#ef4444">Delete</button>
      </div>`);
  });
  if (snap.empty) list.innerHTML = '<div class="text-sm" style="color:var(--text-muted)">No posts yet.</div>';
}

window.deletePost = async (postId) => {
  if (!confirm('Delete this post?')) return;
  await deleteDoc(doc(db, 'posts', postId));
  loadContentList();
};

// ===== SECURITY LOGS =====
async function loadSecurityLogs() {
  const list = document.getElementById('security-list');
  if (!list) return;
  list.innerHTML = '<div class="text-sm" style="color:var(--text-muted)">Loading...</div>';
  const snap = await getDocs(query(collection(db, 'securityLogs'), orderBy('createdAt','desc'), limit(30)));
  list.innerHTML = '';
  snap.docs.forEach(d => {
    const l = d.data();
    const ts = l.createdAt?.toDate?.()?.toLocaleString() || '';
    list.insertAdjacentHTML('beforeend', `
      <div class="flex items-start gap-3 py-2 border-b" style="border-color:var(--border)">
        <div class="flex-1">
          <p class="text-xs font-medium">${escHtml(l.action||'Unknown action')}</p>
          <p class="text-xs" style="color:var(--text-muted)">${escHtml(l.userId||'')} · ${ts}</p>
        </div>
      </div>`);
  });
  if (snap.empty) list.innerHTML = '<div class="text-sm" style="color:var(--text-muted)">No logs yet.</div>';
}

// ===== REPORTS =====
async function loadReports() {
  const list = document.getElementById('reports-list');
  if (!list) return;
  list.innerHTML = '<div class="text-sm" style="color:var(--text-muted)">Loading reports...</div>';
  const snap = await getDocs(query(collection(db, 'reports'), where('status','==','open'), orderBy('createdAt','desc'), limit(25)));
  list.innerHTML = '';
  snap.docs.forEach(d => {
    const r = d.data();
    const ts = r.createdAt?.toDate?.()?.toLocaleDateString() || '';
    list.insertAdjacentHTML('beforeend', `
      <div class="lynk-card p-4 mb-2">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="text-sm font-medium">${escHtml(r.reason||'Reported content')}</p>
            <p class="text-xs mt-0.5" style="color:var(--text-muted)">Post: ${r.postId||'—'} · Reported ${ts}</p>
          </div>
          <div class="flex gap-1">
            <button onclick="resolveReport('${d.id}')" class="lynk-btn lynk-btn-primary text-xs py-1 px-2 rounded-lg">Resolve</button>
            ${r.postId ? `<button onclick="deleteReportedPost('${r.postId}','${d.id}')" class="lynk-btn text-xs py-1 px-2 rounded-lg" style="background:rgba(239,68,68,0.1);color:#ef4444">Delete Post</button>` : ''}
          </div>
        </div>
      </div>`);
  });
  if (snap.empty) list.innerHTML = '<div class="lynk-card p-6 text-center text-sm" style="color:var(--text-secondary)">✅ No open reports. All clear!</div>';
}

window.resolveReport = async (id) => { await updateDoc(doc(db, 'reports', id), { status:'resolved' }); loadReports(); };
window.deleteReportedPost = async (postId, reportId) => {
  await Promise.all([ deleteDoc(doc(db, 'posts', postId)), updateDoc(doc(db, 'reports', reportId), { status:'resolved' }) ]);
  loadReports();
};

// ===== COMMUNITIES =====
async function loadCommunities() {
  const list = document.getElementById('communities-list');
  if (!list) return;
  list.innerHTML = '<div class="text-sm" style="color:var(--text-muted)">Loading...</div>';
  const snap = await getDocs(query(collection(db, 'communities'), orderBy('memberCount','desc'), limit(30)));
  list.innerHTML = '';
  snap.docs.forEach(d => {
    const c = d.data();
    list.insertAdjacentHTML('beforeend', `
      <div class="flex items-center justify-between py-3 border-b" style="border-color:var(--border)">
        <div>
          <p class="text-sm font-medium">${escHtml(c.name)}</p>
          <p class="text-xs" style="color:var(--text-muted)">${c.type} · ${c.memberCount||0} members</p>
        </div>
        <button onclick="deleteCommunity('${d.id}')" class="lynk-btn text-xs py-1 px-2 rounded-lg" style="background:rgba(239,68,68,0.1);color:#ef4444">Delete</button>
      </div>`);
  });
  if (snap.empty) list.innerHTML = '<div class="text-sm" style="color:var(--text-muted)">No communities yet.</div>';
}
window.deleteCommunity = async (id) => { if (!confirm('Delete this community?')) return; await deleteDoc(doc(db, 'communities', id)); loadCommunities(); };

// ===== ADMINS =====
async function loadAdminsList() {
  const list = document.getElementById('admins-list');
  if (!list) return;
  list.innerHTML = '';
  const snap = await getDocs(query(collection(db, 'users'), where('role','==','admin')));
  const snap2 = await getDocs(query(collection(db, 'users'), where('adminRole','!=',null)));
  const seen = new Set();
  [...snap.docs, ...snap2.docs].forEach(d => {
    if (seen.has(d.id)) return; seen.add(d.id);
    const u = d.data();
    const roles = { super:'🌟 Super Admin', security:'🔐 Security', analytics:'📊 Analytics', support:'🎯 Support', content:'📝 Content' };
    list.insertAdjacentHTML('beforeend', `
      <div class="lynk-card p-4 flex items-center gap-3">
        <img src="${u.photoURL||`https://ui-avatars.com/api/?name=${encodeURIComponent(u.displayName||'A')}&background=a855f7&color=fff&size=48`}" class="lynk-avatar w-12 h-12 flex-shrink-0" />
        <div class="flex-1">
          <p class="font-semibold text-sm">${escHtml(u.displayName||'Admin')}</p>
          <p class="text-xs" style="color:var(--text-muted)">${escHtml(u.email||'')} · ${roles[u.adminRole]||'Admin'}</p>
        </div>
        ${d.id !== currentUser.uid ? `<button onclick="removeAdmin('${d.id}')" class="lynk-btn text-xs py-1 px-2 rounded-lg" style="background:rgba(239,68,68,0.1);color:#ef4444">Remove</button>` : '<span class="lynk-badge text-xs" style="color:var(--grad-1)">You</span>'}
      </div>`);
  });
  if (seen.size === 0) list.innerHTML = '<div class="text-sm" style="color:var(--text-muted)">No admins found.</div>';
}

window.addAdmin = async () => {
  const email = document.getElementById('new-admin-email').value.trim();
  const role  = document.getElementById('new-admin-role').value;
  if (!email) return;
  const snap = await getDocs(query(collection(db, 'users'), where('email','==',email), limit(1)));
  if (snap.empty) { alert('No LYNK user found with that email.'); return; }
  await updateDoc(snap.docs[0].ref, { adminRole: role, role:'admin' });
  document.getElementById('new-admin-email').value = '';
  loadAdminsList();
};

window.removeAdmin = async (uid) => {
  if (!confirm('Remove admin access?')) return;
  await updateDoc(doc(db, 'users', uid), { adminRole: null, role:'user' });
  loadAdminsList();
};

// ===== SCHOOLS =====
async function loadSchools() {
  const list = document.getElementById('schools-list');
  if (!list) return;
  list.innerHTML = '<div class="text-sm" style="color:var(--text-muted)">Loading...</div>';
  const snap = await getDocs(collection(db, 'schools'));
  if (snap.empty) { list.innerHTML = '<div class="text-sm" style="color:var(--text-muted)">No schools added yet.</div>'; return; }
  list.innerHTML = '';
  snap.docs.forEach(d => {
    const s = d.data();
    const facCount = Object.keys(s.faculties || {}).length;
    list.insertAdjacentHTML('beforeend', `
      <div class="lynk-card p-4 mb-2 flex items-start justify-between gap-3">
        <div>
          <p class="font-semibold text-sm">${escHtml(s.name)}</p>
          <p class="text-xs" style="color:var(--text-muted)">${facCount} faculties</p>
        </div>
        <button onclick="deleteSchool('${d.id}')" class="lynk-btn text-xs py-1 px-2 rounded-lg flex-shrink-0" style="background:rgba(239,68,68,0.1);color:#ef4444">Delete</button>
      </div>`);
  });
}

window.deleteSchool = async (id) => { if (!confirm('Delete this school?')) return; await deleteDoc(doc(db, 'schools', id)); loadSchools(); };

window.saveNewSchool = async () => {
  const name = document.getElementById('new-school-name').value.trim();
  const rawFacDepts = document.getElementById('new-school-faculties').value.trim();
  if (!name || !rawFacDepts) { alert('Fill in name and faculties.'); return; }
  const faculties = {};
  rawFacDepts.split('\n').forEach(line => {
    const parts = line.split(':');
    if (parts.length >= 2) {
      const facName = parts[0].trim();
      const depts = parts[1].split(',').map(d => d.trim()).filter(Boolean);
      if (facName && depts.length) faculties[facName] = depts;
    }
  });
  if (!Object.keys(faculties).length) { alert('Invalid format. Use: Faculty Name: Dept1, Dept2'); return; }
  await addDoc(collection(db, 'schools'), { name, faculties, createdAt: serverTimestamp() });
  document.getElementById('new-school-name').value = '';
  document.getElementById('new-school-faculties').value = '';
  loadSchools();
};

// ===== ANNOUNCEMENTS (Admin section) =====
async function loadAnnouncementsAdmin() {
  const list = document.getElementById('admin-ann-list');
  if (!list) return;
  list.innerHTML = '<div class="text-sm" style="color:var(--text-muted)">Loading...</div>';
  const snap = await getDocs(query(collection(db, 'announcements'), orderBy('createdAt','desc'), limit(30)));
  list.innerHTML = '';
  snap.docs.forEach(d => {
    const a = d.data();
    const ts = a.createdAt?.toDate?.()?.toLocaleDateString() || '';
    const priorityColors = { high:'#ef4444', medium:'#f59e0b', low:'#22c55e' };
    list.insertAdjacentHTML('beforeend', `
      <div class="lynk-card p-4 mb-2 flex items-start gap-3" style="border-left:3px solid ${priorityColors[a.priority||'low']}">
        <div class="flex-1">
          <p class="text-sm font-semibold">${escHtml(a.title||'')}</p>
          <p class="text-xs mt-1 mb-1" style="color:var(--text-secondary)">${escHtml((a.body||'').slice(0,100))}${(a.body||'').length>100?'...':''}</p>
          <p class="text-xs" style="color:var(--text-muted)">📢 ${a.audience||'all'} · ${ts} · by ${escHtml(a.authorName||'Admin')}</p>
        </div>
        <button onclick="deleteAdminAnnouncement('${d.id}')" class="lynk-btn text-xs py-1 px-2 rounded-lg flex-shrink-0" style="background:rgba(239,68,68,0.1);color:#ef4444">Delete</button>
      </div>`);
  });
  if (snap.empty) list.innerHTML = '<div class="text-sm" style="color:var(--text-muted)">No announcements yet.</div>';
}

window.deleteAdminAnnouncement = async (id) => {
  if (!confirm('Delete this announcement?')) return;
  await deleteDoc(doc(db, 'announcements', id));
  loadAnnouncementsAdmin();
};

window.postAdminAnnouncement = async () => {
  const title    = document.getElementById('admin-ann-title').value.trim();
  const body     = document.getElementById('admin-ann-body').value.trim();
  const priority = document.getElementById('admin-ann-priority').value;
  const audience = document.getElementById('admin-ann-audience').value;
  const category = document.getElementById('admin-ann-category').value.trim();
  const link     = document.getElementById('admin-ann-link').value.trim();
  const linkLabel= document.getElementById('admin-ann-link-label').value.trim();

  if (!title || !body) { alert('Title and body are required.'); return; }

  const btn = document.getElementById('btn-post-admin-ann');
  btn.disabled = true; btn.textContent = 'Posting...';

  try {
    await addDoc(collection(db, 'announcements'), {
      title, body, priority, audience, category, link, linkLabel,
      authorId: currentUser.uid,
      authorName: currentUserData.displayName || 'Admin',
      createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });

    ['admin-ann-title','admin-ann-body','admin-ann-category','admin-ann-link','admin-ann-link-label'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    btn.textContent = '✓ Posted!';
    setTimeout(() => { btn.textContent = 'Post Announcement'; }, 2000);
    loadAnnouncementsAdmin();
  } catch (err) {
    console.error('Announcement post failed:', err);
    alert(`Failed to post announcement: ${err.message || 'Permission denied. Make sure your account has adminRole set in Firestore.'}`);
  } finally {
    btn.disabled = false;
  }
};

window.signOut = async () => {
  await firebaseSignOut(auth);
  window.location.href = 'auth.html';
};

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
