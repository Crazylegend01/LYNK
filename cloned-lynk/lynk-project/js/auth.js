// ============================================================
// LYNK By Legends — Authentication Module
// ============================================================

import { auth, db } from './firebase-config.js';
import { ThemeManager } from './theme.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut as firebaseSignOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  doc, setDoc, getDoc, getDocs, collection, query, where, limit, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

ThemeManager.init();

const showAlert = (msg, type = 'error') => {
  const el = document.getElementById('auth-alert');
  if (!el) return;
  el.className = `mb-4 p-3 rounded-xl text-sm font-medium`;
  el.style.background = type === 'error' ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)';
  el.style.border = `1px solid ${type === 'error' ? '#ef4444' : '#22c55e'}`;
  el.style.color = type === 'error' ? '#f87171' : '#4ade80';
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 6000);
};

const setLoading = (btnId, loading, label = '') => {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  btn.textContent = loading ? '⏳ Please wait...' : (label || btn.dataset.label || btn.textContent);
  if (label) btn.dataset.label = label;
};

// ===== REDIRECT IF ALREADY SIGNED IN & VERIFIED =====
onAuthStateChanged(auth, async (user) => {
  if (user && user.emailVerified) {
    try {
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (snap.exists()) {
        window.location.href = 'feed.html';
      }
    } catch { /* ignore */ }
  }
});

// ===== USERNAME AVAILABILITY =====
let usernameTimer = null;
window.checkUsername = (value) => {
  const status = document.getElementById('username-status');
  const clean = value.toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (value !== clean) {
    document.getElementById('signup-username').value = clean;
  }
  if (!status) return;
  if (clean.length < 3) {
    status.textContent = 'Username must be at least 3 characters';
    status.style.color = '#f87171';
    return;
  }
  clearTimeout(usernameTimer);
  status.textContent = 'Checking...';
  status.style.color = 'var(--text-muted)';
  usernameTimer = setTimeout(async () => {
    try {
      const snap = await getDocs(query(collection(db, 'users'), where('username', '==', clean), limit(1)));
      if (snap.empty) {
        status.textContent = `✓ @${clean} is available`;
        status.style.color = '#4ade80';
      } else {
        status.textContent = `✗ @${clean} is taken`;
        status.style.color = '#f87171';
      }
    } catch {
      status.textContent = '';
    }
  }, 600);
};

// Show/hide position field based on user type
window.onUserTypeChange = (value) => {
  const posWrapper = document.getElementById('position-wrapper');
  const levelWrapper = document.getElementById('level-wrapper');
  if (posWrapper) posWrapper.style.display = value === 'staff' ? 'block' : 'none';
  if (levelWrapper) levelWrapper.style.display = (value === 'student' || value === 'alumni') ? 'block' : 'none';
};

// ===== SCHOOL DROPDOWN LOGIC =====
let schoolsData = {};

async function loadSchools() {
  const select = document.getElementById('uni-select');
  if (!select) return;
  try {
    const snap = await getDocs(collection(db, 'schools'));
    if (snap.empty) {
      document.getElementById('no-schools-note')?.classList.remove('hidden');
      return;
    }
    snap.docs.forEach(d => {
      const s = d.data();
      schoolsData[d.id] = s;
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = s.name;
      select.appendChild(opt);
    });
  } catch {
    document.getElementById('no-schools-note')?.classList.remove('hidden');
  }
}

window.loadFaculties = (schoolId) => {
  const facSelect = document.getElementById('faculty-select');
  const deptSelect = document.getElementById('dept-select');
  const facWrapper = document.getElementById('faculty-wrapper');
  const deptWrapper = document.getElementById('dept-wrapper');
  if (!schoolId || !schoolsData[schoolId]) {
    facWrapper?.classList.add('hidden');
    deptWrapper?.classList.add('hidden');
    return;
  }
  const faculties = Object.keys(schoolsData[schoolId].faculties || {});
  facSelect.innerHTML = '<option value="">-- Select faculty --</option>';
  faculties.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f; opt.textContent = f;
    facSelect.appendChild(opt);
  });
  facWrapper?.classList.remove('hidden');
  deptWrapper?.classList.add('hidden');
};

window.loadDepartments = (faculty) => {
  const schoolId = document.getElementById('uni-select').value;
  const deptSelect = document.getElementById('dept-select');
  const deptWrapper = document.getElementById('dept-wrapper');
  if (!faculty || !schoolId) { deptWrapper?.classList.add('hidden'); return; }
  const depts = schoolsData[schoolId]?.faculties?.[faculty] || [];
  deptSelect.innerHTML = '<option value="">-- Select department --</option>';
  depts.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d; opt.textContent = d;
    deptSelect.appendChild(opt);
  });
  deptWrapper?.classList.remove('hidden');
};

loadSchools();

// ===== SIGNUP STEP 1 =====
let pendingUserUid = null;
let pendingUserEmail = null;
let pendingUserPassword = null;

