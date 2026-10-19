const dashboardContent = document.getElementById('dashboard-content');
let studentCardPreviewUrl = null;
renderUserBadge();

function renderClaims(claims) {
  if (!claims.length) return '<div class="empty-state">Belum ada klaim.</div>';

  return `<ul class="list">${claims.map((claim) => `
    <li>
      <strong>${escapeHTML(claim.item_title)}</strong>
      <div><a class="item-id" href="item-detail.html?id=${encodeURIComponent(claim.item_id)}">ID barang: #${escapeHTML(claim.item_id)}</a></div>
      <div class="muted">Status: ${escapeHTML(claim.status)}</div>
      ${claim.status === 'APPROVED' && claim.item_status === 'CLAIMED'
        ? '<div class="message info">Klaim disetujui. Penyerahan barang masih menunggu koordinasi dengan Admin.</div>'
        : claim.item_status === 'RETURNED'
          ? '<div class="message success">Penyerahan barang telah dicatat selesai.</div>'
          : ''}
      <div class="claim-answer"><strong>Jawaban survey Anda:</strong><br />${escapeHTML(claim.verification_answer)}</div>
      ${claim.admin_note === 'Verifikasi otomatis gagal'
        ? '<div class="message info">Catatan sistem lama: klaim ini pernah ditolak oleh verifikasi otomatis sebelum alur peninjauan manual diterapkan. Riwayat lama dipertahankan, tetapi penolakan tersebut bukan keputusan Admin manual.</div>'
        : claim.admin_note ? `<div class="muted">Catatan admin: ${escapeHTML(claim.admin_note)}</div>` : ''}
    </li>
  `).join('')}</ul>`;
}

function renderProfile(profile) {
  const statusLabels = {
    NOT_SUBMITTED: 'Belum diajukan',
    PENDING: 'Menunggu pemeriksaan Admin',
    VERIFIED: 'Terverifikasi secara manual',
    REJECTED: 'Perlu diperbaiki',
  };
  return `
    <section class="profile-section" aria-labelledby="profile-title">
      <h3 id="profile-title">Profil dan verifikasi identitas</h3>
      <p class="muted">Nomor HP digunakan untuk koordinasi. Pemeriksaan KTM dilakukan manual oleh Admin dan tidak membuktikan kepemilikan barang.</p>
      <form id="profile-form" class="profile-form">
        <label>Nama akun<input name="name" value="${escapeHTML(profile.name || '')}" minlength="2" maxlength="100" required /></label>
        <label>Nomor HP<input name="phone" type="tel" autocomplete="tel" value="${escapeHTML(profile.phone || '')}" placeholder="081234567890" /></label>
        <label>Nama mahasiswa<input name="student_name" value="${escapeHTML(profile.student_name || '')}" maxlength="100" /></label>
        <label>NIM<input name="nim" value="${escapeHTML(profile.nim || '')}" maxlength="40" /></label>
        <label>Program studi<input name="study_program" value="${escapeHTML(profile.study_program || '')}" maxlength="120" /></label>
        <button class="button primary" type="submit">Simpan profil</button>
      </form>
      <p class="identity-status">Status identitas: <strong>${escapeHTML(statusLabels[profile.identity_status] || profile.identity_status)}</strong></p>
      <p id="identity-note" class="message info" ${profile.identity_note ? '' : 'hidden'}>${escapeHTML(profile.identity_note || '')}</p>
      <form id="student-card-form" class="student-card-form">
        <label for="student-card-file">Foto KTM (opsional, maksimal 5 MB)</label>
        <input id="student-card-file" name="student_card" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" />
        <p class="muted">KTM hanya dapat dilihat oleh Anda dan Admin. Gunakan foto yang memperlihatkan informasi identitas dengan jelas.</p>
        <div id="student-card-preview" class="student-card-preview" ${profile.has_student_card ? '' : 'hidden'}>
          ${profile.has_student_card ? '<img data-private-photo="/api/auth/users/' + encodeURIComponent(profile.id) + '/student-card" alt="Foto KTM tersimpan" />' : ''}
          <span id="student-card-filename">${profile.has_student_card ? 'Foto KTM tersimpan' : ''}</span>
        </div>
        <button class="button secondary" type="submit">Unggah KTM untuk pemeriksaan</button>
      </form>
      <div id="profile-message" class="message" role="status" aria-live="polite"></div>
    </section>
  `;
}

