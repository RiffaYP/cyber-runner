export const CONFIG = {
  // Fallback tempo ONLY. The real BPM is measured from the selected song at
  // startup (see beatDetector). This value is used only if analysis fails.
  bpm: 212,

  normalizeSongUrl(url) {
    return url
      .split('/')
      .map((segment, i) => {
        if (i === 0) return segment
        return encodeURIComponent(decodeURIComponent(segment))
      })
      .join('/')
  },

  resolveAssetUrl(url) {
    const base = import.meta.env.BASE_URL || '/'
    const prodRoot = '/cyber-runner/'
    if (url.startsWith(prodRoot)) {
      return base.replace(/\/?$/, '/') + url.slice(prodRoot.length)
    }
    return url
  },

  songs: [
    {
      id: 'idontloveyou',
      title: "I Don't Love You",
      artist: 'My Chemical Romance',
      url: "/cyber-runner/songs/My%20Chemical%20Romance%20-%20I%20Don't%20Love%20You.mp3",
    },
    {
      id: 'dontlookbackinanger',
      title: "Don't Look Back In Anger",
      artist: 'Oasis',
      url: "/cyber-runner/songs/Oasis%20-%20Don't%20Look%20Back%20In%20Anger.mp3",
    },
    {
      id: 'masterofpuppets',
      title: 'Master of Puppets',
      artist: 'Metallica',
      url: '/cyber-runner/songs/Metallica%20-%20Master%20of%20Puppets.mp3',
    },
    {
      id: 'sofaraway',
      title: 'So Far Away',
      artist: 'Avenged Sevenfold',
      url: '/cyber-runner/songs/Avenged%20Sevenfold%20-%20So%20Far%20Away.mp3',
    },
  ],

  maxUploadBytes: 30 * 1024 * 1024,
  warnUploadBytes: 20 * 1024 * 1024,
  previewSeconds: 15,

  laneCount: 4,
  laneWidth: 2.35,
  laneKeys: ['Digit1', 'Digit2', 'Digit3', 'Digit4'],

  gridWidth: 30,
  gridLength: 150,
  gridDivisionsZ: 150,
  gridScrollSpeed: 30,

  noteSize: 2.6,
  spawnZ: -95,
  despawnZ: 10,
  noteSpeed: 30,

  hitLineZ: 0,
  missZThreshold: 2.2,

  hitWindow: 0.2,
  maxMisses: 10,

  audioOffset: 0,
  audioOffsetLimit: 0.2,

  graphicsQuality: 'auto',

  judge: {
    perfect: 0.055,
    good: 0.11,
    ok: 0.2,
  },
  judgeScore: {
    perfect: 150,
    good: 100,
    ok: 50,
  },

  chartMinGap: 0.26,

  difficulties: {
    easy: {
      label: 'EASY',
      useHats: false,
      mergeWindow: 0.055,
      chartMinGap: 0.26,
      // Easy keeps only hits that sit close to the tempo grid, so the chart
      // stays sparse and predictable for beginners.
      dropOffGrid: true,
    },
    hard: {
      label: 'HARD',
      useHats: true,
      mergeWindow: 0.055,
      chartMinGap: 0.14,
      // Hard follows every detected drum hit, even ones off the grid, so the
      // notes land where the drummer actually played.
      dropOffGrid: false,
    },
  },
  defaultDifficulty: 'easy',

  countdownSeconds: 3,

  cameraY: 6.2,
  cameraZ: 9.5,
  cameraLookAtY: 0.0,
  cameraLookAtZ: -22,

  // Audio & SFX settings
  sfxVolume: 0.7,
  musicVolume: 0.8,
}

export const COLORS = {
  background: 0x05070d,
  cyan: 0x2fd8ff,
  magenta: 0xff5c9d,
  lanes: [0x2fd8ff, 0x4dff9e, 0xffc443, 0xff5c9d],
}

export const MODIFIERS = {
  noFail: false,
  speed: 1,
  mirror: false,
}

export const SPEED_OPTIONS = [1, 1.5, 2]

export function mirrorLane(lane) {
  return MODIFIERS.mirror ? CONFIG.laneCount - 1 - lane : lane
}

export function activeNoteSpeed() {
  return CONFIG.noteSpeed * MODIFIERS.speed
}
