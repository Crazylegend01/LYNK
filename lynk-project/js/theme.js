// ============================================================
// LYNK By Legends — Theme & Gradient System
// ============================================================

export const ThemeManager = {
  defaults: {
    g1: '#a855f7',
    g2: '#06b6d4',
    g3: '#3b82f6',
  },

  themes: {
    system:   null, // resolved dynamically
    dark:     { g1: '#a855f7', g2: '#06b6d4', g3: '#3b82f6' },
    light:    { g1: '#a855f7', g2: '#06b6d4', g3: '#3b82f6' },
    sunset:   { g1: '#f97316', g2: '#ec4899', g3: '#8b5cf6' },
    ocean:    { g1: '#06b6d4', g2: '#0ea5e9', g3: '#6366f1' },
    forest:   { g1: '#22c55e', g2: '#10b981', g3: '#06b6d4' },
    midnight: { g1: '#818cf8', g2: '#c084fc', g3: '#f472b6' },
  },

  // Resolve 'system' to the actual OS-preferred theme
  resolveTheme(theme) {
    if (theme === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return theme;
  },

  init() {
    const saved = localStorage.getItem('lynk-theme') || 'system';
    this.apply(saved);
    this.loadGradient();
    this.bindToggle();
    this.bindGradientPicker();
    // Watch OS preference changes when theme is 'system'
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if ((localStorage.getItem('lynk-theme') || 'system') === 'system') {
        this.apply('system');
      }
    });
  },

  apply(theme) {
    localStorage.setItem('lynk-theme', theme);
    const resolved = this.resolveTheme(theme);
    document.documentElement.setAttribute('data-theme', resolved);

    // Apply theme gradient colors
    if (this.themes[resolved]) {
      const t = this.themes[resolved];
      const hasCustom = localStorage.getItem('lynk-custom-gradient');
      if (!hasCustom) {
        this.applyGradient(t.g1, t.g2, t.g3, false);
      }
    }

    const icon = document.getElementById('theme-icon');
    if (icon) {
      const icons = { system: '🖥️', dark: '☀️', light: '🌙', sunset: '🌅', ocean: '🌊', forest: '🌿', midnight: '✨' };
      icon.textContent = icons[theme] || '🎨';
    }
    // Highlight active swatch if present
    document.querySelectorAll('.theme-swatch').forEach(el => el.classList.remove('selected'));
    document.querySelector(`.theme-swatch-${theme}`)?.classList.add('selected');
    document.querySelectorAll('[data-theme-btn]').forEach(el => el.classList.remove('selected'));
    document.querySelector(`[data-theme-btn="${theme}"]`)?.classList.add('selected');
  },

  toggle() {
    const current = localStorage.getItem('lynk-theme') || 'system';
    const next = current === 'dark' ? 'light' : current === 'light' ? 'system' : 'dark';
    this.apply(next);
  },

  loadGradient() {
    const theme = localStorage.getItem('lynk-theme') || 'system';
    const resolved = this.resolveTheme(theme);
    const hasCustom = localStorage.getItem('lynk-custom-gradient');
    let s1, s2, s3;
    if (hasCustom) {
      s1 = localStorage.getItem('lynk-g1') || this.defaults.g1;
      s2 = localStorage.getItem('lynk-g2') || this.defaults.g2;
      s3 = localStorage.getItem('lynk-g3') || this.defaults.g3;
    } else if (this.themes[resolved]) {
      s1 = this.themes[resolved].g1;
      s2 = this.themes[resolved].g2;
      s3 = this.themes[resolved].g3;
    } else {
      s1 = localStorage.getItem('lynk-g1') || this.defaults.g1;
      s2 = localStorage.getItem('lynk-g2') || this.defaults.g2;
      s3 = localStorage.getItem('lynk-g3') || this.defaults.g3;
    }
    this.applyGradient(s1, s2, s3, false);

    ['g1','g2','g3'].forEach(id => {
      const el = document.getElementById(`picker-${id}`);
      if (el) el.value = localStorage.getItem(`lynk-${id}`) || this.defaults[id];
      const el2 = document.getElementById(`modal-picker-${id}`);
      if (el2) el2.value = localStorage.getItem(`lynk-${id}`) || this.defaults[id];
    });
  },

  applyGradient(s1, s2, s3, saveAsCustom = true) {
    const root = document.documentElement;
    root.style.setProperty('--grad-1', s1 || this.defaults.g1);
    root.style.setProperty('--grad-2', s2 || this.defaults.g2);
    root.style.setProperty('--grad-3', s3 || this.defaults.g3);
    localStorage.setItem('lynk-g1', s1 || this.defaults.g1);
    localStorage.setItem('lynk-g2', s2 || this.defaults.g2);
    localStorage.setItem('lynk-g3', s3 || this.defaults.g3);
    if (saveAsCustom) {
      localStorage.setItem('lynk-custom-gradient', '1');
    }
  },

  resetGradient() {
    const theme = localStorage.getItem('lynk-theme') || 'system';
    const resolved = this.resolveTheme(theme);
    localStorage.removeItem('lynk-custom-gradient');
    const t = this.themes[resolved] || this.defaults;
    this.applyGradient(t.g1, t.g2, t.g3, false);
    ['g1','g2','g3'].forEach((id, i) => {
      const val = [t.g1, t.g2, t.g3][i];
      const el = document.getElementById(`picker-${id}`);
      if (el) el.value = val;
      const el2 = document.getElementById(`modal-picker-${id}`);
      if (el2) el2.value = val;
    });
  },

  bindToggle() {
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.addEventListener('click', () => this.toggle());
  },

  bindGradientPicker() {
    ['g1','g2','g3'].forEach(id => {
      ['picker-', 'modal-picker-'].forEach(prefix => {
        const el = document.getElementById(`${prefix}${id}`);
        if (!el) return;
        el.addEventListener('input', () => {
          const s1 = document.getElementById('picker-g1')?.value || document.getElementById('modal-picker-g1')?.value || this.defaults.g1;
          const s2 = document.getElementById('picker-g2')?.value || document.getElementById('modal-picker-g2')?.value || this.defaults.g2;
          const s3 = document.getElementById('picker-g3')?.value || document.getElementById('modal-picker-g3')?.value || this.defaults.g3;
          this.applyGradient(s1, s2, s3, true);
        });
      });
    });
  }
};
