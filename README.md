# temubarang
website untuk menemukan barang hilang

## Upload foto dan data profil

Laporan barang dan foto KTM memakai penyimpanan volume Docker `uploads_data`. Foto maksimal 5 MB dan dibatasi ke JPG, JPEG, PNG, atau WEBP. Jangan menghapus volume tersebut saat menjalankan `docker compose down`; penghapusan volume akan menghapus foto yang tersimpan.

Foto KTM hanya dapat diambil pemilik akun atau Admin melalui endpoint yang memeriksa token. Nomor HP pada profil, laporan, dan klaim hanya tersedia untuk pemilik data atau Admin. Pemeriksaan identitas mahasiswa dilakukan manual; status terverifikasi bukan bukti kepemilikan barang.

Laporan baru berstatus menunggu pemeriksaan Admin dan tidak masuk daftar publik hingga disetujui. Klaim tetap diperiksa terpisah. Setelah klaim disetujui, Admin mencatat penyerahan selesai secara terpisah setelah barang benar-benar diterima.

Skema database lama diperbarui dengan migrasi aditif saat layanan dimulai. Data laporan yang sudah ada dipertahankan sebagai disetujui agar tidak hilang dari daftar publik.
