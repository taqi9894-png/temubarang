const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
require('dotenv').config();

const app = express();
const PORT = Number(process.env.PORT || 3002);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'internal-key';
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:8080';
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
const MAX_PHOTO_SIZE = 5 * 1024 * 1024;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'temubarang',
  password: process.env.DB_PASSWORD || 'temubarang123',
  database: process.env.DB_NAME || 'temubarang',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

app.use(cors({
  origin: CORS_ORIGIN,
  credentials: true,
}));
app.use(express.json());

const photoUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, callback) => {
      const extension = path.extname(file.originalname).toLowerCase();
      callback(null, `${crypto.randomUUID()}${extension}`);
    },
  }),
  limits: { fileSize: MAX_PHOTO_SIZE, files: 1 },
  fileFilter: (req, file, callback) => {
    const extensions = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
    const extension = path.extname(file.originalname).toLowerCase();
    if (extensions[extension] !== file.mimetype) {
      callback(new Error('Foto harus berformat JPG, JPEG, PNG, atau WEBP.'));
      return;
    }
    callback(null, true);
  },
});

function parsePhone(value) {
  if (value === undefined || value === null || String(value).trim() === '') return { phone: null };
  const normalized = String(value).replace(/[\s()-]/g, '');
  if (/^08\d{8,11}$/.test(normalized)) return { phone: `+62${normalized.slice(1)}` };
  if (/^\+628\d{8,11}$/.test(normalized)) return { phone: normalized };
  return { error: 'Nomor HP harus menggunakan format Indonesia, misalnya 081234567890 atau +6281234567890.' };
}

function uploadPhoto(req, res, next) {
  photoUpload.single('photo')(req, res, (error) => {
    if (!error) return next();
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? 'Ukuran foto maksimal 5 MB.'
      : error.message || 'Foto gagal diunggah.';
    return res.status(400).json({ message });
  });
}

async function validPhotoSignature(filePath, mimeType) {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(12);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const header = buffer.subarray(0, bytesRead);
    if (mimeType === 'image/jpeg') return header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
    if (mimeType === 'image/png') return header.length >= 8 && header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (mimeType === 'image/webp') return header.length >= 12 && header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP';
    return false;
  } finally {
    await handle.close();
  }
}

async function removeUploadedFile(filePath) {
  if (!filePath) return;
  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Gagal menghapus file upload:', error);
  }
}

function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return next();
  try {
    req.user = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
  } catch {
    req.user = null;
  }
  return next();
}

function authRequired(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Token tidak ditemukan atau tidak valid.' });
  }

  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    return next();
  } catch (error) {
    return res.status(401).json({ message: 'Token tidak valid atau sudah kadaluarsa.' });
  }
}

function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Akses ditolak. Hanya admin.' });
  }
  return next();
}

function internalAuth(req, res, next) {
  const key = req.headers['x-internal-key'];
  if (!key || key !== INTERNAL_API_KEY) {
    return res.status(401).json({ message: 'Kunci internal tidak valid.' });
  }
  return next();
}

function parseItemId(value) {
  const text = String(value ?? '').trim();
  if (!/^[1-9]\d*$/.test(text)) return null;
  const id = Number(text);
  return Number.isSafeInteger(id) ? id : null;
}

async function retryDbConnection() {
  let attempts = 0;

  while (attempts < 15) {
    try {
      await pool.query('SELECT 1');
      console.log('Koneksi database item-service siap.');
      return;
    } catch (error) {
      attempts += 1;
      console.log(`Mencoba koneksi DB item-service (${attempts}/15)...`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

  }

  console.error('Database item-service tidak bisa terhubung setelah beberapa percobaan.');
  process.exit(1);
}

async function ensureItemColumns() {
  await pool.query(`
    ALTER TABLE items ADD COLUMN IF NOT EXISTS contact_phone TEXT;
    ALTER TABLE items ADD COLUMN IF NOT EXISTS listing_status VARCHAR(20);
    ALTER TABLE items ADD COLUMN IF NOT EXISTS review_note TEXT;
    ALTER TABLE items ADD COLUMN IF NOT EXISTS photo_key TEXT;
    UPDATE items SET listing_status = 'APPROVED' WHERE listing_status IS NULL;
    ALTER TABLE items ALTER COLUMN listing_status SET DEFAULT 'PENDING';
    ALTER TABLE items ALTER COLUMN listing_status SET NOT NULL;
  `);
}

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    return res.json({ ok: true, service: 'item-service' });
  } catch (error) {
    return res.status(500).json({ ok: false, message: 'Database tidak tersedia' });
  }
});

