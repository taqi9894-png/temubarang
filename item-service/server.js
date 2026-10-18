const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = Number(process.env.PORT || 3002);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'internal-key';
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:8080';

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

function normalizeText(value) {
  if (!value) return '';
  return String(value)
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()\[\]"'<>?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getKeywordSet(text) {
  const stopWords = new Set([
    'yang', 'di', 'pada', 'ada', 'dan', 'dengan', 'ke', 'itu', 'ini', 'bagian'
  ]);

  return normalizeText(text)
    .split(' ')
    .filter((word) => word && !stopWords.has(word));
}

function extractVerificationAnswer(body) {
  if (!body || typeof body !== 'object') {
    return '';
  }

  const rawValue = body.answer ?? body.verification_answer ?? body.verificationAnswer ?? body.answer_text;
  if (rawValue === undefined || rawValue === null) {
    return '';
  }

  return String(rawValue).trim();
}

function computeVerificationMatch(secretClue, answer) {
  const normalizedAnswer = normalizeText(answer);
  const normalizedClue = normalizeText(secretClue);

  const answerWords = getKeywordSet(normalizedAnswer);
  const clueWords = getKeywordSet(normalizedClue);

  const clueSet = new Set(clueWords);
  const matches = answerWords.filter((word) => clueSet.has(word));
  const percentage = clueWords.length > 0 ? (matches.length / clueWords.length) * 100 : 0;

  return {
    match: percentage >= 50,
    score: Number(Math.min(1, percentage / 100).toFixed(2)),
    percentage,
    matches: matches.length,
    totalKeywords: clueWords.length,
  };
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

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    return res.json({ ok: true, service: 'item-service' });
  } catch (error) {
    return res.status(500).json({ ok: false, message: 'Database tidak tersedia' });
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
      WHERE 1 = 1
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

app.get('/api/items/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT
        id, title, category, description, color, location_found, date_found,
        image_url, status, reported_by, created_at
       FROM items WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Barang tidak ditemukan.' });
    }

    return res.json({ item: result.rows[0] });
  } catch (error) {
    console.error('Get item error:', error);
    return res.status(500).json({ message: 'Gagal mengambil detail barang.' });
  }
});

app.post('/api/items', authRequired, async (req, res) => {
  const { title, category, description, color, location_found, date_found, image_url, secret_clue } = req.body || {};

  if (!title || String(title).trim().length < 3) {
    return res.status(400).json({ message: 'Judul barang minimal 3 karakter.' });
  }

  if (!category || String(category).trim().length < 2) {
    return res.status(400).json({ message: 'Kategori wajib diisi.' });
  }

  if (!description || String(description).trim().length < 10) {
    return res.status(400).json({ message: 'Deskripsi barang minimal 10 karakter.' });
  }

  if (!location_found || String(location_found).trim().length < 3) {
    return res.status(400).json({ message: 'Lokasi ditemukan wajib diisi.' });
  }

  if (!date_found) {
    return res.status(400).json({ message: 'Tanggal ditemukan wajib diisi.' });
  }

  if (!secret_clue || String(secret_clue).trim().length < 5) {
    return res.status(400).json({ message: 'Ciri rahasia wajib diisi minimal 5 karakter.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO items (
        title, category, description, color, location_found, date_found,
        image_url, status, secret_clue, reported_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING
        id, title, category, description, color, location_found,
        date_found, image_url, status, reported_by, created_at`,
      [
        String(title).trim(),
        String(category).trim(),
        String(description).trim(),
        color ? String(color).trim() : null,
        String(location_found).trim(),
        String(date_found),
        image_url ? String(image_url).trim() : null,
        'FOUND',
        String(secret_clue).trim(),
        req.user.id,
      ]
    );

    return res.status(201).json({ message: 'Barang berhasil dilaporkan.', item: result.rows[0] });
  } catch (error) {
    console.error('Create item error:', error);
    return res.status(500).json({ message: 'Gagal menyimpan laporan barang.' });
  }
});

app.put('/api/items/:id', authRequired, async (req, res) => {
  const { id } = req.params;
  const { title, category, description, color, location_found, date_found, image_url, status } = req.body || {};

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
        image_url = COALESCE($7, image_url),
        status = COALESCE($8, status)
      WHERE id = $9
      RETURNING
        id, title, category, description, color, location_found,
        date_found, image_url, status, reported_by, created_at`,
      [
        title ? String(title).trim() : null,
        category ? String(category).trim() : null,
        description ? String(description).trim() : null,
        color !== undefined ? String(color).trim() : null,
        location_found ? String(location_found).trim() : null,
        date_found ? String(date_found) : null,
        image_url !== undefined ? (String(image_url).trim() || null) : null,
        status ? String(status).trim().toUpperCase() : null,
        id,
      ]
    );

    return res.json({ message: 'Barang berhasil diperbarui.', item: result.rows[0] });
  } catch (error) {
    console.error('Update item error:', error);
    return res.status(500).json({ message: 'Gagal memperbarui barang.' });
  }
});

app.delete('/api/items/:id', authRequired, async (req, res) => {
  try {
    const check = await pool.query('SELECT reported_by FROM items WHERE id = $1', [req.params.id]);

    if (check.rows.length === 0) {
      return res.status(404).json({ message: 'Barang tidak ditemukan.' });
    }

    if (check.rows[0].reported_by !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Anda tidak berhak menghapus barang ini.' });
    }

    await pool.query('DELETE FROM items WHERE id = $1', [req.params.id]);
    return res.json({ message: 'Barang berhasil dihapus.' });
  } catch (error) {
    console.error('Delete item error:', error);
    return res.status(500).json({ message: 'Gagal menghapus barang.' });
  }
});

app.post('/internal/items/:id/verify', internalAuth, async (req, res) => {
  const { id } = req.params;
  const answer = extractVerificationAnswer(req.body || {});

  if (!answer || answer.length < 1) {
    return res.status(400).json({ message: 'Jawaban tidak valid.' });
  }

  try {
    const result = await pool.query(
      'SELECT secret_clue FROM items WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Barang tidak ditemukan.' });
    }

    const verification = computeVerificationMatch(result.rows[0].secret_clue, answer);

    return res.json({
      match: verification.match,
      score: verification.score,
      percentage: verification.percentage,
      matches: verification.matches,
      totalKeywords: verification.totalKeywords,
    });
  } catch (error) {
    console.error('Verify item error:', error);
    return res.status(500).json({ message: 'Gagal memverifikasi barang.' });
  }
});

app.put('/internal/items/:id/status', internalAuth, async (req, res) => {
  const { id } = req.params;
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
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Item Service berjalan di port ${PORT}`);
  });
}

startServer().catch((error) => {
  console.error('Gagal menjalankan item-service:', error);
  process.exit(1);
});
