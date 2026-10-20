# 🏆 Website Leaderboard & Timer Real-Time (Waktu Tercepat = Juara 1)

Sistem leaderboard dan timer perlombaan real-time berformat **Menit : Detik . Milidetik** (`MM:SS.mmm`).

Dirancang khusus untuk pertandingan arena/lintasan dengan 2 leaderboard, pengaman akses passphrase panitia, timer hitung mundur dengan alarm buzzer, serta pencatatan finish langsung dari timer.

---

## 🔒 Keamanan Akses Panitia
- **Passphrase**: `qoisganteng123`
- Saat pertama kali membuka Panel Panitia, layar akan meminta passphrase ini sebelum membuka kontrol.

---

## 🚀 Cara Menjalankan

1. Buka terminal di folder project:
   ```bash
   npm start
   ```
2. Aplikasi akan berjalan di port `3000`.

---

## 🖥️ Daftar Halaman & URL

| Halaman | URL | Kegunaan |
|---|---|---|
| **Layar Display Proyektor** | [`http://localhost:3000/display`](http://localhost:3000/display) | Ditampilkan ke layar proyektor / TV. Terdapat tombol switcher: **Leaderboard 1**, **Leaderboard 2**, atau **Split (Layar Ganda)**! |
| **Panel Panitia (Leaderboard 1)** | [`http://localhost:3000/admin?board=1`](http://localhost:3000/admin?board=1) | Kontrol penuh Leaderboard 1: kelola timer, setup 2 kelompok bertanding, tombol catat finish instan, dan CSV. |
| **Panel Panitia (Leaderboard 2)** | [`http://localhost:3000/admin?board=2`](http://localhost:3000/admin?board=2) | Kontrol penuh Leaderboard 2 secara independen. |

*(Di dalam panel panitia juga tersedia tombol tab untuk berpindah antara Leaderboard 1 dan 2 dalam 1 klik).*

---

## ⏱️ Alur Pertandingan & Timer (Sangat Praktis!)

1. **Setup Waktu Timer**:
   - Panitia menentukan durasi hitung mundur (misal: 03:00) dan judul sesi pertandingan.
2. **Setup 2 Kelompok Bertanding**:
   - Masukkan nama kelompok yang sedang berlaga di arena (contoh: **Kelompok 1 (Jalur A): Tim Rajawali** dan **Kelompok 2 (Jalur B): Tim Garuda**).
3. **Mulai Timer**:
   - Klik **▶ Mulai**. Suara peluit berbunyi dan timer di proyektor langsung berhitung mundur real-time.
4. **Catat Finish Instan**:
   - Begitu Tim Rajawali menyentuh garis finish, panitia cukup mengklik:  
     👉 **`🏁 CATAT FINISH KELOMPOK 1 (Tim Rajawali)`**
   - Sistem secara otomatis menghitung waktu tempuh:  
     $$\text{Waktu Tempuh} = \text{Durasi Awal} - \text{Sisa Timer}$$
     *(Contoh: Waktu awal 03:00, finish di sisa 01:45.300 $\rightarrow$ waktu tercatat: **01:14.700**).*
   - Peringkat di proyektor langsung tergeser secara otomatis (waktu tercepat jadi Juara 1)!
5. **Waktu Habis**:
   - Pada detik ke-5, 4, 3, 2, 1 terdengar bunyi beep peringatan.
   - Saat timer menyentuh 00:00, **Buzzer Klakson Arena (Horn)** berbunyi kencang dan layar berkedip merah *"WAKTU HABIS!"*.

---

## 📁 Fitur Data & Backup (CSV)
- **Export ke CSV**: Unduh file rekap hasil peringkat lengkap berformat `.csv` (langsung cocok dibuka di Excel).
- **Load / Import CSV**: Muat data peserta dari berkas CSV dengan opsi *Replace* atau *Append*.
- **Penyimpanan Lokal**: Semua data tersimpan otomatis di [`data/leaderboard.json`](file:///c:/Users/LENOVO/Documents/My%20Documents/Project/leaderboard/data/leaderboard.json).