app.get('/api/admin/summary', authRequired, adminOnly, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        (SELECT COUNT(*) FROM items) AS total_reports,
        (SELECT COUNT(*) FROM items WHERE listing_status = 'PENDING') AS pending_reports,
        (SELECT COUNT(*) FROM items WHERE status = 'FOUND') AS found_items,
        (SELECT COUNT(*) FROM items WHERE status = 'CLAIMED') AS claimed_items,
        (SELECT COUNT(*) FROM items WHERE status = 'RETURNED') AS returned_items,
        (SELECT COUNT(*) FROM claims WHERE status = 'PENDING') AS pending_claims,
        (SELECT COUNT(*) FROM claims WHERE status = 'APPROVED') AS approved_claims,
        (SELECT COUNT(*) FROM claims WHERE status = 'REJECTED') AS rejected_claims`
    );
    const summary = Object.fromEntries(
      Object.entries(result.rows[0]).map(([key, value]) => [key, Number(value)])
    );
    return res.json({ summary });
  } catch (error) {
    console.error('Admin summary error:', error);
    return res.status(500).json({ message: 'Gagal mengambil ringkasan admin.' });
  }
});

app.get('/api/admin/reports', authRequired, adminOnly, async (req, res) => {
  const status = String(req.query.status || '').trim().toUpperCase();
  const reviewStatus = String(req.query.review_status || '').trim().toUpperCase();
  const search = String(req.query.search || '').trim();
  const page = Number(req.query.page || 1);
  const limit = Number(req.query.limit || 10);

  if (status && !['FOUND', 'CLAIMED', 'RETURNED'].includes(status)) {
    return res.status(400).json({ message: 'Filter status laporan tidak valid.' });
  }
  if (reviewStatus && !['PENDING', 'APPROVED', 'REJECTED'].includes(reviewStatus)) {
    return res.status(400).json({ message: 'Filter verifikasi laporan tidak valid.' });
  }
  if (!Number.isSafeInteger(page) || page < 1 || ![10, 20, 50].includes(limit)
      || !Number.isSafeInteger((page - 1) * limit)) {
    return res.status(400).json({ message: 'Nomor halaman atau batas laporan tidak valid.' });
  }

  const params = [];
  const filters = [];
  if (status) {
    params.push(status);
    filters.push(`i.status = $${params.length}`);
  }
  if (reviewStatus) {
    params.push(reviewStatus);
    filters.push(`i.listing_status = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    filters.push(`(
      CAST(i.id AS TEXT) ILIKE $${params.length}
      OR i.title ILIKE $${params.length}
      OR i.description ILIKE $${params.length}
      OR i.category ILIKE $${params.length}
      OR i.location_found ILIKE $${params.length}
      OR u.name ILIKE $${params.length}
    )`);
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  try {
    const countResult = await pool.query(
      `SELECT COUNT(*) AS total
       FROM items i
       JOIN users u ON u.id = i.reported_by
       ${where}`,
      params
    );
    const total = Number(countResult.rows[0].total);
    const offset = (page - 1) * limit;
    const result = await pool.query(
      `SELECT
        i.id, i.title, i.category, i.description, i.color, i.location_found,
        i.date_found, i.image_url, i.status, i.listing_status, i.review_note,
        i.contact_phone, i.reported_by, i.created_at, u.name AS reporter_name
       FROM items i
       JOIN users u ON u.id = i.reported_by
       ${where}
       ORDER BY i.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    return res.json({
      items: result.rows,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Admin reports error:', error);
    return res.status(500).json({ message: 'Gagal mengambil laporan admin.' });
  }
});

app.get('/api/items', async (req, res) => {
  try {
    const { search, category, status } = req.query;
    let query = `
      SELECT
        id, title, category, description, color, location_found, date_found,
        image_url, status, reported_by, created_at
      FROM items
      WHERE listing_status = 'APPROVED'
    `;
    const params = [];
    let index = 1;

    if (search && String(search).trim()) {
      query += ` AND (LOWER(title) LIKE $${index} OR LOWER(description) LIKE $${index})`;
      params.push(`%${String(search).trim().toLowerCase()}%`);
      index += 1;
    }

    if (category && String(category).trim()) {
      query += ` AND LOWER(category) = $${index}`;
      params.push(String(category).trim().toLowerCase());
      index += 1;
    }

    if (status && String(status).trim()) {
      query += ` AND UPPER(status) = $${index}`;
      params.push(String(status).trim().toUpperCase());
      index += 1;
    }

    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, params);
    return res.json({ items: result.rows });
  } catch (error) {
    console.error('List items error:', error);
    return res.status(500).json({ message: 'Gagal mengambil daftar barang.' });
  }
});

app.get('/api/items/my', authRequired, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        id, title, category, description, color, location_found, date_found,
        image_url, status, listing_status, review_note, contact_phone,
        reported_by, created_at
       FROM items
       WHERE reported_by = $1
       ORDER BY created_at DESC`,
      [req.user.id]
    );

    return res.json({ items: result.rows });
  } catch (error) {
    console.error('My items error:', error);
    return res.status(500).json({ message: 'Gagal mengambil barang yang Anda laporkan.' });
  }
});

