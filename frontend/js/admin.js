const adminContent = document.getElementById('admin-content');
const adminSummary = document.getElementById('admin-summary');
const reportsContent = document.getElementById('reports-content');
const reportsPagination = document.getElementById('reports-pagination');
const claimMessage = document.getElementById('claim-message');
const identityContent = document.getElementById('identities-content');
const identityMessage = document.getElementById('identity-message');
const reportMessage = document.getElementById('report-message');
const reportFilters = document.getElementById('report-filters');
const claimFilters = document.getElementById('claim-filters');
const reportState = { page: 1, limit: 10 };
let adminClaims = [];

function formatAdminDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString('id-ID');
}

function renderAdminSummary(summary) {
  const metrics = [
    ['Total laporan', summary.total_reports],
    ['Laporan menunggu verifikasi', summary.pending_reports],
    ['Barang ditemukan', summary.found_items],
    ['Menunggu klaim', summary.claimed_items],
    ['Sudah dikembalikan', summary.returned_items],
    ['Klaim perlu ditinjau', summary.pending_claims],
    ['Klaim disetujui', summary.approved_claims],
    ['Klaim ditolak', summary.rejected_claims],
  ];
  adminSummary.innerHTML = metrics.map(([label, value]) => `
    <article class="admin-stat">
      <span class="admin-stat-label">${escapeHTML(label)}</span>
      <strong class="admin-stat-value">${escapeHTML(value)}</strong>
    </article>
  `).join('');
}

function renderReportDetails(item) {
  const image = item.image_url
    ? `<a href="${escapeHTML(getSafeImageUrl(item.image_url))}" ${String(item.image_url).startsWith('/api/items/') ? `data-private-photo="${escapeHTML(item.image_url)}"` : 'target="_blank" rel="noopener noreferrer'}>Buka foto laporan</a>`
    : '<span class="muted">Tidak ada foto.</span>';
  const decision = item.listing_status === 'PENDING' ? `
    <label class="admin-note-field">Catatan Admin (opsional untuk persetujuan, wajib untuk penolakan)
      <textarea data-report-note="${escapeHTML(item.id)}" rows="2" maxlength="1000"></textarea>
    </label>
    <div class="admin-actions">
      <button class="button primary" type="button" data-report-action="approve-report" data-id="${escapeHTML(item.id)}">Setujui laporan</button>
      <button class="button danger" type="button" data-report-action="reject-report" data-id="${escapeHTML(item.id)}">Tolak laporan</button>
    </div>
  ` : '';
  return `
    <details class="report-details">
      <summary>Lihat detail</summary>
      <dl>
        <dt>Deskripsi</dt><dd>${escapeHTML(item.description)}</dd>
        <dt>Kategori</dt><dd>${escapeHTML(item.category)}</dd>
        <dt>Warna</dt><dd>${escapeHTML(item.color || '-')}</dd>
        <dt>Lokasi ditemukan</dt><dd>${escapeHTML(item.location_found)}</dd>
        <dt>Tanggal ditemukan</dt><dd>${escapeHTML(formatAdminDate(item.date_found))}</dd>
        <dt>Nomor kontak pelapor</dt><dd>${escapeHTML(item.contact_phone || 'Tidak tersedia')}</dd>
        <dt>Foto</dt><dd>${image}</dd>
        <dt>Verifikasi laporan</dt><dd>${escapeHTML(item.listing_status)}${item.review_note ? `: ${escapeHTML(item.review_note)}` : ''}</dd>
      </dl>
      ${decision}
    </details>
  `;
}

