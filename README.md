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

| Jalur | Tombol (preset 1234) | Tombol (preset DFJK) |
|:---:|:---:|:---:|
| 1 | `1` | `D` |
| 2 | `2` | `F` |
| 3 | `3` | `J` |
| 4 | `4` | `K` |

**Gamepad:** didukung lewat Gamepad API — D-Pad (kiri/bawah/atas/kanan),
trigger/shoulder (`L2 L1 R1 R2`), atau tombol wajah (`X Y A B`). Tombol
**Start** untuk jeda.

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
- **Tempo & grid adaptif.** Tempo dicari langsung di rentang 60–200 BPM
  (onset envelope + autokorelasi). Kandidat tempo tidak dipilih dari puncak
  autokorelasi terkuat saja, tetapi dari yang **grid-nya paling pas** dengan
  onset drum (mean-distance ternormalisasi), lalu diperhalus dengan interpolasi
  parabola — supaya tempo rubato/human-feel tidak salah kunci ke double/half
  time. Setiap hit lalu di-snap ke grid musik secara **konservatif**: hanya
  digeser bila sudah dalam ~60 ms dari tick. Hit yang jauh dari grid tidak
  ditarik paksa ke ketukan yang tidak ada.
- **Sinkronisasi berbasis audio clock.** Posisi note dan penilaian timing
  dihitung dari `currentTime` elemen audio, sehingga tidak pernah melenceng.
- **Bloom neon** (EffectComposer + UnrealBloomPass) dengan exposure rendah agar
  warna tetap natural dan tidak menjadi putih menyilaukan.
- **Pustaka lagu**: daftar lagu dari `CONFIG.songs`, preview 15 detik, serta
  unggah MP3 sendiri (maks 30 MB, hanya untuk sesi berjalan).
- **Pause** dengan nilai tetap sinkron: musik berhenti, chart berhenti, grid
  dibekukan, lalu menyambung tepat di posisi semula.
- **Hit SFX sintetis.** Suara woodblock/rimshot dari Web Audio (dua sine
  detuned + tick noise pendek, pitch per grade, dentuman rendah saat miss).
  Tidak butuh file audio tambahan; `AudioContext` di-unlock pada gesture
  pertama (penting untuk iOS).
- **Kalibrasi latency interaktif.** Tombol **CALIBRATE** membuka wizard
  tap-to-beat (120 BPM, 16 ketukan, 2 ketukan warmup dibuang). Rata-rata offset
  dihitung otomatis dan diterapkan ke timing window — penting untuk headphone
  Bluetooth.
- **Volume terpisah** untuk SFX dan musik.
- **Preset keybind** `1 2 3 4` atau `D F J K`, plus dukungan **gamepad**.
- **Mobile-friendly**: `100dvh` + safe-area (notch/home bar), zona sentuh besar,
  dan modal yang tetap bisa di-scroll di layar landscape pendek.

---

## Tingkat Kesulitan

Dipilih di pengaturan sebelum mulai. Keduanya memakai deteksi drum yang sama,
tetapi menyusun chart berbeda:

| | **EASY** | **HARD** |
|---|---|---|
| Hi-hat | tidak dipakai | dipakai |
| Jarak minimum antar note | 260 ms, dan minimal 0.7 ketukan (lagu cepat jadi lebih renggang) | 140 ms |
| Hit jauh dari grid | dibuang (chart rapi & jarang) | dipertahankan di posisi drum asli |
| Kepadatan | ~50–100 note/menit | ~190–240 note/menit |
| Rasa | mudah, note sedikit | padat, mengikuti semua pukulan drum |

Pada **HARD**, note mengikuti posisi drum sebenarnya (drift ~4–10 ms), termasuk
pukulan yang jatuh di antara ketukan. Pada **EASY**, hanya ketukan yang pas grid
yang dipakai supaya pola mudah ditebak.

---

## Struktur Project

