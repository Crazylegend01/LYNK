// ============================================================
// LYNK By Legends — Admin Panel Module
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
let _editSchoolId = null;

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

  const roles = { super:'Super Admin', security:'Security Admin', analytics:'Analytics Admin', support:'Support Admin', content:'Content Admin' };
  const roleBadge = document.getElementById('admin-role-badge');
  if (roleBadge) roleBadge.textContent = roles[currentUserData.adminRole] || 'Super Admin';

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

// ===== STATS — real data =====
async function loadStats() {
  try {
    const [usersSnap, postsSnap, reportsSnap, onlineSnap] = await Promise.all([
      getCountFromServer(collection(db, 'users')),
      getCountFromServer(collection(db, 'posts')),
      getCountFromServer(query(collection(db, 'reports'), where('status','==','open'))),
      getCountFromServer(query(collection(db, 'users'), where('isOnline','==',true)))
    ]);

    const totalUsers = usersSnap.data().count;
    const totalPosts = postsSnap.data().count;
    const openReports = reportsSnap.data().count;
    const onlineNow = onlineSnap.data().count;

    document.getElementById('stat-users').textContent = totalUsers.toLocaleString();
    document.getElementById('stat-posts').textContent = totalPosts.toLocaleString();
    document.getElementById('stat-reports').textContent = openReports;
    document.getElementById('stat-active').textContent = onlineNow;

    // Recent growth counts
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    try {
      const [newUsersSnap, newPostsSnap] = await Promise.all([
        getCountFromServer(query(collection(db, 'users'), where('createdAt','>=',weekAgo))),
        getCountFromServer(query(collection(db, 'posts'), where('createdAt','>=',dayAgo)))
      ]);
      document.getElementById('stat-users-growth').textContent = `+${newUsersSnap.data().count} this week`;
      document.getElementById('stat-posts-growth').textContent = `+${newPostsSnap.data().count} today`;

      const anaDau = document.getElementById('ana-dau');
      if (anaDau) anaDau.textContent = onlineNow;

      const anaPd = document.getElementById('ana-posts-day');
      if (anaPd) anaPd.textContent = newPostsSnap.data().count;

      const anaMsg = document.getElementById('ana-messages');
      if (anaMsg) {
        const msgSnap = await getCountFromServer(query(collection(db, 'conversations')));
        anaMsg.textContent = msgSnap.data().count;
      }
    } catch (e) {
      document.getElementById('stat-users-growth').textContent = 'this week';
      document.getElementById('stat-posts-growth').textContent = 'today';
    }
  } catch (e) {
    console.error('Stats error:', e);
  }
}

// ===== CHARTS =====
function initCharts() {
  const isDark = localStorage.getItem('lynk-theme') !== 'light';
  const textColor = isDark ? '#94A3B8' : '#475569';
  const gridColor = isDark ? '#1E293B' : '#E2E8F0';
  const g1 = getComputedStyle(document.documentElement).getPropertyValue('--grad-1').trim() || '#a855f7';
  const g2 = getComputedStyle(document.documentElement).getPropertyValue('--grad-2').trim() || '#06b6d4';
  const g3 = getComputedStyle(document.documentElement).getPropertyValue('--grad-3').trim() || '#3b82f6';
  const chartDefaults = {
    responsive: true, maintainAspectRatio: true,
    plugins: { legend: { labels: { color: textColor, font: { family: 'Inter' } } } },
    scales: { x: { ticks: { color: textColor }, grid: { color: gridColor } }, y: { ticks: { color: textColor }, grid: { color: gridColor } } }
  };

  // User growth chart — use real data days of week label
  const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const today = new Date().getDay();
  const orderedDays = [...days.slice(today), ...days.slice(0, today)];

  const growthCtx = document.getElementById('chart-growth');
  if (growthCtx) {
    if (chartInstances['growth']) chartInstances['growth'].destroy();
    chartInstances['growth'] = new Chart(growthCtx, {
      type:'line',
      data:{ labels: orderedDays, datasets:[{ label:'New Users', data:[0,0,0,0,0,0,0], borderColor:g1, backgroundColor:g1+'22', tension:0.4, fill:true, pointBackgroundColor:g1 }] },
      options:chartDefaults
    });
    // Load real data
    loadGrowthData(g1).then(data => {
      if (chartInstances['growth']) {
        chartInstances['growth'].data.datasets[0].data = data;
        chartInstances['growth'].update();
      }
    });
  }

  const actCtx = document.getElementById('chart-activity');
  if (actCtx) {
    if (chartInstances['activity']) chartInstances['activity'].destroy();
    chartInstances['activity'] = new Chart(actCtx, {
      type:'doughnut',
      data:{ labels:['Posts','Comments','Likes','Messages'], datasets:[{ data:[0,0,0,0], backgroundColor:[g1,g2,g3,'#f59e0b'], borderWidth:0 }] },
      options:{ responsive:true, plugins:{ legend:{ labels:{ color:textColor, font:{ family:'Inter' } } } } }
    });
    loadActivityData().then(data => {
      if (chartInstances['activity']) {
        chartInstances['activity'].data.datasets[0].data = data;
        chartInstances['activity'].update();
      }
    });
  }

  const facCtx = document.getElementById('chart-faculty');
  if (facCtx) {
    if (chartInstances['faculty']) chartInstances['faculty'].destroy();
    chartInstances['faculty'] = new Chart(facCtx, {
      type:'bar',
      data:{ labels:[], datasets:[{ label:'Posts', data:[], backgroundColor:g1+'88', borderColor:g1, borderWidth:1 }] },
      options:chartDefaults
    });
    loadFacultyData().then(({ labels, data }) => {
      if (chartInstances['faculty']) {
        chartInstances['faculty'].data.labels = labels;
        chartInstances['faculty'].data.datasets[0].data = data;
        chartInstances['faculty'].update();
      }
    });
  }
}

