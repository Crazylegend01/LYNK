// ============================================================
// LYNK By Legends — Settings Module
// ============================================================

import { auth, db } from './firebase-config.js';
import { ThemeManager } from './theme.js';
import { initNotifications, showToast } from './notifications.js';
import {
  doc, getDoc, updateDoc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  onAuthStateChanged, signOut as firebaseSignOut,
  updatePassword, reauthenticateWithCredential, EmailAuthProvider,
  sendEmailVerification
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

ThemeManager.init();

let currentUser = null;
let currentUserData = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'auth.html'; return; }
  currentUser = user;
  const snap = await getDoc(doc(db, 'users', user.uid));
  currentUserData = snap.data() || {};
  await initNotifications(user.uid);
  populateSidebar();
  populateForms();
});

function populateSidebar() {
  const d = currentUserData;
  const ava = d.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(d.displayName||'U')}&background=a855f7&color=fff`;
  ['nav-avatar','sidebar-avatar'].forEach(id => { const el = document.getElementById(id); if (el) el.src = ava; });
  const sn = document.getElementById('sidebar-name'); if (sn) sn.textContent = d.displayName || 'LYNK User';
  const sd = document.getElementById('sidebar-dept'); if (sd) sd.textContent = `${d.department||''} · ${d.university||''}`;
  if (d.adminRole || d.role === 'admin') document.getElementById('admin-link')?.classList.remove('hidden');
}

function populateForms() {
  const d = currentUserData;

  // Profile tab
  const dn = document.getElementById('set-displayname'); if (dn) dn.value = d.displayName || '';
  const bio = document.getElementById('set-bio'); if (bio) bio.value = d.bio || '';
  const lvl = document.getElementById('set-level'); if (lvl) lvl.value = d.academicLevel || '';
  const skills = document.getElementById('set-skills'); if (skills) skills.value = (d.skills||[]).join(', ');
  const interests = document.getElementById('set-interests'); if (interests) interests.value = (d.interests||[]).join(', ');
  const website = document.getElementById('set-website'); if (website) website.value = d.website || '';
  const linkedin = document.getElementById('set-linkedin'); if (linkedin) linkedin.value = d.linkedin || '';
  const twitter = document.getElementById('set-twitter'); if (twitter) twitter.value = d.twitter || '';

  // Notification prefs
  const prefs = d.notificationPrefs || {};
  setCheck('notif-likes', prefs.likes !== false);
  setCheck('notif-comments', prefs.comments !== false);
  setCheck('notif-friends', prefs.friends !== false);
  setCheck('notif-announcements', prefs.announcements !== false);
  setCheck('notif-messages', prefs.messages !== false);

  // Privacy prefs
  const privacy = d.privacySettings || {};
  const pv = document.getElementById('privacy-profile'); if (pv) pv.value = privacy.profileVisibility || 'public';
  const pfl = document.getElementById('privacy-friends-list'); if (pfl) pfl.value = privacy.friendsListVisibility || 'public';
  setCheck('privacy-search', privacy.appearInSearch !== false);
  setCheck('privacy-suggestions', privacy.showInSuggestions !== false);

  // Security
  const emailEl = document.getElementById('current-email'); if (emailEl) emailEl.textContent = currentUser.email || '';
  const verifiedEl = document.getElementById('email-verified');
  if (verifiedEl) {
    verifiedEl.textContent = currentUser.emailVerified ? '✅ Verified' : '⚠️ Not verified';
    verifiedEl.style.color = currentUser.emailVerified ? '#4ade80' : '#f87171';
  }
}

function setCheck(id, val) {
  const el = document.getElementById(id);
  if (el) el.checked = !!val;
}

// ===== PROFILE SETTINGS =====
window.saveProfileSettings = async () => {
  if (!currentUser) return;
  const btn = document.getElementById('btn-save-profile');
  btn.disabled = true; btn.textContent = 'Saving...';

  const displayName = document.getElementById('set-displayname').value.trim();
  const bio         = document.getElementById('set-bio').value.trim();
  const academicLevel = document.getElementById('set-level').value;
  const skillsRaw   = document.getElementById('set-skills').value;
  const interestsRaw= document.getElementById('set-interests').value;
  const website     = document.getElementById('set-website').value.trim();
  const linkedin    = document.getElementById('set-linkedin').value.trim();
  const twitter     = document.getElementById('set-twitter').value.trim();

  const skills    = skillsRaw.split(',').map(s=>s.trim()).filter(Boolean).slice(0,15);
  const interests = interestsRaw.split(',').map(s=>s.trim()).filter(Boolean).slice(0,15);

  await updateDoc(doc(db, 'users', currentUser.uid), {
    displayName, bio, academicLevel, skills, interests, website, linkedin, twitter
  });
  currentUserData = { ...currentUserData, displayName, bio, academicLevel, skills, interests, website, linkedin, twitter };

  btn.disabled = false; btn.textContent = 'Save Changes';
  showToast('Settings Saved! ✓', 'Your profile settings have been updated.', currentUserData.photoURL||'');
};

// ===== NOTIFICATION SETTINGS =====
window.saveNotificationSettings = async () => {
  if (!currentUser) return;
  const btn = document.getElementById('btn-save-notif');
  btn.disabled = true; btn.textContent = 'Saving...';

  const prefs = {
    likes:         getCheck('notif-likes'),
    comments:      getCheck('notif-comments'),
    friends:       getCheck('notif-friends'),
    announcements: getCheck('notif-announcements'),
    messages:      getCheck('notif-messages')
  };
  await updateDoc(doc(db, 'users', currentUser.uid), { notificationPrefs: prefs });
  currentUserData.notificationPrefs = prefs;

  btn.disabled = false; btn.textContent = 'Save Preferences';
  showToast('Saved! ✓', 'Notification preferences updated.', '');
};

// ===== PRIVACY SETTINGS =====
window.savePrivacySettings = async () => {
  if (!currentUser) return;
  const btn = document.getElementById('btn-save-privacy');
  btn.disabled = true; btn.textContent = 'Saving...';

  const privacy = {
    profileVisibility:       document.getElementById('privacy-profile').value,
    friendsListVisibility:   document.getElementById('privacy-friends-list').value,
    appearInSearch:          getCheck('privacy-search'),
    showInSuggestions:       getCheck('privacy-suggestions')
  };
  await updateDoc(doc(db, 'users', currentUser.uid), { privacySettings: privacy });
  currentUserData.privacySettings = privacy;

  btn.disabled = false; btn.textContent = 'Save Privacy Settings';
  showToast('Privacy Updated! 🔒', 'Your privacy settings have been saved.', '');
};

// ===== CHANGE PASSWORD =====
window.changePassword = async () => {
  if (!currentUser) return;
  const current  = document.getElementById('pw-current').value;
  const newPw    = document.getElementById('pw-new').value;
  const confirm  = document.getElementById('pw-confirm').value;
  const errEl    = document.getElementById('pw-error');
  const btn      = document.getElementById('btn-change-pw');
  errEl.classList.add('hidden');

  if (!current || !newPw || !confirm) { showPwError('All fields are required.'); return; }
  if (newPw !== confirm) { showPwError('New passwords do not match.'); return; }
  if (newPw.length < 8) { showPwError('New password must be at least 8 characters.'); return; }

  btn.disabled = true; btn.textContent = '⏳ Updating...';
  try {
    const credential = EmailAuthProvider.credential(currentUser.email, current);
    await reauthenticateWithCredential(currentUser, credential);
    await updatePassword(currentUser, newPw);
    document.getElementById('pw-current').value = '';
    document.getElementById('pw-new').value = '';
    document.getElementById('pw-confirm').value = '';
    btn.disabled = false; btn.textContent = 'Update Password';
    showToast('Password Changed! 🔐', 'Your password has been updated successfully.', '');
  } catch (err) {
    btn.disabled = false; btn.textContent = 'Update Password';
    const msgs = { 'auth/wrong-password':'Current password is incorrect.', 'auth/invalid-credential':'Current password is incorrect.', 'auth/too-many-requests':'Too many attempts — wait a few minutes.' };
    showPwError(msgs[err.code] || err.message);
  }
};

function showPwError(msg) {
  const el = document.getElementById('pw-error');
  el.textContent = msg; el.classList.remove('hidden');
}

window.resendVerificationEmail = async () => {
  if (!currentUser) return;
  try {
    await sendEmailVerification(currentUser);
    showToast('Email Sent! 📧', 'Verification email has been sent. Check your inbox.', '');
  } catch (err) {
    if (err.code === 'auth/too-many-requests') showToast('Slow down', 'Too many requests — wait a few minutes.', '');
    else showToast('Error', err.message, '');
  }
};

// ===== SECTION TABS =====
window.showSection = (name, btn) => {
  document.querySelectorAll('.settings-section').forEach(s => s.classList.add('hidden'));
  document.querySelectorAll('.settings-nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`section-${name}`)?.classList.remove('hidden');
  btn?.classList.add('active');
};

window.signOut = async () => {
  if (currentUser) await updateDoc(doc(db, 'users', currentUser.uid), { isOnline: false, lastSeen: serverTimestamp() });
  await firebaseSignOut(auth);
  window.location.href = 'auth.html';
};

function getCheck(id) { return document.getElementById(id)?.checked ?? false; }

// ===== MISSING WINDOW ALIASES (functions called from settings.html) =====

// Tab switching — HTML calls showSettingsTab(), JS defines showSection()
window.showSettingsTab = window.showSection;

// Also expose saveProfile and saveNotifPrefs aliases
window.saveProfile = window.saveProfileSettings;
window.savePrivacy = window.savePrivacySettings;
window.saveNotifPrefs = window.saveNotificationSettings;

// Theme functions — ThemeManager is imported above
window.applySettingsTheme = (theme) => ThemeManager.apply(theme);
window.resetGradient = () => ThemeManager.resetGradient();

window.saveCustomGradient = () => {
  const s1 = document.getElementById('picker-g1')?.value || ThemeManager.defaults.g1;
  const s2 = document.getElementById('picker-g2')?.value || ThemeManager.defaults.g2;
  const s3 = document.getElementById('picker-g3')?.value || ThemeManager.defaults.g3;
  ThemeManager.applyGradient(s1, s2, s3, true);
  showToast('Gradient Applied! 🎨', 'Your custom gradient has been saved.', '');
};

window.setFontSize = (size) => {
  const map = { small: '13px', normal: '15px', large: '18px' };
  document.documentElement.style.setProperty('--base-font-size', map[size] || '15px');
  localStorage.setItem('lynk-font-size', size);
  document.querySelectorAll('[data-font-btn]').forEach(b => b.classList.remove('active'));
  document.querySelector(`[data-font-btn="${size}"]`)?.classList.add('active');
};

window.previewAvatar = (input) => {
  const file = input.files?.[0];
  if (!file) return;
  const preview = document.getElementById('profile-avatar-preview');
  if (!preview) return;
  const reader = new FileReader();
  reader.onload = (e) => { preview.src = e.target.result; };
  reader.readAsDataURL(file);
};