function renderNotifications(notifications) {
  if (!notifications.length) return '<div class="empty-state">Belum ada notifikasi.</div>';

  return `<ul class="list">${notifications.map((notification) => `
    <li>
      <strong>${escapeHTML(notification.message)}</strong>
      <div class="muted">${escapeHTML(notification.type)} · ${notification.is_read ? 'Sudah dibaca' : 'Belum dibaca'}</div>
      ${notification.is_read ? '' : `<button class="button secondary" type="button" data-action="mark-read" data-id="${escapeHTML(notification.id)}">Tandai dibaca</button>`}
    </li>
  `).join('')}</ul>`;
}

function renderReportedItems(items) {
  if (!items.length) return '<div class="empty-state">Anda belum melaporkan barang.</div>';

  return `<ul class="list">${items.map((item) => `
    <li>
      <strong>${escapeHTML(item.title)}</strong>
      <div>${item.listing_status === 'APPROVED'
        ? `<a class="item-id" href="item-detail.html?id=${encodeURIComponent(item.id)}">ID barang: #${escapeHTML(item.id)}</a>`
        : `<span class="item-id">ID barang: #${escapeHTML(item.id)}</span>`}</div>
      <div class="muted">${escapeHTML(item.category)} · ${escapeHTML(item.location_found)} · ${escapeHTML(item.status)}</div>
      <div class="muted">Verifikasi laporan: ${escapeHTML(item.listing_status)}${item.review_note ? ` · ${escapeHTML(item.review_note)}` : ''}</div>
      ${item.image_url ? `<p><a href="${escapeHTML(getSafeImageUrl(item.image_url))}" ${String(item.image_url).startsWith('/api/items/') ? `data-private-photo="${escapeHTML(item.image_url)}"` : 'target="_blank" rel="noopener noreferrer'}>Lihat foto laporan</a></p>` : ''}
      <div style="margin-top: 10px; display: flex; gap: 10px; flex-wrap: wrap;">
        <button class="button secondary" type="button" data-action="edit" data-id="${escapeHTML(item.id)}">Edit laporan</button>
        <button class="button danger" type="button" data-action="delete" data-id="${escapeHTML(item.id)}">Hapus laporan</button>
      </div>
      <form class="report-edit-form" data-id="${escapeHTML(item.id)}" hidden>
        <label>Judul barang<input name="title" value="${escapeHTML(item.title)}" required minlength="3" /></label>
        <label>Kategori
          <select name="category" required>
            ${ITEM_CATEGORIES.map((category) => `<option value="${escapeHTML(category)}" ${category === item.category ? 'selected' : ''}>${escapeHTML(category)}</option>`).join('')}
          </select>
        </label>
        <label>Deskripsi<textarea name="description" required minlength="10">${escapeHTML(item.description)}</textarea></label>
        <label>Warna<input name="color" value="${escapeHTML(item.color || '')}" /></label>
        <label>Lokasi ditemukan<input name="location_found" value="${escapeHTML(item.location_found)}" required minlength="3" /></label>
        <label>Tanggal ditemukan<input name="date_found" type="date" value="${escapeHTML(String(item.date_found).slice(0, 10))}" required /></label>
        <p class="muted">Foto yang sudah tersimpan tidak diubah dari formulir edit ini.</p>
        <div style="display: flex; gap: 10px; flex-wrap: wrap;">
          <button class="button primary" type="submit">Simpan perubahan</button>
          <button class="button secondary" type="button" data-action="cancel-edit">Batal</button>
        </div>
      </form>
    </li>
  `).join('')}</ul>`;
}