document.getElementById('form-signup')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fname    = document.getElementById('signup-fname').value.trim();
  const lname    = document.getElementById('signup-lname').value.trim();
  const username = document.getElementById('signup-username').value.trim().toLowerCase();
  const email    = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  const userType = document.querySelector('input[name="user-type"]:checked')?.value || 'student';
  const position = document.getElementById('signup-position')?.value.trim() || '';
  const academicLevel = document.getElementById('signup-level')?.value || '';

  if (!username || username.length < 3) {
    showAlert('Username must be at least 3 characters.'); return;
  }
  if (!/^[a-z0-9_]+$/.test(username)) {
    showAlert('Username can only contain letters, numbers and underscores.'); return;
  }
  if (userType === 'staff' && !position) {
    showAlert('Please enter your position or rank.'); return;
  }
  if (!document.getElementById('terms-check').checked) {
    showAlert('Please accept the Terms of Service to continue.'); return;
  }

  setLoading('btn-signup', true, 'Continue →');
  try {
    const uSnap = await getDocs(query(collection(db, 'users'), where('username', '==', username), limit(1)));
    if (!uSnap.empty) {
      showAlert('That username is already taken. Please choose another.');
      setLoading('btn-signup', false, 'Continue →');
      return;
    }
  } catch { /* proceed */ }

  try {
    const { user } = await createUserWithEmailAndPassword(auth, email, password);
    pendingUserUid = user.uid;
    pendingUserEmail = email;
    pendingUserPassword = password;

    await setDoc(doc(db, 'users', user.uid), {
      uid: user.uid,
      email,
      displayName: `${fname} ${lname}`,
      firstName: fname,
      lastName: lname,
      username,
      userType,
      position: userType === 'staff' ? position : '',
      academicLevel: (userType === 'student' || userType === 'alumni') ? academicLevel : '',
      university: '',
      faculty: '',
      department: '',
      bio: '',
      photoURL: `https://ui-avatars.com/api/?name=${encodeURIComponent(fname+' '+lname)}&background=a855f7&color=fff&size=200`,
      coverURL: '',
      role: 'user',
      adminRole: null,
      isOnline: false,
      profileComplete: false,
      skills: [],
      interests: [],
      createdAt: serverTimestamp(),
      lastSeen: serverTimestamp(),
      friendsCount: 0,
      postsCount: 0
    });

    setLoading('btn-signup', false, 'Continue →');
    window.switchTab('university');
  } catch (err) {
    const msgs = {
      'auth/email-already-in-use': 'An account with this email already exists.',
      'auth/weak-password': 'Password must be at least 8 characters.',
      'auth/invalid-email': 'Please enter a valid email address.'
    };
    showAlert(msgs[err.code] || err.message);
    setLoading('btn-signup', false, 'Continue →');
  }
});

// ===== STEP 2 — University Info =====
window.completeUniversityInfo = async () => {
  const schoolId   = document.getElementById('uni-select')?.value;
  const facultyVal = document.getElementById('faculty-select')?.value;
  const deptVal    = document.getElementById('dept-select')?.value;

  if (!pendingUserUid) { window.location.href = 'feed.html'; return; }

  const universityName = schoolId ? (schoolsData[schoolId]?.name || '') : '';
  await setDoc(doc(db, 'users', pendingUserUid), {
    university: universityName,
    faculty: facultyVal || '',
    department: deptVal || '',
    profileComplete: !!(universityName && facultyVal && deptVal)
  }, { merge: true });

  if (universityName && facultyVal) {
    await setDoc(doc(db, 'communities', `${universityName}-${facultyVal}`.replace(/\s+/g,'-').toLowerCase()), {
      name: `${facultyVal} — ${universityName}`, type: 'faculty',
      university: universityName, faculty: facultyVal, memberCount: 1, createdAt: serverTimestamp()
    }, { merge: true });
  }
  if (universityName && deptVal) {
    await setDoc(doc(db, 'communities', `${universityName}-${deptVal}`.replace(/\s+/g,'-').toLowerCase()), {
      name: `${deptVal} — ${universityName}`, type: 'department',
      university: universityName, faculty: facultyVal || '', department: deptVal, memberCount: 1, createdAt: serverTimestamp()
    }, { merge: true });
  }

  const user = auth.currentUser;
  if (user) {
    try {
      await sendEmailVerification(user, {
      url: 'https://crazylegend01.github.io/LYNK/auth.html',
      handleCodeInApp: false
    });
    } catch (err) {
      console.warn('sendEmailVerification error:', err.code);
    }
    await firebaseSignOut(auth);
  }
  document.getElementById('verify-email-addr').textContent = pendingUserEmail || '';
  const spamNote = document.getElementById('verify-spam-note');
  if (spamNote) spamNote.classList.remove('hidden');
  window.switchTab('verify');
};

window.skipUniversityInfo = async () => {
  const user = auth.currentUser;
  if (user) {
    try {
      await sendEmailVerification(user, {
      url: 'https://crazylegend01.github.io/LYNK/auth.html',
      handleCodeInApp: false
    });
    } catch (err) {
      console.warn('sendEmailVerification error:', err.code);
    }
    await firebaseSignOut(auth);
  }
  document.getElementById('verify-email-addr').textContent = pendingUserEmail || '';
  const spamNote2 = document.getElementById('verify-spam-note');
  if (spamNote2) spamNote2.classList.remove('hidden');
  window.switchTab('verify');
};

