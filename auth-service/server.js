const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
require('dotenv').config();

const app = express();
const PORT = Number(process.env.PORT || 3001);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:8080';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@temubarang.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
const MAX_CARD_SIZE = 5 * 1024 * 1024;

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

const cardUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, callback) => {
      callback(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`);
    },
  }),
  limits: { fileSize: MAX_CARD_SIZE, files: 1 },
  fileFilter: (req, file, callback) => {
    const extensions = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
    if (extensions[path.extname(file.originalname).toLowerCase()] !== file.mimetype) {
      callback(new Error('Foto KTM harus berformat JPG, JPEG, PNG, atau WEBP.'));
      return;
    }
    callback(null, true);
  },
});

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parsePhone(value) {
  if (value === undefined || value === null || String(value).trim() === '') return { phone: null };
  const normalized = String(value).replace(/[\s()-]/g, '');
  if (/^08\d{8,11}$/.test(normalized)) return { phone: `+62${normalized.slice(1)}` };
  if (/^\+628\d{8,11}$/.test(normalized)) return { phone: normalized };
  return { error: 'Nomor HP harus menggunakan format Indonesia, misalnya 081234567890 atau +6281234567890.' };
}

function uploadStudentCard(req, res, next) {
  cardUpload.single('student_card')(req, res, (error) => {
    if (!error) return next();
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? 'Ukuran foto KTM maksimal 5 MB.'
      : error.message || 'Foto KTM gagal diunggah.';
    return res.status(400).json({ message });
  });
}

async function validImageSignature(filePath, mimeType) {
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

function optionalPhone(value) {
  const result = parsePhone(value);
  if (result.error) return result;
  return result;
}

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

async function ensureProfileColumns() {
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS student_name VARCHAR(100);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS nim VARCHAR(40);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS study_program VARCHAR(120);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS student_card_key TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS identity_status VARCHAR(20);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS identity_note TEXT;
    UPDATE users SET identity_status = 'NOT_SUBMITTED' WHERE identity_status IS NULL;
    ALTER TABLE users ALTER COLUMN identity_status SET DEFAULT 'NOT_SUBMITTED';
    ALTER TABLE users ALTER COLUMN identity_status SET NOT NULL;
  `);
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
  const { name, email, password, phone } = req.body || {};
  const contact = optionalPhone(phone);

  if (contact.error) return res.status(400).json({ message: contact.error });

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
      'INSERT INTO users (name, email, password_hash, role, phone) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email, role, phone',
      [String(name).trim(), String(email).trim().toLowerCase(), passwordHash, 'user', contact.phone]
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
        phone: user.phone,
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
      'SELECT id, name, email, role, phone, created_at FROM users WHERE id = $1',
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

app.get('/api/auth/profile', authRequired, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, phone, student_name, nim, study_program,
              identity_status, identity_note, student_card_key IS NOT NULL AS has_student_card
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ message: 'Profil tidak ditemukan.' });
    return res.json({ profile: result.rows[0] });
  } catch (error) {
    console.error('Get profile error:', error);
    return res.status(500).json({ message: 'Gagal mengambil profil.' });
  }
});

