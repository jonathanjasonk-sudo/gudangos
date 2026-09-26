# Purchasing

Aplikasi tracking request produksi dan material purchasing dengan tiga bagian: Request Produksi, Marketing Ready, dan Taken.
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

### 4. Set password & secret
Di service aplikasi (bukan database), buka tab **Variables**, tambahkan:
- `PASS_PRODUKSI` → password akun Produksi
- `PASS_MARKETING` → password akun Marketing
- `PASS_MASTER` → password akun Master
- `AUTH_SECRET` → string acak panjang (bebas, buat sendiri)

Password default: Produksi `prod123`, Marketing `marketing123`, dan Master `master123`. Atur password melalui environment variables sebelum aplikasi digunakan bersama.

### 5. Selesai
Railway akan memberi Anda URL publik (misalnya `namaservis.up.railway.app`). Buka URL itu, dan aplikasi sudah bisa dipakai oleh siapa saja yang Anda beri linknya, dengan data tersimpan permanen di database.

## Alur dan akses
- **Request Produksi** — akun Produksi membuat request SPK; Master juga dapat membuat atau menghapus request.
- **Marketing Ready** — akun Marketing mencatat material yang siap, per material dan qty.
- **Taken** — akun Marketing mencatat material yang diambil, per material dan qty.
- **Master** — akses penuh ke request, Marketing Ready, dan Taken.
- Material yang dicatat: Shoe Box, Size Label, Karton Label, dan Marking.

## Menjalankan di komputer sendiri (opsional, untuk uji coba sebelum deploy)
Butuh Node.js 18+ dan PostgreSQL terpasang.
```bash
npm install
export DATABASE_URL=postgres://user:pass@localhost:5432/gudang
npm start
```
Buka http://localhost:3000