```
cyber-runner/
├── index.html            # Overlay DOM (HUD, menu, pause, countdown)
├── vite.config.js        # Base path Pages + split chunk three.js
├── public/
│   ├── favicon.svg
│   └── songs/            # File MP3 lagu (+ README.txt petunjuk)
├── src/
│   ├── main.js           # Entry: wiring, game loop, event DOM
│   ├── config.js         # CONFIG, COLORS, MODIFIERS
│   ├── storage.js        # localStorage, high score, settings
│   ├── style.css         # Tampilan overlay neon
│   ├── touch.js          # Zona sentuh mobile
│   ├── device.js         # Deteksi mobile/iOS/Android
│   ├── audio/
│   │   ├── audioEngine.js    # Elemen audio + jam offset
│   │   ├── sfx.js            # SFX sintesis Web Audio
│   │   ├── id3.js            # Parser tag MP3
│   │   └── calibration.js    # LatencyCalibrator
│   ├── chart/
│   │   └── beatDetector.js   # Deteksi tempo (60–200 BPM), onset drum, snap grid, cache
│   ├── render/
│   │   ├── scene.js          # Renderer, camera, bloom, resize
│   │   ├── road.js           # Grid, rail, beam, garis hit
│   │   ├── playerMesh.js     # Paddle, pulse, flash
│   │   └── obstacles.js      # Spawn note, gerak, judge, miss
│   ├── game/
│   │   ├── rhythmEngine.js   # Penjadwal note
│   │   ├── gameState.js      # Skor, combo, pause, game over
│   │   └── input.js          # Keyboard + gamepad
│   └── ui/
│       ├── dom.js            # Handle DOM, HUD, countdown
│       ├── songLibrary.js    # Katalog, preview, upload
│       ├── settingsModal.js  # Modifier/setting UI
│       └── calibrationModal.js
├── scripts/
│   ├── diagnose-mp3.mjs      # Diagnostik chart dari file MP3 langsung (Node)
│   └── analyze-chart.mjs     # Diagnostik chart dari file WAV (Node)
└── test/                     # Vitest (judgment, config, quantize, kalibrasi)
```

### Menambah Lagu

1. Taruh file MP3 di `public/songs/`.
2. Tambahkan entri di `CONFIG.songs` pada `src/config.js`:

```js
{ id: 'id-unik', title: 'Judul', artist: 'Artis', url: '/cyber-runner/songs/nama-file.mp3' },
```

> **Penting:** nama file di `url` harus **persis** sama dengan nama file di
> disk — termasuk spasi dan apostrof. Gunakan apostrof ASCII (`'`), bukan
> apostrof Unicode (`’`), karena URL yang tidak cocok akan membuat server
> mengembalikan halaman HTML dan lagu gagal dimuat. Spasi dan karakter khusus
> harus di-encode (`%20`, `%27`).
>
> Lagu diurutkan otomatis berdasarkan `title` (A-Z).

---

## Skrip

```bash
npm run dev       # dev server
npm run build     # build produksi
npm run preview   # cek hasil build
npm run test      # jalankan Vitest
npm run lint      # ESLint
npm run format    # Prettier
```

### Debug chart

`scripts/diagnose-mp3.mjs` menjalankan pipeline chart lengkap (band split,
onset, tempo, snap) di Node terhadap **file MP3 langsung** (dekode murni JS via
`mpg123-decoder`), tanpa ffmpeg. Output: kandidat tempo + skor grid-fit, tempo
terpilih, jumlah kick/snare/hat, kepadatan note, dan **drift note terhadap drum
asli** (mean, jumlah note >50 ms / >100 ms dari pukulan drum terdekat) — metrik
yang menunjukkan apakah note benar-benar "menempel" ke drum.

```bash
node scripts/diagnose-mp3.mjs "public/songs/lagu.mp3" easy   # atau: hard
```

Versi lama `scripts/analyze-chart.mjs` tetap ada untuk file **WAV 16-bit mono**
(konversi dulu dengan ffmpeg):

```bash
ffmpeg -i lagu.mp3 -ac 1 -ar 44100 lagu.wav
node scripts/analyze-chart.mjs lagu.wav easy   # atau: hard
```

---

## Teknologi

- [Three.js](https://threejs.org/) — render 3D, EffectComposer, UnrealBloomPass
- [Vite](https://vite.dev/) — dev server & bundler
- Web Audio API (`OfflineAudioContext`, `AudioContext`) — decode, analisis audio, SFX
- Gamepad API — dukungan stik
- [Vitest](https://vitest.dev/) — unit test
- ESLint + Prettier — lint & format

---

## Catatan Hak Cipta

File MP3 di `public/songs/` adalah karya berhak cipta milik artis dan label
masing-masing. File tersebut disertakan hanya untuk keperluan pengembangan dan
pembelajaran pribadi. Jika kamu menyalin atau menyebarluaskan project ini,
hapus folder `public/songs/` dan gunakan lagu milikmu sendiri.
