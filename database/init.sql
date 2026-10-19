CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    phone TEXT,
    student_name VARCHAR(100),
    nim VARCHAR(40),
    study_program VARCHAR(120),
    student_card_key TEXT,
    identity_status VARCHAR(20) NOT NULL DEFAULT 'NOT_SUBMITTED',
    identity_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS items (
    id SERIAL PRIMARY KEY,
    title VARCHAR(150) NOT NULL,
    category VARCHAR(50) NOT NULL,
    description TEXT NOT NULL,
    color VARCHAR(50),
    location_found VARCHAR(200) NOT NULL,
    date_found DATE NOT NULL,
    image_url TEXT,
    photo_key TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'FOUND' CHECK (status IN ('FOUND', 'CLAIMED', 'RETURNED')),
    listing_status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (listing_status IN ('PENDING', 'APPROVED', 'REJECTED')),
    review_note TEXT,
    contact_phone TEXT,
    secret_clue TEXT NOT NULL,
    reported_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS claims (
    id SERIAL PRIMARY KEY,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    verification_answer TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    contact_phone TEXT,
    admin_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    type VARCHAR(30) NOT NULL CHECK (type IN ('CLAIM_PENDING', 'CLAIM_APPROVED', 'CLAIM_REJECTED')),
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);
CREATE INDEX IF NOT EXISTS idx_items_reported_by ON items(reported_by);
CREATE INDEX IF NOT EXISTS idx_claims_user_id ON claims(user_id);
CREATE INDEX IF NOT EXISTS idx_claims_item_id ON claims(item_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);

INSERT INTO users (name, email, password_hash, role)
VALUES
    ('Admin TemuBarang', 'admin@temubarang.local', '$2b$10$yCADLGTH3awTD8ob4BbUguqyfmjkSrz6MrpazW/D0Klxk9g5mMV6a', 'admin'),
    ('Andi Pratama', 'andi@example.com', '$2b$10$/QB1t7PRtMCsX7Q/kcWXdu9p/Igs2.44n/MlntyOgx2sgqUDHSn4u', 'user'),
    ('Sari Lestari', 'sari@example.com', '$2b$10$NU7DAeIRhsLVyECem5nTE.BvLv4.AK.8nI/owqB9f2GA7vGjgpupe', 'user')
ON CONFLICT (email) DO NOTHING;

INSERT INTO items (
    title,
    category,
    description,
    color,
    location_found,
    date_found,
    image_url,
    listing_status,
    status,
    secret_clue,
    reported_by
)
VALUES
    (
        'Tas Ransel Hitam',
        'Aksesori',
        'Tas ransel hitam berukuran medium dengan slot laptop 14 inci, kondisi masih bagus.',
        'Hitam',
        'Stasiun Bandung',
        '2026-10-01',
        'https://images.unsplash.com/photo-1542291026-7eec264c27ff',
        'APPROVED',
        'CLAIMED',
        'stiker kucing di bagian dalam casing',
        2
    ),
    (
        'Dompet Kulit Coklat',
        'Dompet',
        'Dompet kulit coklat dengan saku kartu dan lembar uang kecil, masih terawat.',
        'Coklat',
        'Kopi Taman',
        '2026-10-03',
        'https://images.unsplash.com/photo-1627123424574-724758594e93',
        'APPROVED',
        'CLAIMED',
        'kancing emas di sisi kiri',
        3
    ),
    (
        'Kunci Motor',
        'Kendaraan',
        'Kunci motor dengan gantungan berbentuk logo bintang, terlihat baru.',
        'Silver',
        'Parkiran Kampus',
        '2026-10-05',
        'https://images.unsplash.com/photo-1558618666-fcd25c85cd64',
        'APPROVED',
        'FOUND',
        'gantungan berbentuk bintang dan tali warna biru',
        2
    )
ON CONFLICT DO NOTHING;

INSERT INTO claims (item_id, user_id, verification_answer, status, admin_note)
VALUES
    (1, 3, 'Ada stiker kucing di casing', 'PENDING', NULL),
    (2, 2, 'Ada kancing emas di sisi kiri dompet', 'PENDING', NULL)
ON CONFLICT DO NOTHING;

INSERT INTO notifications (user_id, message, type, is_read)
VALUES
    (2, 'Pengajuan klaim Anda sedang diverifikasi.', 'CLAIM_PENDING', false),
    (3, 'Pengajuan klaim Anda sedang diverifikasi.', 'CLAIM_PENDING', false)
ON CONFLICT DO NOTHING;
