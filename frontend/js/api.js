const ITEM_CATEGORIES = ['Aksesori', 'Dompet', 'Kendaraan', 'Elektronik', 'Dokumen'];

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function getCurrentToken() {
  return localStorage.getItem('temubarang_token');
}

function getCurrentUser() {
  try {
    const user = JSON.parse(localStorage.getItem('temubarang_user') || 'null');
    return user && typeof user === 'object' ? user : null;
  } catch {
    localStorage.removeItem('temubarang_user');
    return null;
  }
}

function getAuthHeaders() {
  const token = getCurrentToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function getSafeImageUrl(value) {
  const fallback = 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=900&q=80';
  if (!value) return fallback;

  try {
    const url = new URL(value, window.location.origin);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : fallback;
  } catch {
    return fallback;
  }
}

async function apiFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(payload.message || 'Request gagal.');
  }

  return payload;
}

function isLoggedIn() {
  return !!getCurrentToken();
}

function logoutUser() {
  localStorage.removeItem('temubarang_token');
  localStorage.removeItem('temubarang_user');
  window.location.href = 'login.html';
}

function initializeTheme() {
  const toggle = document.querySelector('[data-theme-toggle]');
  if (!toggle) return;

  const applyTheme = (theme) => {
    const activeTheme = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = activeTheme;
    toggle.setAttribute('aria-pressed', String(activeTheme === 'dark'));
    toggle.textContent = activeTheme === 'dark' ? 'Mode terang' : 'Mode gelap';
  };

  applyTheme(localStorage.getItem('temubarang_theme'));
  toggle.addEventListener('click', () => {
    const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('temubarang_theme', nextTheme);
    applyTheme(nextTheme);
  });
}

function renderUserBadge() {
  const user = getCurrentUser();

  document.querySelectorAll('[data-admin-link]').forEach((link) => {
    link.hidden = user?.role !== 'admin';
  });

  initializeTheme();

  const currentPath = window.location.pathname === '/'
    ? '/index.html'
    : window.location.pathname;
  const relatedNavPaths = {
    '/item-detail.html': '/items.html',
    '/claim.html': '/items.html',
  };
  const activePath = relatedNavPaths[currentPath] || currentPath;

  document.querySelectorAll('.nav-links a[href]').forEach((link) => {
    const target = new URL(link.href, window.location.href);
    if (target.pathname === activePath) {
      link.setAttribute('aria-current', 'page');
    }
  });

  const userArea = document.getElementById('user-badge');
  if (!userArea) return;

  if (!user) {
    userArea.innerHTML = '<a href="login.html">Login</a>';
    return;
  }

  const role = user.role === 'admin' ? 'Admin' : 'Pengguna';
  userArea.innerHTML = `
    <span>Halo, ${escapeHTML(user.name)}</span>
    <span class="role-badge ${user.role === 'admin' ? 'admin' : 'user'}" aria-label="Peran: ${role}">${role}</span>
    <button class="button secondary" id="logout-btn" type="button">Logout</button>
  `;
  const btn = document.getElementById('logout-btn');
  if (btn) btn.addEventListener('click', logoutUser);
}
