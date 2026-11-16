CARA MENAMBAH LAGU
==================

1. Taruh file MP3 di folder ini (public/songs/).

2. Buka src/config.js, cari "songs", lalu tambahkan satu entri:

   { id: 'nama-unik', title: 'Judul Lagu', artist: 'Nama Artis', url: '/cyber-runner/songs/nama-file.mp3' },

   Contoh:
   { id: 'midnight', title: 'Midnight Run', artist: 'Someone', url: '/cyber-runner/songs/midnight-run.mp3' },

3. Simpan. Lagu akan otomatis muncul di daftar (urut abjad berdasarkan title).

CATATAN PENTING
---------------
- id harus unik, tidak boleh sama dengan lagu lain.
- url diawali "/cyber-runner/songs/" dan huruf besar/kecil HARUS sama dengan
  nama file. Spasi dan karakter khusus harus di-encode (%20, %27).
- Taruh juga file di folder yang sama dengan nama persis seperti di `url`.
- Format yang didukung: MP3 (paling aman), M4A, OGG, WAV.
- Ukuran 1 lagu sebaiknya di bawah 10 MB. Semakin besar file, semakin lama
  proses analisis drum saat pertama kali dimainkan.

UKURAN & WAKTU ANALISIS
-----------------------
Game membaca lagu untuk mendeteksi pukulan drum. Perkiraan waktu analisis:

  ~3 MB   -> ~1 detik
  ~10 MB  -> ~3 detik
  ~20 MB  -> ~6 detik

Analisis hanya terjadi SEKALI per lagu (hasilnya disimpan di memori), jadi
percobaan berikutnya langsung mulai.

LAGU YANG COCOK
---------------
Game ini paling enak dimainkan dengan lagu yang pukulan drumnya JELAS dan
TERATUR (EDM, rock, pop dengan drum tegas). Lagu dengan drum samar atau tempo
yang berubah-ubah akan menghasilkan note yang jarang atau tidak rata.

MENGGUNAKAN LAGU SENDIRI TANPA EDIT KODE
----------------------------------------
Di layar judul ada tombol "UPLOAD MP3". File yang diunggah hanya tersimpan
selama sesi browser berjalan (tidak permanen), maksimal 30 MB per file.

CATATAN HAK CIPTA
-----------------
Pastikan Anda memiliki izin untuk menggunakan lagu apa pun yang Anda tambahkan.
