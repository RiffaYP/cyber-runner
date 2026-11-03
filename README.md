# CYBER RUNNER

Game ritme 3D bergaya Guitar Hero yang dibangun dengan **Three.js** + **Vite**.
Empat jalur, empat tombol, dan chart yang dibuat otomatis dari pukulan drum
lagu yang sedang diputar.

![Three.js](https://img.shields.io/badge/three.js-r187-black)
![Vite](https://img.shields.io/badge/vite-8.x-646CFF)

---

## Cara Menjalankan

```bash
npm install
npm run dev
```

Buka alamat yang muncul di terminal (biasanya `http://localhost:5173`).

Build produksi:

```bash
npm run build     # hasil di folder dist/
npm run preview   # cek hasil build
```

---

## Cara Bermain

1. Pilih lagu di dropdown layar judul.
2. Klik **START GAME** — akan muncul hitung mundur **3 - 2 - 1 - GO**.
3. Tekan tombol jalur saat kotak mencapai garis hit.

| Jalur | Tombol |
|:---:|:---:|
| 1 | `1` |
| 2 | `2` |
| 3 | `3` |
| 4 | `4` |

**Jeda:** `Esc` atau `P` (juga otomatis saat tab kehilangan fokus).
Dari menu jeda tersedia **RESUME**, **RESTART**, dan **MAIN MENU**.

### Penilaian

| Grade | Toleransi | Skor dasar |
|---|---|---|
| **PERFECT** | ≤ 55 ms | 150 |
| **GOOD** | ≤ 110 ms | 100 |
| **OK** | ≤ 200 ms | 50 |
| **BAD** | tekan tanpa note di dekat garis | 0 (combo putus) |
| **MISS** | note lewat garis tanpa ditekan | 0 (combo putus) |

Combo menambah pengali skor. **10 MISS** mengakhiri permainan.

---

## Fitur

- **Chart otomatis dari drum asli.** Lagu di-decode, lalu onset kick/snare
  dideteksi per pita frekuensi. Note dijadwalkan pada waktu pukulan drum
  sesungguhnya, bukan pada grid BPM yang diasumsikan.
- **Sinkronisasi berbasis audio clock.** Posisi note dan penilaian timing
  dihitung dari `currentTime` elemen audio, sehingga tidak pernah melenceng.
- **Deteksi BPM** dengan onset envelope + autokorelasi (fallback bila analisis
  gagal).
- **Bloom neon** (EffectComposer + UnrealBloomPass) dengan exposure rendah agar
  warna tetap natural dan tidak menjadi putih menyilaukan.
- **Pustaka lagu**: daftar lagu dari `CONFIG.songs`, preview 15 detik, serta
  unggah MP3 sendiri (maks 30 MB, hanya untuk sesi berjalan).
- **Pause** dengan nilai tetap sinkron: musik berhenti, chart berhenti, grid
  dibekukan, lalu menyambung tepat di posisi semula.

---

## Struktur Project

```
cyber-runner/
├── index.html          # Overlay DOM (HUD, menu, pause, countdown)
├── public/
│   ├── track.mp3       # (opsional) lagu bawaan lama
│   └── songs/          # File MP3 lagu
│       └── README.txt  # Petunjuk menambah lagu
└── src/
    ├── main.js         # Seluruh logika game
    └── style.css       # Tampilan overlay neon
```

### Menambah Lagu

1. Taruh file MP3 di `public/songs/`.
2. Tambahkan entri di `CONFIG.songs` pada `src/main.js`:

```js
{ id: 'id-unik', title: 'Judul', artist: 'Artis', url: '/songs/nama-file.mp3' },
```

> **Penting:** nama file di `url` harus **persis** sama dengan nama file di
> disk — termasuk spasi dan apostrof. Gunakan apostrof ASCII (`'`), bukan
> apostrof Unicode (`’`), karena URL yang tidak cocok akan membuat server
> mengembalikan halaman HTML dan lagu gagal dimuat.
>
> Lagu diurutkan otomatis berdasarkan `title` (A-Z).

---

## Teknologi

- [Three.js](https://threejs.org/) — render 3D, EffectComposer, UnrealBloomPass
- [Vite](https://vite.dev/) — dev server & bundler
- Web Audio API (`OfflineAudioContext`) — decode & analisis audio

---

## Catatan Hak Cipta

File MP3 di `public/songs/` adalah karya berhak cipta milik artis dan label
masing-masing. File tersebut disertakan hanya untuk keperluan pengembangan dan
pembelajaran pribadi. Jika kamu menyalin atau menyebarluaskan project ini,
hapus folder `public/songs/` dan gunakan lagu milikmu sendiri.