app.get('/api/items/:id/photo', optionalAuth, async (req, res) => {
  const id = parseItemId(req.params.id);
  if (!id) return res.status(400).json({ message: 'ID barang tidak valid.' });
  try {
    const result = await pool.query(
      'SELECT image_url, photo_key, listing_status, reported_by FROM items WHERE id = $1',
      [id]
    );
    if (!result.rows.length || !result.rows[0].image_url) {
      return res.status(404).json({ message: 'Foto barang tidak ditemukan.' });
    }
    const item = result.rows[0];
    const mayView = item.listing_status === 'APPROVED'
      || Number(item.reported_by) === Number(req.user?.id)
      || req.user?.role === 'admin';
    if (!mayView) return res.status(404).json({ message: 'Foto barang tidak ditemukan.' });

    if (!item.photo_key) return res.status(404).json({ message: 'Foto barang tidak tersedia di penyimpanan TemuBarang.' });
    const filename = path.basename(item.photo_key);
    if (filename !== item.photo_key) return res.status(404).json({ message: 'Foto barang tidak ditemukan.' });
    const filePath = path.join(UPLOAD_DIR, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ message: 'File foto tidak tersedia.' });
    res.set('Cache-Control', item.listing_status === 'APPROVED' ? 'public, max-age=3600' : 'private, no-store');
    return res.sendFile(filePath);
  } catch (error) {
    console.error('Get item photo error:', error);
    return res.status(500).json({ message: 'Gagal mengambil foto barang.' });
  }
});