async function loadGrowthData(color) {
  try {
    const data = [];
    for (let i = 6; i >= 0; i--) {
      const start = new Date(); start.setDate(start.getDate() - i); start.setHours(0,0,0,0);
      const end = new Date(start); end.setHours(23,59,59,999);
      try {
        const snap = await getCountFromServer(query(collection(db, 'users'), where('createdAt','>=',start), where('createdAt','<=',end)));
        data.push(snap.data().count);
      } catch { data.push(0); }
    }
    return data;
  } catch { return [0,0,0,0,0,0,0]; }
}

async function loadActivityData() {
  try {
    const [postsSnap, commentsSnap, likesSnap, msgsSnap] = await Promise.all([
      getCountFromServer(collection(db, 'posts')),
      getCountFromServer(collection(db, 'users')), // placeholder
      getCountFromServer(collection(db, 'reports')),
      getCountFromServer(collection(db, 'conversations'))
    ]);
    return [postsSnap.data().count, 0, 0, msgsSnap.data().count];
  } catch { return [35, 25, 30, 10]; }
}

async function loadFacultyData() {
  try {
    const snap = await getDocs(query(collection(db, 'posts'), orderBy('createdAt','desc'), limit(200)));
    const counts = {};
    snap.docs.forEach(d => {
      const fac = d.data().faculty || 'Unknown';
      counts[fac] = (counts[fac] || 0) + 1;
    });
    const sorted = Object.entries(counts).sort((a,b) => b[1]-a[1]).slice(0, 7);
    return { labels: sorted.map(x => x[0]), data: sorted.map(x => x[1]) };
  } catch { return { labels:[], data:[] }; }
}

window.refreshDashboard = () => { loadStats(); initCharts(); };

// ===== USERS TABLE =====
let _allUsers = [];

