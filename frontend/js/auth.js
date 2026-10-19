document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('auth-form');
  const messageBox = document.getElementById('message-box');
  const mode = document.body.dataset.mode;

  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());

    try {
      messageBox.className = 'message info';
      messageBox.textContent = 'Memproses...';

      const endpoint = mode === 'register'
        ? '/api/auth/register'
        : '/api/auth/login';

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Proses gagal.');
      }

      localStorage.setItem('temubarang_token', data.token);
      localStorage.setItem('temubarang_user', JSON.stringify(data.user));

      messageBox.className = 'message success';
      messageBox.textContent = data.message || 'Berhasil.';
      setTimeout(() => window.location.href = 'items.html', 600);
    } catch (error) {
      messageBox.className = 'message error';
      messageBox.textContent = error.message;
    }
  });
});