function renderReports(items, pagination) {
  if (!items.length) {
    reportsContent.innerHTML = '<div class="empty-state">Tidak ada laporan yang sesuai dengan pencarian.</div>';
    reportsPagination.hidden = true;
    return;
  }

  const statusLabels = {
    FOUND: 'Ditemukan',
    CLAIMED: 'Menunggu klaim',
    RETURNED: 'Sudah dikembalikan',
  };
  reportsContent.innerHTML = `
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead>
          <tr><th>ID</th><th>Barang</th><th>Pelapor</th><th>Tanggal laporan</th><th>Status</th><th>Detail</th></tr>
        </thead>
        <tbody>
          ${items.map((item) => `
            <tr data-report-row="${escapeHTML(item.id)}">
              <td>${item.listing_status === 'APPROVED' ? `<a class="item-id" href="item-detail.html?id=${encodeURIComponent(item.id)}">#${escapeHTML(item.id)}</a>` : `#${escapeHTML(item.id)}`}</td>
              <td><strong>${escapeHTML(item.title)}</strong><span class="admin-table-subtext">${escapeHTML(item.category)}</span></td>
              <td>${escapeHTML(item.reporter_name)}</td>
              <td>${escapeHTML(formatAdminDate(item.created_at))}</td>
              <td><span class="badge ${escapeHTML(String(item.status).toLowerCase())}">${escapeHTML(statusLabels[item.status] || item.status)}</span><span class="admin-table-subtext">${escapeHTML(item.listing_status)}</span></td>
              <td>${renderReportDetails(item)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  const totalPages = pagination.total_pages;
  reportsPagination.hidden = totalPages <= 1;
  reportsPagination.innerHTML = `
    <button class="button secondary" type="button" data-page="${pagination.page - 1}" ${pagination.page <= 1 ? 'disabled' : ''}>Sebelumnya</button>
    <span>Halaman ${escapeHTML(pagination.page)} dari ${escapeHTML(totalPages)} · ${escapeHTML(pagination.total)} laporan</span>
    <button class="button secondary" type="button" data-page="${pagination.page + 1}" ${pagination.page >= totalPages ? 'disabled' : ''}>Berikutnya</button>
  `;
}

function renderClaimDetails(claim) {
  const image = claim.item_image_url
    ? `<a href="${escapeHTML(getSafeImageUrl(claim.item_image_url))}" ${String(claim.item_image_url).startsWith('/api/items/') ? `data-private-photo="${escapeHTML(claim.item_image_url)}"` : 'target="_blank" rel="noopener noreferrer'}>Buka foto barang</a>`
    : 'Tidak ada foto.';
  const studentCard = claim.has_student_card
    ? `<a href="/api/auth/users/${encodeURIComponent(claim.user_id)}/student-card" data-private-photo="/api/auth/users/${encodeURIComponent(claim.user_id)}/student-card">Buka foto KTM</a>`
    : 'Belum diunggah.';
  const noteLabel = claim.admin_note === 'Verifikasi otomatis gagal'
    ? 'Catatan lama sistem, bukan keputusan Admin manual'
    : 'Catatan keputusan Admin';

  return `
    <details class="claim-details">
      <summary>Lihat Detail</summary>
      <dl>
        <dt>ID klaim</dt><dd>#${escapeHTML(claim.id)}</dd>
        <dt>ID barang</dt><dd><a class="item-id" href="item-detail.html?id=${encodeURIComponent(claim.item_id)}">#${escapeHTML(claim.item_id)} · ${escapeHTML(claim.item_title)}</a></dd>
        <dt>Pengaju</dt><dd>${escapeHTML(claim.user_name)} (${escapeHTML(claim.user_email)})</dd>
        <dt>Nomor kontak klaim</dt><dd>${escapeHTML(claim.contact_phone || claim.account_phone || 'Tidak tersedia')}</dd>
        <dt>Nama mahasiswa</dt><dd>${escapeHTML(claim.student_name || '-')}</dd>
        <dt>NIM</dt><dd>${escapeHTML(claim.nim || '-')}</dd>
        <dt>Program studi</dt><dd>${escapeHTML(claim.study_program || '-')}</dd>
        <dt>Status verifikasi identitas</dt><dd>${escapeHTML(claim.identity_status || 'NOT_SUBMITTED')}${claim.identity_note ? `: ${escapeHTML(claim.identity_note)}` : ''}</dd>
        <dt>KTM</dt><dd>${studentCard}</dd>
        <dt>Tanggal pengajuan</dt><dd>${escapeHTML(formatAdminDate(claim.created_at))}</dd>
        <dt>Status penyerahan barang</dt><dd>${escapeHTML(claim.item_status)}</dd>
        <dt>Kategori</dt><dd>${escapeHTML(claim.item_category)}</dd>
        <dt>Deskripsi barang</dt><dd>${escapeHTML(claim.item_description)}</dd>
        <dt>Warna</dt><dd>${escapeHTML(claim.item_color || '-')}</dd>
        <dt>Lokasi ditemukan</dt><dd>${escapeHTML(claim.item_location_found)}</dd>
        <dt>Tanggal ditemukan</dt><dd>${escapeHTML(formatAdminDate(claim.item_date_found))}</dd>
        <dt>Foto barang</dt><dd>${image}</dd>
        <dt>Jawaban survey</dt><dd class="claim-answer">${escapeHTML(claim.verification_answer)}</dd>
        <dt>Ciri rahasia pada laporan</dt><dd class="claim-secret">${escapeHTML(claim.item_secret_clue)}</dd>
        ${claim.admin_note ? `<dt>${noteLabel}</dt><dd>${escapeHTML(claim.admin_note)}</dd>` : ''}
        ${claim.status !== 'PENDING' ? `<dt>Keputusan dicatat</dt><dd>${escapeHTML(formatAdminDate(claim.updated_at))}</dd>` : ''}
      </dl>
      ${claim.admin_note === 'Verifikasi otomatis gagal'
        ? '<p class="message info">Data ini adalah riwayat lama. Statusnya dipertahankan dan tidak dianggap sebagai keputusan Admin manual.</p>'
        : ''}
    </details>
  `;
}

async function hydratePrivatePhotos(container) {
  const elements = container.querySelectorAll('[data-private-photo]');
  await Promise.all([...elements].map(async (element) => {
    try {
      const response = await fetch(element.dataset.privatePhoto, { headers: getAuthHeaders() });
      if (!response.ok) throw new Error('Foto terlindungi tidak dapat dimuat.');
      const blobUrl = URL.createObjectURL(await response.blob());
      if (element.tagName === 'IMG') {
        element.src = blobUrl;
      } else {
        element.href = blobUrl;
        element.target = '_blank';
        element.rel = 'noopener noreferrer';
      }
    } catch (error) {
      element.textContent = error.message;
      element.removeAttribute('href');
    }
  }));
}

async function loadReports(page = reportState.page) {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(reportState.limit),
    search: reportFilters.elements.search.value.trim(),
    status: reportFilters.elements.status.value,
    review_status: reportFilters.elements.review_status.value,
  });
  reportsContent.innerHTML = '<div class="empty-state">Memuat laporan...</div>';
  reportsPagination.hidden = true;

  try {
    const result = await apiFetch(`/api/admin/reports?${params}`);
    reportState.page = result.pagination.page;
    renderReports(result.items, result.pagination);
    hydratePrivatePhotos(reportsContent);
  } catch (error) {
    reportsContent.innerHTML = `<div class="message error">${escapeHTML(error.message)}</div>`;
  }
}

