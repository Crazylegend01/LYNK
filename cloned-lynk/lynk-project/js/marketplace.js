// ============================================================
// LYNK By Legends — Campus Marketplace Module (Phase 3)
// ============================================================

import { auth, db } from './firebase-config.js';
import { ThemeManager } from './theme.js';
import {
  collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, serverTimestamp, arrayUnion, arrayRemove
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { onAuthStateChanged, signOut as firebaseSignOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { uploadToCloudinary } from './cloudinary.js';
import { initFCM, notifyMarketplaceMessage } from './notifications-fcm.js';

ThemeManager.init();

let currentUser = null;
let currentUserData = null;
let currentCategory = 'all';
let currentMarketTab = 'all';
let pendingPhotos = [];
let allListings = [];

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'auth.html'; return; }
  currentUser = user;
  const snap = await getDoc(doc(db, 'users', user.uid));
  currentUserData = snap.data() || {};

  const navAvatar = document.getElementById('nav-avatar');
  if (navAvatar) navAvatar.src = currentUserData.photoURL || `https://ui-avatars.com/api/?name=U&background=a855f7&color=fff`;
  const sidebarAvatar = document.getElementById('sidebar-avatar');
  if (sidebarAvatar) sidebarAvatar.src = currentUserData.photoURL || `https://ui-avatars.com/api/?name=U&background=a855f7&color=fff`;
  const sidebarName = document.getElementById('sidebar-name');
  if (sidebarName) sidebarName.textContent = currentUserData.displayName || 'LYNK User';
  const sidebarDept = document.getElementById('sidebar-dept');
  if (sidebarDept) sidebarDept.textContent = `${currentUserData.department || ''} · ${currentUserData.university || ''}`;
  if (currentUserData.role === 'admin' || currentUserData.adminRole) {
    document.getElementById('admin-link')?.classList.remove('hidden');
  }

  // Watch contact select for WhatsApp field
  document.getElementById('listing-contact')?.addEventListener('change', (e) => {
    const wa = document.getElementById('listing-whatsapp');
    wa?.classList.toggle('hidden', e.target.value === 'chat');
  });

  initFCM(user.uid).catch(() => {});
  loadListings();
});

// ===== LOAD LISTINGS =====
async function loadListings() {
  const grid = document.getElementById('listings-grid');
  grid.innerHTML = loadingSpinner();

  try {
    let q;
    if (currentMarketTab === 'mine') {
      q = query(collection(db, 'marketplaceListings'), where('sellerId', '==', currentUser.uid), orderBy('createdAt', 'desc'), limit(30));
    } else if (currentMarketTab === 'saved') {
      const savedSnap = await getDocs(query(collection(db, 'savedListings'), where('uid', '==', currentUser.uid), limit(20)));
      const ids = savedSnap.docs.map(d => d.data().listingId);
      if (ids.length === 0) { grid.innerHTML = emptyState('No saved items', 'Browse listings and save the ones you like!'); return; }
      const snaps = await Promise.all(ids.map(id => getDoc(doc(db, 'marketplaceListings', id))));
      allListings = snaps.filter(s => s.exists()).map(s => ({ id: s.id, ...s.data() }));
      renderListings(filterByCat(allListings));
      return;
    } else {
      q = query(collection(db, 'marketplaceListings'), where('status', '==', 'active'), orderBy('createdAt', 'desc'), limit(50));
    }

    const snap = await getDocs(q);
    allListings = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderListings(filterByCat(allListings));
  } catch (err) {
    console.warn('Listings error:', err.message);
    grid.innerHTML = `<div class="col-span-full text-center py-10 text-sm" style="color:var(--text-muted)">Error loading listings. ${err.message}</div>`;
  }
}

function filterByCat(listings) {
  if (currentCategory === 'all') return listings;
  return listings.filter(l => l.category === currentCategory);
}