async function loadUsersTable(filterQuery = '') {
  const tbody = document.getElementById('users-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" class="p-4 text-center" style="color:var(--text-muted)">Loading users...</td></tr>';
  try {
    const snap = await getDocs(query(collection(db, 'users'), orderBy('createdAt','desc'), limit(100)));
    _allUsers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderUsersTable(_allUsers, filterQuery);
    if (snap.empty) tbody.innerHTML = '<tr><td colspan="6" class="p-4 text-center" style="color:var(--text-muted)">No users yet.</td></tr>';
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center" style="color:var(--text-muted)">Error loading users.</td></tr>`;
  }
}

function renderUsersTable(users, filter = '') {
  const tbody = document.getElementById('users-tbody');
  if (!tbody) return;
  const filtered = filter ? users.filter(u =>
    (u.displayName||'').toLowerCase().includes(filter.toLowerCase()) ||
    (u.email||'').toLowerCase().includes(filter.toLowerCase()) ||
    (u.university||'').toLowerCase().includes(filter.toLowerCase())
  ) : users;

  tbody.innerHTML = '';
  filtered.forEach(u => {
    const joined = u.createdAt?.toDate?.()?.toLocaleDateString() || '—';
    const roleLabel = u.userType === 'staff' ? 'Staff' : u.userType === 'alumni' ? 'Alumni' : 'Student';
    const statusDot = u.isOnline
      ? '<span class="inline-block w-2 h-2 rounded-full bg-green-500 mr-1"></span>Online'
      : '<span class="inline-block w-2 h-2 rounded-full bg-gray-500 mr-1"></span>' + (u.suspended ? 'Suspended' : 'Offline');
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
        <td class="p-3"><span class="lynk-badge text-xs" style="background:var(--bg-card-hover)">${roleLabel}</span></td>
        <td class="p-3 text-sm" style="color:var(--text-secondary)">${escHtml(u.university||'—')}</td>
        <td class="p-3">
          <span class="text-xs flex items-center" style="color:var(--text-muted)">${statusDot}</span>
          <span class="text-xs" style="color:var(--text-muted)">${joined}</span>
        </td>
        <td class="p-3">
          <div class="flex gap-1 flex-wrap">
            ${u.suspended
              ? `<button onclick="unsuspendUser('${u.id}')" class="lynk-btn lynk-btn-secondary text-xs py-1 px-2 rounded-lg">Restore</button>`
              : `<button onclick="suspendUser('${u.id}')" class="lynk-btn text-xs py-1 px-2 rounded-lg" style="background:rgba(245,158,11,0.1);color:#f59e0b">Suspend</button>`}
            <a href="profile.html?uid=${u.id}" target="_blank" class="lynk-btn lynk-btn-ghost text-xs py-1 px-2 rounded-lg">View</a>
          </div>
        </td>
      </tr>`);
  });
  if (filtered.length === 0) tbody.innerHTML = '<tr><td colspan="6" class="p-4 text-center" style="color:var(--text-muted)">No users match your search.</td></tr>';
}

window.filterUsers = (q) => renderUsersTable(_allUsers, q);

window.suspendUser = async (uid) => {
  if (!confirm('Suspend this user? They will not be able to log in.')) return;
  try {
    await updateDoc(doc(db, 'users', uid), { suspended: true, isOnline: false });
    loadUsersTable();
  } catch (e) { alert('Error: ' + e.message); }
};
window.unsuspendUser = async (uid) => {
  try {
    await updateDoc(doc(db, 'users', uid), { suspended: false });
    loadUsersTable();
  } catch (e) { alert('Error: ' + e.message); }
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
        <button onclick="adminDeletePost('${d.id}')" class="lynk-btn text-xs py-1 px-2 rounded-lg flex-shrink-0" style="background:rgba(239,68,68,0.1);color:#ef4444">Delete</button>
      </div>`);
  });
  if (snap.empty) list.innerHTML = '<div class="text-sm" style="color:var(--text-muted)">No posts yet.</div>';
}

window.adminDeletePost = async (postId) => {
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
  if (snap.empty) list.innerHTML = '<div class="text-sm" style="color:var(--text-muted)">No security logs yet.</div>';
}

