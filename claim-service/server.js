const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = Number(process.env.PORT || 3003);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'internal-key';
const ITEM_SERVICE_URL = process.env.ITEM_SERVICE_URL || 'http://item-service:3002';
const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:3004';
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

async function fetchJson(url, options = {}) {
  const requestOptions = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  };

  const response = await fetch(url, requestOptions);

  const text = await response.text();
  let body = {};

  if (text) {
    try {
      body = JSON.parse(text);
    } catch (error) {
      body = { message: text };
    }
  }

  if (!response.ok) {
    const message = body.message || 'Request gagal';
    throw new Error(message);
  }

  return body;
}

async function createNotification(userId, message, type) {
  try {
    await fetchJson(`${NOTIFICATION_SERVICE_URL}/api/notifications`, {
      method: 'POST',
      headers: {
        'x-internal-key': INTERNAL_API_KEY,
      },
      body: JSON.stringify({ user_id: Number(userId), message, type }),
    });
  } catch (error) {
    console.error('Gagal membuat notifikasi:', error.message);
  }
}

async function retryDbConnection() {
  let attempts = 0;

  while (attempts < 15) {
    try {
      await pool.query('SELECT 1');
      console.log('Koneksi database claim-service siap.');
      return;
    } catch (error) {
      attempts += 1;
      console.log(`Mencoba koneksi DB claim-service (${attempts}/15)...`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  console.error('Database claim-service tidak bisa terhubung setelah beberapa percobaan.');
  process.exit(1);
}

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    return res.json({ ok: true, service: 'claim-service' });
  } catch (error) {
    return res.status(500).json({ ok: false, message: 'Database tidak tersedia' });
  }
});

app.post('/api/claims', authRequired, async (req, res) => {
  const { item_id, verification_answer } = req.body || {};

  if (!item_id || Number(item_id) <= 0) {
    return res.status(400).json({ message: 'ID barang wajib diisi.' });
  }

  if (!verification_answer || String(verification_answer).trim().length < 5) {
    return res.status(400).json({ message: 'Jawaban minimal 5 karakter.' });
  }

  try {
    const itemCheck = await pool.query(
      'SELECT id, status, reported_by FROM items WHERE id = $1',
      [item_id]
    );

    if (itemCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Barang tidak ditemukan.' });
    }

    const item = itemCheck.rows[0];
    if (item.status !== 'FOUND') {
      return res.status(400).json({ message: 'Barang tidak bisa diklaim karena statusnya bukan FOUND.' });
    }

    const pendingCheck = await pool.query(
      'SELECT id FROM claims WHERE item_id = $1 AND user_id = $2 AND status IN (\'PENDING\', \'APPROVED\')',
      [item_id, req.user.id]
    );

    if (pendingCheck.rows.length > 0) {
      return res.status(409).json({ message: 'Anda sudah pernah mengajukan klaim untuk barang ini.' });
    }

    const rejectedCount = await pool.query(
      'SELECT COUNT(*) AS total FROM claims WHERE item_id = $1 AND user_id = $2 AND status = \'REJECTED\'',
      [item_id, req.user.id]
    );

    if (Number(rejectedCount.rows[0].total) >= 3) {
      return res.status(400).json({ message: 'Anda sudah melewati batas 3 percobaan gagal untuk barang ini.' });
    }

    const verifyResult = await fetchJson(`${ITEM_SERVICE_URL}/internal/items/${item_id}/verify`, {
      method: 'POST',
      headers: {
        'x-internal-key': INTERNAL_API_KEY,
      },
      body: JSON.stringify({ answer: String(verification_answer).trim() }),
    });

    const isVerified = Boolean(verifyResult && typeof verifyResult.match === 'boolean' ? verifyResult.match : verifyResult && verifyResult.score >= 0.5);
    const claimStatus = isVerified ? 'PENDING' : 'REJECTED';
    const adminNote = isVerified ? null : 'Verifikasi otomatis gagal';

    if (isVerified) {
      const insertResult = await pool.query(
        `INSERT INTO claims (item_id, user_id, verification_answer, status, admin_note)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, item_id, user_id, verification_answer, status, admin_note, created_at, updated_at`,
        [item_id, req.user.id, String(verification_answer).trim(), claimStatus, adminNote]
      );

      await fetchJson(`${ITEM_SERVICE_URL}/internal/items/${item_id}/status`, {
        method: 'PUT',
        headers: {
          'x-internal-key': INTERNAL_API_KEY,
        },
        body: JSON.stringify({ status: 'CLAIMED' }),
      });

      await createNotification(req.user.id, 'Pengajuan klaim Anda sedang diverifikasi.', 'CLAIM_PENDING');

      return res.status(201).json({
        message: 'Jawaban Anda telah dikirim untuk diverifikasi.',
        claim: insertResult.rows[0],
      });
    }

    const rejectedInsert = await pool.query(
      `INSERT INTO claims (item_id, user_id, verification_answer, status, admin_note)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, item_id, user_id, verification_answer, status, admin_note, created_at, updated_at`,
      [item_id, req.user.id, String(verification_answer).trim(), 'REJECTED', 'Verifikasi otomatis gagal']
    );

    return res.status(400).json({
      message: 'Jawaban tidak sesuai. Silakan coba lagi.',
      claim: rejectedInsert.rows[0],
    });
  } catch (error) {
    console.error('Create claim error:', error);
    return res.status(500).json({ message: error.message || 'Gagal mengajukan klaim.' });
  }
});

