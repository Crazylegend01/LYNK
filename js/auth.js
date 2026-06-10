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
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, setDoc, getDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

ThemeManager.init();

const showAlert = (msg, type = 'error') => {
  const el = document.getElementById('auth-alert');
  if (!el) return;
  el.className = `mb-4 p-3 rounded-xl text-sm font-medium ${type === 'error' ? 'border-red-500 text-red-400' : 'border-green-500 text-green-400'}`;
  el.style.background = type === 'error' ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)';
  el.style.border = `1px solid ${type === 'error' ? '#ef4444' : '#22c55e'}`;
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 6000);
};

const setLoading = (btnId, loading) => {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  btn.textContent = loading ? '⏳ Please wait...' : (btnId === 'btn-login' ? 'Sign In' : 'Create Account');
};

// Check if already logged in
onAuthStateChanged(auth, async (user) => {
  if (user) {
    const userRef = doc(db, 'users', user.uid);
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      window.location.href = 'feed.html';
    }
  }
});

// ===== LOGIN =====
document.getElementById('form-login')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  setLoading('btn-login', true);
  try {
    const { user } = await signInWithEmailAndPassword(auth, email, password);
    if (!user.emailVerified) {
      showAlert('Please verify your email before signing in. Check your inbox.', 'error');
      await firebaseSignOut(auth);
      setLoading('btn-login', false);
      return;
    }
    // Update online status
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
    showAlert(msgs[err.code] || err.message, 'error');
    setLoading('btn-login', false);
  }
});

// ===== SIGN UP =====
document.getElementById('form-signup')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fname = document.getElementById('signup-fname').value.trim();
  const lname = document.getElementById('signup-lname').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const university = document.getElementById('signup-university').value.trim();
  const faculty = document.getElementById('signup-faculty').value.trim();
  const department = document.getElementById('signup-department').value.trim();
  const password = document.getElementById('signup-password').value;

  if (!document.getElementById('terms-check').checked) {
    showAlert('Please accept the Terms of Service to continue.', 'error');
    return;
  }

  setLoading('btn-signup', true);
  try {
    const { user } = await createUserWithEmailAndPassword(auth, email, password);

    // Create user profile in Firestore
    await setDoc(doc(db, 'users', user.uid), {
      uid: user.uid,
      email,
      displayName: `${fname} ${lname}`,
      firstName: fname,
      lastName: lname,
      university,
      faculty,
      department,
      bio: '',
      photoURL: `https://ui-avatars.com/api/?name=${encodeURIComponent(fname+' '+lname)}&background=a855f7&color=fff&size=200`,
      coverURL: '',
      role: 'user',
      adminRole: null,
      isOnline: false,
      createdAt: serverTimestamp(),
      lastSeen: serverTimestamp(),
      friendsCount: 0,
      postsCount: 0
    });

    // Auto-join faculty community
    await setDoc(doc(db, 'communities', `${university}-${faculty}`.replace(/\s+/g,'-').toLowerCase()), {
      name: `${faculty} — ${university}`,
      type: 'faculty',
      university,
      faculty,
      memberCount: 1,
      createdAt: serverTimestamp()
    }, { merge: true });

    // Auto-join department community
    await setDoc(doc(db, 'communities', `${university}-${department}`.replace(/\s+/g,'-').toLowerCase()), {
      name: `${department} — ${university}`,
      type: 'department',
      university,
      faculty,
      department,
      memberCount: 1,
      createdAt: serverTimestamp()
    }, { merge: true });

    // Send email verification
    await sendEmailVerification(user);
    document.getElementById('verify-email-addr').textContent = email;
    window.switchTab('verify');
    await firebaseSignOut(auth);
  } catch (err) {
    const msgs = {
      'auth/email-already-in-use': 'An account with this email already exists.',
      'auth/weak-password': 'Password must be at least 8 characters.',
      'auth/invalid-email': 'Please enter a valid email address.'
    };
    showAlert(msgs[err.code] || err.message, 'error');
    setLoading('btn-signup', false);
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
      // New Google user — create profile
      const [fname, ...rest] = (user.displayName || 'LYNK User').split(' ');
      await setDoc(userRef, {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName || 'LYNK User',
        firstName: fname,
        lastName: rest.join(' '),
        university: '',
        faculty: '',
        department: '',
        bio: '',
        photoURL: user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName || 'User')}&background=a855f7&color=fff&size=200`,
        coverURL: '',
        role: 'user',
        adminRole: null,
        isOnline: true,
        createdAt: serverTimestamp(),
        lastSeen: serverTimestamp(),
        friendsCount: 0,
        postsCount: 0
      });
    }
    await setDoc(userRef, { isOnline: true, lastSeen: serverTimestamp() }, { merge: true });
    window.location.href = 'feed.html';
  } catch (err) {
    showAlert('Google sign-in failed. Please try again.', 'error');
  }
};

// ===== PASSWORD RESET =====
window.sendReset = async () => {
  const email = document.getElementById('reset-email').value.trim();
  if (!email) { showAlert('Enter your email to reset password.', 'error'); return; }
  try {
    await sendPasswordResetEmail(auth, email);
    showAlert('Reset link sent! Check your inbox.', 'success');
    window.hideResetModal();
  } catch (err) {
    showAlert('Could not send reset email. Check the address.', 'error');
  }
};

// ===== RESEND VERIFICATION =====
window.resendVerification = async () => {
  const user = auth.currentUser;
  if (user) {
    await sendEmailVerification(user);
    showAlert('Verification email resent!', 'success');
  }
};

// ===== 2FA VERIFY (Placeholder — Firebase 2FA uses phone, this is a UI stub) =====
window.verify2FA = () => {
  const code = document.getElementById('otp-input').value;
  if (code.length === 6) {
    showAlert('2FA verified! Redirecting...', 'success');
    setTimeout(() => { window.location.href = 'feed.html'; }, 1000);
  } else {
    showAlert('Enter the full 6-digit code.', 'error');
  }
};

// Global sign out
window.signOut = async () => {
  const user = auth.currentUser;
  if (user) {
    await setDoc(doc(db, 'users', user.uid), { isOnline: false, lastSeen: serverTimestamp() }, { merge: true });
  }
  await firebaseSignOut(auth);
  window.location.href = 'auth.html';
};
