// ============================================================
// LYNK By Legends — Premium & Payments Module (Phase 3)
// ============================================================

import { auth, db } from './firebase-config.js';
import { ThemeManager } from './theme.js';
import {
  doc, getDoc, setDoc, addDoc, collection, serverTimestamp, updateDoc,
  query, where, orderBy, limit, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged, signOut as firebaseSignOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

ThemeManager.init();

let currentUser = null;
let currentUserData = null;
let flutterwaveKey = null;

const PLANS = {
  weekly:    { amount: 1000,  label: 'Weekly Premium',    days: 7  },
  monthly:   { amount: 3500,  label: 'Monthly Premium',   days: 30 },
  quarterly: { amount: 9000,  label: 'Quarterly Premium', days: 90 },
};
let _fwCurrency = 'NGN';

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'auth.html'; return; }
  currentUser = user;
  const snap = await getDoc(doc(db, 'users', user.uid));
  currentUserData = snap.data() || {};

  const navAvatar = document.getElementById('nav-avatar');
  if (navAvatar) navAvatar.src = currentUserData.photoURL || `https://ui-avatars.com/api/?name=U&background=a855f7&color=fff`;

  // Load Flutterwave key from admin settings
  try {
    const settingsSnap = await getDoc(doc(db, 'settings', 'payments'));
    const pdata = settingsSnap.data() || {};
    flutterwaveKey = pdata.flutterwavePublicKey || pdata.fw_public_key || null;
    _fwCurrency = pdata.currency || 'NGN';
    // Override PLANS amounts with admin-set prices if available
    if (pdata.prices) {
      if (pdata.prices.weekly)    PLANS.weekly.amount    = pdata.prices.weekly;
      if (pdata.prices.monthly)   PLANS.monthly.amount   = pdata.prices.monthly;
      if (pdata.prices.quarterly) PLANS.quarterly.amount = pdata.prices.quarterly;
    }
  } catch (e) { console.warn('Flutterwave key load:', e.message); flutterwaveKey = null; }

  await checkCurrentStatus();
  await loadCreditSection();
});

