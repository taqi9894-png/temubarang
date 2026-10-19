const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = Number(process.env.PORT || 3003);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'internal-key';
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

function parsePositiveId(value) {
  const text = String(value ?? '').trim();
  if (!/^[1-9]\d*$/.test(text)) return null;
  const id = Number(text);
  return Number.isSafeInteger(id) ? id : null;
}

function parsePhone(value) {
  if (value === undefined || value === null || String(value).trim() === '') return { phone: null };
  const normalized = String(value).replace(/[\s()-]/g, '');
  if (/^08\d{8,11}$/.test(normalized)) return { phone: `+62${normalized.slice(1)}` };
  if (/^\+628\d{8,11}$/.test(normalized)) return { phone: normalized };
  return { error: 'Nomor HP harus menggunakan format Indonesia, misalnya 081234567890 atau +6281234567890.' };
}

// Both tables share the Compose Postgres database, so their state can change atomically.
async function runInTransaction(operation) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Gagal membatalkan transaksi klaim:', rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
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

async function ensureClaimColumns() {
  await pool.query('ALTER TABLE claims ADD COLUMN IF NOT EXISTS contact_phone TEXT');
  let attempts = 0;
  while (attempts < 15) {
    try {
      await pool.query('SELECT phone, student_name, nim, study_program, identity_status, student_card_key FROM users LIMIT 0');
      await pool.query('SELECT listing_status, photo_key FROM items LIMIT 0');
      return;
    } catch (error) {
      attempts += 1;
      if (attempts === 15) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
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
  const { item_id, verification_answer, contact_phone } = req.body || {};
  const itemId = parsePositiveId(item_id);
  const submittedPhone = parsePhone(contact_phone);

  if (!itemId) {
    return res.status(400).json({ message: 'ID barang tidak valid.' });
  }

  if (!verification_answer || String(verification_answer).trim().length < 5) {
    return res.status(400).json({ message: 'Jawaban minimal 5 karakter.' });
  }
  if (submittedPhone.error) return res.status(400).json({ message: submittedPhone.error });

  try {
    const userResult = await pool.query('SELECT phone FROM users WHERE id = $1', [req.user.id]);
    const claimantPhone = submittedPhone.phone || userResult.rows[0]?.phone || null;
    if (!claimantPhone) {
      return res.status(400).json({ message: 'Nomor HP diperlukan untuk koordinasi klaim. Isi nomor kontak pada profil atau formulir klaim.' });
    }
    const itemCheck = await pool.query(
      'SELECT id, status, listing_status, reported_by FROM items WHERE id = $1',
      [itemId]
    );

    if (itemCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Barang tidak ditemukan.' });
    }

    const item = itemCheck.rows[0];
    if (item.listing_status !== 'APPROVED') {
      return res.status(404).json({ message: 'Barang tidak ditemukan.' });
    }
    if (Number(item.reported_by) === Number(req.user.id)) {
      return res.status(403).json({ message: 'Anda tidak bisa mengklaim barang yang Anda laporkan.' });
    }

    if (item.status !== 'FOUND') {
      return res.status(400).json({ message: 'Barang tidak bisa diklaim karena statusnya bukan FOUND.' });
    }

    const outcome = await runInTransaction(async (client) => {
      const lockedItem = await client.query(
        'SELECT id, status, listing_status, reported_by FROM items WHERE id = $1 FOR UPDATE',
        [itemId]
      );

      if (lockedItem.rows.length === 0) {
        return { status: 404, body: { message: 'Barang tidak ditemukan.' } };
      }

      if (Number(lockedItem.rows[0].reported_by) === Number(req.user.id)) {
        return { status: 403, body: { message: 'Anda tidak bisa mengklaim barang yang Anda laporkan.' } };
      }
      if (lockedItem.rows[0].listing_status !== 'APPROVED') {
        return { status: 404, body: { message: 'Barang tidak ditemukan.' } };
      }

      if (lockedItem.rows[0].status !== 'FOUND') {
        return { status: 409, body: { message: 'Barang sudah tidak tersedia untuk diklaim.' } };
      }

      const pendingForItem = await client.query(
        "SELECT id FROM claims WHERE item_id = $1 AND status = 'PENDING' LIMIT 1",
        [itemId]
      );
      if (pendingForItem.rows.length > 0) {
        return { status: 409, body: { message: 'Barang sudah memiliki klaim yang menunggu pemeriksaan Admin.' } };
      }

      const pendingCheck = await client.query(
        'SELECT id FROM claims WHERE item_id = $1 AND user_id = $2 AND status IN (\'PENDING\', \'APPROVED\')',
        [itemId, req.user.id]
      );

      if (pendingCheck.rows.length > 0) {
        return { status: 409, body: { message: 'Anda sudah pernah mengajukan klaim untuk barang ini.' } };
      }

      const rejectedCount = await client.query(
        'SELECT COUNT(*) AS total FROM claims WHERE item_id = $1 AND user_id = $2 AND status = \'REJECTED\'',
        [itemId, req.user.id]
      );

      if (Number(rejectedCount.rows[0].total) >= 3) {
        return { status: 400, body: { message: 'Anda sudah melewati batas 3 percobaan gagal untuk barang ini.' } };
      }

      await client.query("UPDATE items SET status = 'CLAIMED' WHERE id = $1", [itemId]);
      const insertResult = await client.query(
        `INSERT INTO claims (item_id, user_id, verification_answer, status, contact_phone)
         VALUES ($1, $2, $3, 'PENDING', $4)
         RETURNING id, item_id, user_id, verification_answer, status, admin_note, contact_phone, created_at, updated_at`,
        [itemId, req.user.id, String(verification_answer).trim(), claimantPhone]
      );

      return {
        status: 201,
        body: {
          message: 'Survey klaim Anda telah dikirim kepada admin untuk ditinjau.',
          claim: insertResult.rows[0],
        },
      };
    });

    if (outcome.status === 201) {
      await createNotification(req.user.id, 'Pengajuan klaim Anda sedang diverifikasi.', 'CLAIM_PENDING');
    }

    return res.status(outcome.status).json(outcome.body);
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
        c.contact_phone,
        i.status AS item_status,
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
        i.status AS item_status,
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
        i.secret_clue AS item_secret_clue,
        i.category AS item_category,
        i.description AS item_description,
        i.color AS item_color,
        i.location_found AS item_location_found,
        i.date_found AS item_date_found,
        i.image_url AS item_image_url,
        i.status AS item_status,
        u.id AS user_id,
        u.name AS user_name,
        u.email AS user_email,
        u.phone AS account_phone,
        u.student_name,
        u.nim,
        u.study_program,
        u.identity_status,
        u.identity_note,
        u.student_card_key IS NOT NULL AS has_student_card,
        c.contact_phone,
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
    const { admin_note } = req.body || {};
    if (admin_note !== undefined && typeof admin_note !== 'string') {
      return res.status(400).json({ message: 'Catatan admin tidak valid.' });
    }
    const adminNote = admin_note?.trim() || null;
    if (adminNote && adminNote.length > 1000) {
      return res.status(400).json({ message: 'Catatan admin maksimal 1000 karakter.' });
    }
    const claimId = parsePositiveId(req.params.id);
    if (!claimId) return res.status(400).json({ message: 'ID klaim tidak valid.' });

    const outcome = await runInTransaction(async (client) => {
      const claimResult = await client.query(
        'SELECT id, item_id, user_id, status FROM claims WHERE id = $1 FOR UPDATE',
        [claimId]
      );
      if (claimResult.rows.length === 0) {
        return { status: 404, body: { message: 'Klaim tidak ditemukan.' } };
      }

      const claim = claimResult.rows[0];
      if (claim.status !== 'PENDING') {
        return { status: 400, body: { message: 'Klaim hanya bisa disetujui jika masih PENDING.' } };
      }

      const itemResult = await client.query(
        'SELECT status FROM items WHERE id = $1 FOR UPDATE',
        [claim.item_id]
      );
      if (itemResult.rows.length === 0 || !['FOUND', 'CLAIMED'].includes(itemResult.rows[0].status)) {
        return { status: 409, body: { message: 'Status barang tidak cocok dengan klaim yang menunggu.' } };
      }

      const otherPendingClaims = await client.query(
        "SELECT id FROM claims WHERE item_id = $1 AND status = 'PENDING' AND id <> $2 LIMIT 1",
        [claim.item_id, claim.id]
      );
      if (otherPendingClaims.rows.length > 0) {
        return { status: 409, body: { message: 'Selesaikan pemeriksaan klaim lain untuk barang ini sebelum menyetujui.' } };
      }

      await client.query("UPDATE items SET status = 'CLAIMED' WHERE id = $1", [claim.item_id]);
      const updatedClaim = await client.query(
        `UPDATE claims
         SET status = 'APPROVED', admin_note = COALESCE($1, admin_note), updated_at = NOW()
         WHERE id = $2
         RETURNING id, item_id, user_id, verification_answer, status, admin_note, created_at, updated_at`,
        [adminNote, claim.id]
      );

      return {
        status: 200,
        body: { message: 'Klaim berhasil disetujui.', claim: updatedClaim.rows[0] },
        userId: claim.user_id,
      };
    });

    if (outcome.status !== 200) return res.status(outcome.status).json(outcome.body);

    await createNotification(outcome.userId, 'Klaim barang Anda telah disetujui.', 'CLAIM_APPROVED');
    return res.json(outcome.body);
  } catch (error) {
    console.error('Approve claim error:', error);
    return res.status(500).json({ message: error.message || 'Gagal menyetujui klaim.' });
  }
});

app.post('/api/claims/:id/complete-handover', authRequired, adminOnly, async (req, res) => {
  const claimId = parsePositiveId(req.params.id);
  if (!claimId) return res.status(400).json({ message: 'ID klaim tidak valid.' });
  try {
    const outcome = await runInTransaction(async (client) => {
      const result = await client.query(
        'SELECT id, item_id, status FROM claims WHERE id = $1 FOR UPDATE',
        [claimId]
      );
      if (!result.rows.length) return { status: 404, message: 'Klaim tidak ditemukan.' };
      const claim = result.rows[0];
      if (claim.status !== 'APPROVED') {
        return { status: 409, message: 'Penyerahan hanya dapat diselesaikan untuk klaim yang sudah disetujui.' };
      }
      const item = await client.query(
        'SELECT status FROM items WHERE id = $1 FOR UPDATE',
        [claim.item_id]
      );
      if (!item.rows.length || item.rows[0].status !== 'CLAIMED') {
        return { status: 409, message: 'Barang tidak sedang menunggu penyerahan.' };
      }
      await client.query("UPDATE items SET status = 'RETURNED' WHERE id = $1", [claim.item_id]);
      return { status: 200, message: 'Penyerahan barang dicatat selesai.' };
    });
    return res.status(outcome.status).json({ message: outcome.message });
  } catch (error) {
    console.error('Complete claim handover error:', error);
    return res.status(500).json({ message: 'Gagal mencatat penyerahan barang.' });
  }
});

app.post('/api/claims/:id/reject', authRequired, adminOnly, async (req, res) => {
  try {
    const { admin_note } = req.body || {};
    if (admin_note !== undefined && typeof admin_note !== 'string') {
      return res.status(400).json({ message: 'Catatan admin tidak valid.' });
    }
    const adminNote = admin_note?.trim() || null;
    if (!adminNote) {
      return res.status(400).json({ message: 'Alasan penolakan wajib diisi.' });
    }
    if (adminNote && adminNote.length > 1000) {
      return res.status(400).json({ message: 'Catatan admin maksimal 1000 karakter.' });
    }
    const claimId = parsePositiveId(req.params.id);
    if (!claimId) return res.status(400).json({ message: 'ID klaim tidak valid.' });

    const outcome = await runInTransaction(async (client) => {
      const claimResult = await client.query(
        'SELECT id, item_id, user_id, status FROM claims WHERE id = $1 FOR UPDATE',
        [claimId]
      );
      if (claimResult.rows.length === 0) {
        return { status: 404, body: { message: 'Klaim tidak ditemukan.' } };
      }

      const claim = claimResult.rows[0];
      if (claim.status !== 'PENDING') {
        return { status: 400, body: { message: 'Klaim hanya bisa ditolak jika masih PENDING.' } };
      }

      const itemResult = await client.query(
        'SELECT status FROM items WHERE id = $1 FOR UPDATE',
        [claim.item_id]
      );
      if (itemResult.rows.length === 0 || !['FOUND', 'CLAIMED'].includes(itemResult.rows[0].status)) {
        return { status: 409, body: { message: 'Status barang tidak cocok dengan klaim yang menunggu.' } };
      }

      const otherPendingClaims = await client.query(
        "SELECT id FROM claims WHERE item_id = $1 AND status = 'PENDING' AND id <> $2 LIMIT 1",
        [claim.item_id, claim.id]
      );
      const nextItemStatus = otherPendingClaims.rows.length > 0 ? 'CLAIMED' : 'FOUND';

      await client.query('UPDATE items SET status = $1 WHERE id = $2', [nextItemStatus, claim.item_id]);
      const updatedClaim = await client.query(
        `UPDATE claims
         SET status = 'REJECTED', admin_note = COALESCE($1, admin_note), updated_at = NOW()
         WHERE id = $2
         RETURNING id, item_id, user_id, verification_answer, status, admin_note, created_at, updated_at`,
        [adminNote, claim.id]
      );

      return {
        status: 200,
        body: { message: 'Klaim berhasil ditolak.', claim: updatedClaim.rows[0] },
        userId: claim.user_id,
      };
    });

    if (outcome.status !== 200) return res.status(outcome.status).json(outcome.body);

    await createNotification(outcome.userId, 'Klaim barang Anda ditolak.', 'CLAIM_REJECTED');
    return res.json(outcome.body);
  } catch (error) {
    console.error('Reject claim error:', error);
    return res.status(500).json({ message: error.message || 'Gagal menolak klaim.' });
  }
});

async function startServer() {
  await retryDbConnection();
  await ensureClaimColumns();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Claim Service berjalan di port ${PORT}`);
  });
}

startServer().catch((error) => {
  console.error('Gagal menjalankan claim-service:', error);
  process.exit(1);
});