app.get('/api/claims/my', authRequired, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        c.id,
        c.item_id,
        i.title AS item_title,
        c.verification_answer,
        c.status,
        c.admin_note,
        c.created_at,
        c.updated_at
       FROM claims c
       JOIN items i ON i.id = c.item_id
       WHERE c.user_id = $1
       ORDER BY c.created_at DESC`,
      [req.user.id]
    );

    return res.json({ claims: result.rows });
  } catch (error) {
    console.error('My claims error:', error);
    return res.status(500).json({ message: 'Gagal mengambil klaim Anda.' });
  }
});

app.get('/api/claims/:id', authRequired, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        c.id,
        c.item_id,
        i.title AS item_title,
        c.user_id,
        u.name AS user_name,
        c.verification_answer,
        c.status,
        c.admin_note,
        c.created_at,
        c.updated_at
       FROM claims c
       JOIN items i ON i.id = c.item_id
       JOIN users u ON u.id = c.user_id
       WHERE c.id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Klaim tidak ditemukan.' });
    }

    const claim = result.rows[0];
    const isOwner = Number(claim.user_id) === Number(req.user.id);
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ message: 'Anda tidak berhak melihat klaim ini.' });
    }

    return res.json({ claim });
  } catch (error) {
    console.error('Get claim error:', error);
    return res.status(500).json({ message: 'Gagal mengambil detail klaim.' });
  }
});

app.get('/api/claims', authRequired, adminOnly, async (req, res) => {
  try {
    const { status } = req.query;
    let query = `
      SELECT
        c.id,
        c.item_id,
        i.title AS item_title,
        u.name AS user_name,
        c.verification_answer,
        c.status,
        c.admin_note,
        c.created_at,
        c.updated_at
      FROM claims c
      JOIN users u ON u.id = c.user_id
      JOIN items i ON i.id = c.item_id
      WHERE 1 = 1
    `;
    const params = [];
    let index = 1;

    if (status && String(status).trim()) {
      query += ` AND c.status = $${index}`;
      params.push(String(status).trim().toUpperCase());
      index += 1;
    }

    query += ' ORDER BY c.created_at DESC';

    const result = await pool.query(query, params);
    return res.json({ claims: result.rows });
  } catch (error) {
    console.error('Admin claims error:', error);
    return res.status(500).json({ message: 'Gagal mengambil daftar klaim.' });
  }
});

app.post('/api/claims/:id/approve', authRequired, adminOnly, async (req, res) => {
  try {
    const claimResult = await pool.query(
      'SELECT id, item_id, user_id, status FROM claims WHERE id = $1',
      [req.params.id]
    );

    if (claimResult.rows.length === 0) {
      return res.status(404).json({ message: 'Klaim tidak ditemukan.' });
    }

    const claim = claimResult.rows[0];
    if (claim.status !== 'PENDING') {
      return res.status(400).json({ message: 'Klaim hanya bisa disetujui jika masih PENDING.' });
    }

    const updatedClaim = await pool.query(
      `UPDATE claims
       SET status = 'APPROVED', updated_at = NOW()
       WHERE id = $1
       RETURNING id, item_id, user_id, verification_answer, status, admin_note, created_at, updated_at`,
      [claim.id]
    );

    await fetchJson(`${ITEM_SERVICE_URL}/internal/items/${claim.item_id}/status`, {
      method: 'PUT',
      headers: {
        'x-internal-key': INTERNAL_API_KEY,
      },
      body: JSON.stringify({ status: 'RETURNED' }),
    });

    await createNotification(claim.user_id, 'Klaim barang Anda telah disetujui.', 'CLAIM_APPROVED');

    return res.json({
      message: 'Klaim berhasil disetujui.',
      claim: updatedClaim.rows[0],
    });
  } catch (error) {
    console.error('Approve claim error:', error);
    return res.status(500).json({ message: error.message || 'Gagal menyetujui klaim.' });
  }
});

app.post('/api/claims/:id/reject', authRequired, adminOnly, async (req, res) => {
  try {
    const { admin_note } = req.body || {};
    const claimResult = await pool.query(
      'SELECT id, item_id, user_id, status FROM claims WHERE id = $1',
      [req.params.id]
    );

    if (claimResult.rows.length === 0) {
      return res.status(404).json({ message: 'Klaim tidak ditemukan.' });
    }

    const claim = claimResult.rows[0];
    if (claim.status !== 'PENDING') {
      return res.status(400).json({ message: 'Klaim hanya bisa ditolak jika masih PENDING.' });
    }

    const updatedClaim = await pool.query(
      `UPDATE claims
       SET status = 'REJECTED', admin_note = COALESCE($1, admin_note), updated_at = NOW()
       WHERE id = $2
       RETURNING id, item_id, user_id, verification_answer, status, admin_note, created_at, updated_at`,
      [admin_note ? String(admin_note).trim() : null, claim.id]
    );

    await fetchJson(`${ITEM_SERVICE_URL}/internal/items/${claim.item_id}/status`, {
      method: 'PUT',
      headers: {
        'x-internal-key': INTERNAL_API_KEY,
      },
      body: JSON.stringify({ status: 'FOUND' }),
    });

    await createNotification(claim.user_id, 'Klaim barang Anda ditolak.', 'CLAIM_REJECTED');

    return res.json({
      message: 'Klaim berhasil ditolak.',
      claim: updatedClaim.rows[0],
    });
  } catch (error) {
    console.error('Reject claim error:', error);
    return res.status(500).json({ message: error.message || 'Gagal menolak klaim.' });
  }
});

async function startServer() {
  await retryDbConnection();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Claim Service berjalan di port ${PORT}`);
  });
}

startServer().catch((error) => {
  console.error('Gagal menjalankan claim-service:', error);
  process.exit(1);
});