// ===== AI CREDITS SECTION =====
async function loadCreditSection() {
  if (currentUserData.role === 'admin' || currentUserData.adminRole) {
    document.getElementById('credit-balance-display')?.replaceWith(
      Object.assign(document.createElement('p'), { className: 'text-sm', textContent: 'Admins have unlimited AI — credits do not apply.' })
    );
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const userData = (await getDoc(doc(db, 'users', currentUser.uid))).data() || {};
  const credits  = userData.aiCredits ?? 0;
  const lastRefill = userData.aiCreditsLastRefill || null;

  // Balance display
  const balEl    = document.getElementById('credit-balance-display');
  const badgeEl  = document.getElementById('credit-balance-badge');
  const barEl    = document.getElementById('credit-bar');
  const refillEl = document.getElementById('credit-refill-status');

  if (balEl)   balEl.textContent   = credits.toLocaleString() + ' credits';
  if (badgeEl) badgeEl.textContent = credits > 0 ? '✓ Active' : '⚠️ Empty';
  if (barEl)   barEl.style.width   = Math.min(100, (credits / 1000) * 100) + '%';
  if (refillEl) {
    if (lastRefill === today) {
      refillEl.textContent = '✓ Daily 100 credits already added today. Next refill tomorrow.';
    } else {
      refillEl.textContent = 'Daily 100 credits will be added next time you open LYNK AI.';
    }
  }

  // Purchase history
  const listEl = document.getElementById('credit-history-list');
  if (!listEl) return;
  try {
    const q = query(
      collection(db, 'paymentLogs'),
      where('uid', '==', currentUser.uid),
      where('type', '==', 'ai_credits'),
      orderBy('createdAt', 'desc'),
      limit(10)
    );
    const snap = await getDocs(q);
    if (snap.empty) {
      listEl.innerHTML = '<p class="text-xs text-center py-3" style="color:var(--text-muted)">No purchases yet.</p>';
      return;
    }
    listEl.innerHTML = snap.docs.map(d => {
      const data = d.data();
      const date = data.createdAt?.toDate?.()?.toLocaleDateString() || '—';
      return `<div class="flex items-center justify-between py-2 border-b" style="border-color:var(--border)">
        <div>
          <p class="text-sm font-medium">+${(data.credits || data.amount || 0).toLocaleString()} credits</p>
          <p class="text-xs" style="color:var(--text-muted)">${date}</p>
        </div>
        <div class="text-right">
          <p class="text-sm font-bold" style="color:#22c55e">₦${(data.amount || 0).toLocaleString()}</p>
          <p class="text-xs" style="color:var(--text-muted)">Paid</p>
        </div>
      </div>`;
    }).join('');
  } catch {
    listEl.innerHTML = '<p class="text-xs text-center py-3" style="color:var(--text-muted)">Could not load history.</p>';
  }
}

window.openBuyCreditsModal = () => {
  document.getElementById('buy-credits-modal-prem')?.classList.remove('hidden');
};

window.closeBuyCreditsModal = (e) => {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('buy-credits-modal-prem')?.classList.add('hidden');
};

window.updatePremCreditPreview = () => {
  const amt = Math.max(200, parseInt(document.getElementById('prem-credits-amount')?.value) || 200);
  const el = document.getElementById('prem-credits-preview');
  if (el) el.textContent = amt.toLocaleString();
};

window.startCreditPurchase = (amount) => {
  const inp = document.getElementById('prem-credits-amount');
  if (inp) { inp.value = amount; updatePremCreditPreview(); }
  openBuyCreditsModal();
};

window.processPremCredits = async () => {
  const amountEl = document.getElementById('prem-credits-amount');
  const amount = Math.max(200, parseInt(amountEl?.value) || 200);

  if (!flutterwaveKey) {
    alert('Error');
    return;
  }

  const txRef = `LYNK_CREDITS_${currentUser.uid}_${Date.now()}`;

  FlutterwaveCheckout({
    public_key: flutterwaveKey,
    tx_ref: txRef,
    amount,
    currency: _fwCurrency || 'NGN',
    payment_options: 'card,banktransfer,ussd',
    customer: {
      email: currentUser.email,
      name: currentUserData.displayName || 'LYNK User',
    },
    customizations: {
      title: 'LYNK AI Credits',
      description: `${amount.toLocaleString()} AI Credits`,
      logo: window.location.origin + '/assets/logo.jpg',
    },
    callback: async (response) => {
      if (response.status === 'successful' || response.status === 'completed') {
        const userRef = doc(db, 'users', currentUser.uid);
        const snap = await getDoc(userRef);
        const current = snap.data()?.aiCredits || 0;
        const newCredits = current + amount;
        await updateDoc(userRef, { aiCredits: newCredits });
        await addDoc(collection(db, 'paymentLogs'), {
          uid: currentUser.uid,
          type: 'ai_credits',
          amount,
          credits: amount,
          currency: 'NGN',
          txRef,
          transactionId: response.transaction_id,
          status: 'success',
          createdAt: serverTimestamp(),
        });
        document.getElementById('buy-credits-modal-prem')?.classList.add('hidden');
        alert(`🎉 ${amount.toLocaleString()} credits added! Your new balance: ${newCredits.toLocaleString()} credits.`);
        loadCreditSection(); // refresh display
      } else {
        alert('Payment was not completed. Please try again.');
      }
    },
    onclose: () => {},
  });
};

async function checkCurrentStatus() {
  const statusEl = document.getElementById('current-status');
  const statusText = document.getElementById('status-text');
  const premiumBadge = document.getElementById('premium-status-badge');
  const plansSection = document.getElementById('plans-section');

  // Admins get all premium features free — show a special badge and hide payment plans
  if (currentUserData.role === 'admin' || currentUserData.adminRole) {
    const roleLabels = { super: 'Super Admin', security: 'Security Admin', analytics: 'Analytics Admin', support: 'Support Admin', content: 'Content Admin' };
    const roleLabel = roleLabels[currentUserData.adminRole] || 'Admin';
    if (statusText) statusText.innerHTML = `👑 <strong>${roleLabel} — All Premium Features Unlocked</strong><br><small style="color:var(--text-muted)">Admins have free lifetime premium access</small>`;
    if (statusEl) {
      statusEl.style.borderColor = 'rgba(168,85,247,0.8)';
      statusEl.style.background = 'linear-gradient(135deg,rgba(168,85,247,.08),rgba(99,102,241,.08))';
    }
    if (premiumBadge) premiumBadge.classList.remove('hidden');
    if (plansSection) plansSection.innerHTML = `
      <div class="lynk-card p-6 text-center">
        <div class="text-4xl mb-3">👑</div>
        <h3 class="font-bold text-lg mb-2">Admin Access</h3>
        <p style="color:var(--text-muted)">As an admin you already have unlimited access to all premium features — AI, marketplace, communities, clubs and more — at no cost.</p>
      </div>`;
    return;
  }

  const snap = await getDoc(doc(db, 'premiumSubscriptions', currentUser.uid));
  if (snap.exists()) {
    const sub = snap.data();
    const expires = sub.expiresAt?.toDate?.();
    const isActive = sub.status === 'active' && expires && expires > new Date();

    if (isActive) {
      if (statusText) statusText.innerHTML = `⭐ <strong>Premium Active</strong> — expires ${expires.toLocaleDateString()}`;
      if (statusEl) statusEl.style.borderColor = 'rgba(168,85,247,0.5)';
      if (premiumBadge) premiumBadge.classList.remove('hidden');
      return;
    }
  }

  if (statusText) statusText.textContent = 'Free tier — 1,000 welcome credits + 100/day';

  // Check verified seller status
  if (currentUserData.verifiedSeller) {
    const sellerExp = currentUserData.verifiedSellerExpires?.toDate?.();
    if (sellerExp && sellerExp > new Date()) {
      if (statusText) statusText.innerHTML += ` · <span style="color:#22c55e">✓ Verified Seller until ${sellerExp.toLocaleDateString()}</span>`;
    }
  }
}

// ===== SUBSCRIBE PREMIUM =====
window.subscribePremium = async (planKey) => {
  const plan = PLANS[planKey];
  if (!plan) return;

  if (!flutterwaveKey) {
    alert('Error');
    return;
  }

  const txRef = `LYNK_PREMIUM_${currentUser.uid}_${Date.now()}`;

  FlutterwaveCheckout({
    public_key: flutterwaveKey,
    tx_ref: txRef,
    amount: plan.amount,
    currency: _fwCurrency,
    payment_options: 'card,banktransfer,ussd',
    customer: {
      email: currentUser.email,
      name: currentUserData.displayName || 'LYNK User',
    },
    customizations: {
      title: 'LYNK By Legends',
      description: plan.label,
      logo: window.location.origin + '/assets/logo.jpg',
    },
    callback: async (response) => {
      if (response.status === 'successful' || response.status === 'completed') {
        await activatePremium(planKey, txRef, response.transaction_id, plan.days);
        alert(`🎉 Welcome to ${plan.label}! Your premium benefits are now active.`);
        location.reload();
      } else {
        alert('Payment was not completed. Please try again.');
      }
    },
    onclose: () => {},
  });
};

async function activatePremium(planKey, txRef, transactionId, days) {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + days);

  await setDoc(doc(db, 'premiumSubscriptions', currentUser.uid), {
    uid: currentUser.uid,
    plan: planKey,
    status: 'active',
    txRef, transactionId,
    activatedAt: serverTimestamp(),
    expiresAt: expiresAt,
  });

  await updateDoc(doc(db, 'users', currentUser.uid), {
    isPremium: true,
    premiumPlan: planKey,
    premiumExpires: expiresAt,
  });

  await addDoc(collection(db, 'paymentLogs'), {
    uid: currentUser.uid,
    type: 'premium',
    plan: planKey,
    amount: PLANS[planKey].amount,
    currency: 'NGN',
    txRef, transactionId,
    status: 'success',
    createdAt: serverTimestamp()
  });
}