app.put('/api/auth/profile', authRequired, async (req, res) => {
  const { name, phone, student_name, nim, study_program } = req.body || {};
  const contact = parsePhone(phone);
  if (contact.error) return res.status(400).json({ message: contact.error });
  if (name !== undefined && (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100)) {
    return res.status(400).json({ message: 'Nama akun harus berisi 2 sampai 100 karakter.' });
  }
  if (student_name !== undefined && student_name !== null
      && (typeof student_name !== 'string' || student_name.trim().length > 100)) {
    return res.status(400).json({ message: 'Nama mahasiswa maksimal 100 karakter.' });
  }
  if (nim !== undefined && nim !== null && nim !== ''
      && (typeof nim !== 'string' || !/^[A-Za-z0-9./-]{4,40}$/.test(nim.trim()))) {
    return res.status(400).json({ message: 'NIM harus berisi 4 sampai 40 karakter huruf, angka, titik, garis miring, atau tanda hubung.' });
  }
  if (study_program !== undefined && study_program !== null
      && (typeof study_program !== 'string' || study_program.trim().length > 120)) {
    return res.status(400).json({ message: 'Program studi maksimal 120 karakter.' });
  }

  try {
    const result = await pool.query(
      `UPDATE users SET
         name = COALESCE($1::varchar(100), name),
         phone = $2,
         student_name = $3::varchar(100),
         nim = $4::varchar(40),
         study_program = $5::varchar(120),
         identity_status = CASE
           WHEN student_card_key IS NOT NULL
             AND (student_name IS DISTINCT FROM $3::varchar(100) OR nim IS DISTINCT FROM $4::varchar(40))
             THEN 'PENDING'
           WHEN student_card_key IS NULL
             AND (student_name IS DISTINCT FROM $3::varchar(100) OR nim IS DISTINCT FROM $4::varchar(40))
             THEN 'NOT_SUBMITTED'
           ELSE identity_status
         END,
         identity_note = CASE
           WHEN student_name IS DISTINCT FROM $3::varchar(100) OR nim IS DISTINCT FROM $4::varchar(40) THEN NULL
           ELSE identity_note
         END
       WHERE id = $6
       RETURNING id, name, email, phone, student_name, nim, study_program,
                 identity_status, identity_note, student_card_key IS NOT NULL AS has_student_card`,
      [
        name === undefined ? null : name.trim(),
        contact.phone,
        student_name ? student_name.trim() : null,
        nim ? nim.trim() : null,
        study_program ? study_program.trim() : null,
        req.user.id,
      ]
    );
    if (!result.rows.length) return res.status(404).json({ message: 'Profil tidak ditemukan.' });
    return res.json({ message: 'Profil berhasil diperbarui.', profile: result.rows[0] });
  } catch (error) {
    console.error('Update profile error:', error);
    return res.status(500).json({ message: 'Gagal menyimpan profil.' });
  }
});

app.post('/api/auth/profile/student-card', authRequired, uploadStudentCard, async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Pilih foto KTM yang akan diunggah.' });
  if (!(await validImageSignature(req.file.path, req.file.mimetype))) {
    await removeUploadedFile(req.file.path);
    return res.status(400).json({ message: 'Isi file tidak sesuai dengan format foto yang dipilih.' });
  }

  try {
    const profile = await pool.query(
      'SELECT student_name, nim, student_card_key FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!profile.rows.length) {
      await removeUploadedFile(req.file.path);
      return res.status(404).json({ message: 'Profil tidak ditemukan.' });
    }
    if (!profile.rows[0].student_name || !profile.rows[0].nim) {
      await removeUploadedFile(req.file.path);
      return res.status(400).json({ message: 'Simpan nama mahasiswa dan NIM terlebih dahulu.' });
    }

    const result = await pool.query(
      `UPDATE users
       SET student_card_key = $1, identity_status = 'PENDING', identity_note = NULL
       WHERE id = $2
       RETURNING id, identity_status`,
      [req.file.filename, req.user.id]
    );
    await removeUploadedFile(profile.rows[0].student_card_key
      ? path.join(UPLOAD_DIR, path.basename(profile.rows[0].student_card_key))
      : null);
    return res.status(201).json({
      message: 'Foto KTM tersimpan dan menunggu pemeriksaan manual Admin.',
      profile: { ...result.rows[0], has_student_card: true },
    });
  } catch (error) {
    await removeUploadedFile(req.file.path);
    console.error('Upload student card error:', error);
    return res.status(500).json({ message: 'Gagal menyimpan foto KTM.' });
  }
});

