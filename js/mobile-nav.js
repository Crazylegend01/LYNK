// ============================================================
// LYNK By Legends — Mobile Navigation (Drawer + Bottom Nav)
// Shared across all pages. No dependencies.
// ============================================================

// ─── Page loading overlay ────────────────────────────────────────────────────
(function () {
  const overlay = document.createElement('div');
  overlay.id = 'lynk-page-loader';
  overlay.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px">
      <div style="width:72px;height:72px;border-radius:50%;box-shadow:0 0 30px #a855f750;animation:loaderPop 0.4s cubic-bezier(0.34,1.56,0.64,1) forwards;background:linear-gradient(135deg,#a855f7,#06b6d4,#3b82f6);display:flex;align-items:center;justify-content:center;font-weight:900;font-size:22px;color:#fff;font-family:Inter,sans-serif;letter-spacing:-1px">
        LYNK
      </div>
    </div>`;
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#020817;display:flex;align-items:center;justify-content:center;transition:opacity 0.4s ease';

  const style = document.createElement('style');
  style.textContent = `
    @keyframes loaderPop { from { opacity:0; transform:scale(0.7); } to { opacity:1; transform:scale(1); } }
    [data-theme="light"] #lynk-page-loader { background:#f8fafc !important; }
  `;
  document.head.appendChild(style);
  document.body.insertBefore(overlay, document.body.firstChild);


  function hideLoader() {
    const bar = document.getElementById('lynk-loader-bar');
    if (bar) bar.style.width = '100%';
    setTimeout(() => {
      overlay.style.opacity = '0';
      setTimeout(() => overlay.remove(), 400);
    }, 200);
  }

  if (document.readyState === 'complete') {
    setTimeout(hideLoader, 300);
  } else {
    window.addEventListener('load', () => setTimeout(hideLoader, 300));
    // Fallback
    setTimeout(hideLoader, 3500);
  }
})();

// ─── Theme — apply immediately (no flash) ────────────────────────────────────
(function () {
  const saved = localStorage.getItem('lynk-theme') || 'system';
  let resolved = saved;
  if (saved === 'system') {
    resolved = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  document.documentElement.setAttribute('data-theme', resolved);
  document.documentElement.setAttribute('data-theme-pref', saved);
})();

function openMobileNav() {
  document.querySelector('.lynk-sidebar')?.classList.add('drawer-open');
  document.getElementById('drawer-overlay')?.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeMobileNav() {
  document.querySelector('.lynk-sidebar')?.classList.remove('drawer-open');
  document.getElementById('drawer-overlay')?.classList.remove('open');
  document.body.style.overflow = '';
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMobileNav(); });

// ─── Ambient glassmorphism orbs ──────────────────────────────────────────────
(function () {
  const wrap = document.createElement('div');
  wrap.className = 'lynk-orb-wrap';
  wrap.innerHTML = '<div class="lynk-orb lynk-orb-1"></div><div class="lynk-orb lynk-orb-2"></div><div class="lynk-orb lynk-orb-3"></div>';
  document.body.insertBefore(wrap, document.body.firstChild);
})();

// ─── AI low-credit badge ──────────────────────────────────────────────────────
(function () {
  function applyAiBadge() {
    const credits  = parseInt(localStorage.getItem('lynk_ai_credits') || '-1', 10);
    const premium  = localStorage.getItem('lynk_ai_premium') === '1';
    const isLow    = !premium && credits >= 0 && credits <= 50;
    document.querySelectorAll('.lynk-bottom-nav a[href="ai.html"]').forEach(link => {
      link.classList.toggle('ai-low-credit', isLow);
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyAiBadge);
  } else {
    applyAiBadge();
  }
  window.addEventListener('storage', applyAiBadge);
})();