function renderListings(listings) {
  const grid = document.getElementById('listings-grid');
  if (listings.length === 0) {
    grid.innerHTML = emptyState('No listings found', 'Be the first to list something in this category!');
    return;
  }
  grid.innerHTML = '';
  listings.forEach(l => {
    const price = l.price === 0 || l.price === '0' ? 'FREE' : `₦${Number(l.price).toLocaleString()}`;
    const img = l.photos?.[0] || `https://via.placeholder.com/400x200/1E293B/a855f7?text=${encodeURIComponent(l.category || 'Item')}`;
    const badge = l.sellerVerified ? '<span class="market-badge-verified lynk-badge absolute top-2 left-2">✓ Verified</span>' : '';
    const ts = l.createdAt?.toDate?.()?.toLocaleDateString() || '';
    grid.insertAdjacentHTML('beforeend', `
      <div class="market-card fade-in" onclick="openListing('${l.id}')">
        <div class="relative">
          <img src="${img}" class="market-card-img" loading="lazy" onerror="this.src='https://via.placeholder.com/400x200/1E293B/a855f7?text=No+Image'" />
          ${badge}
          <span class="market-badge-price absolute bottom-2 right-2">${price}</span>
        </div>
        <div class="p-4">
          <h3 class="font-semibold text-sm mb-1 truncate">${escHtml(l.title)}</h3>
          <p class="text-xs mb-2 line-clamp-2" style="color:var(--text-secondary)">${escHtml(l.description || '')}</p>
          <div class="flex items-center justify-between">
            <span class="text-xs px-2 py-0.5 rounded-md" style="background:var(--bg-card-hover);color:var(--text-muted)">${catLabel(l.category)}</span>
            <span class="text-xs" style="color:var(--text-muted)">${ts}</span>
          </div>
          <div class="flex items-center gap-2 mt-3 pt-2 border-t" style="border-color:var(--border)">
            <img src="${l.sellerPhoto || `https://ui-avatars.com/api/?name=S&background=a855f7&color=fff`}" class="lynk-avatar w-6 h-6" />
            <span class="text-xs truncate" style="color:var(--text-muted)">${escHtml(l.sellerName || 'Seller')}</span>
            <button onclick="event.stopPropagation();toggleSave('${l.id}')" class="ml-auto lynk-icon-btn" id="save-btn-${l.id}" style="width:28px;height:28px" title="Save listing">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            </button>
          </div>
        </div>
      </div>`);
  });
}

// ===== OPEN LISTING =====
window.openListing = async (listingId) => {
  const snap = await getDoc(doc(db, 'marketplaceListings', listingId));
  if (!snap.exists()) return;
  const l = { id: snap.id, ...snap.data() };

  const price = l.price === 0 || l.price === '0' ? 'FREE' : `₦${Number(l.price).toLocaleString()}`;
  const photos = l.photos?.length ? l.photos.map(p => `<img src="${p}" class="w-full h-64 object-cover rounded-xl mb-2" loading="lazy" />`).join('') : '';
  const isOwner = l.sellerId === currentUser.uid;
  const ts = l.createdAt?.toDate?.()?.toLocaleDateString() || '';

  document.getElementById('listing-modal-content').innerHTML = `
    <div class="p-5">
      <div class="flex items-center justify-between mb-4">
        <span class="text-lg font-black lynk-gradient-text">${price}</span>
        <button onclick="closeListingModal()" class="lynk-icon-btn">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      ${photos}
      <h2 class="text-xl font-bold mb-2">${escHtml(l.title)}</h2>
      <div class="flex gap-2 mb-3">
        <span class="lynk-badge text-xs px-2 py-0.5" style="background:var(--bg-card-hover)">${catLabel(l.category)}</span>
        ${l.condition && l.condition !== 'service' ? `<span class="lynk-badge text-xs px-2 py-0.5" style="background:var(--bg-card-hover)">${l.condition}</span>` : ''}
        ${l.sellerVerified ? '<span class="market-badge-verified lynk-badge text-xs px-2 py-0.5">✓ Verified Seller</span>' : ''}
      </div>
      <p class="text-sm mb-4 whitespace-pre-wrap" style="color:var(--text-secondary)">${escHtml(l.description)}</p>
      <div class="flex items-center gap-3 p-3 rounded-xl mb-4" style="background:var(--bg-card-hover)">
        <img src="${l.sellerPhoto || `https://ui-avatars.com/api/?name=S&background=a855f7&color=fff`}" class="lynk-avatar w-10 h-10" />
        <div class="flex-1">
          <p class="font-semibold text-sm">${escHtml(l.sellerName || 'Seller')}</p>
          <p class="text-xs" style="color:var(--text-muted)">${escHtml(l.sellerUniversity || '')} · Listed ${ts}</p>
        </div>
        ${!isOwner ? `<a href="profile.html?uid=${l.sellerId}" class="lynk-btn lynk-btn-ghost text-xs py-1.5 px-3">Profile</a>` : ''}
      </div>
      ${!isOwner ? `
        <div class="flex gap-3">
          <button onclick="contactSeller('${l.sellerId}','${listingId}')" class="lynk-btn lynk-btn-primary flex-1">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            Chat Seller
          </button>
          ${l.whatsapp ? `<a href="https://wa.me/${l.whatsapp.replace(/\D/g,'')}" target="_blank" class="lynk-btn lynk-btn-secondary flex-1">
            💬 WhatsApp
          </a>` : ''}
          <button onclick="reportListing('${listingId}')" class="lynk-btn lynk-btn-ghost text-xs px-3" style="color:#ef4444" title="Report">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
          </button>
        </div>` : `
        <div class="flex gap-3">
          <button onclick="markSold('${listingId}')" class="lynk-btn lynk-btn-secondary flex-1 text-sm" ${l.status === 'sold' ? 'disabled' : ''}>${l.status === 'sold' ? '✓ Sold' : 'Mark as Sold'}</button>
          <button onclick="deleteListing('${listingId}')" class="lynk-btn lynk-btn-danger flex-1 text-sm">Delete</button>
        </div>`}
    </div>`;
  document.getElementById('listing-modal').classList.remove('hidden');
};

window.closeListingModal = (e) => {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('listing-modal').classList.add('hidden');
};

// ===== SAVE/UNSAVE =====
window.toggleSave = async (listingId) => {
  const savedId = `${listingId}_${currentUser.uid}`;
  const savedRef = doc(db, 'savedListings', savedId);
  const snap = await getDoc(savedRef);
  const btn = document.getElementById(`save-btn-${listingId}`);
  if (snap.exists()) {
    await deleteDoc(savedRef);
    if (btn) btn.style.color = '';
  } else {
    await setDoc(savedRef, { listingId, uid: currentUser.uid, savedAt: serverTimestamp() });
    if (btn) btn.style.color = 'var(--grad-1)';
  }
};

// ===== CONTACT SELLER =====
window.contactSeller = async (sellerId, listingId) => {
  // Queue a push notification to the seller
  try {
    const listingSnap = await getDoc(doc(db, 'marketplaceListings', listingId));
    const listingTitle = listingSnap.exists() ? (listingSnap.data().title || 'your listing') : 'your listing';
    await notifyMarketplaceMessage({
      toUid: sellerId,
      fromName: currentUserData.displayName || 'Someone',
      listingTitle
    });
  } catch (_) {}
  window.location.href = `chat.html?uid=${sellerId}`;
};

// ===== REPORT =====
window.reportListing = async (listingId) => {
  await addDoc(collection(db, 'reports'), {
    listingId, reportedBy: currentUser.uid,
    type: 'listing', reason: 'User report',
    status: 'open', createdAt: serverTimestamp()
  });
  alert('Reported. Our team will review this listing.');
};

// ===== MARK SOLD / DELETE =====
window.markSold = async (listingId) => {
  await updateDoc(doc(db, 'marketplaceListings', listingId), { status: 'sold' });
  closeListingModal();
  loadListings();
};

window.deleteListing = async (listingId) => {
  if (!confirm('Delete this listing?')) return;
  await deleteDoc(doc(db, 'marketplaceListings', listingId));
  closeListingModal();
  loadListings();
};

// ===== CREATE LISTING =====
window.showCreateListing = () => document.getElementById('create-listing-modal').classList.remove('hidden');
window.closeCreateListing = (e) => {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('create-listing-modal').classList.add('hidden');
  pendingPhotos = [];
  document.getElementById('listing-photos-preview').innerHTML = '';
};

window.previewListingPhotos = (input) => {
  const preview = document.getElementById('listing-photos-preview');
  preview.innerHTML = '';
  pendingPhotos = Array.from(input.files).slice(0, 4);
  pendingPhotos.forEach(file => {
    const reader = new FileReader();
    reader.onload = (e) => {
      preview.insertAdjacentHTML('beforeend', `<img src="${e.target.result}" class="w-20 h-20 object-cover rounded-lg" />`);
    };
    reader.readAsDataURL(file);
  });
};

window.submitListing = async () => {
  const title = document.getElementById('listing-title').value.trim();
  const category = document.getElementById('listing-category').value;
  const price = document.getElementById('listing-price').value || '0';
  const desc = document.getElementById('listing-desc').value.trim();
  const condition = document.getElementById('listing-condition').value;
  const contact = document.getElementById('listing-contact').value;
  const whatsapp = document.getElementById('listing-whatsapp').value.trim();

  if (!title || !desc) { alert('Please fill in all required fields.'); return; }

  const btn = document.querySelector('#create-listing-modal button[onclick="submitListing()"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Publishing...'; }

  try {
    let photos = [];
    if (pendingPhotos.length > 0) {
      photos = await Promise.all(pendingPhotos.map((file, i) => {
        if (btn) btn.textContent = `Uploading photo ${i + 1}/${pendingPhotos.length}...`;
        return uploadToCloudinary(file, `lynk/marketplace/${currentUser.uid}`);
      }));
    }

    await addDoc(collection(db, 'marketplaceListings'), {
      title, category, price: Number(price), description: desc,
      condition, contact, whatsapp: contact !== 'chat' ? whatsapp : '',
      photos,
      sellerId: currentUser.uid,
      sellerName: currentUserData.displayName || 'LYNK User',
      sellerPhoto: currentUserData.photoURL || '',
      sellerUniversity: currentUserData.university || '',
      sellerFaculty: currentUserData.faculty || '',
      sellerDepartment: currentUserData.department || '',
      sellerVerified: currentUserData.verifiedSeller || false,
      status: 'active',
      savedCount: 0,
      createdAt: serverTimestamp()
    });

    closeCreateListing();
    loadListings();
  } catch (err) {
    alert('Error creating listing: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Publish Listing'; }
  }
};

// ===== FILTERS =====
window.filterCategory = (cat, btn) => {
  document.querySelectorAll('.category-chip').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentCategory = cat;
  renderListings(filterByCat(allListings));
};

window.switchMarketTab = (tab, btn) => {
  document.querySelectorAll('.lynk-tab').forEach(b => {
    b.classList.remove('active');
    b.style.borderBottomColor = 'transparent';
  });
  btn.classList.add('active');
  btn.style.borderBottomColor = 'var(--grad-1)';
  currentMarketTab = tab;
  loadListings();
};

window.searchListings = (term) => {
  const filtered = allListings.filter(l =>
    l.title.toLowerCase().includes(term.toLowerCase()) ||
    (l.description || '').toLowerCase().includes(term.toLowerCase())
  );
  renderListings(filterByCat(filtered));
};

// ===== HELPERS =====
function catLabel(cat) {
  const map = { textbooks: '📚 Textbooks', electronics: '💻 Electronics', services: '🔧 Services', tutorials: '🎓 Tutorials', roommates: '🏠 Roommates', business: '🏪 Business', clothing: '👕 Clothing', other: '📦 Other' };
  return map[cat] || cat;
}

function loadingSpinner() {
  return `<div class="col-span-full text-center py-10" style="color:var(--text-muted)"><div class="spinner w-8 h-8 border-4 rounded-full mx-auto mb-3" style="border-color:var(--grad-1);border-top-color:transparent"></div>Loading...</div>`;
}

function emptyState(title, sub) {
  return `<div class="col-span-full text-center py-16"><div class="text-5xl mb-3">🛒</div><h3 class="font-bold mb-2">${title}</h3><p class="text-sm" style="color:var(--text-muted)">${sub}</p><button onclick="showCreateListing()" class="lynk-btn lynk-btn-primary mt-4 text-sm">List Something</button></div>`;
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

window.signOut = async () => {
  await firebaseSignOut(auth);
  window.location.href = 'auth.html';
};
