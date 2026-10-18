const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = Number(process.env.PORT || 3001);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:8080';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@temubarang.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

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

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function authRequired(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Token tidak ditemukan atau tidak valid.' });
  }

  const token = authHeader.split(' ')[1];

  try {
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

async function ensureAdminUser() {
  try {
    const result = await pool.query('SELECT id FROM users WHERE email = $1', [ADMIN_EMAIL]);

    if (result.rows.length > 0) {
      return;
    }

    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    await pool.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4)',
      ['Admin TemuBarang', ADMIN_EMAIL, passwordHash, 'admin']
    );

    console.log('Admin default berhasil dibuat.');
  } catch (error) {
    console.error('Gagal memastikan admin default:', error.message);
  }
}

async function retryDbConnection() {
  let attempts = 0;

  while (attempts < 15) {
    try {
      await pool.query('SELECT 1');
      console.log('Koneksi database auth-service siap.');
      return;
    } catch (error) {
      attempts += 1;
      console.log(`Mencoba koneksi DB auth-service (${attempts}/15)...`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  console.error('Database auth-service tidak bisa terhubung setelah beberapa percobaan.');
  process.exit(1);
}

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, service: 'auth-service' });
  } catch (error) {
    res.status(500).json({ ok: false, message: 'Database tidak tersedia' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body || {};

  if (!name || String(name).trim().length < 2) {
    return res.status(400).json({ message: 'Nama wajib diisi minimal 2 karakter.' });
  }

  if (!email || !emailRegex.test(String(email))) {
    return res.status(400).json({ message: 'Email tidak valid.' });
  }

  if (!password || String(password).length < 6) {
    return res.status(400).json({ message: 'Password minimal 6 karakter.' });
  }

  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [String(email).trim().toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ message: 'Email sudah terdaftar.' });
    }

    const passwordHash = await bcrypt.hash(String(password), 10);
    const insertResult = await pool.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role',
      [String(name).trim(), String(email).trim().toLowerCase(), passwordHash, 'user']
    );

    const user = insertResult.rows[0];
    const token = jwt.sign({ id: user.id, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: '1d' });

    return res.status(201).json({
      message: 'Registrasi berhasil.',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('Register error:', error);
    return res.status(500).json({ message: 'Registrasi gagal. Coba lagi.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !emailRegex.test(String(email))) {
    return res.status(400).json({ message: 'Email tidak valid.' });
  }

  if (!password || String(password).length < 6) {
    return res.status(400).json({ message: 'Password minimal 6 karakter.' });
  }

  try {
    const result = await pool.query(
      'SELECT id, name, email, password_hash, role FROM users WHERE email = $1',
      [String(email).trim().toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Email atau password salah.' });
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(String(password), user.password_hash);

    if (!valid) {
      return res.status(401).json({ message: 'Email atau password salah.' });
    }

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    return res.status(200).json({
      message: 'Login berhasil.',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ message: 'Login gagal. Coba lagi.' });
  }
});

app.get('/api/auth/me', authRequired, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, role, created_at FROM users WHERE id = $1',
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User tidak ditemukan.' });
    }

    const user = result.rows[0];
    return res.json({ user });
  } catch (error) {
    console.error('Get me error:', error);
    return res.status(500).json({ message: 'Gagal mengambil data user.' });
  }
});

app.get('/api/auth/admin-check', authRequired, adminOnly, (req, res) => {
  res.json({ ok: true, message: 'Anda admin.', user: req.user });
});

app.post('/api/auth/logout', authRequired, (req, res) => {
  return res.json({ message: 'Logout berhasil dilakukan di frontend dengan menghapus token.' });
});

async function startServer() {
  await retryDbConnection();
  await ensureAdminUser();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Auth Service berjalan di port ${PORT}`);
  });
}

startServer().catch((error) => {
  console.error('Gagal menjalankan auth-service:', error);
  process.exit(1);
});
