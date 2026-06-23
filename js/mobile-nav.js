// ============================================================
// LYNK By Legends — Mobile Navigation (Drawer + Bottom Nav)
// Shared across all pages. No dependencies.
// ============================================================

// Apply saved theme immediately on every page load (no flash)
(function () {
  const saved = localStorage.getItem('lynk-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
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