// ===== VERIFIED SELLER =====
window.purchaseVerifiedSeller = async () => {
  if (!flutterwaveKey) {
    alert('Error');
    return;
  }

  const txRef = `LYNK_SELLER_${currentUser.uid}_${Date.now()}`;

  FlutterwaveCheckout({
    public_key: flutterwaveKey,
    tx_ref: txRef,
    amount: 2500,
    currency: 'NGN',
    payment_options: 'card,banktransfer,ussd',
    customer: {
      email: currentUser.email,
      name: currentUserData.displayName || 'LYNK User',
    },
    customizations: {
      title: 'LYNK Verified Seller',
      description: 'Verified Seller Badge — 15 days',
      logo: window.location.origin + '/assets/logo.jpg',
    },
    callback: async (response) => {
      if (response.status === 'successful' || response.status === 'completed') {
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 15);

        await updateDoc(doc(db, 'users', currentUser.uid), {
          verifiedSeller: true,
          verifiedSellerExpires: expiresAt,
        });

        await addDoc(collection(db, 'paymentLogs'), {
          uid: currentUser.uid,
          type: 'verified_seller',
          amount: 2500,
          currency: 'NGN',
          txRef,
          transactionId: response.transaction_id,
          status: 'success',
          createdAt: serverTimestamp()
        });

        alert('✅ Verified Seller badge activated for 15 days!');
        location.reload();
      }
    },
    onclose: () => {},
  });
};

