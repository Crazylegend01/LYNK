// ============================================================
// LYNK By Legends — Theme & Gradient System
// ============================================================

export const ThemeManager = {
  // Default gradient stops (hue values)
  defaults: {
    g1: '#a855f7', // purple
    g2: '#06b6d4', // cyan
    g3: '#3b82f6', // blue
  },

  init() {
    const saved = localStorage.getItem('lynk-theme') || 'dark';
    this.apply(saved);
    this.loadGradient();
    this.bindToggle();
    this.bindGradientPicker();
  },

  apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('lynk-theme', theme);
    const icon = document.getElementById('theme-icon');
    if (icon) icon.textContent = theme === 'dark' ? '☀️' : '🌙';
  },

  toggle() {
    const current = localStorage.getItem('lynk-theme') || 'dark';
    this.apply(current === 'dark' ? 'light' : 'dark');
  },

  loadGradient() {
    const s1 = localStorage.getItem('lynk-g1') || this.defaults.stop1;
    const s2 = localStorage.getItem('lynk-g2') || this.defaults.stop2;
    const s3 = localStorage.getItem('lynk-g3') || this.defaults.stop3;
    this.applyGradient(s1, s2, s3);

    // Populate pickers if they exist
    ['g1','g2','g3'].forEach(id => {
      const el = document.getElementById(`picker-${id}`);
      if (el) el.value = localStorage.getItem(`lynk-${id}`) || this.defaults[id];
    });
  },

  applyGradient(s1, s2, s3) {
    const root = document.documentElement;
    root.style.setProperty('--grad-1', s1);
    root.style.setProperty('--grad-2', s2);
    root.style.setProperty('--grad-3', s3);
    localStorage.setItem('lynk-g1', s1);
    localStorage.setItem('lynk-g2', s2);
    localStorage.setItem('lynk-g3', s3);
  },

  bindToggle() {
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.addEventListener('click', () => this.toggle());
  },

  bindGradientPicker() {
    ['g1','g2','g3'].forEach((id, i) => {
      const el = document.getElementById(`picker-${id}`);
      if (!el) return;
      el.addEventListener('input', () => {
        const s1 = document.getElementById('picker-g1')?.value || this.defaults.stop1;
        const s2 = document.getElementById('picker-g2')?.value || this.defaults.stop2;
        const s3 = document.getElementById('picker-g3')?.value || this.defaults.stop3;
        this.applyGradient(s1, s2, s3);
      });
    });
  }
};