// ===== REPORTS =====
async function loadReports() {
  const list = document.getElementById('reports-list');
  if (!list) return;
  list.innerHTML = '<div class="text-sm" style="color:var(--text-muted)">Loading reports...</div>';
  try {
    const snap = await getDocs(query(collection(db, 'reports'), where('status','==','open'), orderBy('createdAt','desc'), limit(25)));
    list.innerHTML = '';
    if (snap.empty) {
      list.innerHTML = '<div class="lynk-card p-6 text-center text-sm" style="color:var(--text-secondary)">No open reports. All clear!</div>';
      return;
    }
    for (const d of snap.docs) {
      const r = d.data();
      const ts = r.createdAt?.toDate?.()?.toLocaleDateString() || '';
      // Fetch the reported post content if possible
      let postPreview = '';
      if (r.postId) {
        try {
          const pSnap = await getDoc(doc(db, 'posts', r.postId));
          if (pSnap.exists()) {
            postPreview = (pSnap.data().content || '').slice(0, 80);
          }
        } catch {}
      }
      // Fetch reporter name
      let reporterName = r.reportedBy || '—';
      if (r.reportedBy) {
        try {
          const uSnap = await getDoc(doc(db, 'users', r.reportedBy));
          if (uSnap.exists()) reporterName = uSnap.data().displayName || r.reportedBy;
        } catch {}
      }
      list.insertAdjacentHTML('beforeend', `
        <div class="lynk-card p-4 mb-2">
          <div class="flex items-start justify-between gap-3">
            <div class="flex-1">
              <p class="text-sm font-medium">${escHtml(r.reason||'User reported content')}</p>
              ${postPreview ? `<p class="text-xs mt-1 p-2 rounded-lg" style="background:var(--bg-card-hover);color:var(--text-secondary)">"${escHtml(postPreview)}..."</p>` : ''}
              <p class="text-xs mt-1" style="color:var(--text-muted)">
                Reported by: ${escHtml(reporterName)} · ${ts}
                ${r.postId ? ` · Post ID: ${r.postId.slice(0,8)}...` : ''}
              </p>
            </div>
            <div class="flex gap-1 flex-shrink-0">
              <button onclick="resolveReport('${d.id}')" class="lynk-btn lynk-btn-primary text-xs py-1 px-2 rounded-lg">Resolve</button>
              ${r.postId ? `<button onclick="deleteReportedPost('${r.postId}','${d.id}')" class="lynk-btn text-xs py-1 px-2 rounded-lg" style="background:rgba(239,68,68,0.1);color:#ef4444">Delete Post</button>` : ''}
            </div>
          </div>
        </div>`);
    }
  } catch (e) {
    list.innerHTML = `<div class="lynk-card p-4 text-sm" style="color:var(--text-muted)">Error loading reports: ${e.message}</div>`;
  }
}

window.resolveReport = async (id) => { await updateDoc(doc(db, 'reports', id), { status:'resolved' }); loadReports(); };
window.deleteReportedPost = async (postId, reportId) => {
  if (!confirm('Delete this post?')) return;
  await Promise.all([ deleteDoc(doc(db, 'posts', postId)), updateDoc(doc(db, 'reports', reportId), { status:'resolved' }) ]);
  loadReports();
};

// ===== COMMUNITIES =====
async function loadCommunities() {
  const list = document.getElementById('communities-list');
  if (!list) return;
  list.innerHTML = '<div class="text-sm" style="color:var(--text-muted)">Loading...</div>';
  try {
    const snap = await getDocs(collection(db, 'communities'));
    list.innerHTML = '';
    if (snap.empty) { list.innerHTML = '<div class="text-sm" style="color:var(--text-muted)">No communities yet.</div>'; return; }
    snap.docs.forEach(d => {
      const c = d.data();
      list.insertAdjacentHTML('beforeend', `
        <div class="flex items-center justify-between py-3 border-b" style="border-color:var(--border)">
          <div>
            <p class="text-sm font-medium">${escHtml(c.name||'Unnamed')}</p>
            <p class="text-xs" style="color:var(--text-muted)">${c.type||'community'} · ${c.memberCount||0} members · ${c.university||''}</p>
          </div>
          <button onclick="deleteCommunity('${d.id}')" class="lynk-btn text-xs py-1 px-2 rounded-lg" style="background:rgba(239,68,68,0.1);color:#ef4444">Delete</button>
        </div>`);
    });
  } catch (e) {
    list.innerHTML = `<div class="text-sm" style="color:var(--text-muted)">Error: ${e.message}</div>`;
  }
}

window.deleteCommunity = async (id) => {
  if (!confirm('Delete this community? This cannot be undone.')) return;
  try {
    await deleteDoc(doc(db, 'communities', id));
    loadCommunities();
  } catch (e) { alert('Error deleting community: ' + e.message); }
};