// ===== LOGIN =====
document.getElementById('form-login')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  setLoading('btn-login', true, 'Sign In');
  try {
    const { user } = await signInWithEmailAndPassword(auth, email, password);
    await user.reload();
    const freshUser = auth.currentUser;
    if (!freshUser.emailVerified) {
      showAlert('Please verify your email first. Check your inbox (and spam folder). Click "Resend Email" below if needed.');
      document.getElementById('login-resend-wrap')?.classList.remove('hidden');
      await firebaseSignOut(auth);
      setLoading('btn-login', false, 'Sign In');
      return;
    }
    await setDoc(doc(db, 'users', user.uid), { isOnline: true, lastSeen: serverTimestamp() }, { merge: true });
    window.location.href = 'feed.html';
  } catch (err) {
    const msgs = {
      'auth/user-not-found': 'No account found with this email.',
      'auth/wrong-password': 'Incorrect password. Try again.',
      'auth/invalid-email': 'Please enter a valid email address.',
      'auth/too-many-requests': 'Too many failed attempts. Try again later.',
      'auth/invalid-credential': 'Invalid email or password.'
    };
    showAlert(msgs[err.code] || err.message);
    setLoading('btn-login', false, 'Sign In');
  }
});

// ===== GOOGLE SIGN IN =====
window.signInWithGoogle = async () => {
  const provider = new GoogleAuthProvider();
  try {
    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    const userRef = doc(db, 'users', user.uid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      const [fname, ...rest] = (user.displayName || 'LYNK User').split(' ');
      const baseUsername = (user.displayName || 'user').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0,15);
      let username = baseUsername;
      let counter = 1;
      while (true) {
        const uSnap = await getDocs(query(collection(db, 'users'), where('username', '==', username), limit(1)));
        if (uSnap.empty) break;
        username = `${baseUsername}${counter++}`;
      }
      await setDoc(userRef, {
        uid: user.uid, email: user.email,
        displayName: user.displayName || 'LYNK User',
        firstName: fname, lastName: rest.join(' '),
        username,
        userType: 'student',
        position: '',
        academicLevel: '',
        university: '', faculty: '', department: '',
        bio: '',
        photoURL: user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName||'User')}&background=a855f7&color=fff`,
        coverURL: '', role: 'user', adminRole: null,
        isOnline: true, profileComplete: false,
        skills: [], interests: [],
        createdAt: serverTimestamp(), lastSeen: serverTimestamp(),
        friendsCount: 0, postsCount: 0
      });
      pendingUserUid = user.uid;
      pendingUserEmail = user.email;
      await loadSchools();
      window.switchTab('university');
      return;
    }
    await setDoc(userRef, { isOnline: true, lastSeen: serverTimestamp() }, { merge: true });
    window.location.href = 'feed.html';
  } catch (err) {
    showAlert('Google sign-in failed. Please try again.');
  }
};

// ===== PASSWORD RESET =====
window.sendReset = async () => {
  const email = document.getElementById('reset-email').value.trim();
  if (!email) { showAlert('Enter your email to reset password.'); return; }
  try {
    await sendPasswordResetEmail(auth, email);
    showAlert('Reset link sent! Check your inbox.', 'success');
    window.hideResetModal();
  } catch (err) {
    showAlert('Could not send reset email. Check the address.');
  }
};

// ===== RESEND VERIFICATION =====
window.resendVerification = async () => {
  if (!pendingUserEmail || !pendingUserPassword) {
    showAlert('Go back to Sign In, enter your credentials, and click "Resend Verification Email".');
    return;
  }
  try {
    const { user } = await signInWithEmailAndPassword(auth, pendingUserEmail, pendingUserPassword);
    await sendEmailVerification(user, {
      url: 'https://crazylegend01.github.io/LYNK/auth.html',
      handleCodeInApp: false
    });
    await firebaseSignOut(auth);
    showAlert('✅ Verification email sent! Check your inbox and spam folder.', 'success');
  } catch (err) {
    if (err.code === 'auth/too-many-requests') {
      showAlert('Too many attempts — wait a few minutes before requesting another email.');
    } else {
      showAlert('Could not resend. Go back to Sign In and use the "Resend Verification Email" button.');
    }
  }
};

window.resendFromLogin = async () => {
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  if (!email || !password) {
    showAlert('Fill in your email and password above so we can resend the link.');
    return;
  }
  try {
    const { user } = await signInWithEmailAndPassword(auth, email, password);
    await sendEmailVerification(user, {
      url: 'https://crazylegend01.github.io/LYNK/auth.html',
      handleCodeInApp: false
    });
    await firebaseSignOut(auth);
    showAlert('✅ Verification email sent! Check your inbox and spam folder.', 'success');
    document.getElementById('login-resend-wrap')?.classList.add('hidden');
  } catch (err) {
    showAlert('Could not resend — check your email and password are correct.');
  }
};

window.signOut = async () => {
  await firebaseSignOut(auth);
  window.location.href = 'auth.html';
};