app.get('/api/auth/users/:id/student-card', authRequired, async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isSafeInteger(userId) || userId < 1) {
    return res.status(400).json({ message: 'ID pengguna tidak valid.' });
  }
  if (Number(req.user.id) !== userId && req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Anda tidak berhak melihat foto KTM ini.' });
  }
  try {
    const result = await pool.query(
      'SELECT student_card_key FROM users WHERE id = $1',
      [userId]
    );
    if (!result.rows.length || !result.rows[0].student_card_key) {
      return res.status(404).json({ message: 'Foto KTM tidak ditemukan.' });
    }
    const filename = path.basename(result.rows[0].student_card_key);
    if (filename !== result.rows[0].student_card_key) {
      return res.status(404).json({ message: 'Foto KTM tidak ditemukan.' });
    }
    const filePath = path.join(UPLOAD_DIR, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ message: 'File foto KTM tidak tersedia.' });
    const extension = path.extname(filename).toLowerCase();
    const contentTypes = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
    res.set({
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Type': contentTypes[extension],
      'Content-Disposition': 'inline',
    });
    return res.sendFile(filePath);
  } catch (error) {
    console.error('Get student card error:', error);
    return res.status(500).json({ message: 'Gagal mengambil foto KTM.' });
  }
});

app.get('/api/admin/identities', authRequired, adminOnly, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, phone, student_name, nim, study_program,
              student_card_key IS NOT NULL AS has_student_card,
              identity_status, identity_note, created_at
       FROM users
       WHERE nim IS NOT NULL OR student_card_key IS NOT NULL
       ORDER BY CASE identity_status WHEN 'PENDING' THEN 0 ELSE 1 END, created_at DESC`
    );
    return res.json({ identities: result.rows });
  } catch (error) {
    console.error('Admin identities error:', error);
    return res.status(500).json({ message: 'Gagal mengambil daftar verifikasi identitas.' });
  }
});

app.put('/api/admin/identities/:id', authRequired, adminOnly, async (req, res) => {
  const userId = Number(req.params.id);
  const status = String(req.body?.status || '').toUpperCase();
  const note = req.body?.note;
  if (!Number.isSafeInteger(userId) || userId < 1) {
    return res.status(400).json({ message: 'ID pengguna tidak valid.' });
  }
  if (!['VERIFIED', 'REJECTED'].includes(status)) {
    return res.status(400).json({ message: 'Status verifikasi identitas tidak valid.' });
  }
  if (note !== undefined && typeof note !== 'string') {
    return res.status(400).json({ message: 'Catatan Admin tidak valid.' });
  }
  const identityNote = typeof note === 'string' ? note.trim() : '';
  if (status === 'REJECTED' && !identityNote) {
    return res.status(400).json({ message: 'Catatan diperlukan jika identitas tidak dapat diverifikasi.' });
  }
  if (identityNote.length > 1000) {
    return res.status(400).json({ message: 'Catatan Admin maksimal 1000 karakter.' });
  }
  try {
    const result = await pool.query(
      `UPDATE users SET identity_status = $1, identity_note = $2
       WHERE id = $3 AND nim IS NOT NULL AND student_card_key IS NOT NULL
       RETURNING id, name, student_name, nim, identity_status, identity_note`,
      [status, identityNote || null, userId]
    );
    if (!result.rows.length) {
      const exists = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
      return exists.rows.length
        ? res.status(400).json({ message: 'Identitas perlu memiliki nama, NIM, dan foto KTM sebelum diputuskan.' })
        : res.status(404).json({ message: 'Pengguna tidak ditemukan.' });
    }
    return res.json({ message: 'Keputusan verifikasi identitas tersimpan.', identity: result.rows[0] });
  } catch (error) {
    console.error('Review identity error:', error);
    return res.status(500).json({ message: 'Gagal menyimpan keputusan verifikasi identitas.' });
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
  await ensureProfileColumns();
  await ensureAdminUser();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Auth Service berjalan di port ${PORT}`);
  });
}

startServer().catch((error) => {
  console.error('Gagal menjalankan auth-service:', error);
  process.exit(1);
});
