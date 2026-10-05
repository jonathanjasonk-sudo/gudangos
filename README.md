# Marketing System

Aplikasi tracking request produksi dan material dengan tiga bagian: Request Produksi, Marketing Ready, dan Taken.
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
- `PASS_PRODUKSI_C` → password Produksi Gedung C
- `PASS_PRODUKSI_D` → password Produksi Gedung D
- `PASS_PRODUKSI_I` → password Produksi Gedung I
- `PASS_PRODUKSI_E` → password Produksi Gedung E
- `PASS_PRODUKSI_F` → password Produksi Gedung F
- `PASS_PRODUKSI_H` → password Produksi Gedung H
- `PASS_MARKETING` → password akun Marketing
- `PASS_MASTER` → password akun Master
- `AUTH_SECRET` → string acak panjang (bebas, buat sendiri)

Setiap password gedung diatur terpisah; gedung hanya dapat login jika variable password-nya sudah diisi. Password Marketing dan Master tetap diatur masing-masing. Aplikasi tidak menyediakan password default.

### Menambah peran akun
Tambahkan entri baru di `accounts.js`. Contoh:
```js
QC: {
	label: 'QC',
	full: 'Quality Control',
	passwordEnv: 'PASS_QC',
	apiPermissions: ['whReady'],
	uiPermissions: {
		canAddItem: false,
		canDeleteItem: false,
		canEditWhReady: true,
		canEditPengambilan: false
	}
}
```
Setelah itu, tambahkan `PASS_QC` beserta password-nya di **Variables** service Railway, lalu deploy ulang. Jangan menulis password asli di `accounts.js` atau meng-commit-nya ke GitHub. `apiPermissions` menentukan akses endpoint (`planning`, `addItem`, `importSpk`, `exportFile`, `whReady`, `pengambilan`, `returanAdd`, `returanConfirm`); `uiPermissions` menentukan tombol yang tersedia di halaman.

### 5. Selesai
Railway akan memberi Anda URL publik (misalnya `namaservis.up.railway.app`). Buka URL itu, dan aplikasi sudah bisa dipakai oleh siapa saja yang Anda beri linknya, dengan data tersimpan permanen di database.

## Alur dan akses
- **Request Produksi** — akun Produksi dan Marketing dapat menambahkan beberapa SPK sekaligus; Master tetap memiliki akses yang sama. Produksi memilih gedung C, D, I, E, F, atau H saat login dan melihat request gedungnya serta request yang dibuat Marketing. Marketing dan Master dapat melihat seluruh request. Request tanpa gedung yang bukan dibuat Marketing tetap hanya terlihat oleh Marketing/Master dan tidak otomatis ditetapkan ke salah satu gedung. SPK yang tidak ditemukan ditandai satu per satu untuk diperbaiki atau diinput manual.
- **Master SPK** — akun Marketing atau Master mengimpor file `.xlsx` dengan kolom `SPK`, `STYLE`, `CUSTOMER`, `XFD`, `QTY`. Template header dapat diunduh dari Menu Dashboard. Impor ulang dengan SPK yang sama memperbarui data master.
- **Import History** — tab Marketing/Master menampilkan waktu, nama file, akun pengimpor, serta jumlah SPK baru dan diperbarui.
- **Pencarian request** — STYLE, CUSTOMER, XFD, dan QTY dari master terisi otomatis. SPK yang tidak ditemukan dapat dibuat manual dan otomatis disimpan sebagai master. Penulisan SPK otomatis menjadi huruf besar.
- **Request material** — satu SPK dapat memiliki beberapa request untuk material berbeda. Material yang sudah pernah diminta tidak dapat diminta ulang untuk SPK tersebut.
- **Marketing Ready** — akun Marketing mencatat material yang siap, per material dan qty; tetap terlihat selama Taken belum lengkap.
- **Taken** — akun Marketing, Produksi, dan Master dapat mencatat material yang diambil. Produksi dapat mencatat untuk request Marketing dari gedung mana pun, tetapi request yang dibuat Produksi tetap dibatasi ke gedung pembuatnya. Request selesai setelah semua 4 material mencapai QTY.
- **History Taken** — tersedia di tab Taken, satu baris per pencatatan komponen dengan qty, tanggal ambil, dan PIC.
- **Master** — akses penuh ke request, Marketing Ready, dan Taken.
- Material yang dicatat: Shoe Box, Size Label, Karton Label, dan Marking.
- Akses impor dan unduh file hanya ditambahkan untuk akun Marketing dan Master. Marketing kini juga dapat membuat Request Produksi; request akun Produksi tetap dibatasi per gedung. Kontrol file dan Request Produksi di Dashboard tersedia pada Menu yang bisa dibuka/tutup. Export Excel menyediakan sheet `REQ PRODUKSI`, `MARKETING READY`, dan `TAKEN`, termasuk qty serta balance tiap material.

## Menjalankan di komputer sendiri (opsional, untuk uji coba sebelum deploy)
Butuh Node.js 18+ dan PostgreSQL terpasang.
```bash
npm install
export DATABASE_URL=postgres://user:pass@localhost:5432/gudang
npm start
```
Buka http://localhost:3000
