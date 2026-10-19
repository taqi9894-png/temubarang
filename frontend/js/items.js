async function fetchItems() {
  const response = await fetch('/api/items');
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Gagal memuat daftar barang.');
  return Array.isArray(data.items) ? data.items : [];
}

function renderItemCards(items) {
  const container = document.getElementById('items-container');
  if (!container) return;

  if (!items.length) {
    container.innerHTML = '<div class="empty-state">Belum ada barang yang cocok.</div>';
    return;
  }

  container.innerHTML = items.map((item) => `
    <div class="item-card">
      <img src="${escapeHTML(getSafeImageUrl(item.image_url))}" alt="${escapeHTML(item.title)}" />
      <div>
        <span class="badge ${escapeHTML(item.status.toLowerCase())}">${escapeHTML(item.status)}</span>
      </div>
      <h3>${escapeHTML(item.title)}</h3>
      <div class="item-id">ID barang: #${escapeHTML(item.id)}</div>
      <div class="item-meta">${escapeHTML(item.category)} · ${escapeHTML(item.location_found)}</div>
      <p>${escapeHTML(item.description.slice(0, 120))}${item.description.length > 120 ? '...' : ''}</p>
      <a class="button secondary" href="item-detail.html?id=${item.id}">Lihat Detail</a>
    </div>
  `).join('');
}

async function loadItems() {
  const container = document.getElementById('items-container');
  const searchInput = document.getElementById('search-input');
  const categoryFilter = document.getElementById('category-filter');
  const filterItems = () => {
    const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
    const idQuery = query.replace(/^#/, '');
    const category = categoryFilter ? categoryFilter.value : '';
    const idSearch = /^\d+$/.test(idQuery);
    const filtered = items.filter((item) => {
      const text = `${item.title} ${item.description}`.toLowerCase();
      const matchesQuery = !query
        || (idSearch ? String(item.id) === idQuery : text.includes(query));
      const categoryMatch = !category || item.category === category;
      return matchesQuery && categoryMatch;
    });
    renderItemCards(filtered);
  };

  container.innerHTML = '<div class="empty-state">Memuat daftar barang...</div>';
  let items;
  try {
    items = await fetchItems();
    renderItemCards(items);
  } catch (error) {
    container.innerHTML = `<div class="message error">${escapeHTML(error.message)}</div>`;
    return;
  }

  if (categoryFilter) {
    const categories = new Set([
      ...ITEM_CATEGORIES,
      ...items.map((item) => item.category).filter(Boolean),
    ]);
    categoryFilter.innerHTML = `<option value="">Semua kategori</option>${[...categories]
      .sort((left, right) => left.localeCompare(right, 'id'))
      .map((category) => `<option value="${escapeHTML(category)}">${escapeHTML(category)}</option>`)
      .join('')}`;
  }

  if (searchInput) {
    searchInput.addEventListener('input', filterItems);
  }

  if (categoryFilter) {
    categoryFilter.addEventListener('change', filterItems);
  }
}

async function loadItemDetail() {
  const detailContainer = document.getElementById('item-detail');
  if (!detailContainer) return;

  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');

  if (!id || !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) {
    detailContainer.innerHTML = '<div class="empty-state">ID barang tidak ditemukan.</div>';
    return;
  }

  try {
    detailContainer.innerHTML = '<div class="empty-state">Memuat detail barang...</div>';
    const response = await fetch(`/api/items/${encodeURIComponent(id)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Barang tidak ditemukan.');
    const item = data.item;

    if (!item) {
      detailContainer.innerHTML = '<div class="empty-state">Barang tidak ditemukan.</div>';
      return;
    }

    const claimAction = item.status === 'FOUND'
      ? `<a class="button primary" href="claim.html?id=${encodeURIComponent(item.id)}">Ajukan Klaim</a>`
      : '<p class="muted">Barang ini sudah tidak tersedia untuk klaim.</p>';
    const foundDate = new Date(item.date_found).toLocaleDateString('id-ID', {
      dateStyle: 'long',
      timeZone: 'UTC',
    });

    detailContainer.innerHTML = `
      <div class="detail-layout">
        <div>
          <img src="${escapeHTML(getSafeImageUrl(item.image_url))}" alt="${escapeHTML(item.title)}" />
        </div>
        <div>
          <span class="badge ${escapeHTML(item.status.toLowerCase())}">${escapeHTML(item.status)}</span>
          <h2>${escapeHTML(item.title)}</h2>
          <ul class="list">
            <li><strong>ID barang:</strong> #${escapeHTML(item.id)}</li>
            <li><strong>Kategori:</strong> ${escapeHTML(item.category)}</li>
            <li><strong>Warna:</strong> ${escapeHTML(item.color || '-')}</li>
            <li><strong>Lokasi:</strong> ${escapeHTML(item.location_found)}</li>
            <li><strong>Tanggal:</strong> ${escapeHTML(foundDate)}</li>
            <li><strong>Deskripsi:</strong> ${escapeHTML(item.description)}</li>
          </ul>
          <div style="margin-top: 18px;">
            ${claimAction}
          </div>
        </div>
      </div>
    `;
  } catch (error) {
    detailContainer.innerHTML = `<div class="message error">${escapeHTML(error.message)}</div>`;
  }
}
