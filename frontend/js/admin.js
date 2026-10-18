async function loadAdminDashboard() {
  const content = document.getElementById('admin-content');
  if (!content) return;

  try {
    const token = localStorage.getItem('temubarang_token');
    if (!token) {
      window.location.href = 'login.html';
      return;
    }

    const result = await fetch('http://localhost:3003/api/claims', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });

    const data = await result.json();

    if (!result.ok) {
      throw new Error(data.message || 'Akses admin gagal.');
    }

    const claims = data.claims || [];
    if (!claims.length) {
      content.innerHTML = '<div class="empty-state">Belum ada klaim masuk.</div>';
      return;
    }

    content.innerHTML = `<ul class="list">${claims.map((claim) => `
      <li>
        <strong>${claim.user_name}</strong> -> <strong>${claim.item_title}</strong>
        <div class="muted">Jawaban: ${claim.verification_answer}</div>
        <div class="muted">Status: ${claim.status}</div>
        <div style="margin-top: 10px; display: flex; gap: 10px; flex-wrap: wrap;">
          <button class="button primary" data-action="approve" data-id="${claim.id}">Setujui</button>
          <button class="button danger" data-action="reject" data-id="${claim.id}">Tolak</button>
        </div>
      </li>
    `).join('')}</ul>`;

    content.querySelectorAll('button[data-action]').forEach((button) => {
      button.addEventListener('click', async () => {
        const action = button.dataset.action;
        const claimId = button.dataset.id;
        const url = `http://localhost:3003/api/claims/${claimId}/${action}`;

        const confirmText = action === 'approve' ? 'Setujui klaim ini?' : 'Tolak klaim ini?';
        if (!window.confirm(confirmText)) return;

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        });

        const payload = await response.json();
        if (!response.ok) {
          alert(payload.message || 'Proses gagal.');
          return;
        }

        alert(payload.message || 'Proses selesai.');
        loadAdminDashboard();
      });
    });
  } catch (error) {
    content.innerHTML = `<div class="message error">${error.message}</div>`;
  }
}