// ===== ADMINS =====
async function loadAdminsList() {
  const list = document.getElementById('admins-list');
  if (!list) return;
  list.innerHTML = '<div style="color:var(--text-muted)">Loading...</div>';
  const snap = await getDocs(query(collection(db, 'users'), where('role','==','admin')));
  const snap2 = await getDocs(query(collection(db, 'users'), where('adminRole','!=',null)));
  const seen = new Set();
  const adminUsers = [];
  [...snap.docs, ...snap2.docs].forEach(d => {
    if (seen.has(d.id)) return; seen.add(d.id);
    adminUsers.push({ id: d.id, ...d.data() });
  });

  const roleLabels = { super:'Super Admin', security:'Security Admin', analytics:'Analytics Admin', support:'Support Admin', content:'Content Admin' };
  list.innerHTML = '';
  adminUsers.forEach(u => {
    list.insertAdjacentHTML('beforeend', `
      <div class="lynk-card p-4 flex items-center gap-3">
        <img src="${u.photoURL||`https://ui-avatars.com/api/?name=${encodeURIComponent(u.displayName||'A')}&background=a855f7&color=fff&size=48`}" class="lynk-avatar w-12 h-12 flex-shrink-0" />
        <div class="flex-1">
          <p class="font-semibold text-sm">${escHtml(u.displayName||'Admin')}</p>
          <p class="text-xs" style="color:var(--text-muted)">${escHtml(u.email||'')} · ${roleLabels[u.adminRole]||'Admin'}</p>
        </div>
        ${u.id !== currentUser.uid
          ? `<button onclick="removeAdmin('${u.id}')" class="lynk-btn text-xs py-1 px-2 rounded-lg" style="background:rgba(239,68,68,0.1);color:#ef4444">Remove</button>`
          : '<span class="lynk-badge text-xs lynk-gradient-text">You</span>'}
      </div>`);
  });
  if (seen.size === 0) list.innerHTML = '<div class="text-sm" style="color:var(--text-muted)">No admins found.</div>';
}

// Works for both inline form and modal form
window.addAdmin = async () => {
  // Only super admins may grant admin roles
  const callerRole = currentUserData.adminRole;
  const callerIsSuper = callerRole === 'super' || (currentUserData.role === 'admin' && !callerRole);
  if (!callerIsSuper) {
    alert('Only Super Admins can grant admin roles to other users.\n\nIf you are the main admin, make sure your Firestore user document has adminRole = "super" set. You can set this directly in the Firebase Console → Firestore → users → your UID → Edit adminRole field.');
    return;
  }

  const emailEl = document.getElementById('new-admin-email-modal') || document.getElementById('new-admin-email');
  const roleEl  = document.getElementById('new-admin-role-modal')  || document.getElementById('new-admin-role');
  const email = emailEl?.value?.trim();
  const role  = roleEl?.value || 'content';
  if (!email) { alert('Please enter an email address.'); return; }

  try {
    const snap = await getDocs(query(collection(db, 'users'), where('email','==',email), limit(1)));
    if (snap.empty) { alert('No LYNK user found with that email. Make sure they have signed up on LYNK first.'); return; }

    await updateDoc(snap.docs[0].ref, { adminRole: role, role: 'admin' });
    if (emailEl) emailEl.value = '';
    document.getElementById('grant-admin-modal')?.classList.add('hidden');
    loadAdminsList();
    alert(`✅ Admin role (${role}) granted to ${email}`);
  } catch (err) {
    console.error('addAdmin error:', err);
    if (err.code === 'permission-denied') {
      alert('❌ Permission denied.\n\nTo fix this:\n1. Open Firebase Console → Firestore\n2. Find your user document (users → your UID)\n3. Set the field: adminRole = "super"\n4. Reload the admin panel and try again.');
    } else {
      alert(`❌ Failed: ${err.message}`);
    }
  }
};

window.removeAdmin = async (uid) => {
  const callerRole = currentUserData.adminRole;
  const callerIsSuper = callerRole === 'super' || (currentUserData.role === 'admin' && !callerRole);
  if (!callerIsSuper) { alert('Only Super Admins can remove admin access.'); return; }
  if (!confirm('Remove this user\'s admin access?')) return;
  try {
    await updateDoc(doc(db, 'users', uid), { adminRole: null, role: 'user' });
    loadAdminsList();
  } catch (err) {
    alert(`❌ Failed: ${err.message}`);
  }
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
    const facList = Object.entries(s.faculties || {}).map(([name, depts]) =>
      `<div class="text-xs py-1 border-b" style="border-color:var(--border)"><strong>${escHtml(name)}</strong>: ${escHtml(depts.join(', '))}</div>`
    ).join('');
    list.insertAdjacentHTML('beforeend', `
      <div class="lynk-card p-4 mb-3" id="school-card-${d.id}">
        <div class="flex items-start justify-between gap-3 mb-2">
          <div>
            <p class="font-semibold">${escHtml(s.name)}</p>
            <p class="text-xs" style="color:var(--text-muted)">${facCount} faculties</p>
          </div>
          <div class="flex gap-1 flex-shrink-0">
            <button onclick="openEditSchool('${d.id}')" class="lynk-btn lynk-btn-secondary text-xs py-1 px-2 rounded-lg">Edit</button>
            <button onclick="deleteSchool('${d.id}')" class="lynk-btn text-xs py-1 px-2 rounded-lg" style="background:rgba(239,68,68,0.1);color:#ef4444">Delete</button>
          </div>
        </div>
        <div class="text-xs mt-2 pl-2 border-l-2" style="border-color:var(--grad-1);max-height:100px;overflow-y:auto">${facList}</div>
      </div>`);
  });
}

window.openEditSchool = async (schoolId) => {
  const snap = await getDoc(doc(db, 'schools', schoolId));
  if (!snap.exists()) return;
  const s = snap.data();
  _editSchoolId = schoolId;

  const facText = Object.entries(s.faculties || {})
    .map(([name, depts]) => `${name}: ${depts.join(', ')}`)
    .join('\n');

  document.getElementById('edit-school-name').value = s.name || '';
  document.getElementById('edit-school-faculties').value = facText;
  document.getElementById('edit-school-modal').classList.remove('hidden');
};

window.saveEditSchool = async () => {
  if (!_editSchoolId) return;
  const name = document.getElementById('edit-school-name').value.trim();
  const rawFacDepts = document.getElementById('edit-school-faculties').value.trim();
  if (!name || !rawFacDepts) { alert('Fill in name and faculties.'); return; }

  const faculties = {};
  rawFacDepts.split('\n').forEach(line => {
    const parts = line.split(':');
    if (parts.length >= 2) {
      const facName = parts[0].trim();
      const depts = parts.slice(1).join(':').split(',').map(d => d.trim()).filter(Boolean);
      if (facName && depts.length) faculties[facName] = depts;
    }
  });
  if (!Object.keys(faculties).length) { alert('Invalid format. Use: Faculty Name: Dept1, Dept2'); return; }

  await updateDoc(doc(db, 'schools', _editSchoolId), { name, faculties });
  document.getElementById('edit-school-modal').classList.add('hidden');
  _editSchoolId = null;
  loadSchools();
};

window.deleteSchool = async (id) => {
  if (!confirm('Delete this school and all its faculty/department data?')) return;
  await deleteDoc(doc(db, 'schools', id));
  loadSchools();
};

window.saveNewSchool = async () => {
  const name = document.getElementById('new-school-name').value.trim();
  const rawFacDepts = document.getElementById('new-school-faculties').value.trim();
  if (!name || !rawFacDepts) { alert('Fill in name and faculties.'); return; }
  const faculties = {};
  rawFacDepts.split('\n').forEach(line => {
    const parts = line.split(':');
    if (parts.length >= 2) {
      const facName = parts[0].trim();
      const depts = parts.slice(1).join(':').split(',').map(d => d.trim()).filter(Boolean);
      if (facName && depts.length) faculties[facName] = depts;
    }
  });
  if (!Object.keys(faculties).length) { alert('Invalid format. Use: Faculty Name: Dept1, Dept2'); return; }
  await addDoc(collection(db, 'schools'), { name, faculties, createdAt: serverTimestamp() });
  document.getElementById('new-school-name').value = '';
  document.getElementById('new-school-faculties').value = '';
  document.getElementById('add-school-modal').classList.add('hidden');
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
          <p class="text-xs" style="color:var(--text-muted)">${a.audience||'all'} · ${ts} · by ${escHtml(a.authorName||'Admin')}</p>
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
    btn.textContent = 'Posted!';
    setTimeout(() => { btn.textContent = 'Post Announcement'; }, 2000);
    loadAnnouncementsAdmin();
  } catch (err) {
    alert(`Failed: ${err.message || 'Check your admin permissions in Firestore.'}`);
  } finally {
    btn.disabled = false;
  }
};

window.signOut = async () => {
  await firebaseSignOut(auth);
  window.location.href = 'auth.html';
};

function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