function renderClaims() {
  const search = claimFilters.elements.search.value.trim().toLocaleLowerCase('id');
  const status = claimFilters.elements.status.value;
  const claims = adminClaims.filter((claim) => {
    if (status && claim.status !== status) return false;
    const searchable = [
      claim.id,
      claim.item_id,
      claim.item_title,
      claim.user_name,
      claim.verification_answer,
      claim.admin_note,
    ].join(' ').toLocaleLowerCase('id');
    return !search || searchable.includes(search);
  });

  if (!claims.length) {
    adminContent.innerHTML = '<div class="empty-state">Tidak ada klaim yang sesuai dengan filter.</div>';
    return;
  }

  adminContent.innerHTML = `<ul class="list">${claims.map((claim) => `
    <li class="admin-claim">
      <div class="admin-claim-heading">
        <strong>${escapeHTML(claim.user_name)} mengajukan klaim untuk ${escapeHTML(claim.item_title)}</strong>
        <span class="badge ${escapeHTML(String(claim.status).toLowerCase())}">${escapeHTML(claim.status)}</span>
      </div>
      <div><a class="item-id" href="item-detail.html?id=${encodeURIComponent(claim.item_id)}">ID barang: #${escapeHTML(claim.item_id)}</a></div>
      ${renderClaimDetails(claim)}
      ${claim.status === 'PENDING' ? `
        <label class="admin-note-field">
          Catatan Admin (opsional untuk persetujuan, wajib untuk penolakan)
          <textarea data-admin-note="${escapeHTML(claim.id)}" rows="2" maxlength="1000"></textarea>
        </label>
        <div class="admin-actions">
          <button class="button primary" type="button" data-action="approve" data-id="${escapeHTML(claim.id)}">Setujui</button>
          <button class="button danger" type="button" data-action="reject" data-id="${escapeHTML(claim.id)}">Tolak</button>
        </div>
      ` : claim.status === 'APPROVED' && claim.item_status === 'CLAIMED' ? `
        <div class="admin-actions">
          <button class="button primary" type="button" data-action="complete-handover" data-id="${escapeHTML(claim.id)}">Tandai barang telah diserahkan</button>
        </div>
      ` : ''}
    </li>
  `).join('')}</ul>`;
  hydratePrivatePhotos(adminContent);
}

