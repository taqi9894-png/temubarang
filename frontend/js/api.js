const API_BASE_URL = 'http://localhost:3001';

function getCurrentToken() {
  return localStorage.getItem('temubarang_token');
}

function getAuthHeaders() {
  const token = getCurrentToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...(options.headers || {}),
    },
    ...options,
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

function renderUserBadge() {
  const user = JSON.parse(localStorage.getItem('temubarang_user') || 'null');
  const userArea = document.getElementById('user-badge');
  if (!userArea) return;

  if (!user) {
    userArea.innerHTML = '<a href="login.html">Login</a>';
    return;
  }

  userArea.innerHTML = `Halo, ${user.name} · <button class="button secondary" id="logout-btn" type="button">Logout</button>`;
  const btn = document.getElementById('logout-btn');
  if (btn) btn.addEventListener('click', logoutUser);
}
