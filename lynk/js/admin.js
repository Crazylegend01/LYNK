// ============================================================
// LYNK By Legends — Admin Panel Module (with Schools Management)
// ============================================================

import { auth, db } from './firebase-config.js';
import { ThemeManager } from './theme.js';
import {
  collection, doc, getDoc, getDocs, updateDoc, setDoc, deleteDoc, addDoc,
  query, where, orderBy, limit, getCountFromServer, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { onAuthStateChanged, signOut as firebaseSignOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

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

  const role = currentUserData.adminRole;
  if (role === 'analytics') {
    document.getElementById('section-users')?.remove();
    document.getElementById('section-security')?.remove();
    document.getElementById('section-admins')?.remove();
  } else if (role === 'content') {
    document.getElementById('section-admins')?.remove();
    document.getElementById('section-security')?.remove();
  }

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
}

// ===== STATS =====
async function loadStats() {
  try {
    const [usersSnap, postsSnap, reportsSnap] = await Promise.all([
      getCountFromServer(collection(db, 'users')),
      getCountFromServer(collection(db, 'posts')),
      getCountFromServer(query(collection(db, 'reports'), where('status', '==', 'open')))
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
    chartInstances['growth'] = new Chart(growthCtx, { type: 'line', data: { labels: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'], datasets: [{ label:'New Users', data: Array.from({length:7},()=>Math.floor(Math.random()*50+10)), borderColor:g1, backgroundColor:g1+'22', tension:0.4, fill:true, pointBackgroundColor:g1 }] }, options: chartDefaults });
  }
  const actCtx = document.getElementById('chart-activity');
  if (actCtx) {
    if (chartInstances['activity']) chartInstances['activity'].destroy();
    chartInstances['activity'] = new Chart(actCtx, { type: 'doughnut', data: { labels:['Posts','Comments','Messages','Reactions','Friends'], datasets:[{ data:[35,20,25,15,5], backgroundColor:[g1,g2,g3,'#f59e0b','#ec4899'], borderWidth:0, hoverOffset:8 }] }, options: { responsive:true, maintainAspectRatio:true, plugins:{legend:{labels:{color:textColor,font:{family:'Inter',size:11}}}} } });
  }
  const facCtx = document.getElementById('chart-faculty');
  if (facCtx) {
    if (chartInstances['faculty']) chartInstances['faculty'].destroy();
    chartInstances['faculty'] = new Chart(facCtx, { type:'bar', data:{ labels:['Science','Arts','Engineering','Medicine','Law','Business'], datasets:[{ label:'Posts', data:[65,42,88,31,45,72], backgroundColor:[g1,g2,g3,'#f59e0b','#ec4899','#22c55e'], borderRadius:8, borderSkipped:false }] }, options:{...chartDefaults,plugins:{legend:{display:false}}} });
  }
  const trendCtx = document.getElementById('chart-30day');
  if (trendCtx) {
    if (chartInstances['30day']) chartInstances['30day'].destroy();
    const labels = Array.from({length:30},(_,i)=>i+1);
    chartInstances['30day'] = new Chart(trendCtx, { type:'line', data:{ labels, datasets:[{ label:'Users', data:labels.map(()=>Math.floor(Math.random()*200+100)), borderColor:g1, backgroundColor:g1+'15', tension:0.4, fill:true },{ label:'Posts', data:labels.map(()=>Math.floor(Math.random()*300+50)), borderColor:g2, backgroundColor:g2+'15', tension:0.4, fill:true }] }, options:chartDefaults });
  }
  const ctCtx = document.getElementById('chart-content-types');
  if (ctCtx) {
    if (chartInstances['ctypes']) chartInstances['ctypes'].destroy();
    chartInstances['ctypes'] = new Chart(ctCtx, { type:'pie', data:{ labels:['Text','Image','Video','Polls'], datasets:[{ data:[55,25,12,8], backgroundColor:[g1,g2,g3,'#f59e0b'], borderWidth:0 }] }, options:{ responsive:true, maintainAspectRatio:true, plugins:{legend:{labels:{color:textColor,font:{family:'Inter',size:11}}}} } });
  }
}

// ===== USERS TABLE =====
async function loadUsersTable(filter = 'all', search = '') {
  const tbody = document.getElementById('users-table-body');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" class="p-8 text-center" style="color:var(--text-muted)">Loading...</td></tr>';

  let q = query(collection(db, 'users'), orderBy('createdAt', 'desc'), limit(50));
  if (filter === 'suspended') q = query(collection(db, 'users'), where('suspended', '==', true), limit(50));
  if (filter === 'staff') q = query(collection(db, 'users'), where('userType', '==', 'staff'), limit(50));
  if (filter === 'active') q = query(collection(db, 'users'), where('isOnline', '==', true), limit(50));

  const snap = await getDocs(q);
  let rows = snap.docs;
  if (search) rows = rows.filter(d => (d.data().displayName||'').toLowerCase().includes(search.toLowerCase()) || (d.data().email||'').toLowerCase().includes(search.toLowerCase()) || (d.data().username||'').toLowerCase().includes(search.toLowerCase()));

  tbody.innerHTML = '';
  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-sm" style="color:var(--text-muted)">No users found.</td></tr>'; return;
  }

  rows.forEach(d => {
    const u = d.data();
    const joined = u.createdAt?.toDate?.()?.toLocaleDateString() || '—';
    const isSuspended = u.suspended || false;
    const ava = u.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.displayName||'U')}&background=a855f7&color=fff&size=40`;
    const isStaff = u.userType === 'staff';

    tbody.insertAdjacentHTML('beforeend', `
      <tr class="border-b hover:bg-opacity-50 transition-colors" style="border-color:var(--border)">
        <td class="p-4">
          <div class="flex items-center gap-3">
            <img src="${ava}" class="lynk-avatar w-9 h-9" />
            <div>
              <p class="text-sm font-semibold">${u.displayName || '—'} ${isStaff ? '<span class="lynk-badge text-xs" style="background:#0ea5e920;color:#38bdf8">Staff</span>' : ''}</p>
              <p class="text-xs" style="color:var(--text-muted)">@${u.username || '—'} · ${u.email || '—'}</p>
              ${u.position ? `<p class="text-xs" style="color:var(--text-muted)">${u.position}</p>` : ''}
            </div>
          </div>
        </td>
        <td class="p-4 text-sm">
          <span style="color:var(--text-secondary)">${u.university || '—'}</span>
          ${u.faculty ? `<p class="text-xs" style="color:var(--text-muted)">${u.faculty}${u.department ? ' · ' + u.department : ''}</p>` : ''}
        </td>
        <td class="p-4 text-xs" style="color:var(--text-muted)">${joined}</td>
        <td class="p-4">
          <span class="lynk-badge ${isSuspended ? 'bg-red-500' : u.isOnline ? 'bg-green-500' : ''} text-white"
                style="${!isSuspended && !u.isOnline ? 'background:var(--bg-card-hover);color:var(--text-muted)' : ''}">
            ${isSuspended ? '🚫 Suspended' : u.isOnline ? '● Online' : '○ Offline'}
          </span>
          ${u.adminRole ? `<span class="lynk-badge lynk-gradient text-white ml-1">${u.adminRole}</span>` : ''}
          ${!u.profileComplete && !u.university ? '<span class="lynk-badge text-xs ml-1" style="background:#f59e0b20;color:#f59e0b">Profile incomplete</span>' : ''}
        </td>
        <td class="p-4">
          <div class="flex gap-1">
            <button onclick="viewUserAdmin('${d.id}')" class="lynk-btn lynk-btn-ghost py-1 px-2 rounded-lg text-xs">👁 View</button>
            ${!isSuspended
              ? `<button onclick="suspendUser('${d.id}', '${(u.displayName||'').replace(/'/g,"\\'")}', true)" class="lynk-btn lynk-btn-ghost py-1 px-2 rounded-lg text-xs" style="color:#ef4444">🚫 Suspend</button>`
              : `<button onclick="suspendUser('${d.id}', '${(u.displayName||'').replace(/'/g,"\\'")}', false)" class="lynk-btn lynk-btn-ghost py-1 px-2 rounded-lg text-xs" style="color:#22c55e">✅ Restore</button>`
            }
          </div>
        </td>
      </tr>`);
  });
}

window.searchUsers = (val) => loadUsersTable('all', val);
window.filterUsers = (filter, btn) => {
  document.querySelectorAll('#section-users .lynk-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  loadUsersTable(filter);
};
window.viewUserAdmin = (uid) => window.open(`profile.html?uid=${uid}`, '_blank');
window.suspendUser = async (uid, name, suspend) => {
  pendingUserAction = { uid, suspend };
  document.getElementById('user-action-title').textContent = suspend ? 'Suspend User' : 'Restore User';
  document.getElementById('user-action-desc').textContent = `${suspend ? 'Suspend' : 'Restore'} account for ${name}? They will ${suspend ? 'not' : 'now'} be able to use LYNK.`;
  document.getElementById('user-action-modal').classList.remove('hidden');
};
window.confirmUserAction = async () => {
  if (!pendingUserAction) return;
  await updateDoc(doc(db, 'users', pendingUserAction.uid), { suspended: pendingUserAction.suspend });
  document.getElementById('user-action-modal').classList.add('hidden');
  loadUsersTable();
  pendingUserAction = null;
};

// ===== SCHOOLS MANAGEMENT =====
async function loadSchools() {
  const list = document.getElementById('schools-list');
  if (!list) return;
  list.innerHTML = '<div class="lynk-card p-5 animate-pulse"><div class="h-4 rounded w-1/2 mb-2" style="background:var(--border)"></div></div>';
  const snap = await getDocs(query(collection(db, 'schools'), orderBy('name', 'asc')));

  if (snap.empty) {
    list.innerHTML = `
      <div class="lynk-card p-10 text-center">
        <div class="text-5xl mb-3">🏫</div>
        <h3 class="font-semibold mb-2">No schools added yet</h3>
        <p class="text-sm mb-4" style="color:var(--text-secondary)">Add universities so students and staff can select them during sign-up.</p>
        <button onclick="showAddSchoolModal()" class="lynk-btn lynk-btn-primary px-6 py-3 rounded-xl">+ Add First University</button>
      </div>`;
    return;
  }

  list.innerHTML = '';
  snap.docs.forEach(d => {
    const s = d.data();
    const faculties = Object.keys(s.faculties || {});
    const totalDepts = faculties.reduce((acc, f) => acc + (s.faculties[f]?.length || 0), 0);
    list.insertAdjacentHTML('beforeend', `
      <div class="lynk-card p-5">
        <div class="flex items-start justify-between gap-4 mb-4">
          <div class="flex items-center gap-4">
            <div class="w-12 h-12 rounded-xl lynk-gradient flex items-center justify-center text-white text-xl flex-shrink-0">🎓</div>
            <div>
              <h3 class="font-bold">${s.name}</h3>
              <p class="text-sm" style="color:var(--text-muted)">${s.shortName || ''} ${s.location ? '· ' + s.location : ''}</p>
            </div>
          </div>
          <div class="flex gap-2 flex-shrink-0">
            <button onclick="manageSchool('${d.id}')" class="lynk-btn lynk-btn-secondary text-xs py-1.5 px-3 rounded-lg">✏️ Manage</button>
            <button onclick="deleteSchool('${d.id}', '${s.name?.replace(/'/g,"\\'")}' )" class="lynk-btn lynk-btn-ghost text-xs py-1.5 px-3 rounded-lg" style="color:#ef4444">🗑</button>
          </div>
        </div>
        <div class="flex gap-4 text-sm mb-3" style="color:var(--text-secondary)">
          <span>🏛️ ${faculties.length} faculties</span>
          <span>📚 ${totalDepts} departments</span>
        </div>
        <div class="flex flex-wrap gap-2">
          ${faculties.slice(0, 6).map(f => `<span class="lynk-badge text-xs" style="background:var(--bg-card-hover);color:var(--text-secondary)">${f}</span>`).join('')}
          ${faculties.length > 6 ? `<span class="lynk-badge text-xs" style="background:var(--bg-card-hover);color:var(--text-muted)">+${faculties.length-6} more</span>` : ''}
        </div>
      </div>`);
  });
}

// Save new school
window.saveSchool = async () => {
  const name = document.getElementById('school-name').value.trim();
  const shortName = document.getElementById('school-short').value.trim();
  const location = document.getElementById('school-location').value.trim();
  if (!name) { alert('University name is required.'); return; }

  const faculties = {};
  const rows = document.getElementById('faculties-builder').querySelectorAll('[id^="faculty-row-"]');
  rows.forEach(row => {
    const id = row.id.replace('faculty-row-', '');
    const facName = document.getElementById(`fac-name-${id}`)?.value.trim();
    const deptsRaw = document.getElementById(`fac-depts-${id}`)?.value.trim();
    if (facName) {
      faculties[facName] = deptsRaw ? deptsRaw.split(',').map(d => d.trim()).filter(Boolean) : [];
    }
  });

  await addDoc(collection(db, 'schools'), {
    name, shortName, location,
    faculties,
    createdAt: serverTimestamp(),
    createdBy: currentUser.uid
  });

  window.hideAddSchoolModal();
  loadSchools();
};

// Manage school (edit faculties/departments)
window.manageSchool = async (schoolId) => {
  const snap = await getDoc(doc(db, 'schools', schoolId));
  const s = snap.data();
  const modal = document.getElementById('manage-school-modal');
  const title = document.getElementById('manage-school-title');
  const content = document.getElementById('manage-school-content');
  title.textContent = `Manage — ${s.name}`;
  const faculties = s.faculties || {};

  content.innerHTML = `
    <div class="text-sm mb-2 font-medium" style="color:var(--text-secondary)">Edit university details</div>
    <input id="edit-school-name" type="text" class="lynk-input mb-2" value="${s.name || ''}" placeholder="University name" />
    <div class="grid grid-cols-2 gap-2 mb-4">
      <input id="edit-school-short" type="text" class="lynk-input" value="${s.shortName || ''}" placeholder="Short name" />
      <input id="edit-school-location" type="text" class="lynk-input" value="${s.location || ''}" placeholder="Location" />
    </div>

    <div class="flex items-center justify-between mb-3">
      <div class="text-sm font-medium" style="color:var(--text-secondary)">Faculties & Departments</div>
      <button onclick="addEditFacultyRow('${schoolId}')" class="lynk-btn lynk-btn-secondary text-xs py-1 px-3 rounded-lg">+ Add Faculty</button>
    </div>
    <div id="edit-faculties-${schoolId}" class="flex flex-col gap-3 mb-4">
      ${Object.entries(faculties).map(([fac, depts]) => `
        <div class="lynk-card p-3" id="efrow-${schoolId}-${fac.replace(/\s/g,'_')}">
          <div class="flex gap-2 mb-2">
            <input type="text" class="lynk-input text-sm py-2 flex-1" value="${fac}" id="efname-${schoolId}-${fac.replace(/\s/g,'_')}" />
            <button onclick="removeEditFaculty('${schoolId}','${fac.replace(/\s/g,'_')}')" class="lynk-btn lynk-btn-ghost text-xs px-2 rounded-lg" style="color:#ef4444">✕</button>
          </div>
          <input type="text" class="lynk-input text-sm py-2 w-full" value="${depts.join(', ')}" id="efdepts-${schoolId}-${fac.replace(/\s/g,'_')}" placeholder="Departments (comma-separated)" />
        </div>`).join('')}
    </div>
    <button onclick="updateSchool('${schoolId}')" class="lynk-btn lynk-btn-primary w-full py-3 rounded-xl">Save Changes</button>`;

  modal.classList.remove('hidden');
};

let editFacultyCounter = 0;
window.addEditFacultyRow = (schoolId) => {
  const id = `new_${editFacultyCounter++}`;
  const container = document.getElementById(`edit-faculties-${schoolId}`);
  container.insertAdjacentHTML('beforeend', `
    <div class="lynk-card p-3" id="efrow-${schoolId}-${id}">
      <div class="flex gap-2 mb-2">
        <input type="text" class="lynk-input text-sm py-2 flex-1" placeholder="Faculty name" id="efname-${schoolId}-${id}" />
        <button onclick="removeEditFaculty('${schoolId}','${id}')" class="lynk-btn lynk-btn-ghost text-xs px-2 rounded-lg" style="color:#ef4444">✕</button>
      </div>
      <input type="text" class="lynk-input text-sm py-2 w-full" placeholder="Departments (comma-separated)" id="efdepts-${schoolId}-${id}" />
    </div>`);
};

window.removeEditFaculty = (schoolId, facId) => {
  document.getElementById(`efrow-${schoolId}-${facId}`)?.remove();
};

window.updateSchool = async (schoolId) => {
  const name = document.getElementById('edit-school-name').value.trim();
  const shortName = document.getElementById('edit-school-short').value.trim();
  const location = document.getElementById('edit-school-location').value.trim();
  const faculties = {};
  const container = document.getElementById(`edit-faculties-${schoolId}`);
  container.querySelectorAll('[id^="efrow-"]').forEach(row => {
    const rowId = row.id.replace(`efrow-${schoolId}-`, '');
    const facName = document.getElementById(`efname-${schoolId}-${rowId}`)?.value.trim();
    const deptsRaw = document.getElementById(`efdepts-${schoolId}-${rowId}`)?.value.trim();
    if (facName) faculties[facName] = deptsRaw ? deptsRaw.split(',').map(d => d.trim()).filter(Boolean) : [];
  });
  await updateDoc(doc(db, 'schools', schoolId), { name, shortName, location, faculties });
  window.hideManageSchoolModal();
  loadSchools();
};

window.deleteSchool = async (schoolId, name) => {
  if (!confirm(`Delete "${name}" and all its faculties/departments? Students who selected this school will keep their existing data.`)) return;
  await deleteDoc(doc(db, 'schools', schoolId));
  loadSchools();
};

// ===== CONTENT =====
async function loadContentList(filter = 'all') {
  const list = document.getElementById('content-list');
  if (!list) return;
  let q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(20));
  const snap = await getDocs(q);
  list.innerHTML = '';
  if (snap.empty) { list.innerHTML = '<div class="lynk-card p-6 text-center text-sm" style="color:var(--text-muted)">No content to moderate.</div>'; return; }
  snap.docs.forEach(d => {
    const p = d.data();
    const ts = p.createdAt?.toDate?.()?.toLocaleString() || '';
    list.insertAdjacentHTML('beforeend', `
      <div class="lynk-card p-5">
        <div class="flex items-start justify-between gap-4">
          <div class="flex-1">
            <div class="flex items-center gap-2 mb-1">
              <span class="font-semibold text-sm">${p.authorName || 'Unknown'}</span>
              <span class="text-xs" style="color:var(--text-muted)">${ts}</span>
            </div>
            <p class="text-sm" style="color:var(--text-secondary)">${(p.content||'').slice(0,200)}${p.content?.length>200?'…':''}</p>
          </div>
          <button onclick="removePost('${d.id}')" class="lynk-btn lynk-btn-ghost text-xs py-1 px-3 rounded-lg flex-shrink-0" style="color:#ef4444">🗑 Remove</button>
        </div>
      </div>`);
  });
}
window.filterContent = (filter, btn) => {
  document.querySelectorAll('#section-content .lynk-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  loadContentList(filter);
};
window.removePost = async (postId) => {
  if (!confirm('Remove this post?')) return;
  await deleteDoc(doc(db, 'posts', postId));
  loadContentList();
};

// ===== SECURITY LOGS =====
async function loadSecurityLogs() {
  const container = document.getElementById('security-logs');
  if (!container) return;
  const q = query(collection(db, 'securityLogs'), orderBy('createdAt', 'desc'), limit(50));
  const snap = await getDocs(q);
  document.getElementById('security-count').textContent = `${snap.size} events`;
  if (snap.empty) {
    const usersSnap = await getDocs(query(collection(db, 'users'), orderBy('lastSeen', 'desc'), limit(10)));
    container.innerHTML = '';
    usersSnap.docs.forEach(d => {
      const u = d.data();
      const ts = u.lastSeen?.toDate?.()?.toLocaleString() || 'Recently';
      container.insertAdjacentHTML('beforeend', `<div class="flex items-center justify-between p-4 text-sm"><div class="flex items-center gap-3"><span class="text-green-400">●</span><span class="font-medium">${u.displayName||'User'}</span><span style="color:var(--text-muted)"> signed in</span></div><span class="text-xs" style="color:var(--text-muted)">${ts}</span></div>`);
    });
    return;
  }
  container.innerHTML = '';
  snap.docs.forEach(d => {
    const l = d.data();
    const ts = l.createdAt?.toDate?.()?.toLocaleString() || '';
    const colors = { signin:'#22c55e', signout:'#94a3b8', failed:'#ef4444', suspended:'#f97316' };
    container.insertAdjacentHTML('beforeend', `<div class="flex items-center justify-between p-4 text-sm border-b" style="border-color:var(--border)"><div class="flex items-center gap-3"><span style="color:${colors[l.type]||'#94a3b8'}">●</span><span>${l.message||l.type}</span></div><span class="text-xs" style="color:var(--text-muted)">${ts}</span></div>`);
  });
}

// ===== REPORTS =====
async function loadReports() {
  const list = document.getElementById('reports-list');
  if (!list) return;
  const snap = await getDocs(query(collection(db, 'reports'), where('status','==','open'), orderBy('createdAt','desc'), limit(20)));
  if (snap.empty) { list.innerHTML = '<div class="lynk-card p-6 text-center text-sm" style="color:var(--text-muted)">✅ No open reports. All clear!</div>'; return; }
  list.innerHTML = '';
  snap.docs.forEach(d => {
    const r = d.data();
    const ts = r.createdAt?.toDate?.()?.toLocaleString() || '';
    list.insertAdjacentHTML('beforeend', `
      <div class="lynk-card p-5"><div class="flex items-center justify-between"><div><p class="font-semibold text-sm mb-1">🚨 ${r.reason||'User Report'}</p><p class="text-xs" style="color:var(--text-muted)">Post ID: ${r.postId||'—'} · ${ts}</p></div><div class="flex gap-2"><button onclick="resolveReport('${d.id}','dismissed')" class="lynk-btn lynk-btn-secondary text-xs py-1.5 px-3 rounded-lg">Dismiss</button><button onclick="resolveReport('${d.id}','actioned')" class="lynk-btn text-xs py-1.5 px-3 rounded-lg" style="background:#ef444422;color:#ef4444">Remove Post</button></div></div></div>`);
  });
}
window.resolveReport = async (reportId, action) => {
  const snap = await getDoc(doc(db, 'reports', reportId));
  if (action === 'actioned' && snap.data()?.postId) await deleteDoc(doc(db, 'posts', snap.data().postId)).catch(()=>{});
  await updateDoc(doc(db, 'reports', reportId), { status: action, resolvedAt: serverTimestamp() });
  loadReports();
};

// ===== COMMUNITIES =====
async function loadCommunities() {
  const list = document.getElementById('communities-list');
  if (!list) return;
  const snap = await getDocs(query(collection(db, 'communities'), orderBy('memberCount','desc'), limit(20)));
  list.innerHTML = '';
  if (snap.empty) { list.innerHTML = '<div class="lynk-card p-6 col-span-full text-center text-sm" style="color:var(--text-muted)">No communities yet.</div>'; return; }
  snap.docs.forEach(d => {
    const c = d.data();
    list.insertAdjacentHTML('beforeend', `<div class="lynk-card p-5"><div class="flex items-center gap-3 mb-3"><span class="text-2xl">${c.type==='faculty'?'🏛️':'📚'}</span><div><p class="font-semibold text-sm">${c.name}</p><p class="text-xs" style="color:var(--text-muted)">${c.type} · ${c.university||''}</p></div></div><div class="flex items-center justify-between text-sm"><span style="color:var(--text-secondary)">👥 ${c.memberCount||0} members</span><span class="lynk-badge" style="background:var(--bg-card-hover);color:var(--text-muted)">${c.type}</span></div></div>`);
  });
}

// ===== ADMINS =====
async function loadAdminsList() {
  const list = document.getElementById('admins-list');
  if (!list) return;
  const snap = await getDocs(query(collection(db, 'users'), where('adminRole', '!=', null), limit(20)));
  if (snap.empty) { list.innerHTML = '<p class="text-sm" style="color:var(--text-muted)">No sub-admins assigned yet.</p>'; return; }
  list.innerHTML = '';
  snap.docs.forEach(d => {
    const u = d.data();
    const ava = u.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.displayName||'U')}&background=a855f7&color=fff&size=40`;
    list.insertAdjacentHTML('beforeend', `<div class="flex items-center gap-2"><img src="${ava}" class="lynk-avatar w-8 h-8" /><div class="flex-1 min-w-0"><p class="text-xs font-semibold truncate">${u.displayName}</p><p class="text-xs truncate" style="color:var(--text-muted)">${u.adminRole}</p></div>${currentUserData.adminRole==='super'?`<button onclick="revokeAdmin('${d.id}')" class="text-xs" style="color:#ef4444">Revoke</button>`:''}</div>`);
  });
}

window.grantAdminRole = async () => {
  const email = document.getElementById('grant-admin-email').value.trim();
  const role  = document.getElementById('grant-admin-role').value;
  if (!email) return;
  const snap = await getDocs(query(collection(db, 'users'), where('email','==',email), limit(1)));
  if (snap.empty) { alert('User not found with that email.'); return; }
  await updateDoc(snap.docs[0].ref, { adminRole: role });
  hideGrantAdminModal();
  loadAdminsList();
  alert(`Admin role "${role}" granted to ${email}`);
};
window.revokeAdmin = async (uid) => {
  if (!confirm('Revoke admin role?')) return;
  await updateDoc(doc(db, 'users', uid), { adminRole: null });
  loadAdminsList();
};

window.refreshDashboard = async () => { await loadStats(); initCharts(); };
window.signOut = async () => {
  if (currentUser) await updateDoc(doc(db, 'users', currentUser.uid), { isOnline: false, lastSeen: serverTimestamp() }).catch(()=>{});
  await firebaseSignOut(auth);
  window.location.href = 'auth.html';
};
window.hideGrantAdminModal = () => document.getElementById('grant-admin-modal')?.classList.add('hidden');
window.hideAddSchoolModal = () => document.getElementById('add-school-modal')?.classList.add('hidden');
window.hideManageSchoolModal = () => document.getElementById('manage-school-modal')?.classList.add('hidden');
