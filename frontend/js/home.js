async function loadRecentItems() {
  const container = document.getElementById('recent-items');
  if (!container) return;

  try {
    const data = await apiFetch('/api/items');
    const items = Array.isArray(data.items)
      ? data.items.filter((item) => item.status === 'FOUND').slice(0, 3)
      : [];

    if (!items.length) {
      container.innerHTML = '<div class="empty-state">Belum ada laporan barang ditemukan.</div>';
      return;
    }

    container.innerHTML = items.map((item) => {
      const description = String(item.description ?? '');
      const imageUrl = escapeHTML(getSafeImageUrl(item.image_url));
      return `
        <article class="item-card">
          <img src="${imageUrl}" alt="${escapeHTML(item.title)}" loading="lazy" />
          <span class="badge found">Ditemukan</span>
          <h3>${escapeHTML(item.title)}</h3>
          <p class="item-meta">${escapeHTML(item.category)} · ${escapeHTML(item.location_found)}</p>
          <p>${escapeHTML(description.slice(0, 120))}${description.length > 120 ? '...' : ''}</p>
          <a class="button secondary" href="item-detail.html?id=${encodeURIComponent(item.id)}">Lihat Detail</a>
        </article>
      `;
    }).join('');
  } catch (error) {
    container.innerHTML = `<div class="message error">${escapeHTML(error.message || 'Gagal memuat laporan terbaru.')}</div>`;
  }
}

loadRecentItems();
