const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = Number(process.env.PORT || 3004);
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

function internalAuth(req, res, next) {
  const key = req.headers['x-internal-key'];
  if (!key || key !== INTERNAL_API_KEY) {
    return res.status(401).json({ message: 'Kunci internal tidak valid.' });
  }
  return next();
}

async function retryDbConnection() {
  let attempts = 0;

  while (attempts < 15) {
    try {
      await pool.query('SELECT 1');
      console.log('Koneksi database notification-service siap.');
      return;
    } catch (error) {
      attempts += 1;
      console.log(`Mencoba koneksi DB notification-service (${attempts}/15)...`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  console.error('Database notification-service tidak bisa terhubung setelah beberapa percobaan.');
  process.exit(1);
}

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    return res.json({ ok: true, service: 'notification-service' });
  } catch (error) {
    return res.status(500).json({ ok: false, message: 'Database tidak tersedia' });
  }
});

app.post('/api/notifications', (req, res, next) => {
  if (req.headers['x-internal-key'] === INTERNAL_API_KEY) {
    return internalAuth(req, res, next);
  }

  return authRequired(req, res, next);
}, async (req, res) => {
  const { user_id, message, type } = req.body || {};

  if (!user_id || Number(user_id) <= 0) {
    return res.status(400).json({ message: 'ID user wajib diisi.' });
  }

  if (!message || String(message).trim().length < 3) {
    return res.status(400).json({ message: 'Pesan notifikasi wajib diisi.' });
  }

  if (!type || !['CLAIM_PENDING', 'CLAIM_APPROVED', 'CLAIM_REJECTED'].includes(type)) {
    return res.status(400).json({ message: 'Tipe notifikasi tidak valid.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO notifications (user_id, message, type, is_read)
       VALUES ($1, $2, $3, false)
       RETURNING id, user_id, message, type, is_read, created_at`,
      [Number(user_id), String(message).trim(), type]
    );

    return res.status(201).json({ message: 'Notifikasi berhasil dibuat.', notification: result.rows[0] });
  } catch (error) {
    console.error('Create notification error:', error);
    return res.status(500).json({ message: 'Gagal membuat notifikasi.' });
  }
});

app.get('/api/notifications', authRequired, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, user_id, message, type, is_read, created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.user.id]
    );

    return res.json({ notifications: result.rows });
  } catch (error) {
    console.error('List notifications error:', error);
    return res.status(500).json({ message: 'Gagal mengambil notifikasi.' });
  }
});

app.put('/api/notifications/:id/read', authRequired, async (req, res) => {
  try {
    const notificationCheck = await pool.query(
      'SELECT user_id FROM notifications WHERE id = $1',
      [req.params.id]
    );

    if (notificationCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Notifikasi tidak ditemukan.' });
    }

    if (Number(notificationCheck.rows[0].user_id) !== Number(req.user.id)) {
      return res.status(403).json({ message: 'Anda tidak berhak membaca notifikasi ini.' });
    }

    const result = await pool.query(
      `UPDATE notifications
       SET is_read = true
       WHERE id = $1
       RETURNING id, user_id, message, type, is_read, created_at`,
      [req.params.id]
    );

    return res.json({ message: 'Notifikasi ditandai sudah dibaca.', notification: result.rows[0] });
  } catch (error) {
    console.error('Read notification error:', error);
    return res.status(500).json({ message: 'Gagal menandai notifikasi dibaca.' });
  }
});

async function startServer() {
  await retryDbConnection();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Notification Service berjalan di port ${PORT}`);
  });
}

startServer().catch((error) => {
  console.error('Gagal menjalankan notification-service:', error);
  process.exit(1);
});