function renderIdentities(identities) {
  if (!identities.length) {
    identityContent.innerHTML = '<div class="empty-state">Belum ada data identitas mahasiswa untuk ditinjau.</div>';
    return;
  }
  identityContent.innerHTML = `<ul class="list">${identities.map((identity) => `
    <li class="admin-claim">
      <div class="admin-claim-heading">
        <strong>${escapeHTML(identity.student_name || identity.name)}${identity.nim ? ` · NIM ${escapeHTML(identity.nim)}` : ''}</strong>
        <span class="badge ${escapeHTML(String(identity.identity_status).toLowerCase())}">${escapeHTML(identity.identity_status)}</span>
      </div>
      <p>${escapeHTML(identity.email)}${identity.phone ? ` · ${escapeHTML(identity.phone)}` : ''}</p>
      <p class="muted">Program studi: ${escapeHTML(identity.study_program || '-')}</p>
      <p>Foto KTM: ${identity.has_student_card
        ? `<a href="/api/auth/users/${encodeURIComponent(identity.id)}/student-card" data-private-photo="/api/auth/users/${encodeURIComponent(identity.id)}/student-card">Buka foto KTM</a>`
        : 'Belum diunggah.'}</p>
      ${identity.identity_note ? `<p class="message info">${escapeHTML(identity.identity_note)}</p>` : ''}
      ${identity.identity_status === 'PENDING' && identity.has_student_card && identity.nim ? `
        <label class="admin-note-field">Catatan identitas (wajib untuk penolakan)
          <textarea data-identity-note="${escapeHTML(identity.id)}" rows="2" maxlength="1000"></textarea>
        </label>
        <div class="admin-actions">
          <button class="button primary" type="button" data-identity-action="verify" data-id="${escapeHTML(identity.id)}">Tandai terverifikasi</button>
          <button class="button danger" type="button" data-identity-action="reject" data-id="${escapeHTML(identity.id)}">Minta perbaikan</button>
        </div>
      ` : ''}
    </li>
  `).join('')}</ul>`;
  hydratePrivatePhotos(identityContent);
}

async function loadIdentities() {
  identityContent.innerHTML = '<div class="empty-state">Memuat identitas...</div>';
  try {
    const result = await apiFetch('/api/admin/identities');
    renderIdentities(Array.isArray(result.identities) ? result.identities : []);
  } catch (error) {
    identityContent.innerHTML = `<div class="message error">${escapeHTML(error.message)}</div>`;
  }
}

async function loadAdminClaims() {
  adminContent.innerHTML = '<div class="empty-state">Memuat klaim...</div>';
  try {
    const result = await apiFetch('/api/claims');
    adminClaims = Array.isArray(result.claims) ? result.claims : [];
    renderClaims();
  } catch (error) {
    adminContent.innerHTML = `<div class="message error">${escapeHTML(error.message)}</div>`;
  }
}

async function loadAdminSummary() {
  try {
    const result = await apiFetch('/api/admin/summary');
    renderAdminSummary(result.summary);
  } catch (error) {
    adminSummary.innerHTML = `<div class="message error">${escapeHTML(error.message)}</div>`;
  }
}

async function loadAdminDashboard() {
  if (!getCurrentToken()) {
    window.location.href = 'login.html';
    return;
  }

  await Promise.all([loadAdminSummary(), loadReports(1), loadAdminClaims(), loadIdentities()]);
}

reportFilters.addEventListener('submit', (event) => {
  event.preventDefault();
  loadReports(1);
});

reportFilters.elements.status.addEventListener('change', () => loadReports(1));
reportFilters.elements.review_status.addEventListener('change', () => loadReports(1));

