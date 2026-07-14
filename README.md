# Dashboard Gudang

Aplikasi tracking SPK dengan 4 tahap: Planning 計劃, WH Ready 備料, Pengambilan 領料, Returan 退料.
Backend: Node.js + Express + PostgreSQL. Frontend: HTML/JS biasa (tanpa build step).

## Cara deploy ke Railway (gratis untuk mulai, tidak perlu install apa-apa di komputer)

### 1. Upload kode ini ke GitHub
1. Buat repository baru di https://github.com/new (boleh private).
2. Upload semua file di folder ini ke repo tersebut (drag & drop lewat web GitHub juga bisa, atau `git push` kalau familiar dengan git).

### 2. Buat project di Railway
1. Buka https://railway.app dan login (bisa pakai akun GitHub).
2. Klik **New Project** → **Deploy from GitHub repo** → pilih repo yang tadi diupload.
3. Railway otomatis mendeteksi ini project Node.js dan akan build+jalankan otomatis (`npm install` lalu `npm start`).

### 3. Tambahkan database PostgreSQL
1. Di dalam project yang sama, klik **New** → **Database** → **Add PostgreSQL**.
2. Railway otomatis membuat variabel `DATABASE_URL` dan menghubungkannya ke service Anda — tidak perlu setting manual.

### 4. Set passcode & secret
Di service aplikasi (bukan database), buka tab **Variables**, tambahkan:
- `PASS_PPIC` → passcode untuk role PPIC
- `PASS_WH` → passcode untuk role WH
- `PASS_SF` → passcode untuk role SF
- `AUTH_SECRET` → string acak panjang (bebas, buat sendiri)

Kalau tidak diset, aplikasi tetap jalan dengan passcode default (`ppic123`, `wh123`, `sf123`) — sebaiknya diganti sebelum dipakai tim.

### 5. Selesai
Railway akan memberi Anda URL publik (misalnya `namaservis.up.railway.app`). Buka URL itu, dan aplikasi sudah bisa dipakai oleh siapa saja yang Anda beri linknya, dengan data tersimpan permanen di database.

## Struktur data
- **Planning (計劃)** — ditandai selesai oleh PPIC.
- **WH Ready (備料)** — PPIC/WH mengisi qty bertahap; status otomatis jadi OK saat total qty tercapai; setiap pengisian tercatat sebagai riwayat bertanggal.
- **Pengambilan (領料)** — sama seperti WH Ready, tapi input dari PPIC/SF.
- **Returan (退料)** — PPIC/WH/SF bisa mengajukan; hanya WH yang bisa menandai selesai (setelah itu otomatis hilang dari daftar aktif).

## Menjalankan di komputer sendiri (opsional, untuk uji coba sebelum deploy)
Butuh Node.js 18+ dan PostgreSQL terpasang.
```bash
npm install
export DATABASE_URL=postgres://user:pass@localhost:5432/gudang
npm start
```
Buka http://localhost:3000