async function loadDashboard() {
  if (!isLoggedIn()) {
    window.location.href = 'login.html';
    return;
  }

  dashboardContent.innerHTML = '<div class="empty-state">Memuat dashboard...</div>';

  try {
    const user = getCurrentUser();
    const isAdmin = user?.role === 'admin';
    const role = isAdmin ? 'Admin' : 'Pengguna';
    const [claims, notifications, reportedItems, profileResult] = await Promise.all([
      apiFetch('/api/claims/my'),
      apiFetch('/api/notifications'),
      apiFetch('/api/items/my'),
      apiFetch('/api/auth/profile'),
    ]);
    const profile = profileResult.profile;

    dashboardContent.innerHTML = `
      <section class="account-summary" aria-label="Informasi akun">
        <strong>${escapeHTML(user?.name || 'Akun TemuBarang')}</strong>
        <span>Peran: <span class="role-badge ${isAdmin ? 'admin' : 'user'}">${role}</span></span>
      </section>
      ${renderProfile(profile)}
      <hr />
      <h3>Klaim saya</h3>
      ${renderClaims(Array.isArray(claims.claims) ? claims.claims : [])}
      <hr />
      <h3>Notifikasi</h3>
      ${renderNotifications(Array.isArray(notifications.notifications) ? notifications.notifications : [])}
      <hr />
      <h3>Laporan barang saya</h3>
      ${renderReportedItems(Array.isArray(reportedItems.items) ? reportedItems.items : [])}
    `;
    await Promise.all([...document.querySelectorAll('[data-private-photo]')].map(loadPrivatePhoto));
  } catch (error) {
    dashboardContent.innerHTML = `<div class="message error">${escapeHTML(error.message)}</div>`;
  }

  async function loadPrivatePhoto(image) {
    if (!image) return;
    try {
      const response = await fetch(image.dataset.privatePhoto, { headers: getAuthHeaders() });
      if (!response.ok) throw new Error('Foto tidak dapat dimuat.');
      const blobUrl = URL.createObjectURL(await response.blob());
      if (image.tagName === 'IMG') {
        image.src = blobUrl;
      } else {
        image.href = blobUrl;
        image.target = '_blank';
        image.rel = 'noopener noreferrer';
      }
    } catch (error) {
      const message = document.createElement('span');
      message.className = 'message error';
      message.textContent = error.message;
      image.replaceWith(message);
    }
  }

  dashboardContent.addEventListener('change', (event) => {
    if (event.target.id !== 'student-card-file') return;
    const file = event.target.files[0];
    const preview = document.getElementById('student-card-preview');
    const status = document.getElementById('profile-message');
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
        || !/\.(jpe?g|png|webp)$/i.test(file.name)) {
      if (studentCardPreviewUrl) URL.revokeObjectURL(studentCardPreviewUrl);
      studentCardPreviewUrl = null;
      event.target.value = '';
      status.className = 'message error';
      status.textContent = 'Pilih foto KTM berformat JPG, JPEG, PNG, atau WEBP.';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      if (studentCardPreviewUrl) URL.revokeObjectURL(studentCardPreviewUrl);
      studentCardPreviewUrl = null;
      event.target.value = '';
      status.className = 'message error';
      status.textContent = 'Ukuran foto KTM maksimal 5 MB.';
      return;
    }
    if (studentCardPreviewUrl) URL.revokeObjectURL(studentCardPreviewUrl);
    studentCardPreviewUrl = URL.createObjectURL(file);
    preview.hidden = false;
    document.getElementById('student-card-filename').textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`;
    let previewImage = preview.querySelector('img');
    if (!previewImage) {
      previewImage = document.createElement('img');
      previewImage.alt = 'Pratinjau foto KTM';
      preview.prepend(previewImage);
    }
    previewImage.src = studentCardPreviewUrl;
  });

  dashboardContent.addEventListener('submit', async (event) => {
    if (event.target.id === 'profile-form') {
      event.preventDefault();
      const form = event.target;
      const button = form.querySelector('button[type="submit"]');
      const message = document.getElementById('profile-message');
      button.disabled = true;
      try {
        const payload = Object.fromEntries(new FormData(form).entries());
        const result = await apiFetch('/api/auth/profile', {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        const user = getCurrentUser();
        localStorage.setItem('temubarang_user', JSON.stringify({ ...user, name: result.profile.name }));
        renderUserBadge();
        const identityLabels = {
          NOT_SUBMITTED: 'Belum diajukan',
          PENDING: 'Menunggu pemeriksaan Admin',
          VERIFIED: 'Terverifikasi secara manual',
          REJECTED: 'Perlu diperbaiki',
        };
        document.querySelector('.identity-status strong').textContent = identityLabels[result.profile.identity_status] || result.profile.identity_status;
        const identityNote = document.getElementById('identity-note');
        identityNote.textContent = result.profile.identity_note || '';
        identityNote.hidden = !result.profile.identity_note;
        form.querySelector('button[type="submit"]').disabled = false;
        message.className = 'message success';
        message.textContent = result.message;
      } catch (error) {
        button.disabled = false;
        message.className = 'message error';
        message.textContent = error.message;
      }
      return;
    }

    if (event.target.id === 'student-card-form') {
      event.preventDefault();
      const form = event.target;
      const input = form.elements.student_card;
      const file = input.files[0];
      const button = form.querySelector('button[type="submit"]');
      const message = document.getElementById('profile-message');
      if (!file) {
        message.className = 'message error';
        message.textContent = 'Pilih file foto KTM terlebih dahulu.';
        return;
      }
      button.disabled = true;
      message.className = 'message info';
      message.textContent = 'Mengunggah foto KTM...';
      try {
        const response = await fetch('/api/auth/profile/student-card', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: new FormData(form),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'Foto KTM gagal diunggah.');
        await loadDashboard();
        const refreshedMessage = document.getElementById('profile-message');
        refreshedMessage.className = 'message success';
        refreshedMessage.textContent = result.message;
      } catch (error) {
        button.disabled = false;
        message.className = 'message error';
        message.textContent = error.message;
      }
    }
  });
}

dashboardContent.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const action = button.dataset.action;
  if (action === 'edit') {
    const editForm = button.closest('li').querySelector('.report-edit-form');
    editForm.hidden = false;
    editForm.querySelector('input[name="title"]').focus();
    return;
  }

  if (action === 'cancel-edit') {
    button.closest('.report-edit-form').hidden = true;
    return;
  }

  if (action === 'delete' && !window.confirm('Hapus laporan barang ini?')) return;

  button.disabled = true;
  try {
    if (action === 'delete') {
      await apiFetch(`/api/items/${encodeURIComponent(button.dataset.id)}`, { method: 'DELETE' });
    } else if (action === 'mark-read') {
      await apiFetch(`/api/notifications/${encodeURIComponent(button.dataset.id)}/read`, { method: 'PUT' });
    }
    await loadDashboard();
  } catch (error) {
    button.disabled = false;
    let message = dashboardContent.querySelector('.action-error');
    if (!message) {
      message = document.createElement('div');
      message.className = 'message error action-error';
      dashboardContent.prepend(message);
    }
    message.textContent = error.message;
  }
});

dashboardContent.addEventListener('submit', async (event) => {
  if (!event.target.matches('.report-edit-form')) return;
  event.preventDefault();

  const form = event.target;
  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;

  try {
    const payload = Object.fromEntries(new FormData(form).entries());
    await apiFetch(`/api/items/${encodeURIComponent(form.dataset.id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    await loadDashboard();
  } catch (error) {
    submitButton.disabled = false;
    let message = dashboardContent.querySelector('.action-error');
    if (!message) {
      message = document.createElement('div');
      message.className = 'message error action-error';
      dashboardContent.prepend(message);
    }
    message.textContent = error.message;
  }
});

loadDashboard();
