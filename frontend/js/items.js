async function fetchItems() {
  const response = await fetch('http://localhost:3002/api/items');
  const data = await response.json();
  return data.items || [];
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
      <img src="${item.image_url || 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=900&q=80'}" alt="${item.title}" />
      <div>
        <span class="badge ${item.status.toLowerCase()}">${item.status}</span>
      </div>
      <h3>${item.title}</h3>
      <div class="item-meta">${item.category} · ${item.location_found}</div>
      <p>${item.description.slice(0, 120)}...</p>
      <a class="button secondary" href="item-detail.html?id=${item.id}">Lihat Detail</a>
    </div>
  `).join('');
}

async function loadItems() {
  const searchInput = document.getElementById('search-input');
  const categoryFilter = document.getElementById('category-filter');

  const items = await fetchItems();
  renderItemCards(items);

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const search = searchInput.value.toLowerCase();
      const category = categoryFilter ? categoryFilter.value : '';
      const filtered = items.filter((item) => {
        const text = `${item.title} ${item.description}`.toLowerCase();
        const categoryMatch = !category || item.category === category;
        return categoryMatch && text.includes(search);
      });
      renderItemCards(filtered);
    });
  }

  if (categoryFilter) {
    categoryFilter.addEventListener('change', () => {
      const search = searchInput ? searchInput.value.toLowerCase() : '';
      const category = categoryFilter.value;
      const filtered = items.filter((item) => {
        const text = `${item.title} ${item.description}`.toLowerCase();
        const categoryMatch = !category || item.category === category;
        return categoryMatch && text.includes(search);
      });
      renderItemCards(filtered);
    });
  }
}

async function loadItemDetail() {
  const detailContainer = document.getElementById('item-detail');
  if (!detailContainer) return;

  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');

  if (!id) {
    detailContainer.innerHTML = '<div class="empty-state">ID barang tidak ditemukan.</div>';
    return;
  }

  try {
    const response = await fetch(`http://localhost:3002/api/items/${id}`);
    const data = await response.json();
    const item = data.item;

    if (!item) {
      detailContainer.innerHTML = '<div class="empty-state">Barang tidak ditemukan.</div>';
      return;
    }

    detailContainer.innerHTML = `
      <div class="detail-layout">
        <div>
          <img src="${item.image_url || 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=900&q=80'}" alt="${item.title}" />
        </div>
        <div>
          <span class="badge ${item.status.toLowerCase()}">${item.status}</span>
          <h2>${item.title}</h2>
          <ul class="list">
            <li><strong>Kategori:</strong> ${item.category}</li>
            <li><strong>Warna:</strong> ${item.color || '-'}</li>
            <li><strong>Lokasi:</strong> ${item.location_found}</li>
            <li><strong>Tanggal:</strong> ${item.date_found}</li>
            <li><strong>Deskripsi:</strong> ${item.description}</li>
          </ul>
          <div style="margin-top: 18px;">
            <a class="button primary" href="claim.html?id=${item.id}">Ajukan Klaim</a>
          </div>
        </div>
      </div>
    `;
  } catch (error) {
    detailContainer.innerHTML = `<div class="message error">${error.message}</div>`;
  }
}
