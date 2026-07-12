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
  signOut as firebaseSignOut,
  RecaptchaVerifier,
  PhoneAuthProvider,
  linkWithCredential
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, setDoc, getDoc, getDocs, updateDoc, collection, query, where, limit, serverTimestamp, increment as fsIncrement
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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
let pendingUserPhoneNumber = null;

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
  const phoneCode = document.getElementById('signup-phone-code')?.value || '';
  const phoneRaw  = (document.getElementById('signup-phone')?.value || '').replace(/\s+/g, '').replace(/-/g, '');
  const phoneNumber = phoneRaw ? `${phoneCode}${phoneRaw.startsWith('0') ? phoneRaw.slice(1) : phoneRaw}` : '';

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
    pendingUserPhoneNumber = phoneNumber || null;

    // Generate unique referral code for this user
    const referralCode = 'LNK' + user.uid.slice(0, 7).toUpperCase();

    // Check if a referral code was provided
    const enteredRef = (document.getElementById('signup-refcode')?.value || '').trim().toUpperCase()
      || localStorage.getItem('lynk_ref_code') || '';

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
      phoneNumber: phoneNumber || '',
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
      postsCount: 0,
      referralCode,
      referredBy: enteredRef || null,
      referralCount: 0
    });

    // Credit the referrer if a valid code was entered
    if (enteredRef && enteredRef !== referralCode) {
      try {
        const refSnap = await getDocs(query(collection(db, 'users'), where('referralCode', '==', enteredRef), limit(1)));
        if (!refSnap.empty) {
          const referrerDoc = refSnap.docs[0];
          const referrerId = referrerDoc.id;
          if (referrerId !== user.uid) {
              await updateDoc(doc(db, 'users', referrerId), {
              aiCredits: fsIncrement(10),
              referralCount: fsIncrement(1)
            });
          }
        }
      } catch { /* referral optional — don't block signup */ }
    }
    try { localStorage.removeItem('lynk_ref_code'); } catch {}

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
async function sendEmailVerificationAndShowScreen() {
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
    // Keep session open — needed for phone OTP linking below
  }
  document.getElementById('verify-email-addr').textContent = pendingUserEmail || '';
  const spamNote = document.getElementById('verify-spam-note');
  if (spamNote) spamNote.classList.remove('hidden');

  // Reveal phone section only when a number was provided at signup
  if (pendingUserPhoneNumber) {
    const phoneSection = document.getElementById('phone-verify-section');
    const phoneDisplay = document.getElementById('verify-phone-display');
    if (phoneSection) phoneSection.classList.remove('hidden');
    if (phoneDisplay) phoneDisplay.textContent = pendingUserPhoneNumber;
    const phonePill = document.getElementById('step-phone-pill');
    if (phonePill) {
      phonePill.style.borderColor = 'var(--grad-1)';
      phonePill.style.background = 'rgba(168,85,247,0.07)';
    }
  }

  window.switchTab('verify');
}

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

  await sendEmailVerificationAndShowScreen();
};

window.skipUniversityInfo = async () => {
  await sendEmailVerificationAndShowScreen();
};

// ===== PHONE OTP VERIFICATION =====
let recaptchaVerifier = null;
let phoneVerificationId = null;

window.sendPhoneOtp = async () => {
  const btn = document.getElementById('btn-send-otp');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Sending…'; }

  try {
    // Build invisible reCAPTCHA once; recreate on failure
    if (!recaptchaVerifier) {
      recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
        size: 'invisible',
        callback: () => {}
      });
      await recaptchaVerifier.render();
    }

    const provider = new PhoneAuthProvider(auth);
    phoneVerificationId = await provider.verifyPhoneNumber(
      pendingUserPhoneNumber,
      recaptchaVerifier
    );

    document.getElementById('otp-send-section').classList.add('hidden');
    document.getElementById('otp-input-section').classList.remove('hidden');
    document.getElementById('otp-input')?.focus();
    showAlert('✅ SMS sent! Enter the 6-digit code below.', 'success');
  } catch (err) {
    console.warn('Phone OTP send error:', err.code, err.message);
    const msgs = {
      'auth/invalid-phone-number':  'The phone number is invalid. Please go back and fix it.',
      'auth/too-many-requests':     'Too many attempts — wait a few minutes and try again.',
      'auth/captcha-check-failed':  'reCAPTCHA failed — refresh the page and retry.',
    };
    showAlert(msgs[err.code] || 'Could not send SMS. Check the number and try again.');
    if (btn) { btn.disabled = false; btn.textContent = '📲 Send SMS Code'; }
    if (recaptchaVerifier) { try { recaptchaVerifier.clear(); } catch {} recaptchaVerifier = null; }
  }
};

window.verifyPhoneOtp = async () => {
  const code = (document.getElementById('otp-input')?.value || '').trim();
  const btn  = document.getElementById('btn-verify-otp');
  if (!code || code.length !== 6) { showAlert('Enter the full 6-digit code.'); return; }
  if (!phoneVerificationId) { showAlert('Please send the SMS code first.'); return; }
  if (btn) { btn.disabled = true; btn.textContent = '⏳…'; }

  try {
    const credential = PhoneAuthProvider.credential(phoneVerificationId, code);
    const user = auth.currentUser;
    if (user) {
      await linkWithCredential(user, credential);
      await setDoc(doc(db, 'users', user.uid), { phoneVerified: true }, { merge: true });
    }

    document.getElementById('otp-input-section').classList.add('hidden');
    const badge = document.getElementById('phone-verified-badge');
    if (badge) { badge.style.display = 'flex'; }
    const pill = document.getElementById('step-phone-pill');
    if (pill) {
      pill.style.borderColor = '#22c55e';
      pill.style.background  = 'rgba(34,197,94,0.07)';
      const status = document.getElementById('phone-pill-status');
      if (status) { status.textContent = '✓ Verified'; status.style.color = '#22c55e'; }
    }
    showAlert('✅ Phone verified!', 'success');
  } catch (err) {
    console.warn('OTP verify error:', err.code, err.message);
    const msgs = {
      'auth/invalid-verification-code': 'Incorrect code — please try again.',
      'auth/code-expired':              'Code expired — tap Resend to get a new one.',
      'auth/provider-already-linked':   'This phone is already linked to another account.',
    };
    showAlert(msgs[err.code] || 'Verification failed. Please retry.');
    if (btn) { btn.disabled = false; btn.textContent = 'Verify'; }
  }
};

// Sign out after user finishes verification steps
window.finishVerifyAndSignOut = async () => {
  await firebaseSignOut(auth);
  window.switchTab('login');
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