// ===== SPONSORED POSTS =====
window.createSponsoredPost = () => {
  document.getElementById('sponsored-post-modal').classList.remove('hidden');
};

window.closeSponsoredModal = (e) => {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('sponsored-post-modal').classList.add('hidden');
};

window.submitSponsoredPost = async () => {
  const title = document.getElementById('sp-title').value.trim();
  const content = document.getElementById('sp-content').value.trim();
  const link = document.getElementById('sp-link').value.trim();
  const days = Number(document.getElementById('sp-days').value);

  if (!title || !content) { alert('Please fill in all required fields.'); return; }

  const prices = { 1: 1000, 3: 2800, 7: 6000, 14: 11000 };
  const amount = prices[days] || 1000;

  // Submit for review first, pay on approval
  await addDoc(collection(db, 'sponsoredPosts'), {
    title, content, link, days, amount,
    sponsorId: currentUser.uid,
    sponsorName: currentUserData.displayName || 'Sponsor',
    sponsorEmail: currentUser.email,
    university: currentUserData.university || '',
    status: 'pending_review',
    createdAt: serverTimestamp()
  });

  closeSponsoredModal();
  alert('📬 Your sponsored post has been submitted for review. You\'ll be notified when it\'s approved, and payment will be collected then.');
};

// ===== PAY FOR APPROVED SPONSORED POST (called when admin approves) =====
window.payForSponsoredPost = (postId, amount) => {
  if (!flutterwaveKey) { alert('Error'); return; }

  const txRef = `LYNK_SPONSORED_${currentUser.uid}_${Date.now()}`;

  FlutterwaveCheckout({
    public_key: flutterwaveKey,
    tx_ref: txRef,
    amount,
    currency: 'NGN',
    payment_options: 'card,banktransfer,ussd',
    customer: { email: currentUser.email, name: currentUserData.displayName || 'Sponsor' },
    customizations: { title: 'LYNK Sponsored Post', description: `Sponsored post payment` },
    callback: async (response) => {
      if (response.status === 'successful' || response.status === 'completed') {
        await updateDoc(doc(db, 'sponsoredPosts', postId), {
          status: 'active',
          txRef,
          transactionId: response.transaction_id,
          paidAt: serverTimestamp(),
          startsAt: serverTimestamp(),
        });
        alert('🎉 Your sponsored post is now live!');
      }
    },
    onclose: () => {},
  });
};

window.signOut = async () => {
  await firebaseSignOut(auth);
  window.location.href = 'auth.html';
};