app.get('/api/items/:id', optionalAuth, async (req, res) => {
  const id = parseItemId(req.params.id);
  if (!id) return res.status(400).json({ message: 'ID barang tidak valid.' });
  try {
    const result = await pool.query(
      `SELECT
        id, title, category, description, color, location_found, date_found,
        image_url, status, listing_status, reported_by, created_at
       FROM items WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Barang tidak ditemukan.' });
    }

    const item = result.rows[0];
    if (item.listing_status !== 'APPROVED'
        && Number(item.reported_by) !== Number(req.user?.id)
        && req.user?.role !== 'admin') {
      return res.status(404).json({ message: 'Barang tidak ditemukan.' });
    }
    return res.json({ item });
  } catch (error) {
    console.error('Get item error:', error);
    return res.status(500).json({ message: 'Gagal mengambil detail barang.' });
  }
});

app.post('/api/items', authRequired, uploadPhoto, async (req, res) => {
  const { title, category, description, color, location_found, date_found, contact_phone, secret_clue } = req.body || {};
  const contact = parsePhone(contact_phone);
  if (contact.error) {
    await removeUploadedFile(req.file?.path);
    return res.status(400).json({ message: contact.error });
  }
  if (req.file && !(await validPhotoSignature(req.file.path, req.file.mimetype))) {
    await removeUploadedFile(req.file.path);
    return res.status(400).json({ message: 'Isi file tidak sesuai dengan format foto yang dipilih.' });
  }

  if (!title || String(title).trim().length < 3) {
    await removeUploadedFile(req.file?.path);
    return res.status(400).json({ message: 'Judul barang minimal 3 karakter.' });
  }

  if (!category || String(category).trim().length < 2) {
    await removeUploadedFile(req.file?.path);
    return res.status(400).json({ message: 'Kategori wajib diisi.' });
  }

  if (!description || String(description).trim().length < 10) {
    await removeUploadedFile(req.file?.path);
    return res.status(400).json({ message: 'Deskripsi barang minimal 10 karakter.' });
  }

  if (!location_found || String(location_found).trim().length < 3) {
    await removeUploadedFile(req.file?.path);
    return res.status(400).json({ message: 'Lokasi ditemukan wajib diisi.' });
  }

  if (!date_found) {
    await removeUploadedFile(req.file?.path);
    return res.status(400).json({ message: 'Tanggal ditemukan wajib diisi.' });
  }

  if (!secret_clue || String(secret_clue).trim().length < 5) {
    await removeUploadedFile(req.file?.path);
    return res.status(400).json({ message: 'Ciri rahasia wajib diisi minimal 5 karakter.' });
  }

  try {
    let accountPhone = null;
    if (!contact.phone) {
      const account = await pool.query('SELECT phone FROM users WHERE id = $1', [req.user.id]);
      accountPhone = account.rows[0]?.phone || null;
    }
    if (!contact.phone && !accountPhone) {
      await removeUploadedFile(req.file?.path);
      return res.status(400).json({ message: 'Nomor HP diperlukan untuk koordinasi. Isi nomor kontak pada laporan atau profil akun.' });
    }
    const client = await pool.connect();
    let item;
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO items (
          title, category, description, color, location_found, date_found,
          image_url, status, secret_clue, reported_by, contact_phone, listing_status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'PENDING')
        RETURNING
          id, title, category, description, color, location_found,
          date_found, image_url, status, listing_status, reported_by, created_at`,
        [
          String(title).trim(),
          String(category).trim(),
          String(description).trim(),
          color ? String(color).trim() : null,
          String(location_found).trim(),
          String(date_found),
          null,
          'FOUND',
          String(secret_clue).trim(),
          req.user.id,
          contact.phone || accountPhone,
        ]
      );
      item = result.rows[0];
      if (req.file) {
        item.image_url = `/api/items/${item.id}/photo`;
        await client.query(
          'UPDATE items SET image_url = $1, photo_key = $2 WHERE id = $3',
          [item.image_url, req.file.filename, item.id]
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return res.status(201).json({ message: 'Laporan berhasil dikirim dan menunggu verifikasi Admin.', item });
  } catch (error) {
    await removeUploadedFile(req.file?.path);
    console.error('Create item error:', error);
    return res.status(500).json({ message: 'Gagal menyimpan laporan barang.' });
  }
});

app.put('/api/items/:id', authRequired, async (req, res) => {
  const id = parseItemId(req.params.id);
  if (!id) return res.status(400).json({ message: 'ID barang tidak valid.' });
  const { title, category, description, color, location_found, date_found } = req.body || {};

  try {
    const check = await pool.query(
      'SELECT reported_by FROM items WHERE id = $1',
      [id]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ message: 'Barang tidak ditemukan.' });
    }

    if (check.rows[0].reported_by !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Anda tidak berhak mengedit barang ini.' });
    }

    const result = await pool.query(
      `UPDATE items SET
        title = COALESCE($1, title),
        category = COALESCE($2, category),
        description = COALESCE($3, description),
        color = COALESCE($4, color),
        location_found = COALESCE($5, location_found),
        date_found = COALESCE($6, date_found),
        listing_status = 'PENDING',
        review_note = NULL
      WHERE id = $7
      RETURNING
        id, title, category, description, color, location_found,
        date_found, image_url, status, listing_status, reported_by, created_at`,
      [
        title ? String(title).trim() : null,
        category ? String(category).trim() : null,
        description ? String(description).trim() : null,
        color !== undefined ? String(color).trim() : null,
        location_found ? String(location_found).trim() : null,
        date_found ? String(date_found) : null,
        id,
      ]
    );

    return res.json({ message: 'Barang berhasil diperbarui.', item: result.rows[0] });
  } catch (error) {
    console.error('Update item error:', error);
    return res.status(500).json({ message: 'Gagal memperbarui barang.' });
  }
});

