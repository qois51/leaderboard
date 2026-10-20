# 🏆 Website Leaderboard & Timer Real-Time (Waktu Tercepat = Juara 1)

Sistem leaderboard dan timer perlombaan real-time berformat **Menit : Detik . Milidetik** (`MM:SS.mmm`).

Dirancang khusus untuk pertandingan arena/lintasan dengan 2 leaderboard terpisah, **Panel Admin khusus Mobile-Friendly**, pengaman akses passphrase panitia, pergantian password dinamis, timer hitung mundur dengan alarm buzzer audio kencang, serta pencatatan finish langsung dari timer.

---

## 🔒 Keamanan Akses & Ganti Password Panitia

- Panel Panitia dilindungi oleh passphrase panitia untuk mencegah akses yang tidak berwenang.
- Saat pertama kali membuka Panel Panitia, layar meminta passphrase panitia sebelum membuka kontrol.
- **Halaman Ganti Password**: Tersedia halaman khusus di [`/change-password`](http://localhost:3000/change-password) untuk mengganti password admin kapan saja:
  - Alur aman: wajib mengetik password saat ini (tanpa auto-fill demi keamanan), password baru (min. 4 karakter), dan konfirmasi password.
  - Terdapat tombol mata (👁️) untuk toggle *show/hide* password pada masing-masing kolom maupun tombol master centang.
  - Password baru tersimpan otomatis secara persisten di berkas [`data/leaderboard.json`](data/leaderboard.json).

---

## 🚀 Cara Menjalankan

1. Pastikan dependensi telah terinstal:
   ```bash
   npm install
   # atau menggunakan bun
   bun install
   ```

2. Jalankan server:
   ```bash
   npm start
   # atau
   bun server.js
   ```

3. Aplikasi akan berjalan di port `3000`.

---

## 🖥️ Daftar Halaman & URL

| Halaman | URL | Kegunaan |
|---|---|---|
| **Layar Display Proyektor** | [`http://localhost:3000/display`](http://localhost:3000/display) | Ditampilkan ke layar proyektor / TV venue. Terdapat switcher: **Leaderboard 1**, **Leaderboard 2**, atau **Split (Layar Ganda)**! Dilengkapi podium juara & jam live. |
| **Panel Remote Panitia** | [`http://localhost:3000/admin`](http://localhost:3000/admin) | Remote kontrol panitia yang didesain khusus **mobile-friendly** untuk HP: kontrol timer, setup 2 tim bertanding, tombol catat finish raksasa, dan tombol modal kelola tim. |
| **Panel Panitia (Board 1)** | [`http://localhost:3000/admin?board=1`](http://localhost:3000/admin?board=1) | Kontrol langsung Leaderboard 1. |
| **Panel Panitia (Board 2)** | [`http://localhost:3000/admin?board=2`](http://localhost:3000/admin?board=2) | Kontrol langsung Leaderboard 2. |
| **Ganti Password Admin** | [`http://localhost:3000/change-password`](http://localhost:3000/change-password) | Halaman khusus penggantian password admin panitia. |

*(Di dalam panel panitia terdapat tombol tab untuk berpindah antara Leaderboard 1 dan 2 dalam 1 sentuhan).*

---

## 📱 Desain Khusus Mobile-Friendly (Remote Panitia)

Panel admin ([`admin.html`](public/admin.html)) dirancang dengan filosofi **Remote Kontrol Saku**:
- **Bebas Distraksi**: Tabel leaderboard raksasa tidak lagi memenuhi layar utama admin, sehingga panitia 100% fokus pada pengoperasian timer dan finish.
- **Tombol FINISH Raksasa (`min-h-[76px]`)**: Tombol `🏁 FINISH A` (Biru) dan `🏁 FINISH B` (Merah) berukuran besar dan taktil, sangat mudah ditekan dengan jempol tanpa harus melirik layar terus-menerus.
- **Banner Konfirmasi Waktu**: Feedback instan di bawah tombol finish langsung mengabarkan nama tim dan waktu tempuh yang baru saja dicatat.
- **Modal Kelola Tim (`📋 Tim`)**: Daftar hasil, edit data, dan hapus catatan waktu dapat dibuka kapan saja melalui tombol modal tanpa mengotori layar kendali.
- **Anti Auto-Zoom & Touch Sizing**: Input teks disesuaikan untuk layar sentuh HP (iOS Safari / Android Chrome) agar tidak terjadi zoom otomatis yang mengganggu saat mengetik nama tim.

---

## 🔊 Sistem Suara & Buzzer Waktu Habis (Default Unmuted)

- **Default Suara Aktif (Unmuted)**: Suara disetel aktif secara *default* (`sounds.enabled = true`), sehingga buzzer pasti berbunyi tanpa perlu menyalakan audio manual.
- **File Audio Pertandingan**: Tersedia di folder [`public/sounds/`](public/sounds/):
  - `buzzer.mp3` & `buzzer.wav` (Suara buzzer pertandingan arena resmi)
  - `horn.mp3` (Klakson stadium)
  - `alarm.wav` (Beep alarm digital)
- **Auto-Unlock Audio**: Sistem otomatis membuka blokir *Autoplay Policy* pada browser begitu panitia atau penonton pertama kali menyentuh/mengklik layar.
- **Dual-Playback**: Saat timer habis (`00:00`), sistem memutar audio file buzzer asli dan synthesizer klakson frekuensi ganda (`150Hz`, `188Hz`, `225Hz`) secara bersamaan untuk memastikan suara terdengar kencang di lapangan.
- **Tombol "🔊 Tes Buzzer"**: Tersedia langsung di widget timer panel admin untuk memastikan speaker HP/laptop berfungsi prima sebelum pertandingan dimulai.

---

## ⏱️ Alur Pertandingan & Timer

1. **Setup Durasi Timer**:
   - Panitia menentukan durasi hitung mundur (misal: 03:00) dan judul sesi pertandingan melalui tombol *Atur Waktu*.
2. **Setup 2 Kelompok Bertanding**:
   - Masukkan nama kelompok yang sedang berlaga di lintasan:
     - **Jalur A (Kelompok 1)**: Contoh *Tim Rajawali*
     - **Jalur B (Kelompok 2)**: Contoh *Tim Garuda*
   - Tekan tombol *Simpan Nama Pasangan Bertanding*.
3. **Mulai Timer**:
   - Klik **▶ Mulai**. Suara peluit berbunyi dan timer proyektor langsung berhitung mundur real-time.
4. **Catat Finish Instan**:
   - Saat tim melewati garis akhir, panitia cukup menekan:  
     👉 **`🏁 FINISH A`** atau **`🏁 FINISH B`**
   - Waktu tempuh dihitung otomatis:  
     $$\text{Waktu Tempuh} = \text{Durasi Awal} - \text{Sisa Timer}$$
   - Peringkat di layar proyektor otomatis terbarui secara instan (*waktu tercepat memegang Juara 1*).
5. **Waktu Habis**:
   - Pada detik ke-5, 4, 3, 2, 1 terdengar beep hitung mundur.
   - Saat timer menyentuh `00:00`, **Buzzer Arena** berbunyi kencang dan layar proyektor berkedip merah *"WAKTU HABIS!"*.

---

## 📁 Fitur Data & Backup (CSV)

- **Export CSV**: Unduh rekap peringkat lengkap berformat `.csv` (cocok untuk dibuka di Microsoft Excel atau Google Sheets).
- **Import / Load CSV**: Muat data peserta massal dari file CSV dengan mode *Replace* (ganti semua) atau *Append* (tambahkan).
- **Penyimpanan Lokal Real-Time**: Semua data leaderboard dan konfigurasi tersimpan aman di berkas [`data/leaderboard.json`](data/leaderboard.json).