reportsPagination.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-page]');
  if (button && !button.disabled) loadReports(Number(button.dataset.page));
});

claimFilters.addEventListener('input', renderClaims);
claimFilters.addEventListener('change', renderClaims);

adminContent.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const action = button.dataset.action;
  const claimId = button.dataset.id;
  const row = button.closest('li');
  const noteField = row.querySelector('textarea[data-admin-note]');
  const note = noteField?.value.trim() || '';
  if (action === 'reject' && !note) {
    claimMessage.className = 'message error';
    claimMessage.textContent = 'Isi alasan penolakan sebelum menolak klaim.';
    noteField?.focus();
    return;
  }

  const confirmText = action === 'approve'
    ? 'Setujui klaim ini?'
    : action === 'complete-handover'
      ? 'Pastikan barang sudah benar-benar diterima pemilik. Catat penyerahan selesai?'
      : 'Tolak klaim ini?';
  if (!window.confirm(confirmText)) return;

  const rowButtons = row.querySelectorAll('button[data-action]');
  rowButtons.forEach((actionButton) => { actionButton.disabled = true; });
  claimMessage.className = '';
  claimMessage.textContent = '';

  try {
    const result = await apiFetch(`/api/claims/${encodeURIComponent(claimId)}/${action}`, {
      method: 'POST',
      body: JSON.stringify({ admin_note: note }),
    });
    claimMessage.className = 'message success';
    claimMessage.textContent = result.message || 'Keputusan klaim berhasil disimpan.';
    await Promise.all([loadAdminSummary(), loadReports(reportState.page), loadAdminClaims()]);
  } catch (error) {
    rowButtons.forEach((actionButton) => { actionButton.disabled = false; });
    claimMessage.className = 'message error';
    claimMessage.textContent = error.message;
  }
});

reportsContent.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-report-action]');
  if (!button) return;
  const action = button.dataset.reportAction;
  const row = button.closest('tr');
  const noteField = row.querySelector('textarea[data-report-note]');
  const note = noteField?.value.trim() || '';
  if (action === 'reject-report' && !note) {
    reportMessage.className = 'message error';
    reportMessage.textContent = 'Isi alasan penolakan laporan terlebih dahulu.';
    noteField?.focus();
    return;
  }
  const decision = action === 'approve-report' ? 'APPROVED' : 'REJECTED';
  if (!window.confirm(decision === 'APPROVED' ? 'Setujui laporan ini agar tampil di daftar barang publik?' : 'Tolak laporan ini?')) return;
  button.disabled = true;
  try {
    const result = await apiFetch(`/api/admin/reports/${encodeURIComponent(button.dataset.id)}/review`, {
      method: 'POST',
      body: JSON.stringify({ decision, note }),
    });
    reportMessage.className = 'message success';
    reportMessage.textContent = result.message;
    await Promise.all([loadAdminSummary(), loadReports(reportState.page)]);
  } catch (error) {
    button.disabled = false;
    reportMessage.className = 'message error';
    reportMessage.textContent = error.message;
  }
});

identityContent.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-identity-action]');
  if (!button) return;
  const action = button.dataset.identityAction;
  const row = button.closest('li');
  const noteField = row.querySelector('textarea[data-identity-note]');
  const note = noteField?.value.trim() || '';
  if (action === 'reject' && !note) {
    identityMessage.className = 'message error';
    identityMessage.textContent = 'Tambahkan catatan tentang data identitas yang perlu diperbaiki.';
    noteField?.focus();
    return;
  }
  const status = action === 'verify' ? 'VERIFIED' : 'REJECTED';
  if (!window.confirm(status === 'VERIFIED' ? 'Tandai identitas ini sudah diperiksa?' : 'Tandai identitas ini tidak dapat diverifikasi?')) return;
  button.disabled = true;
  try {
    const result = await apiFetch(`/api/admin/identities/${encodeURIComponent(button.dataset.id)}`, {
      method: 'PUT',
      body: JSON.stringify({ status, note }),
    });
    identityMessage.className = 'message success';
    identityMessage.textContent = result.message;
    await loadIdentities();
  } catch (error) {
    button.disabled = false;
    identityMessage.className = 'message error';
    identityMessage.textContent = error.message;
  }
});

renderUserBadge();
loadAdminDashboard();