app.post('/api/admin/reports/:id/review', authRequired, adminOnly, async (req, res) => {
  const id = parseItemId(req.params.id);
  const { decision, note } = req.body || {};
  const normalizedDecision = String(decision || '').toUpperCase();
  if (!id) return res.status(400).json({ message: 'ID barang tidak valid.' });
  if (!['APPROVED', 'REJECTED'].includes(normalizedDecision)) {
    return res.status(400).json({ message: 'Keputusan laporan tidak valid.' });
  }
  if (note !== undefined && typeof note !== 'string') {
    return res.status(400).json({ message: 'Catatan Admin tidak valid.' });
  }
  const reviewNote = typeof note === 'string' ? note.trim() : '';
  if (normalizedDecision === 'REJECTED' && !reviewNote) {
    return res.status(400).json({ message: 'Alasan penolakan laporan wajib diisi.' });
  }
  if (reviewNote.length > 1000) {
    return res.status(400).json({ message: 'Catatan Admin maksimal 1000 karakter.' });
  }
  try {
    const result = await pool.query(
      `UPDATE items
       SET listing_status = $1, review_note = $2
       WHERE id = $3 AND listing_status = 'PENDING'
       RETURNING id, title, listing_status, review_note`,
      [normalizedDecision, reviewNote || null, id]
    );
    if (!result.rows.length) {
      const exists = await pool.query('SELECT id FROM items WHERE id = $1', [id]);
      return exists.rows.length
        ? res.status(409).json({ message: 'Laporan sudah pernah diputuskan.' })
        : res.status(404).json({ message: 'Laporan tidak ditemukan.' });
    }
    return res.json({ message: `Laporan berhasil ${normalizedDecision === 'APPROVED' ? 'disetujui' : 'ditolak'}.`, item: result.rows[0] });
  } catch (error) {
    console.error('Review item report error:', error);
    return res.status(500).json({ message: 'Gagal menyimpan keputusan laporan.' });
  }
});

app.delete('/api/items/:id', authRequired, async (req, res) => {
  const id = parseItemId(req.params.id);
  if (!id) return res.status(400).json({ message: 'ID barang tidak valid.' });
  try {
    const check = await pool.query('SELECT reported_by FROM items WHERE id = $1', [id]);

    if (check.rows.length === 0) {
      return res.status(404).json({ message: 'Barang tidak ditemukan.' });
    }

    if (check.rows[0].reported_by !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Anda tidak berhak menghapus barang ini.' });
    }

    await pool.query('DELETE FROM items WHERE id = $1', [id]);
    return res.json({ message: 'Barang berhasil dihapus.' });
  } catch (error) {
    console.error('Delete item error:', error);
    return res.status(500).json({ message: 'Gagal menghapus barang.' });
  }
});

app.put('/internal/items/:id/status', internalAuth, async (req, res) => {
  const id = parseItemId(req.params.id);
  if (!id) return res.status(400).json({ message: 'ID barang tidak valid.' });
  const { status } = req.body || {};

  if (!status || !['FOUND', 'CLAIMED', 'RETURNED'].includes(String(status).toUpperCase())) {
    return res.status(400).json({ message: 'Status tidak valid.' });
  }

  try {
    const result = await pool.query(
      'UPDATE items SET status = $1 WHERE id = $2 RETURNING id, status',
      [String(status).toUpperCase(), id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Barang tidak ditemukan.' });
    }

    return res.json({ message: 'Status barang berhasil diubah.', item: result.rows[0] });
  } catch (error) {
    console.error('Update item status error:', error);
    return res.status(500).json({ message: 'Gagal mengubah status barang.' });
  }
});

async function startServer() {
  await retryDbConnection();
  await ensureItemColumns();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Item Service berjalan di port ${PORT}`);
  });
}

startServer().catch((error) => {
  console.error('Gagal menjalankan item-service:', error);
  process.exit(1);
});
