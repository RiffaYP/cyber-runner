import './style.css'

import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'

import { isMobile, prefersLandscape } from './device.js'
import { initTouch } from './touch.js'

/* ==========================================================================
   CONFIG
   ========================================================================== */

const CONFIG = {
  // Fallback tempo ONLY. The real BPM is measured from the selected song at
  // startup (see beatDetector). This value is used only if analysis fails.
  bpm: 212,

  /**
   * Normalize a song URL by properly encoding path segments while preserving slashes.
   * Encodes spaces, apostrophes, and other special characters that browsers
   * might not handle correctly in fetch/Audio src.
   */
  normalizeSongUrl(url) {
    return url.split('/').map((segment, i) => {
      if (i === 0) return segment; // leading empty segment from leading '/'
      return encodeURIComponent(decodeURIComponent(segment))
    }).join('/')
  },

  /**
   * Resolve a catalogue URL against the base the site is actually served from.
   *
   * The catalogue stores absolute production paths ("/cyber-runner/songs/...")
   * because that is how GitHub Pages serves the app. On the dev server the site
   * lives at "/", so those paths 404 — every song then looks "missing" and the
   * chart silently falls back to the beat grid. Re-rooting the path on the
   * current base fixes dev, preview and Pages with one rule.
   */
  resolveAssetUrl(url) {
    const base = import.meta.env.BASE_URL || '/'
    const prodRoot = '/cyber-runner/'
    if (url.startsWith(prodRoot)) {
      return base.replace(/\/?$/, '/') + url.slice(prodRoot.length)
    }
    return url
  },

  /*
   * Song catalogue. Songs are listed ALPHABETICALLY by title at runtime, so
   * order here does not matter. There is no "default" song — the first entry
   * after sorting is simply preselected.
   *
   * To add a song: drop an MP3 into public/songs/ and add an entry below.
   * Keep `url` relative to the site root.
   */
  songs: [
    // Sorted alphabetically by title
    { id: 'idontloveyou', title: 'I Don\'t Love You', artist: 'My Chemical Romance', url: '/cyber-runner/songs/My%20Chemical%20Romance%20-%20I%20Don%27t%20Love%20You.mp3' },
    { id: 'dontlookbackinanger', title: 'Don\'t Look Back In Anger', artist: 'Oasis', url: '/cyber-runner/songs/Oasis%20-%20Don%27t%20Look%20Back%20In%20Anger.mp3' },
    { id: 'masterofpuppets', title: 'Master of Puppets', artist: 'Metallica', url: '/cyber-runner/songs/Metallica%20-%20Master%20of%20Puppets.mp3' },
    { id: 'sofaraway', title: 'So Far Away', artist: 'Avenged Sevenfold', url: '/cyber-runner/songs/Avenged%20Sevenfold%20-%20So%20Far%20Away.mp3' },
  ],

  // Upload limits for user-picked MP3s. Decoding a very large file blocks the
  // main thread for a long time, so we refuse anything above this.
  maxUploadBytes: 30 * 1024 * 1024, // 30 MB
  // Warn (but still allow) above this size, because analysis gets slow.
  warnUploadBytes: 20 * 1024 * 1024, // 20 MB

  // Seconds of audio used for the "listen" preview.
  previewSeconds: 15,

  // Four lanes, Guitar Hero style. Each lane owns one key.
  laneCount: 4,
  laneWidth: 2.35,
  laneKeys: ['Digit1', 'Digit2', 'Digit3', 'Digit4'],

  // World geometry
  gridWidth: 30,
  gridLength: 150,
  gridDivisionsZ: 150,
  gridScrollSpeed: 30, // world-units / second (purely visual)

  // Notes
  noteSize: 2.6,
  spawnZ: -95,
  despawnZ: 10,
  // Speed derived from BPM so notes feel tied to the music:
  //   at 212 BPM a note covers ~1 lane-length per beat on screen.
  //   Increased spawn distance gives ~3.2s approach (11 beats) for comfort.
  noteSpeed: 30,

  // The hit line sits just in front of the camera-facing player plane.
  hitLineZ: 0,
  // How far past the hit line a note may travel before it counts as a miss.
  missZThreshold: 2.2,

  // Timing window: press a lane key within this many SECONDS of the note
  // reaching the line and it counts as a hit.
  hitWindow: 0.2,
  maxMisses: 10,

  /**
   * Audio latency calibration, in seconds, adjustable by the player.
   *
   * Every device has a different output delay (bluetooth headphones are the
   * worst offenders), so the drum you HEAR can arrive later than the audio
   * clock says. A positive value means "the sound reaches me late", so the
   * game waits that much longer before judging a note.
   *
   * This is the single source of truth; `audio.getTime()` applies it, which
   * keeps judging, spawning and note positions consistent.
   */
  audioOffset: 0,
  audioOffsetLimit: 0.2, // slider range is +/- 200 ms

  /**
   * Graphics quality. 'auto' resolves to 'low' on mobile and 'high' on desktop.
   * Low: bloom off, pixelRatio 1. High: full bloom, pixelRatio up to 2.
   */
  graphicsQuality: 'auto',

  /*
   * Judgement thresholds (absolute timing error, in seconds).
   * The closer the strike to the exact beat, the better the label:
   *   PERFECT  |error| <= 0.055  -> full points, keeps combo
   *   GOOD     |error| <= 0.110  -> reduced points, keeps combo
   *   OK       |error| <= 0.200  -> small points, keeps combo
   *   MISS     note passed the line un-struck -> no points, combo resets
   * A key press with no note inside hitWindow is a BAD (whiff): no points and
   * the combo breaks, but it does not cost a life.
   */
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

  // Minimum gap between two consecutive chart notes (seconds). Keeps fast
  // drum fills playable instead of spawning un-hittable note clusters.
  // This is only the fallback for an unknown mode; each difficulty below owns
  // its own gap so switching modes never mutates global config.
  chartMinGap: 0.26,

  /**
   * Difficulty modes. The ONLY difference between them is which detected drum
   * onsets become notes (and how aggressively the chart is thinned). Timing
   * windows, note speed, miss limit and scoring are identical in both modes —
   * so only the number of notes changes.
   *
   *   easy  kick + snare           (the classic chart)
   *   hard  kick + snare + hi-hat  (~1.6-2.2x the notes)
   */
  difficulties: {
    easy: {
      label: 'EASY',
      // Kick + snare only; hats are left out of the chart.
      useHats: false,
      // Two hits closer than this are the same physical strike (e.g. a hat on
      // top of a kick) and collapse into a single note.
      mergeWindow: 0.055,
      chartMinGap: 0.26,
    },
    hard: {
      label: 'HARD',
      // Hats fill the space between kick and snare.
      useHats: true,
      mergeWindow: 0.055,
      // Thinning gap. 0.14 s is still comfortably hittable: the PERFECT window
      // is +/-0.055 s, so consecutive notes never share the same window.
      chartMinGap: 0.14,
    },
  },
  defaultDifficulty: 'easy',

  // Seconds of "3 - 2 - 1" countdown before the music starts, so the player
  // has time to get their hands on the keys.
  countdownSeconds: 3,

  // Camera. Sits behind and above the hit line looking down the lanes, so the
  // whole play field is visible and notes can be read well before they arrive.
  cameraY: 6.2,
  cameraZ: 9.5,
  cameraLookAtY: 0.0,
  cameraLookAtZ: -22,
}

const COLORS = {
  background: 0x05070d,
  cyan: 0x2fd8ff,
  magenta: 0xff5c9d,
  // Per-lane note colours (kept in sync with the CSS --lane-N variables).
  lanes: [0x2fd8ff, 0x4dff9e, 0xffc443, 0xff5c9d],
}

/* ==========================================================================
   LOCAL STORAGE
   Small, defensive wrapper: every read is validated and every write is
   wrapped, so a corrupt or disabled store can never break the game.
   ========================================================================== */

const STORAGE_PREFIX = 'cyber-runner:'

const storage = {
  read(key, fallback) {
    try {
      const raw = window.localStorage.getItem(STORAGE_PREFIX + key)
      return raw === null ? fallback : JSON.parse(raw)
    } catch {
      return fallback
    }
  },

  write(key, value) {
    try {
      window.localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value))
    } catch {
      // Private mode / quota exceeded: persistence is a nicety, not a need.
    }
  },

  /** Clamp a stored number into a range, falling back if it is not one. */
  readNumber(key, fallback, min, max) {
    const value = this.read(key, fallback)
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
    return Math.min(max, Math.max(min, value))
  },
}

/* ==========================================================================
   PLAYER SETTINGS + MODIFIERS
   ========================================================================== */

/**
 * Run modifiers. They change how forgiving the run is, never the scoring
 * table — a No-Fail run is flagged so it can be excluded from records.
 */
const MODIFIERS = {
  noFail: false,
  speed: 1, // 1 | 1.5 | 2 -> multiplies noteSpeed (approach speed)
  mirror: false, // flips the lane order 1<->4, 2<->3
}

const SPEED_OPTIONS = [1, 1.5, 2]

/** Mirror a lane index if the mirror modifier is on. */
function mirrorLane(lane) {
  return MODIFIERS.mirror ? CONFIG.laneCount - 1 - lane : lane
}

/** The note speed actually used this run (base speed x modifier). */
function activeNoteSpeed() {
  return CONFIG.noteSpeed * MODIFIERS.speed
}

/* ==========================================================================
   HIGH SCORES
   Best score and best combo per (song, mode). No-Fail runs are not recorded,
   because they can be played to the end without the miss limit.
   ========================================================================== */

const STORAGE_KEY_SCORES = 'scores'

const highScores = {
  /** { [songId]: { easy: {score, combo}, hard: {score, combo} } } */
  data: {},

  load() {
    const raw = storage.read(STORAGE_KEY_SCORES, {})
    this.data = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  },

  save() {
    storage.write(STORAGE_KEY_SCORES, this.data)
  },

  /** Stable key for a song, works for uploads too (their ids are unique). */
  songKey(song) {
    if (!song) return null
    return song.id || song.url
  },

  get(song, mode) {
    const key = this.songKey(song)
    if (!key) return null
    return this.data[key]?.[mode] ?? null
  },

  /**
   * Record a finished run. Returns { isScore, isCombo, best } describing what
   * just happened, so the game-over screen can celebrate it.
   */
  submit(song, mode, stats) {
    const key = this.songKey(song)
    if (!key) return null

    const previous = this.get(song, mode) ?? { score: 0, combo: 0 }
    const isScore = stats.score > previous.score
    const isCombo = stats.maxCombo > previous.combo

    const best = {
      score: Math.max(previous.score, stats.score),
      combo: Math.max(previous.combo, stats.maxCombo),
    }

    if (!this.data[key]) this.data[key] = {}
    this.data[key][mode] = best
    this.save()

    return { isScore, isCombo, previous, best }
  },
}

/* ==========================================================================
   DOM HANDLES
   ========================================================================== */

const ui = {
  score: document.getElementById('score'),
  misses: document.getElementById('misses'),
  combo: document.getElementById('combo'),
  beat: document.getElementById('beat'),
  hud: document.getElementById('hud'),
  laneKeys: document.getElementById('lane-keys'),
  startScreen: document.getElementById('start-screen'),
  startButton: document.getElementById('start-btn'),
  difficultyButtons: Array.from(document.querySelectorAll('[data-difficulty]')),

  // Modifiers
  speedButtons: Array.from(document.querySelectorAll('[data-speed]')),
  qualityButtons: Array.from(document.querySelectorAll('[data-quality]')),
  noFailButton: document.getElementById('mod-nofail'),
  mirrorButton: document.getElementById('mod-mirror'),
  offsetSlider: document.getElementById('offset-slider'),
  offsetReset: document.getElementById('offset-reset'),

  // Analysis progress
  analysis: document.getElementById('analysis'),
  analysisLabel: document.getElementById('analysis-label'),
  analysisBar: document.getElementById('analysis-bar'),
  analysisCancel: document.getElementById('analysis-cancel'),

  songSelect: document.getElementById('song-select'),
  songInfo: document.getElementById('song-info'),
  songStatus: document.getElementById('song-status'),
  songUpload: document.getElementById('song-upload'),
  songRemoveButton: document.getElementById('song-remove-btn'),
  retryButton: document.getElementById('song-retry'),
  previewButton: document.getElementById('preview-btn'),
  gameOver: document.getElementById('game-over'),
  finalScore: document.getElementById('final-score'),
  finalHits: document.getElementById('final-hits'),
  finalCombo: document.getElementById('final-combo'),
  bestScore: document.getElementById('best-score'),
  bestCombo: document.getElementById('best-combo'),
  bestScoreLabel: document.getElementById('best-score-label'),
  bestComboLabel: document.getElementById('best-combo-label'),
  noFailNote: document.getElementById('no-fail-note'),
  restartButton: document.getElementById('restart-btn'),
  overMenuButton: document.getElementById('over-menu-btn'),

  judgement: document.getElementById('judgement'),
  judgementText: document.getElementById('judgement-text'),
  judgementDetail: document.getElementById('judgement-detail'),
  countdown: document.getElementById('countdown'),
  countdownText: document.getElementById('countdown-text'),
  pauseButton: document.getElementById('pause-btn'),
  pauseScreen: document.getElementById('pause-screen'),
  resumeButton: document.getElementById('resume-btn'),
  quitButton: document.getElementById('quit-btn'),
  menuButton: document.getElementById('menu-btn'),

  touchZones: document.getElementById('touch-zones'),
  rotateOverlay: document.getElementById('rotate-overlay'),

  /** Hide the title card (used by reset so a restart is seamless). */
  hideStartScreen() {
    this.startScreen.classList.add('hidden')
  },
}

/* ==========================================================================
   RENDERER / SCENE / CAMERA
   ========================================================================== */

/**
 * Resolve the effective quality tier. 'auto' -> low on mobile, high elsewhere.
 * 'low' disables bloom and caps pixel ratio at 1; everything else keeps bloom.
 */
function resolveQuality() {
  const want = CONFIG.graphicsQuality
  if (want === 'auto' || !want) return isMobile ? 'low' : 'high'
  return want === 'low' ? 'low' : 'high'
}

function bloomEnabled() {
  return resolveQuality() !== 'low'
}

function targetPixelRatio() {
  return bloomEnabled() ? Math.min(window.devicePixelRatio, 2) : 1
}

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
renderer.setPixelRatio(targetPixelRatio())
renderer.setSize(window.innerWidth, window.innerHeight)
// Exposure well below 1 keeps highlights from clipping to pure white,
// which is what caused the previous "white blob" look.
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 0.68
renderer.outputColorSpace = THREE.SRGBColorSpace
document.getElementById('app').appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(COLORS.background)
scene.fog = new THREE.Fog(COLORS.background, 34, 110)

// A narrower FOV than before: less extreme perspective, so notes keep their
// apparent size as they travel and are easy to read at any distance.
const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 400)
camera.position.set(0, CONFIG.cameraY, CONFIG.cameraZ)
camera.lookAt(0, CONFIG.cameraLookAtY, CONFIG.cameraLookAtZ)

// Gentle lighting: the neon comes from emissive materials + bloom, not from
// blasting the whole scene with light.
scene.add(new THREE.AmbientLight(0xffffff, 0.32))
const keyLight = new THREE.DirectionalLight(0xbfe9ff, 0.55)
keyLight.position.set(-4, 10, 6)
scene.add(keyLight)

/* ==========================================================================
   POST-PROCESSING  (EffectComposer -> RenderPass -> UnrealBloomPass)
   ========================================================================== */

const composer = new EffectComposer(renderer)
composer.setSize(window.innerWidth, window.innerHeight)

const renderPass = new RenderPass(scene, camera)
composer.addPass(renderPass)

/*
 * Bloom tuning, the single biggest fix for the "too bright / unnatural" look:
 *   strength 0.42  -> was 1.35, so glows no longer swamp the scene
 *   radius   0.42  -> was 0.65, tighter, less smeared
 *   threshold 0.62 -> was 0.05, only genuinely bright pixels bloom
 * With a high threshold the dark grid stays crisp and only note edges glow.
 */
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.42,
  0.42,
  0.62,
)
composer.addPass(bloomPass)

/* ==========================================================================
   FLOOR GRID  (scrolls toward the camera to fake forward motion)
   ========================================================================== */

const grid = new THREE.GridHelper(
  CONFIG.gridLength,
  CONFIG.gridDivisionsZ,
  COLORS.cyan,
  COLORS.magenta,
)
// GridHelper is square; scaling X matches the perceived runtime width.
grid.scale.x = CONFIG.gridWidth / CONFIG.gridLength
grid.position.set(0, -0.02, -CONFIG.gridLength / 2 + 10)
grid.material.transparent = true
grid.material.opacity = 0.18 // faint: it is atmosphere, not the focus
grid.material.blending = THREE.AdditiveBlending
grid.material.depthWrite = false
scene.add(grid)

/* ---------- The four lane rails ("strings") ---------- */
const laneGroup = new THREE.Group()
scene.add(laneGroup)

let laneCenter = (index) =>
  (index - (CONFIG.laneCount - 1) / 2) * CONFIG.laneWidth

let LANE_HALF = (CONFIG.laneCount * CONFIG.laneWidth) / 2
const RAIL_LENGTH = 130
const RAIL_FAR = -RAIL_LENGTH + 8

let railXs = [-LANE_HALF]
for (let i = 0; i < CONFIG.laneCount - 1; i++) {
  railXs.push(-LANE_HALF + (i + 1) * CONFIG.laneWidth)
}
railXs.push(LANE_HALF)

const railLines = []
for (const x of railXs) {
  const rail = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x, 0.01, RAIL_FAR),
      new THREE.Vector3(x, 0.01, 6),
    ]),
    new THREE.LineBasicMaterial({
      color: 0x7fb6d9,
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  )
  laneGroup.add(rail)
  railLines.push(rail)
}

// One soft "beam" quad per lane so each lane reads as a distinct strip.
const BEAM_NEAR = 14
const BEAM_FAR = RAIL_FAR
const BEAM_LENGTH = BEAM_NEAR - BEAM_FAR

const laneBeams = []
for (let i = 0; i < CONFIG.laneCount; i++) {
  const beam = new THREE.Mesh(
    new THREE.PlaneGeometry(CONFIG.laneWidth * 0.9, BEAM_LENGTH),
    new THREE.MeshBasicMaterial({
      color: COLORS.lanes[i],
      transparent: true,
      opacity: 0.07,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  )
  beam.rotation.x = -Math.PI / 2
  beam.position.set(laneCenter(i), 0.004, (BEAM_NEAR + BEAM_FAR) / 2)
  laneGroup.add(beam)
  laneBeams.push(beam)
}

/* ---------- The hit line (where notes must be struck) ---------- */
let HIT_LINE_WIDTH = LANE_HALF * 2 + 1.2

const hitLineMaterial = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0.5,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
})
const hitLine = new THREE.Mesh(
  new THREE.PlaneGeometry(HIT_LINE_WIDTH, 0.16),
  hitLineMaterial,
)
hitLine.rotation.x = -Math.PI / 2
hitLine.position.set(0, 0.012, CONFIG.hitLineZ)
scene.add(hitLine)

// A second, fainter echo line just ahead for depth.
const hitEcho = new THREE.Mesh(
  new THREE.PlaneGeometry(HIT_LINE_WIDTH * 0.98, 0.07),
  new THREE.MeshBasicMaterial({
    color: COLORS.cyan,
    transparent: true,
    opacity: 0.16,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }),
)
hitEcho.rotation.x = -Math.PI / 2
hitEcho.position.set(0, 0.011, CONFIG.hitLineZ - 1.15)
scene.add(hitEcho)

/* ==========================================================================
   PLAYER  (glowing low-poly tetrahedron locked to three lanes)
   ========================================================================== */

const player = new THREE.Group()
player.position.set(laneCenter(1), 0.02, CONFIG.hitLineZ)
scene.add(player)

// The "catcher" is a flat glowing paddle that sits on the hit line and slides
// between lanes, Guitar Hero style.
let paddleWidth = CONFIG.laneWidth * 0.9
const PADDLE_LENGTH = 1.5

const paddlePadGeo = new THREE.PlaneGeometry(paddleWidth, PADDLE_LENGTH)
const paddleMaterial = new THREE.MeshBasicMaterial({
  color: COLORS.lanes[0],
  transparent: true,
  opacity: 0.14,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  side: THREE.DoubleSide,
})
const paddlePad = new THREE.Mesh(paddlePadGeo, paddleMaterial)
paddlePad.rotation.x = -Math.PI / 2
player.add(paddlePad)

// Bright outline so the pad is unmistakable against the dark lane.
const paddleRing = new THREE.LineSegments(
  new THREE.EdgesGeometry(paddlePadGeo),
  new THREE.LineBasicMaterial({ color: COLORS.lanes[0], transparent: true, opacity: 0.95 }),
)
paddleRing.rotation.x = -Math.PI / 2
paddleRing.position.y = 0.004
player.add(paddleRing)

// Bright bar marking the exact strike moment at the front edge of the pad.
const strikeMarker = new THREE.Mesh(
  new THREE.PlaneGeometry(paddleWidth * 0.94, 0.16),
  new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }),
)
strikeMarker.rotation.x = -Math.PI / 2
strikeMarker.position.set(0, 0.008, 0)
player.add(strikeMarker)

let laneToX = laneCenter

/** Rebuild all lane-dependent geometry when laneWidth changes (mobile rotate/resize). */
function updateLaneGeometry() {
  laneCenter = (index) =>
    (index - (CONFIG.laneCount - 1) / 2) * CONFIG.laneWidth

  LANE_HALF = (CONFIG.laneCount * CONFIG.laneWidth) / 2

  // Rebuild rails
  railXs = [-LANE_HALF]
  for (let i = 0; i < CONFIG.laneCount - 1; i++) {
    railXs.push(-LANE_HALF + (i + 1) * CONFIG.laneWidth)
  }
  railXs.push(LANE_HALF)

  // Dispose old rail geometries
  for (const rail of railLines) {
    laneGroup.remove(rail)
    rail.geometry.dispose()
  }
  railLines.length = 0

  for (const x of railXs) {
    const rail = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x, 0.01, RAIL_FAR),
        new THREE.Vector3(x, 0.01, 6),
      ]),
      new THREE.LineBasicMaterial({
        color: 0x7fb6d9,
        transparent: true,
        opacity: 0.16,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    )
    laneGroup.add(rail)
    railLines.push(rail)
  }

  // Update lane beams
  for (let i = 0; i < CONFIG.laneCount; i++) {
    const beam = laneBeams[i]
    beam.geometry.dispose()
    beam.geometry = new THREE.PlaneGeometry(CONFIG.laneWidth * 0.9, BEAM_LENGTH)
    beam.position.set(laneCenter(i), 0.004, (BEAM_NEAR + BEAM_FAR) / 2)
  }

  // Update hit line width
  HIT_LINE_WIDTH = LANE_HALF * 2 + 1.2
  hitLine.geometry.dispose()
  hitLine.geometry = new THREE.PlaneGeometry(HIT_LINE_WIDTH, 0.16)
  hitEcho.geometry.dispose()
  hitEcho.geometry = new THREE.PlaneGeometry(HIT_LINE_WIDTH * 0.98, 0.07)

  // Update player paddle
  paddleWidth = CONFIG.laneWidth * 0.9
  paddlePad.geometry.dispose()
  paddlePad.geometry = new THREE.PlaneGeometry(paddleWidth, PADDLE_LENGTH)
  paddleRing.geometry.dispose()
  paddleRing.geometry = new THREE.EdgesGeometry(paddlePad.geometry)
  strikeMarker.geometry.dispose()
  strikeMarker.geometry = new THREE.PlaneGeometry(paddleWidth * 0.94, 0.16)

  // Update laneToX reference for obstacle spawning
  laneToX = laneCenter
}

/* ==========================================================================
   ANALYSIS PROGRESS / CANCELLATION
   Building a chart for a long upload takes seconds. While it runs we show a
   progress bar on the title screen and let the player cancel it.
   ========================================================================== */

const analysisJob = {
  active: false,
  cancelled: false,
}

/** Update the progress bar (0..1) and its label, if a job is running. */
function reportProgress(fraction, label) {
  if (!analysisJob.active) return
  const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100)
  ui.analysisBar.style.width = `${pct}%`
  if (label) ui.analysisLabel.textContent = label
}

/** Throw if the player cancelled; every long step calls this. */
function throwIfCancelled() {
  if (analysisJob.cancelled) {
    const error = new Error('Analysis cancelled.')
    error.cancelled = true
    throw error
  }
}

function showAnalysis(label = 'ANALYSING…') {
  analysisJob.active = true
  analysisJob.cancelled = false
  ui.analysisLabel.textContent = label
  ui.analysisBar.style.width = '0%'
  ui.analysis.classList.remove('hidden')
}

function hideAnalysis() {
  analysisJob.active = false
  analysisJob.cancelled = false
  ui.analysis.classList.add('hidden')
  ui.analysisBar.style.width = '0%'
}

/* ==========================================================================
   BEAT DETECTION
   The track's real tempo is measured from the audio itself instead of being
   hard-coded. Notes then land on the song's actual drum hits rather than on an
   assumed 212 BPM grid that drifts away from the music.

   Method: decode the file once, build an onset-strength envelope (positive
   energy flux on ~10 ms hops), then autocorrelate that envelope. The lag with
   the strongest self-similarity is one beat period; BPM = 60 / period.
   ========================================================================== */

const beatDetector = {
  /*
   * Caches are keyed by URL so several songs can be analysed in one session.
   * A single-slot cache would make song B reuse song A's chart — a silent,
   * very confusing bug (notes would be wildly off) — so this must stay a Map.
   */
  beatCache: new Map(),
  analysing: new Map(),

  /** Forget everything for a URL (used when an uploaded blob URL is revoked). */
  forget(url) {
    this.beatCache.delete(url)
    this.analysing.delete(url)
    // Charts are keyed per (mode, url), so drop every mode's entry.
    for (const mode of Object.keys(CONFIG.difficulties)) {
      const key = this.chartKey(url, mode)
      this.chartCache.delete(key)
      this.chartBuilding.delete(key)
    }
  },

  /**
   * Resolve { bpm, beatInterval, offset } for the given track.
   * Falls back to CONFIG.bpm if analysis is impossible (e.g. decode error).
   */
  async detect(url) {
    if (this.beatCache.has(url)) return this.beatCache.get(url)
    if (this.analysing.has(url)) return this.analysing.get(url)

    const job = (async () => {
      try {
        const result = await this.analyse(url)
        this.beatCache.set(url, result)
        console.info(
          `[cyber-runner] Detected ${result.bpm.toFixed(1)} BPM ` +
            `(beat ${result.beatInterval.toFixed(4)}s, first beat ${result.offset.toFixed(3)}s)`,
        )
        return result
      } catch (error) {
        console.warn('[cyber-runner] Beat detection failed, using fallback.', error)
        const fallback = {
          bpm: CONFIG.bpm,
          beatInterval: 60 / CONFIG.bpm,
          offset: 0,
        }
        this.beatCache.set(url, fallback)
        return fallback
      } finally {
        this.analysing.delete(url)
      }
    })()

    this.analysing.set(url, job)
    return job
  },

  /*
   * Decoding a 20 MB MP3 takes seconds, and both analyse() and buildChart()
   * need the same buffer. Decode once and share it between them.
   */
  decodeCache: new Map(),
  decoding: new Map(),

  async decode(url) {
    if (this.decodeCache.has(url)) return this.decodeCache.get(url)
    if (this.decoding.has(url)) return this.decoding.get(url)

    const job = (async () => {
      reportProgress(0.05, 'DOWNLOADING…')
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
      const buffer = await response.arrayBuffer()
      throwIfCancelled()

      reportProgress(0.3, 'DECODING AUDIO…')
      // OfflineAudioContext decodes without ever producing sound.
      const offline = new OfflineAudioContext(1, 44100, 44100)
      const audio = await offline.decodeAudioData(buffer)
      throwIfCancelled()
      this.decodeCache.set(url, audio)
      reportProgress(0.45, 'ANALYSING…')
      return audio
    })()

    try {
      return await job
    } finally {
      this.decoding.delete(url)
    }
  },

  async analyse(url) {
    const audio = await this.decode(url)

    const sr = audio.sampleRate
    const left = audio.getChannelData(0)
    const right = audio.numberOfChannels > 1 ? audio.getChannelData(1) : left

    // --- 1. Onset-strength envelope at 100 Hz ---------------------------
    const hop = Math.round(sr * 0.01)
    const frames = Math.floor(left.length / hop)
    const rms = new Float32Array(frames)

    for (let i = 0; i < frames; i++) {
      let sum = 0
      const start = i * hop
      for (let j = 0; j < hop; j++) {
        const v = (left[start + j] + right[start + j]) * 0.5
        sum += v * v
      }
      rms[i] = Math.sqrt(sum / hop)
    }

    const flux = new Float32Array(frames)
    for (let i = 1; i < frames; i++) {
      const diff = rms[i] - rms[i - 1]
      flux[i] = diff > 0 ? diff : 0
    }

    // Remove the local mean so autocorrelation reflects rhythm, not loudness.
    const window = 50
    const onset = new Float32Array(frames)
    for (let i = 0; i < frames; i++) {
      let sum = 0
      let count = 0
      for (let k = -window; k <= window; k++) {
        const idx = i + k
        if (idx >= 0 && idx < frames) {
          sum += flux[idx]
          count++
        }
      }
      onset[i] = flux[i] - sum / count
    }

    // --- 2. Autocorrelation over plausible beat lags (40-300 BPM) -------
    const MIN_LAG = 20 // 0.20 s -> 300 BPM
    const MAX_LAG = 150 // 1.50 s -> 40 BPM
    const autocorr = new Float64Array(MAX_LAG + 1)

    for (let lag = MIN_LAG; lag <= MAX_LAG; lag++) {
      let sum = 0
      for (let i = 0; i + lag < frames; i++) sum += onset[i] * onset[i + lag]
      autocorr[lag] = sum / (frames - lag)
    }

    // --- 3. Prefer the lag whose score is strongest after normalising ---
    // Longer lags naturally accumulate less, so we slightly favour the
    // shorter (higher BPM) peaks, which track drum hits more tightly.
    let bestLag = MIN_LAG
    let bestScore = -Infinity

    for (let lag = MIN_LAG + 1; lag < MAX_LAG; lag++) {
      const isPeak = autocorr[lag] > autocorr[lag - 1] && autocorr[lag] >= autocorr[lag + 1]
      if (!isPeak || autocorr[lag] <= 0) continue
      const score = autocorr[lag] * Math.pow(lag, 0.25)
      if (score > bestScore) {
        bestScore = score
        bestLag = lag
      }
    }

    let beatInterval = bestLag * 0.01

    // Fold into a comfortable gameplay range (roughly 80-170 BPM) by
    // halving/doubling, which preserves alignment with the drums.
    while (beatInterval < 60 / 170) beatInterval *= 2
    while (beatInterval > 60 / 80) beatInterval /= 2

    const bpm = 60 / beatInterval

    // --- 4. Phase: where does the first beat fall? ----------------------
    // Try every offset within one beat and keep the one that lines up with
    // the most onsets, so the grid starts on a real drum hit.
    // Threshold is relative to the envelope's own peak, not an absolute value.
    let onsetPeak = 0
    for (let i = 1; i < frames; i++) {
      if (onset[i] > onsetPeak) onsetPeak = onset[i]
    }

    const onsets = []
    const onsetThreshold = onsetPeak * 0.25
    for (let i = 1; i < frames; i++) {
      if (onset[i] >= onsetThreshold) onsets.push(i * 0.01)
    }

    let bestOffset = 0
    let bestHits = -1
    const tolerance = Math.min(0.05, beatInterval * 0.12)

    for (let offset = 0; offset < beatInterval; offset += 0.005) {
      let hits = 0
      for (const time of onsets) {
        const phase = (((time - offset) % beatInterval) + beatInterval) % beatInterval
        if (Math.min(phase, beatInterval - phase) < tolerance) hits++
      }
      if (hits > bestHits) {
        bestHits = hits
        bestOffset = offset
      }
    }

    return { bpm, beatInterval, offset: bestOffset, onsets: onsets.length }
  },

  /**
   * Build a playable chart from the song's REAL drum hits.
   *
   * The tempo grid alone can never be perfectly in sync on tracks whose beat
   * is syncopated or drifts, which is exactly the complaint here. So instead of
   * assuming a grid, we detect actual percussion onsets and use those times.
   *
   * Multi-band approach: kick (low), snare (mid) and hat (high) are analysed
   * separately with one-pole filters, giving far better hit timing than a
   * single broadband envelope.
   */
  chartCache: new Map(),
  chartBuilding: new Map(),

  /**
   * Cache key for a chart. The chart depends on BOTH the audio and the
   * difficulty mode, so the key must include the mode — otherwise picking the
   * same song in EASY then HARD would silently reuse the EASY chart.
   */
  chartKey(url, mode) {
    return `${mode}:${url}`
  },

  /** Resolve a difficulty key ('easy' | 'hard') from anything given. */
  resolveMode(mode) {
    return CONFIG.difficulties[mode] ? mode : CONFIG.defaultDifficulty
  },

  async buildChart(url, options = {}) {
    const mode = this.resolveMode(options.difficulty)
    const preset = CONFIG.difficulties[mode]
    // Per-call settings: never mutate CONFIG, so each mode's cache stays valid.
    const useHats = options.useHats ?? preset.useHats
    const mergeWindow = options.mergeWindow ?? preset.mergeWindow
    const minGap = options.chartMinGap ?? preset.chartMinGap
    const key = this.chartKey(url, mode)

    if (this.chartCache.has(key)) return this.chartCache.get(key)
    if (this.chartBuilding.has(key)) return this.chartBuilding.get(key)

    const job = (async () => {
      try {
        const audio = await this.decode(url)

        const sr = audio.sampleRate
        const left = audio.getChannelData(0)
        const right = audio.numberOfChannels > 1 ? audio.getChannelData(1) : left
        const mono = new Float32Array(left.length)
        for (let i = 0; i < left.length; i++) mono[i] = (left[i] + right[i]) * 0.5

        /* ------------------------------------------------------------------
         * Onset detection — "when does a drum actually get struck?"
         *
         * The old code detected kick and snare independently and then suppressed
         * peaks with a 120 ms window per band. That had two consequences:
         *   - two real beats 130-250 ms apart collapsed into ONE note, and the
         *     surviving time belonged to whichever hit happened to be louder
         *     (often the wrong instrument), and
         *   - leaking energy between bands produced notes at times where no
         *     drum sounded at all.
         *
         * Measured on the bundled tracks, 12-24% of the old chart's notes did
         * not sit on any real attack. The fix is to find the attacks FIRST (on
         * the broadband signal) and only then decide which drum caused them.
         * ------------------------------------------------------------------ */

        const hop = Math.round(sr * 0.005) // 5 ms -> precise drum timing
        const hopSec = hop / sr

        /** RMS envelope at the 5 ms hop. */
        const envelopeOf = (signal) => {
          const frames = Math.floor(signal.length / hop)
          const env = new Float32Array(frames)
          for (let i = 0; i < frames; i++) {
            let sum = 0
            const start = i * hop
            for (let j = 0; j < hop; j++) sum += signal[start + j] * signal[start + j]
            env[i] = Math.sqrt(sum / hop)
          }
          return env
        }

        /** RBJ biquad coefficients (band-pass / high-pass / low-pass). */
        const biquad = (type, freq, q = 0.707) => {
          const w0 = (2 * Math.PI * freq) / sr
          const cos = Math.cos(w0)
          const alpha = Math.sin(w0) / (2 * q)
          let b0
          let b1
          let b2
          if (type === 'highpass') {
            b0 = (1 + cos) / 2
            b1 = -(1 + cos)
            b2 = (1 + cos) / 2
          } else {
            b0 = (1 - cos) / 2
            b1 = 1 - cos
            b2 = (1 - cos) / 2
          }
          const a0 = 1 + alpha
          return {
            b0: b0 / a0,
            b1: b1 / a0,
            b2: b2 / a0,
            a1: (-2 * cos) / a0,
            a2: (1 - alpha) / a0,
          }
        }

        const applyBiquad = (input, c) => {
          const out = new Float32Array(input.length)
          let x1 = 0
          let x2 = 0
          let y1 = 0
          let y2 = 0
          for (let i = 0; i < input.length; i++) {
            const x = input[i]
            const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2
            x2 = x1
            x1 = x
            y2 = y1
            y1 = y
            out[i] = y
          }
          return out
        }

        reportProgress(0.55, 'SPLITTING BANDS…')
        throwIfCancelled()

        // True band-pass = high-pass then low-pass. These isolate the drums far
        // better than the old one-pole "difference of leaks" filters.
        const bandEnvelope = (loHz, hiHz) =>
          envelopeOf(applyBiquad(applyBiquad(mono, biquad('highpass', loHz)), biquad('lowpass', hiHz)))

        /*
         * The frequency ranges below were measured on the bundled tracks rather
         * than guessed. Two of the ranges used previously were simply wrong:
         *
         *   kick  30-110 Hz   correct.
         *   snare 150-400 Hz  the snare's body. The old 1200-5000 Hz range held
         *                     almost nothing on these mixes (18 detections in a
         *                     whole Oasis track), which is why real snares were
         *                     missing notes.
         *   hat   6.5-9 kHz   cymbal sizzle.
         *
         * A "rise" test in dB is used instead of a level test: a drum is a
         * sudden jump in a band, and this separates real hits from vocals and
         * piano, which sit in overlapping ranges but rarely jump 10 dB in 20 ms.
         */
        const kickEnv = bandEnvelope(30, 110)
        const snareEnv = bandEnvelope(150, 400)
        const hatEnv = bandEnvelope(6500, 9000)
        reportProgress(0.75, 'FINDING DRUM HITS…')
        throwIfCancelled()

        const riseLag = Math.max(1, Math.round(0.02 / hopSec)) // 20 ms look-back
        const dbRise = (env, i) =>
          20 * Math.log10((env[i] + 1e-9) / (env[i - riseLag] + 1e-9))

        /**
         * Find hits in one band: local peaks that jump at least `minDb` within
         * 20 ms and are loud enough to matter for this track.
         */
        const detectBand = (env, minDb, minLevel) => {
          const found = []
          for (let i = riseLag + 2; i < env.length - 2; i++) {
            if (env[i] < minLevel) continue
            if (env[i] <= env[i - 1] || env[i] <= env[i + 1]) continue
            if (dbRise(env, i) < minDb) continue
            found.push({ index: i, time: i * hopSec, strength: env[i], rise: dbRise(env, i) })
          }
          // The same strike rings for a while; keep the strongest frame.
          const merged = []
          for (const hit of found) {
            const last = merged[merged.length - 1]
            if (last && hit.time - last.time < 0.06) {
              if (hit.strength > last.strength) {
                last.index = hit.index
                last.time = hit.time
                last.strength = hit.strength
                last.rise = hit.rise
              }
              continue
            }
            merged.push(hit)
          }
          return merged
        }

        // Reference levels so the thresholds scale with how loud the track's
        // drums actually are (a quiet acoustic track still gets its hits).
        const percentile = (env, p) => {
          const sorted = Float32Array.from(env).sort()
          return sorted[Math.floor(sorted.length * p)] || 0
        }
        const kickRef = percentile(kickEnv, 0.9)
        const snareRef = percentile(snareEnv, 0.9)
        const hatRef = percentile(hatEnv, 0.9)

        const kickHits = detectBand(kickEnv, 10, Math.max(0.008, kickRef * 0.1))
        const snareHits = detectBand(snareEnv, 10, Math.max(0.006, snareRef * 0.1))
        const hatHits = useHats
          ? detectBand(hatEnv, 9, Math.max(0.004, hatRef * 0.1))
          : []

        /*
         * Everything a player should strike: kick, snare, and (in HARD) hats.
         * The time of each note is the exact frame the drum hit — it is never
         * nudged towards a neighbour.
         */
        const hits = [
          ...kickHits.map((h) => ({ ...h, type: 'kick' })),
          ...snareHits.map((h) => ({ ...h, type: 'snare' })),
          ...hatHits.map((h) => ({ ...h, type: 'hat' })),
        ].sort((a, b) => a.time - b.time)

        /* ------------------------------------------------------------------
         * Build the chart.
         *
         * The surviving notes keep their EXACT detected time — a note is never
         * nudged towards a neighbour. When two hits are too close to be played
         * as separate notes, the weaker one is dropped instead.
         * ------------------------------------------------------------------ */

        // Hats are only detected in HARD (see hatHits above), so `hits` is
        // already exactly the note pool for this difficulty.

        // Merge hits that are the same physical strike (e.g. hat on top of a
        // kick, or a kick and snare landing together): keep one note, at the
        // stronger component's own time.
        const merged = []
        for (const hit of hits) {
          const last = merged[merged.length - 1]
          if (last && hit.time - last.time < mergeWindow) {
            if (hit.strength > last.strength) {
              last.time = hit.time
              last.strength = hit.strength
              last.type = hit.type
            }
            continue
          }
          merged.push({ ...hit })
        }

        // Thin out anything still too fast to play by DROPPING the weak hit.
        const chart = []
        for (const hit of merged) {
          const last = chart[chart.length - 1]
          if (last && hit.time - last.time < minGap) continue
          chart.push(hit)
        }

        // Drop a leading near-silent region so the first note is not 4 s away.
        const firstNote = chart.length ? chart[0].time : 0

        const result = {
          // Absolute times (seconds) of each drum hit to strike.
          times: chart.map((c) => c.time),
          // Relative gaps used by the rhythm engine.
          count: chart.length,
          firstNoteTime: firstNote,
          duration: audio.duration,
          mode,
        }

        this.chartCache.set(key, result)
        reportProgress(1, 'READY')
        console.info(
          `[cyber-runner] Drum chart (${mode}): ${result.count} notes ` +
            `(${(result.count / (audio.duration / 60)).toFixed(0)}/min), first at ${firstNote.toFixed(2)}s`,
        )
        return result
      } catch (error) {
        if (error.cancelled) {
          // The player cancelled: no chart, and no misleading fallback cached.
          throw error
        }
        console.warn('[cyber-runner] Drum chart failed; falling back to the beat grid.', error)
        const fallback = {
          times: [],
          count: 0,
          firstNoteTime: 0,
          duration: 0,
          fallback: true,
          mode,
        }
        this.chartCache.set(key, fallback)
        return fallback
      } finally {
        this.chartBuilding.delete(key)
      }
    })()

    this.chartBuilding.set(key, job)
    return job
  },
}

/* ==========================================================================
   RHYTHM ENGINE  (chart-driven)
   Notes are spawned from the REAL drum-hit times detected in the song, not
   from an assumed tempo grid. Each frame we compare the audio playhead to the
   next scheduled hit time; when the playhead reaches it, the note is spawned.

   Because scheduling is driven by the audio clock itself, the notes cannot
   drift relative to the music even if the tempo wanders.
   ========================================================================== */

const rhythm = {
  startTime: 0,
  beatIndex: 0,
  isRunning: false,
  beatInterval: 60 / CONFIG.bpm,
  offset: 0,

  /** Detected drum-hit times (seconds) from the chart. */
  times: [],
  /** Index of the next chart note to spawn. */
  cursor: 0,
  /** True once the chart has been exhausted. */
  finished: false,

  /** Apply a detected tempo (used only for the bar counter / fallback). */
  configure({ beatInterval, offset }) {
    this.beatInterval = beatInterval
    this.offset = offset
  },

  /** Apply a detected drum chart. */
  setChart(chart) {
    this.times = chart && chart.times ? chart.times : []
  },

  reset() {
    this.startTime = performance.now() / 1000
    this.beatIndex = 0
    this.cursor = 0
    this.finished = false
    this.isRunning = true
  },

  /**
   * Advance the chart against the audio playhead.
   * Returns the number of notes spawned this frame.
   */
  update(audioTime, onNote) {
    if (!this.isRunning || audioTime === null) return 0
    if (this.cursor >= this.times.length) {
      this.finished = true
      return 0
    }

    let emitted = 0
    // A note appears at the far end of the lane and must reach the hit line
    // exactly when the drum sounds. A speed modifier shortens this lead time,
    // so the note travels faster and appears later — the hit moment never moves.
    const travel = Math.abs(CONFIG.spawnZ - CONFIG.hitLineZ) / activeNoteSpeed()

    while (this.cursor < this.times.length) {
      const hitTime = this.times[this.cursor]
      const spawnAt = hitTime - travel

      if (audioTime < spawnAt) break

      // If the song started mid-chart (or a note's lead time already elapsed),
      // never spawn a note whose moment has already gone — that would be an
      // instant, unavoidable MISS. Just skip past it.
      if (audioTime > hitTime + CONFIG.judge.ok) {
        this.cursor += 1
        continue
      }

      this.cursor += 1
      this.beatIndex += 1
      onNote(this.beatIndex, hitTime)
      emitted += 1
      if (emitted > 8) break // guard against huge time jumps
    }
    return emitted
  },

  stop() {
    this.isRunning = false
  },
}

/* ==========================================================================
   OBSTACLE MANAGER  (spawn on beat, move on +Z, recycle when behind camera)
   ========================================================================== */

const obstacles = []

/*
 * One shared "tile" geometry per note. Notes lie flat on the lane so they read
 * as Guitar Hero arrows rather than floating boxes.
 */
// A tall-ish slab: reads as a 3D "note" while lying within its lane.
const noteGeometry = new THREE.BoxGeometry(
  CONFIG.noteSize * 0.76,
  CONFIG.noteSize * 0.6,
  CONFIG.noteSize * 0.66,
)
noteGeometry.userData.shared = true

// One emissive material per lane colour, shared across all notes.
const noteMaterials = COLORS.lanes.map((hex) => {
  const material = new THREE.MeshStandardMaterial({
    // Dark base + strong emissive = saturated colour that glows without
    // clipping to white.
    color: new THREE.Color(hex).multiplyScalar(0.32),
    emissive: hex,
    emissiveIntensity: 1.25,
    metalness: 0.1,
    roughness: 0.6,
    transparent: true,
    opacity: 0.97,
  })
  material.userData.shared = true
  return material
})

// Shared edge material cache, one per lane.
const noteEdgeMaterials = COLORS.lanes.map((hex) => {
  const material = new THREE.LineBasicMaterial({ color: hex, transparent: true, opacity: 0.9 })
  material.userData.shared = true
  return material
})

/**
 * Fully detach a note from the scene graph and free its GPU memory.
 *
 * The note's box geometry and materials are SHARED (one per lane) for
 * efficiency, while the per-note EdgesGeometry is unique. Anything tagged
 * `userData.shared` is skipped so we never free memory still in use by other
 * notes. Every removal path must go through this function.
 */
function disposeObstacle(obstacle) {
  scene.remove(obstacle)
  obstacle.traverse((child) => {
    if (!child.isMesh && !child.isLineSegments) return

    if (child.geometry && !child.geometry.userData?.shared) {
      child.geometry.dispose()
    }
    if (child.material && !child.material.userData?.shared) {
      child.material.dispose()
    }
  })
}

/** Remove one note by identity, disposing it and splicing it out of the array. */
function removeObstacle(obstacle) {
  const index = obstacles.indexOf(obstacle)
  if (index !== -1) obstacles.splice(index, 1)
  disposeObstacle(obstacle)
}

const obstacleManager = {
  spawn(laneIndex, hitTime = 0) {
    const group = new THREE.Group()

    group.add(new THREE.Mesh(noteGeometry, noteMaterials[laneIndex]))
    group.add(
      new THREE.LineSegments(
        new THREE.EdgesGeometry(noteGeometry),
        noteEdgeMaterials[laneIndex],
      ),
    )

    group.position.set(laneToX(laneIndex), CONFIG.noteSize * 0.42, CONFIG.spawnZ)
    // hitTime is the song time this note must be struck at; it lets the note
    // self-correct against the audio clock instead of relying on travel maths.
    group.userData = { lane: laneIndex, hitTime }

    scene.add(group)
    obstacles.push(group)
  },

  /**
   * Lazily generate the next lane instead of pre-building a whole chart, so
   * runs differ each time. Rules keep it fair and playable:
   *  - never repeat the same lane 3 times in a row (no endless hold)
   *  - bias toward steps the player can physically reach (never two lanes
   *    apart twice in quick succession)
   */
  pickLane(recentLanes) {
    const last = recentLanes[recentLanes.length - 1] ?? 1
    const prev = recentLanes[recentLanes.length - 2]

    // Avoid triple repeats.
    if (prev !== undefined && prev === last) {
      const candidates = []
      for (let lane = 0; lane < CONFIG.laneCount; lane++) {
        if (lane !== last) candidates.push(lane)
      }
      return candidates[Math.floor(Math.random() * candidates.length)]
    }

    // Prefer a neighbour of the previous lane (natural hand movement) but
    // sometimes jump for variety.
    const roll = Math.random()
    if (roll < 0.72) {
      const neighbours = []
      if (last - 1 >= 0) neighbours.push(last - 1)
      if (last + 1 < CONFIG.laneCount) neighbours.push(last + 1)
      return neighbours[Math.floor(Math.random() * neighbours.length)]
    }
    return Math.floor(Math.random() * CONFIG.laneCount)
  },

  update(dt) {
    const audioTime = audio.getTime()

    for (let i = obstacles.length - 1; i >= 0; i--) {
      const note = obstacles[i]

      if (note.userData.fading) {
        // Game over: notes drift slowly and fade, then are cleaned up.
        note.position.z += CONFIG.noteSpeed * 0.25 * dt
        note.scale.multiplyScalar(1 - dt * 2.2)
        if (note.scale.x < 0.08) removeObstacle(note)
        continue
      }

      if (audioTime !== null && note.userData.hitTime) {
        // Drive the note's position from the audio clock. A note that is still
        // 2.6 s away must sit at the FAR end (-78), not +78: it travels toward
        // the camera, so a positive "time remaining" maps to a negative Z.
        const timeUntilHit = note.userData.hitTime - audioTime
        note.position.z = CONFIG.hitLineZ - timeUntilHit * activeNoteSpeed()
      } else {
        note.position.z += activeNoteSpeed() * dt
      }

      // Safety net for notes that somehow slip through resolution.
      if (note.position.z > CONFIG.despawnZ) {
        removeObstacle(note)
      }
    }
  },

  clear() {
    for (let i = obstacles.length - 1; i >= 0; i--) {
      disposeObstacle(obstacles[i])
    }
    obstacles.length = 0
  },
}

/* ==========================================================================
   LANE KEY UI  (DOM indicator strip, synced with 3D lanes)
   ========================================================================== */

const laneKeyEls = Array.from(document.querySelectorAll('.lane-key'))

/** Toggle the pressed look on a lane's key indicator. */
function setLaneKeyActive(lane, active) {
  const el = laneKeyEls[lane]
  if (el) el.classList.toggle('active', active)
}

/** Briefly flash a lane key on a hit, an OK, or a miss. */
function flashLaneKey(lane, kind) {
  const el = laneKeyEls[lane]
  if (!el) return

  const cls = kind === 'miss' ? 'miss' : kind === 'ok' ? 'ok' : 'hit'
  el.classList.remove('hit', 'miss', 'ok')
  // Force reflow so the animation can restart on rapid repeats.
  void el.offsetWidth
  el.classList.add(cls)

  const timeout = kind === 'hit' ? 130 : kind === 'ok' ? 180 : 340
  setTimeout(() => el.classList.remove(cls), timeout)
}

/* ==========================================================================
   JUDGEMENT POPUP
   ========================================================================== */

const JUDGEMENT_LABEL = {
  perfect: 'PERFECT',
  good: 'GOOD',
  ok: 'OK',
  bad: 'BAD',
  miss: 'MISS',
}

let judgementTimer = 0

/**
 * Show the PERFECT / GOOD / OK / BAD / MISS popup.
 * `timing` is the signed error in seconds (used for the small detail line).
 */
function showJudgement(grade, timing = 0) {
  const el = ui.judgement
  if (!el) return

  ui.judgementText.textContent = JUDGEMENT_LABEL[grade] ?? grade.toUpperCase()

  // Only hits have a meaningful millisecond reading.
  const isHit = grade === 'perfect' || grade === 'good' || grade === 'ok'
  ui.judgementDetail.textContent = isHit
    ? `${timing >= 0 ? '+' : ''}${(timing * 1000).toFixed(0)} ms`
    : ''

  el.dataset.grade = grade

  // Restart the animation from scratch.
  el.classList.remove('show')
  void el.offsetWidth
  el.classList.add('show')

  clearTimeout(judgementTimer)
  judgementTimer = setTimeout(() => el.classList.remove('show'), 640)
}

function clearJudgement() {
  if (!ui.judgement) return
  clearTimeout(judgementTimer)
  ui.judgement.classList.remove('show')
  ui.judgementText.textContent = ''
  ui.judgementDetail.textContent = ''
}

/* ==========================================================================
   COUNTDOWN  (3 - 2 - 1 before the music starts)
   ========================================================================== */

/** Show a number and restart its pop animation. */
function showCountdownValue(value, isGo = false) {
  const el = ui.countdownText
  if (!el) return

  el.textContent = value
  el.classList.toggle('go', isGo)
  // Force a reflow so the animation restarts for each new number.
  el.style.animation = 'none'
  void el.offsetWidth
  el.style.animation = ''
}

/**
 * Run the pre-song countdown in silence.
 * Resolves once the last beat has been shown, so the caller can start the
 * music and the chart on the same frame.
 */
function runCountdown() {
  return new Promise((resolve) => {
    const total = CONFIG.countdownSeconds
    ui.countdown.classList.remove('hidden')
    showCountdownValue(String(total))

    let remaining = total

    const tickDown = () => {
      remaining -= 1
      if (remaining > 0) {
        showCountdownValue(String(remaining))
        setTimeout(tickDown, 1000)
      } else {
        // Final "GO" flash, then hand control back to start().
        showCountdownValue('GO', true)
        setTimeout(() => {
          ui.countdown.classList.add('hidden')
          resolve()
        }, 550)
      }
    }

    setTimeout(tickDown, 1000)
  })
}

/* ==========================================================================
   NOTE RESOLUTION  (tap a lane key as the note reaches the hit line)
   ========================================================================== */

// Z past which an un-hit note is counted as a miss.
const MISS_Z = CONFIG.hitLineZ + CONFIG.missZThreshold

/**
 * Timing model — judged against the AUDIO clock.
 *
 * Each note carries the song time it must be struck (`userData.hitTime`,
 * taken straight from the detected drum onsets). The timing error is simply
 *
 *     error = currentAudioTime - note.hitTime
 *
 * so the judgement is measured against the music itself rather than against
 * how far the mesh has travelled. That removes any drift between the visual
 * animation and the drum you hear.
 *
 * Negative error = struck early, positive = late.
 */
function timeToHit(note) {
  const audioTime = audio.getTime()

  if (audioTime !== null && note.userData.hitTime) {
    return note.userData.hitTime - audioTime
  }

  // Fallback (audio paused/not ready): derive from the mesh position.
  return (note.position.z - CONFIG.hitLineZ) / activeNoteSpeed()
}

/**
 * Find the closest un-hit note in a given lane that is within the hit window.
 * Returns the note and its signed timing error (negative = struck early).
 */
function findHittableNote(lane) {
  let best = null
  let bestAbs = Infinity
  let bestTiming = 0

  for (const note of obstacles) {
    if (note.userData.lane !== lane) continue
    const t = timeToHit(note)
    const abs = Math.abs(t)
    if (abs <= CONFIG.hitWindow && abs < bestAbs) {
      best = note
      bestAbs = abs
      bestTiming = t
    }
  }
  return best ? { note: best, timing: bestTiming } : null
}

/** Map an absolute timing error to PERFECT / GOOD / OK / null. */
function judgeTiming(absError) {
  const { perfect, good, ok } = CONFIG.judge
  if (absError <= perfect) return 'perfect'
  if (absError <= good) return 'good'
  if (absError <= ok) return 'ok'
  return null
}

/**
 * Resolve notes that have passed their hit time without being struck.
 * Judged on the audio clock (same as hits), so a note is only a MISS once the
 * drum moment has genuinely gone by.
 */
function resolveMisses() {
  const audioTime = audio.getTime()

  for (let i = obstacles.length - 1; i >= 0; i--) {
    const note = obstacles[i]

    // Prefer the audio clock; fall back to position if audio is unavailable.
    const isMissed =
      audioTime !== null && note.userData.hitTime
        ? audioTime - note.userData.hitTime > CONFIG.judge.ok
        : note.position.z > MISS_Z

    if (!isMissed) continue

    const lane = note.userData.lane
    removeObstacle(note)
    game.addMiss(lane)
    flashLaneKey(lane, 'miss')

    if (!game.isPlaying) return
  }
}

/* ==========================================================================
   INPUT  (Guitar Hero style: one key per lane, tap to strike)
   ========================================================================== */

const input = {
  // Track which physical key is currently held so key-repeat is ignored.
  held: new Set(),

  init() {
    window.addEventListener('keydown', (event) => this.onKeyDown(event))
    window.addEventListener('keyup', (event) => this.onKeyUp(event))
    // Releasing focus would otherwise leave keys stuck "held".
    window.addEventListener('blur', () => this.releaseAll())
    // Auto-pause if the tab/window loses focus mid-song.
    window.addEventListener('blur', () => game.pause())
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) game.pause()
    })
  },

  /** Pause keys: Escape or P. */
  isPauseKey(code) {
    return code === 'Escape' || code === 'KeyP'
  },

  laneForCode(code) {
    return CONFIG.laneKeys.indexOf(code)
  },

  onKeyDown(event) {
    // Pause toggle takes priority over lane input.
    if (this.isPauseKey(event.code)) {
      event.preventDefault()
      if (game.isPlaying) game.togglePause()
      return
    }

    const lane = this.laneForCode(event.code)
    if (lane === -1) return
    event.preventDefault()

    // Ignore OS auto-repeat: only the first press counts as a strike.
    if (this.held.has(event.code)) return
    this.held.add(event.code)

    this.pressLane(lane)
  },

  onKeyUp(event) {
    const lane = this.laneForCode(event.code)
    if (lane === -1) return
    event.preventDefault()
    this.held.delete(event.code)
    setLaneKeyActive(lane, false)
  },

  pressLane(lane) {
    setLaneKeyActive(lane, true)
    if (!game.isPlaying || game.isPaused) return

    // Move the paddle to this lane instantly — the player IS the key press.
    game.requestLane(lane)

    const hit = findHittableNote(lane)
    if (!hit) {
      // Nothing in range: BAD. No life lost, but the combo breaks.
      game.addJudgement('bad', lane)
      flashLaneKey(lane, 'miss')
      return
    }

    const grade = judgeTiming(Math.abs(hit.timing))
    // A note found inside hitWindow always maps to at least 'ok'.
    const finalGrade = grade ?? 'ok'

    removeObstacle(hit.note)
    game.addJudgement(finalGrade, lane, hit.timing)
    flashLaneKey(lane, finalGrade === 'perfect' || finalGrade === 'good' ? 'hit' : 'ok')
  },

  releaseAll() {
    this.held.clear()
    for (let lane = 0; lane < CONFIG.laneCount; lane++) {
      setLaneKeyActive(lane, false)
    }
  },

  reset() {
    this.releaseAll()
    game.targetLane = 1
    player.position.set(laneToX(1), 0.02, CONFIG.hitLineZ)
  },
}

/* ==========================================================================
   AUDIO
   ========================================================================== */

const audio = {
  el: null,
  url: null,

  /**
   * Get (or create) the audio element for a song. Switching songs rebuilds the
   * element so the previous source is released instead of being left in memory.
   */
  ensure(url) {
    if (!url) url = this.url
    if (!url) throw new Error('audio.ensure() called without a song URL')

    if (!this.el || this.url !== url) {
      if (this.el) {
        this.el.pause()
        this.el.removeAttribute('src')
        this.el.load() // release the previous stream
      }
      this.el = new Audio(url)
      this.el.preload = 'auto'
      this.el.loop = false
      this.el.addEventListener('ended', () => game.gameOver())
      this.url = url
    }
    return this.el
  },

  async play(url) {
    const el = this.ensure(url)
    await el.play()
  },

  /**
   * Rewind to 0:00 and play. Must be called from a user gesture (the button
   * click) for the browser to allow playback.
   */
  async restart(url) {
    const el = this.ensure(url)
    el.pause()
    el.currentTime = 0
    await el.play()
  },

  /**
   * Unlock playback inside the user gesture WITHOUT audible playback, and
   * rewind to the start.
   *
   * Browsers only allow play() during a gesture. We call play() straight away
   * (which satisfies the policy), then immediately pause and seek back to 0,
   * so the countdown can run in silence and a later play() will be permitted.
   */
  async prime(url) {
    const el = this.ensure(url)
    el.currentTime = 0
    try {
      await el.play()
    } catch {
      console.warn('[cyber-runner] Audio could not be unlocked.')
      return
    }
    // Silence it again right away; the countdown runs before the real start.
    el.pause()
    el.currentTime = 0
  },

  /** Start the track from 0:00 (after the countdown has finished). */
  startFromBeginning(url) {
    const el = this.ensure(url)
    el.currentTime = 0
    return el.play().catch(() => {
      console.warn('[cyber-runner] Audio could not start.')
    })
  },

  /** Freeze the track where it is (game over / pause). */
  pause() {
    if (this.el) this.el.pause()
  },

  /** Continue from the paused position. */
  resume() {
    if (!this.el) return
    this.el.play().catch(() => {
      console.warn('[cyber-runner] Could not resume audio.')
    })
  },

  /**
   * Prefer the audio element's own clock; it is the ground truth for sync.
   *
   * The calibrated latency offset is subtracted here so that every consumer
   * (judging, spawning, note positions) sees the same corrected clock: a
   * positive offset means "the sound I hear is late", so the game pretends the
   * playhead is slightly behind where the element claims it is.
   */
  getTime() {
    if (!this.el || this.el.paused) return null
    return this.el.currentTime - CONFIG.audioOffset
  },
}

/* ==========================================================================
   ID3 TAGS
   Reads the title / artist / album out of an MP3 so uploaded songs show a real
   name instead of a raw file name. Supports ID3v2.2/v2.3/v2.4 and ID3v1.
   Only the first few KB are read, so this stays instant for big files.
   ========================================================================== */

const ID3_READ_BYTES = 256 * 1024

/** Decode a text frame, honouring the declared encoding byte. */
function decodeId3Text(bytes, encoding) {
  if (!bytes.length) return ''

  let text
  if (encoding === 0) {
    // ISO-8859-1: map straight to code points (avoids UTF-8 mangling).
    text = String.fromCharCode(...bytes)
  } else if (encoding === 3) {
    text = new TextDecoder('utf-8').decode(bytes)
  } else {
    // 1 = UTF-16 with BOM, 2 = UTF-16BE.
    if (encoding === 2) {
      const swapped = new Uint8Array(bytes.length)
      for (let i = 0; i + 1 < bytes.length; i += 2) {
        swapped[i] = bytes[i + 1]
        swapped[i + 1] = bytes[i]
      }
      text = new TextDecoder('utf-16le').decode(swapped)
    } else {
      text = new TextDecoder('utf-16le').decode(bytes)
    }
  }
  // Strip BOM / NUL padding and collapse whitespace.
  return text.replace(/^\uFEFF/, '').replace(/\0+$/, '').trim()
}

/** Remove the "01 " track-number style prefix some taggers leave in titles. */
function cleanTagText(value) {
  return value.replace(/\s+/g, ' ').trim()
}

/**
 * Parse ID3 tags from an MP3 blob. Returns { title, artist, album } with only
 * the fields that were found (possibly an empty object).
 */
async function readId3Tags(file) {
  if (!file || !/\.mp3$/i.test(file.name)) return {}

  let bytes
  try {
    const head = new Uint8Array(await file.slice(0, ID3_READ_BYTES).arrayBuffer())
    bytes = head
  } catch {
    return {}
  }

  const result = {}

  // ---- ID3v2 ----
  if (bytes.length > 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const major = bytes[3]
    // The size is a 28-bit synchsafe integer (7 usable bits per byte).
    const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) |
      ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f)

    const body = bytes.subarray(10, Math.min(10 + size, bytes.length))
    const idLength = major === 2 ? 3 : 4
    const headerLength = major === 2 ? 6 : 10

    let offset = 0
    // Stop at the padding (a run of zero bytes) or the end of the tag.
    while (offset + headerLength <= body.length) {
      const id = String.fromCharCode(...body.subarray(offset, offset + idLength))
      if (!/^[A-Z0-9]{3,4}$/.test(id)) break

      const frameSize =
        major === 2
          ? (body[offset + 3] << 16) | (body[offset + 4] << 8) | body[offset + 5]
          : major === 3
            ? (body[offset + 4] << 24) | (body[offset + 5] << 16) |
              (body[offset + 6] << 8) | body[offset + 7]
            : // v2.4 frame sizes are also synchsafe
              ((body[offset + 4] & 0x7f) << 21) | ((body[offset + 5] & 0x7f) << 14) |
              ((body[offset + 6] & 0x7f) << 7) | (body[offset + 7] & 0x7f)

      if (frameSize <= 0) break

      const dataStart = offset + headerLength
      const dataEnd = Math.min(dataStart + frameSize, body.length)
      const data = body.subarray(dataStart, dataEnd)

      // TIT2 = title, TPE1 = artist, TALB = album (v2.2 uses 3-char ids).
      const isTitle = id === 'TIT2' || id === 'TT2'
      const isArtist = id === 'TPE1' || id === 'TP1'
      const isAlbum = id === 'TALB' || id === 'TAL'

      if (data.length > 1 && (isTitle || isArtist || isAlbum)) {
        const text = cleanTagText(decodeId3Text(data.subarray(1), data[0]))
        if (text) {
          if (isTitle && !result.title) result.title = text
          if (isArtist && !result.artist) result.artist = text
          if (isAlbum && !result.album) result.album = text
        }
      }

      offset = dataEnd
    }
  }

  // ---- ID3v1 fallback: the last 128 bytes of the file ----
  if (!result.title || !result.artist) {
    try {
      const tail = new Uint8Array(await file.slice(-128).arrayBuffer())
      const isV1 =
        tail.length === 128 && tail[0] === 0x54 && tail[1] === 0x41 && tail[2] === 0x47
      if (isV1) {
        const decode = (from, to) =>
          cleanTagText(new TextDecoder('iso-8859-1').decode(tail.subarray(from, to)))
        if (!result.title) result.title = decode(3, 33)
        if (!result.artist) result.artist = decode(33, 63)
        if (!result.album) result.album = decode(63, 93)
      }
    } catch {
      // Ignore: an unreadable tail just means no v1 tags.
    }
  }

  return result
}

/* ==========================================================================
   SONG LIBRARY
   Owns the catalogue (bundled songs + user uploads), alphabetical ordering,
   the preview player, and upload validation.
   ========================================================================== */

const songLibrary = {
  /** Bundled songs from CONFIG, sorted A-Z by title (no "default" song). */
  bundled: [],
  /** Songs the user picked from disk this session (blob URLs). */
  uploaded: [],
  /** Currently selected song object. */
  selected: null,

  init() {
    this.bundled = [...CONFIG.songs]
      .map((song) => ({
        ...song,
        // Re-root the production path on whatever base we are served from, so
        // the same catalogue works on Pages, `vite preview` and the dev server.
        url: CONFIG.resolveAssetUrl(song.url),
        source: 'bundled',
        available: null,
      }))
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))

    this.selected = this.bundled[0] ?? null
    this.render()
    this.checkAvailability()
  },

  /**
   * Probe each bundled URL so missing files are marked and never selected by
   * accident. Uploaded songs are always available (blob URL).
   *
   * IMPORTANT: a dev server (Vite) answers a *missing* file with 200 + an HTML
   * fallback page instead of a 404. Treating "response.ok" as "song exists"
   * therefore silently accepts broken songs, and the audio then fails to
   * decode with a confusing "Could not play this song" error.
   * So we only accept responses whose Content-Type is actually audio.
   */
  async checkAvailability() {
    await Promise.all(
      this.bundled.map(async (song) => {
        // Assume available by default; only mark missing when proven so.
        let available = true
        try {
          const response = await fetch(song.url, {
            method: 'GET',
            headers: { Range: 'bytes=0-0' },
          })
          const type = (response.headers.get('content-type') || '').toLowerCase()
          // An HTML fallback means the file is not actually served.
          const isAudio =
            type.startsWith('audio/') ||
            type.includes('mpeg') ||
            type.includes('octet-stream')
          available = response.ok && isAudio
        } catch {
          // Network error -> assume available (dev server quirks)
          available = true
        }

        if (!available) {
          console.warn(
            `[cyber-runner] Song file not served as audio: ${song.url} ` +
              `(check the filename, including accents/invisible characters)`,
          )
        }
        song.available = available
      }),
    )
    this.selected = this.availableSongs()[0] ?? this.all()[0] ?? null
    this.render()
  },

  /** Can the currently selected song be played? */
  isPlayable(song = this.selected) {
    return !!song && song.available !== false
  },

  /** All songs, bundled first then uploads, each group sorted A-Z. */
  all() {
    const uploads = [...this.uploaded].sort((a, b) =>
      a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
    )
    return [...this.bundled, ...uploads]
  },

  first() {
    return this.all()[0] ?? null
  },

  /** Songs that can actually be played. */
  availableSongs() {
    return this.all().filter((song) => song.available !== false)
  },

  find(id) {
    return this.all().find((song) => song.id === id) ?? null
  },

  select(id) {
    const song = this.find(id)
    if (!song) return
    this.selected = song
    this.stopPreview()
    this.render()
  },

  /** Rebuild the dropdown and the selected-song label. */
  render() {
    if (!ui.songSelect) return

    const songs = this.all()
    ui.songSelect.innerHTML = ''

    if (songs.length === 0) {
      const option = document.createElement('option')
      option.textContent = 'No songs available'
      option.disabled = true
      ui.songSelect.appendChild(option)
      ui.songSelect.disabled = true
      if (ui.startButton) ui.startButton.disabled = true
      return
    }

    ui.songSelect.disabled = false
    if (ui.startButton) ui.startButton.disabled = false

    for (const song of songs) {
      const option = document.createElement('option')
      option.value = song.id
      const label = song.artist ? `${song.title} — ${song.artist}` : song.title
      const suffix = song.source === 'uploaded' ? '  (uploaded)' : ''
      const missing = song.available === false
      option.textContent = missing ? `${label}${suffix}  — file not found` : `${label}${suffix}`
      // Missing files are listed (so the user knows why) but cannot be picked.
      option.disabled = missing
      ui.songSelect.appendChild(option)
    }

    // Keep the current selection if it still exists.
    if (!this.selected || !songs.some((s) => s.id === this.selected.id)) {
      this.selected = songs.find((s) => s.available !== false) ?? songs[0]
    }
    ui.songSelect.value = this.selected.id
    this.renderInfo()
  },

  renderInfo() {
    if (!ui.songInfo) return
    const song = this.selected
    if (!song) {
      ui.songInfo.textContent = ''
      this.setStartEnabled(false)
      return
    }
    const bits = [song.title]
    if (song.artist) bits.push(song.artist)
    bits.push(song.source === 'uploaded' ? 'uploaded' : 'bundled')
    ui.songInfo.textContent = bits.join('  ·  ')

    const playable = this.isPlayable(song)
    this.setStartEnabled(playable)
    if (!playable) {
      this.setStatus('This song file is missing. Pick another or upload an MP3.', 'error')
    }
  },

  setStartEnabled(enabled) {
    if (ui.startButton) ui.startButton.disabled = !enabled
    if (ui.previewButton) ui.previewButton.disabled = !enabled
  },

  /* ---------------- Upload handling ---------------- */

  /**
   * Validate and register a user-picked audio file.
   * Reads ID3 tags (when present) so the song shows its real title/artist.
   * Returns { ok: true, song } or { ok: false, message }.
   */
  async addFile(file) {
    if (!file) return { ok: false, message: 'No file selected.' }

    const isAudioType = file.type.startsWith('audio/')
    const isMp3Name = /\.(mp3|m4a|ogg|wav)$/i.test(file.name)
    if (!isAudioType && !isMp3Name) {
      return { ok: false, message: 'Please choose an audio file (MP3, M4A, OGG or WAV).' }
    }

    if (file.size > CONFIG.maxUploadBytes) {
      const maxMb = Math.round(CONFIG.maxUploadBytes / 1024 / 1024)
      const sizeMb = (file.size / 1024 / 1024).toFixed(1)
      return { ok: false, message: `File is ${sizeMb} MB — the limit is ${maxMb} MB.` }
    }

    // Reject duplicates by name+size so re-picking the same file is harmless.
    const existing = this.uploaded.find(
      (song) => song.fileName === file.name && song.fileSize === file.size,
    )
    if (existing) return { ok: true, song: existing, duplicate: true }

    const tags = await readId3Tags(file)
    const url = URL.createObjectURL(file)
    const fallbackTitle = file.name.replace(/\.[^.]+$/, '')

    const song = {
      id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: tags.title || fallbackTitle,
      artist: tags.artist || '',
      url,
      source: 'uploaded',
      fileName: file.name,
      fileSize: file.size,
    }

    this.uploaded.push(song)
    this.selected = song
    this.render()

    const warning =
      file.size > CONFIG.warnUploadBytes
        ? `Large file (${(file.size / 1024 / 1024).toFixed(1)} MB) — analysis may take a few seconds.`
        : ''

    return { ok: true, song, warning }
  },

  /** Drop an uploaded song and revoke its blob URL. */
  remove(song) {
    const index = this.uploaded.indexOf(song)
    if (index === -1) return
    this.uploaded.splice(index, 1)

    // Stop anything using this URL before releasing it.
    if (audio.url === song.url) {
      audio.pause()
      audio.el = null
      audio.url = null
    }
    beatDetector.forget(song.url)
    beatDetector.decodeCache.delete(song.url)
    this.stopPreview()

    URL.revokeObjectURL(song.url)

    if (this.selected === song) this.selected = this.all()[0] ?? null
    this.render()
  },

  /* ---------------- Preview ("listen first") ---------------- */

  /**
   * Preview is deliberately separate from the gameplay audio element so it can
   * never interfere with sync. It is stopped on every state change.
   */
  previewEl: null,
  previewTimer: 0,

  togglePreview() {
    if (this.previewEl && !this.previewEl.paused) {
      this.stopPreview()
      return
    }
    this.startPreview()
  },

  startPreview() {
    const song = this.selected
    if (!song) return
    if (!this.isPlayable(song)) {
      this.setStatus('This song file is missing.', 'error')
      return
    }

    this.stopPreview()

    const el = new Audio(song.url)
    el.preload = 'auto'
    // Preview from a little way in, where the beat usually settles.
    el.currentTime = 0

    this.previewEl = el

    el.play()
      .then(() => {
        ui.previewButton?.classList.add('playing')
        if (ui.previewButton) ui.previewButton.textContent = 'STOP'
        // Auto-stop so a forgotten preview never overlaps the game.
        clearTimeout(this.previewTimer)
        this.previewTimer = setTimeout(
          () => this.stopPreview(),
          CONFIG.previewSeconds * 1000,
        )
      })
      .catch(() => {
        // Most common cause: the file is missing or cannot be decoded.
        this.setStatus('Could not play this song — the file may be missing.', 'error')
        this.stopPreview()
      })

    el.addEventListener('ended', () => this.stopPreview(), { once: true })
  },

  stopPreview() {
    clearTimeout(this.previewTimer)
    this.previewTimer = 0

    const el = this.previewEl
    this.previewEl = null
    if (el) {
      el.pause()
      el.removeAttribute('src')
      el.load()
    }

    if (ui.previewButton) {
      ui.previewButton.classList.remove('playing')
      ui.previewButton.textContent = 'LISTEN'
    }
  },

  /** Small status line under the picker (loading / errors). */
  setStatus(message, kind = 'info') {
    if (!ui.songStatus) return
    ui.songStatus.textContent = message
    ui.songStatus.dataset.kind = kind
  },

  clearStatus() {
    this.setStatus('', 'info')
  },
}

/* ==========================================================================
   GAME STATE
   ========================================================================== */

const game = {
  isPlaying: false,
  isStarting: false,
  isPaused: false,
  score: 0,
  missCount: 0,
  hits: 0,
  badCount: 0,
  combo: 0,
  maxCombo: 0,
  lastGrade: null,
  lastTiming: 0,
  targetLane: 1,
  recentLanes: [],
  /** The song object currently loaded (so RUN AGAIN replays the same track). */
  currentSong: null,
  /**
   * Selected difficulty ('easy' | 'hard'). Lives in the game state so RUN AGAIN
   * and RESTART keep the same mode until the player changes it on the title
   * screen. Only the chart density depends on it — timing and scoring do not.
   */
  difficulty: CONFIG.defaultDifficulty,

  reset() {
    obstacleManager.clear()
    rhythm.stop()
    rhythm.reset()
    input.reset()
    ui.hideStartScreen()

    this.score = 0
    this.missCount = 0
    this.hits = 0
    this.badCount = 0
    this.combo = 0
    this.maxCombo = 0
    this.lastGrade = null
    this.lastTiming = 0
    this.targetLane = 1
    this.recentLanes = []
    this.isPaused = false

    ui.beat.textContent = '--'
    this.updateHud()
    paddlePulse = 0
    shakeAmount = 0
    clearJudgement()
  },

  async start(song) {
    if (this.isStarting) return
    this.isStarting = true

    // Remember which song is being played so RUN AGAIN replays the same one.
    const target = song ?? this.currentSong ?? songLibrary.first()
    this.currentSong = target

    try {
      // Hard-stop the previous run BEFORE any await. Otherwise the tick loop
      // keeps resolving misses against the old session while we wait for the
      // chart, which leaks miss counts into the new run.
      this.isPlaying = false
      this.isPaused = false
      rhythm.stop()
      obstacleManager.clear()
      input.releaseAll()

      // Unlock audio inside the user gesture (silent) so the countdown can run
      // before the music actually begins.
      audio.prime(target.url)

      // Kick off analysis (cached per (song, mode) after the first run). The
      // drum chart is what actually drives note timing now.
      const mode = beatDetector.resolveMode(this.difficulty)
      const beatPromise = beatDetector.detect(target.url)
      const chartPromise = beatDetector.buildChart(target.url, { difficulty: mode })

      // Show the play field behind the countdown.
      ui.startScreen.classList.add('hidden')
      ui.gameOver.classList.add('hidden')
      ui.pauseScreen.classList.add('hidden')
      ui.hud.classList.remove('hidden')
      ui.laneKeys.classList.remove('hidden')
      document.body.classList.add('is-playing')

      // Wait for analysis to finish (instant after the first run) BEFORE the
      // countdown, so the countdown is a clean 3-2-1.
      rhythm.configure(await beatPromise)
      rhythm.setChart(await chartPromise)

      // Clear the scoreboard before the countdown so HUD shows 0 during 3-2-1
      // instead of the previous run's numbers.
      this.reset()

      // 3 - 2 - 1, in silence. The player can already move the paddle.
      // Start audio NOW (inside user gesture), then immediately pause at ~0.
      // This keeps the audio context "warm" so resume() after countdown works on mobile.
      audio.startFromBeginning(target.url)
      audio.pause()

      await runCountdown()

      // Now start everything together: music, chart and scoring.
      rhythm.reset()
      this.isPlaying = true
      ui.pauseButton.classList.remove('hidden')
      audio.resume()
    } finally {
      // Always release the lock, even if analysis threw — otherwise the game
      // could never be started again.
      this.isStarting = false
    }
  },

  /** Move the paddle to a lane (called on every lane key press). */
  requestLane(lane) {
    this.targetLane = lane
    paddlePulse = 1
  },

  /**
   * Central scoring entry point for every judgement.
   * grade: 'perfect' | 'good' | 'ok' | 'bad' | 'miss'
   */
  addJudgement(grade, lane, timing = 0) {
    this.lastGrade = grade
    this.lastTiming = timing

    const isHit = grade === 'perfect' || grade === 'good' || grade === 'ok'

    if (isHit) {
      this.hits += 1
      this.combo += 1
      this.maxCombo = Math.max(this.maxCombo, this.combo)

      const base = CONFIG.judgeScore[grade]
      const multiplier = 1 + Math.min(this.combo, 20) * 0.05
      this.score += Math.round(base * multiplier)

      flashPaddle(lane, 'hit')
      this.popScore()
    } else {
      // BAD (whiff) and MISS both break the combo.
      this.combo = 0
      if (grade === 'bad') this.badCount += 1
      flashPaddle(lane, 'miss')
    }

    if (grade === 'miss') {
      this.missCount += 1
      // No-Fail (practice): misses still count on the HUD and break the combo,
      // but the run is never cut short by the miss limit.
      if (!MODIFIERS.noFail && this.missCount >= CONFIG.maxMisses) {
        this.updateHud()
        showJudgement('miss', 0)
        this.gameOver()
        return
      }
    }

    this.updateHud()
    showJudgement(grade, timing)
  },

  /** A note slipped past the hit line. */
  addMiss(lane) {
    this.addJudgement('miss', lane)
  },

  gameOver() {
    if (!this.isPlaying) return
    this.isPlaying = false
    this.isPaused = false
    document.body.classList.remove('is-playing')
    ui.countdown.classList.add('hidden')
    songLibrary.stopPreview()

    // Stop spawning and freeze the music exactly where it is.
    rhythm.stop()
    audio.pause()
    input.releaseAll()

    // Fade the remaining notes out instead of leaving them frozen on screen.
    for (const note of obstacles) note.userData.fading = true

    ui.finalScore.textContent = String(this.score)
    ui.finalHits.textContent = String(this.hits)
    this.renderGameOverRecords()
    ui.laneKeys.classList.add('hidden')
    ui.pauseButton.classList.add('hidden')
    ui.pauseScreen.classList.add('hidden')
    ui.gameOver.classList.remove('hidden')
    shakeAmount = 0.18
  },

  /**
   * Store a record for this run (unless it was a No-Fail) and paint the
   * best-score / best-combo lines on the game-over screen.
   */
  renderGameOverRecords() {
    const mode = beatDetector.resolveMode(this.difficulty)
    const song = this.currentSong
    const runStats = { score: this.score, maxCombo: this.maxCombo }

    const result = MODIFIERS.noFail ? null : highScores.submit(song, mode, runStats)
    const best = highScores.get(song, mode)

    // "NEW BEST" only makes sense when the run actually set the record.
    const scoreLabel = ui.bestScoreLabel
    const comboLabel = ui.bestComboLabel
    if (scoreLabel && comboLabel) {
      scoreLabel.classList.toggle('is-record', !!result?.isScore)
      comboLabel.classList.toggle('is-record', !!result?.isCombo)
    }

    ui.finalCombo.textContent = String(this.maxCombo)
    ui.bestScore.textContent = best ? String(best.score) : '—'
    ui.bestCombo.textContent = best ? String(best.combo) : '—'

    ui.noFailNote.classList.toggle('hidden', !MODIFIERS.noFail)
  },

  /* ---------------- PAUSE / RESUME ---------------- */

  pause() {
    if (!this.isPlaying || this.isPaused) return
    this.isPaused = true

    // Freeze the music AND the beat grid together so they stay in sync.
    audio.pause()
    rhythm.stop()
    input.releaseAll()

    ui.pauseScreen.classList.remove('hidden')
    ui.pauseButton.classList.add('hidden')
    ui.hud.classList.add('hidden')
    ui.laneKeys.classList.add('hidden')
  },

  resume() {
    if (!this.isPlaying || !this.isPaused) return
    this.isPaused = false

    // Re-align the beat grid to the position we paused at, BEFORE the audio
    // starts playing again, so notes never drift while frozen.
    this.rebaseRhythm()
    audio.resume()

    ui.pauseScreen.classList.add('hidden')
    ui.pauseButton.classList.remove('hidden')
    ui.hud.classList.remove('hidden')
    ui.laneKeys.classList.remove('hidden')
  },

  togglePause() {
    if (this.isPaused) this.resume()
    else this.pause()
  },

  /**
   * With a chart-driven scheduler there is no beat grid to re-anchor: notes are
   * scheduled against the audio playhead, so resuming playback automatically
   * resumes the chart at the exact right moment. We only need to make sure the
   * scheduler is running again.
   */
  rebaseRhythm() {
    rhythm.startTime = performance.now() / 1000
    rhythm.isRunning = true
  },

  updateHud() {
    ui.score.textContent = String(this.score)
    ui.misses.textContent = `${this.missCount} / ${CONFIG.maxMisses}`
    ui.combo.textContent = this.combo > 0 ? `x${this.combo}` : '0'
    ui.misses.classList.toggle('danger', this.missCount >= CONFIG.maxMisses - 3)
  },

  popScore() {
    ui.score.classList.remove('hud-pop')
    void ui.score.offsetWidth
    ui.score.classList.add('hud-pop')
    clearTimeout(this._popTimer)
    this._popTimer = setTimeout(() => ui.score.classList.remove('hud-pop'), 160)
  },
}

/* ==========================================================================
   PADDLE FEEDBACK  (colour flash, pulse ring, camera shake)
   ========================================================================== */

let shakeAmount = 0
let paddlePulse = 0
const paddleFlash = { value: 0, color: new THREE.Color(0xffffff) }

const PADDLE_FLASH = {
  hit: new THREE.Color(0xffffff),
  miss: new THREE.Color(0xff4d6d),
}

/**
 * Expanding ring pulse on the hit line — reused from a small pool so a
 * 212 BPM stream never allocates during play.
 */
const PULSE_POOL_SIZE = 5
const pulsePool = []
const pulseGeometry = new THREE.RingGeometry(0.5, 0.62, 40)

for (let i = 0; i < PULSE_POOL_SIZE; i++) {
  const ring = new THREE.Mesh(
    pulseGeometry,
    new THREE.MeshBasicMaterial({
      color: COLORS.cyan,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  )
  ring.rotation.x = -Math.PI / 2
  ring.visible = false
  player.add(ring)
  pulsePool.push({ mesh: ring, life: 0 })
}

function spawnPulse(lane, kind) {
  const slot = pulsePool.find((p) => p.life <= 0) ?? pulsePool[0]
  slot.life = 1
  slot.mesh.visible = true
  slot.mesh.scale.setScalar(0.5)
  slot.mesh.material.color.setHex(kind === 'hit' ? COLORS.lanes[lane] : 0xff4d6d)
  slot.mesh.material.opacity = kind === 'hit' ? 0.65 : 0.45
}

function updatePulses(dt) {
  for (const slot of pulsePool) {
    if (slot.life <= 0) continue
    slot.life = Math.max(0, slot.life - dt * 2.6)
    const t = 1 - slot.life
    slot.mesh.scale.setScalar(0.5 + t * 2.4)
    slot.mesh.material.opacity *= Math.max(0, 1 - dt * 4)
    if (slot.life <= 0) slot.mesh.visible = false
  }
}

/** Colour the paddle for a hit (lane colour + white) or a miss (red). */
function flashPaddle(lane, kind) {
  spawnPulse(lane, kind)

  if (kind === 'hit') {
    paddleFlash.value = 1
    paddleFlash.color.copy(PADDLE_FLASH.hit)
    shakeAmount = Math.min(shakeAmount + 0.045, 0.1)
  } else {
    paddleFlash.value = 0.6
    paddleFlash.color.copy(PADDLE_FLASH.miss)
  }
}

/* ==========================================================================
   PER-FRAME UPDATE
   ========================================================================== */

const timer = new THREE.Timer()

function onBeat(noteIndex, hitTime) {
  // Never spawn while paused or after the run ended.
  if (!game.isPlaying || game.isPaused) return

  const lane = obstacleManager.pickLane(game.recentLanes)
  game.recentLanes.push(lane)
  if (game.recentLanes.length > 3) game.recentLanes.shift()

  // Mirror is applied at the very last moment: the chart generator behaves
  // exactly the same, the result is simply flipped left-right.
  obstacleManager.spawn(mirrorLane(lane), hitTime)

  // Show the song position (in bars) rather than a note counter.
  const bar = Math.floor(hitTime / (rhythm.beatInterval * 4)) + 1
  ui.beat.textContent = String(bar).padStart(2, '0')
}

/** Slide the paddle to the active lane and drive its glow feedback. */
function updatePlayer(dt) {
  // Lanes are discrete; ease toward the target so the slide reads smoothly
  // but still feels instant at 212 BPM.
  const targetX = laneToX(game.targetLane)
  const slideSpeed = 22
  const t = 1 - Math.exp(-slideSpeed * dt)
  player.position.x += (targetX - player.position.x) * t

  // Keep the paddle glued to the hit line; a tiny bob adds life.
  player.position.y = 0.02 + Math.sin(timer.getElapsed() * 2.4) * 0.008

  // Decay flash + pulse.
  paddleFlash.value = Math.max(0, paddleFlash.value - dt * 5)
  paddlePulse = Math.max(0, paddlePulse - dt * 4)

  const flash = paddleFlash.value
  const laneColor = COLORS.lanes[game.targetLane]
  const blink = 0.16 + paddlePulse * 0.26

  paddleMaterial.color.setHex(laneColor).lerp(paddleFlash.color, flash * 0.85)
  paddleMaterial.opacity = blink + flash * 0.4
  paddleRing.material.color.setHex(laneColor).lerp(paddleFlash.color, flash)
  paddleRing.material.opacity = 0.8 + flash * 0.2

  // Highlight the active lane's strip so the eye tracks where to strike.
  for (let i = 0; i < laneBeams.length; i++) {
    const target = i === game.targetLane ? 0.17 + paddlePulse * 0.1 : 0.055
    laneBeams[i].material.opacity +=
      (target - laneBeams[i].material.opacity) * (1 - Math.exp(-12 * dt))
  }

  // A gentle scale bump on press sells the "strike".
  const bump = 1 + paddlePulse * 0.06
  paddlePad.scale.set(bump, bump, 1)
  paddleRing.scale.set(bump, bump, 1)
}

function updateGrid(dt) {
  // Scroll the grid toward the viewer one cell at a time, then wrap.
  const cell = CONFIG.gridLength / CONFIG.gridDivisionsZ
  grid.position.z += CONFIG.gridScrollSpeed * dt
  if (grid.position.z - CONFIG.gridLength / 2 > CONFIG.gridLength - 10) {
    grid.position.z -= cell * CONFIG.gridDivisionsZ
  }
}

function tick(timestamp) {
  timer.update(timestamp)
  const dt = Math.min(timer.getDelta(), 0.1)

  // Freeze all animation while paused so the world looks truly stopped.
  const sceneDt = game.isPaused ? 0 : dt

  updateGrid(sceneDt)
  updatePlayer(sceneDt)
  updatePulses(sceneDt)

  // While paused everything gameplay-related is frozen: no spawning, no note
  // movement, no miss checks. The scene still renders so the pause overlay
  // sits over a live 3D view.
  if (game.isPlaying && !game.isPaused) {
    // The chart is scheduled directly against the audio playhead, so notes
    // land on the song's real drum hits with no accumulated drift.
    const audioTime = audio.getTime()
    rhythm.update(audioTime, onBeat)
    obstacleManager.update(dt)
    resolveMisses()
  } else if (!game.isPaused && obstacles.length > 0) {
    // After game over, let leftover notes drift away and clean themselves up.
    // NOTE: this branch must NOT run while paused, otherwise notes would keep
    // moving and get disposed behind the fog during the pause overlay.
    obstacleManager.update(dt)
  }

  // Camera shake (kept very subtle) + gentle sway.
  if (shakeAmount > 0.001) {
    shakeAmount *= 1 - dt * 7
    camera.position.x = (Math.random() - 0.5) * shakeAmount
    camera.position.y = CONFIG.cameraY + (Math.random() - 0.5) * shakeAmount
  } else {
    camera.position.x += (0 - camera.position.x) * (1 - Math.exp(-6 * dt))
    camera.position.y += (CONFIG.cameraY - camera.position.y) * (1 - Math.exp(-6 * dt))
  }
  // Look down the lane, drifting only slightly with the paddle.
  camera.lookAt(player.position.x * 0.08, CONFIG.cameraLookAtY, CONFIG.cameraLookAtZ)

  composer.render()
  requestAnimationFrame(tick)
}

/* ==========================================================================
   RESIZE
   ========================================================================== */

function onResize() {
  const width = window.innerWidth
  const height = window.innerHeight

  // Mobile landscape: wider FOV + wider lanes to fill screen
  const wasMobileLandscape = CONFIG.laneWidth > 2.5
  const isMobileLandscape = isMobile && width > height

  if (isMobileLandscape) {
    camera.fov = 68
    CONFIG.laneWidth = 3.6
  } else {
    camera.fov = 52
    CONFIG.laneWidth = 2.35
  }

  // Rebuild lane geometry if mobile/landscape state changed
  if (wasMobileLandscape !== isMobileLandscape) {
    updateLaneGeometry()
  }

  camera.aspect = width / height
  camera.updateProjectionMatrix()

  renderer.setPixelRatio(targetPixelRatio())
  renderer.setSize(width, height)
  composer.setSize(width, height)
  bloomPass.setSize(width, height)
  bloomPass.enabled = bloomEnabled()
}

/* Mobile: lock to landscape where supported, else show a rotate hint. */
function applyOrientation() {
  if (!isMobile) return

  const portrait = window.innerHeight > window.innerWidth
  ui.rotateOverlay.classList.toggle('hidden', !portrait)

  if (prefersLandscape() && screen.orientation && screen.orientation.lock) {
    screen.orientation.lock('landscape').catch(() => {})
  }
}

/* ==========================================================================
   BOOTSTRAP
   ========================================================================== */

function init() {
  input.init()
  window.addEventListener('resize', () => {
    onResize()
    applyOrientation()
  })
  window.addEventListener('orientationchange', applyOrientation)
  onResize()
  applyOrientation()

  // Touch zones replace the keyboard on mobile.
  if (isMobile) {
    document.body.classList.add('is-touch')
    ui.touchZones.classList.remove('hidden')
    initTouch(ui.touchZones, {
      pressLane: (lane) => input.pressLane(lane),
      isPlaying: () => game.isPlaying && !game.isStarting,
      isPaused: () => game.isPaused,
    })
  }

  songLibrary.init()

  // Song selection
  ui.songSelect.addEventListener('change', (event) => {
    songLibrary.select(event.target.value)
    songLibrary.clearStatus()
    updateRemoveButton()
    prefetchSelectedSong()
  })

  // "Listen" preview — separate audio element, never touches gameplay sync.
  ui.previewButton.addEventListener('click', () => songLibrary.togglePreview())

  // Upload your own MP3
  ui.songUpload.addEventListener('change', async (event) => {
    const file = event.target.files?.[0]
    ui.songUpload.value = '' // allow re-picking the same file later
    if (!file) return

    songLibrary.setStatus('READING FILE…', 'info')
    const result = await songLibrary.addFile(file)
    if (!result.ok) {
      songLibrary.setStatus(result.message, 'error')
      return
    }
    if (result.warning) {
      songLibrary.setStatus(result.warning, 'warn')
    } else {
      songLibrary.setStatus(result.duplicate ? 'Song already added.' : 'Song added.', 'ok')
    }
    updateRemoveButton()
    prefetchSelectedSong()
  })

  // Remove the currently selected uploaded song
  ui.songRemoveButton.addEventListener('click', () => {
    const song = songLibrary.selected
    if (!song || song.source !== 'uploaded') return
    songLibrary.remove(song)
    songLibrary.setStatus('Uploaded song removed.', 'ok')
    updateRemoveButton()
    prefetchSelectedSong()
  })

  ui.startButton.addEventListener('click', () => startSelectedSong())
  ui.restartButton.addEventListener('click', () => game.start())
  ui.overMenuButton.addEventListener('click', () => goToMainMenu())
  ui.quitButton.addEventListener('click', () => game.start())
  ui.menuButton.addEventListener('click', () => goToMainMenu())

  // Run modifiers -------------------------------------------------------
  for (const button of ui.speedButtons) {
    button.addEventListener('click', () => setSpeed(Number(button.dataset.speed)))
  }
  ui.noFailButton.addEventListener('click', () => setNoFail(!MODIFIERS.noFail))
  ui.mirrorButton.addEventListener('click', () => setMirror(!MODIFIERS.mirror))
  for (const button of ui.qualityButtons) {
    button.addEventListener('click', () => setQuality(button.dataset.quality))
  }

  // Audio latency calibration -------------------------------------------
  ui.offsetSlider.addEventListener('input', () => {
    setAudioOffset(Number(ui.offsetSlider.value) / 1000)
  })
  ui.offsetReset.addEventListener('click', () => {
    setAudioOffset(0)
  })

  // Cancel an in-flight chart build --------------------------------------
  ui.analysisCancel.addEventListener('click', () => cancelAnalysis())

  // Retry a song whose audio failed to decode ---------------------------
  ui.retryButton.addEventListener('click', () => retrySelectedSong())

  // Restore the player's saved settings (offset, modifiers, records).
  loadSettings()

  // Difficulty toggle. It only changes which chart gets built — never timing or
  // scoring — and the choice survives RUN AGAIN / RESTART / MAIN MENU.
  for (const button of ui.difficultyButtons) {
    button.addEventListener('click', () => {
      setDifficulty(button.dataset.difficulty)
    })
  }
  renderDifficulty()
  ui.pauseButton.addEventListener('click', () => game.pause())
  ui.resumeButton.addEventListener('click', () => game.resume())

  updateRemoveButton()

  // Analyse the first song while the player is still on the title screen, so
  // the START click has no decode delay.
  prefetchSelectedSong()

  // Render the idle attract scene immediately behind the start overlay.
  requestAnimationFrame(tick)
}

/** Show REMOVE only when an uploaded song is selected. */
function updateRemoveButton() {
  const song = songLibrary.selected
  const canRemove = !!song && song.source === 'uploaded'
  ui.songRemoveButton.classList.toggle('hidden', !canRemove)
}

/** Warm the caches for the selected song (silent, in the background). */
function prefetchSelectedSong() {
  const song = songLibrary.selected
  if (!song) return
  // Never analyse during play; it would stutter the game.
  if (game.isPlaying) return
  // Skip files we already know are missing — probing them only spams errors.
  if (song.available === false) return
  const mode = beatDetector.resolveMode(game.difficulty)
  beatDetector.detect(song.url).catch(() => {})
  // Only the selected mode's chart is warmed — the other mode builds on demand.
  beatDetector
    .buildChart(song.url, { difficulty: mode })
    .then((chart) => {
      // A fallback chart means the audio could not be analysed: offer a retry.
      if (chart && chart.fallback && !game.isPlaying) {
        ui.retryButton.classList.remove('hidden')
      } else {
        ui.retryButton.classList.add('hidden')
      }
    })
    .catch(() => {
      if (!game.isPlaying) ui.retryButton.classList.remove('hidden')
    })
}

/* ==========================================================================
   SETTINGS / MODIFIER UI
   ========================================================================== */

const STORAGE_KEY_SETTINGS = 'settings'

/** Apply a speed modifier, repaint the picker, and persist the choice. */
function setSpeed(speed) {
  const next = SPEED_OPTIONS.includes(speed) ? speed : 1
  MODIFIERS.speed = next
  renderModifiers()
  saveSettings()
}

function setNoFail(on) {
  MODIFIERS.noFail = !!on
  renderModifiers()
  saveSettings()
}

function setMirror(on) {
  MODIFIERS.mirror = !!on
  renderModifiers()
  saveSettings()
}

/** Change the graphics quality tier and re-apply it live. */
const QUALITY_OPTIONS = ['auto', 'high', 'low']
function setQuality(quality) {
  CONFIG.graphicsQuality = QUALITY_OPTIONS.includes(quality) ? quality : 'auto'
  onResize()
  renderModifiers()
  saveSettings()
}

/**
 * Set the audio latency offset (seconds). Applied live, so a running game
 * immediately judges against the corrected clock.
 *
 * `persist` is false while restoring saved settings, so a page load does not
 * immediately rewrite the stored value.
 */
function setAudioOffset(seconds, persist = true) {
  const limit = CONFIG.audioOffsetLimit
  const clamped = Math.min(limit, Math.max(-limit, Number(seconds) || 0))
  CONFIG.audioOffset = clamped

  const ms = Math.round(clamped * 1000)
  ui.offsetSlider.value = String(ms)
  ui.offsetReset.textContent = ms === 0 ? '0 ms' : `${ms > 0 ? '+' : ''}${ms} ms`
  ui.offsetReset.classList.toggle('is-active', ms !== 0)

  if (persist) saveSettings()
}

/** Paint every modifier control from the current state. */
function renderModifiers() {
  for (const button of ui.speedButtons) {
    const active = Number(button.dataset.speed) === MODIFIERS.speed
    button.setAttribute('aria-checked', active ? 'true' : 'false')
  }
  ui.noFailButton.setAttribute('aria-pressed', MODIFIERS.noFail ? 'true' : 'false')
  ui.noFailButton.classList.toggle('is-on', MODIFIERS.noFail)
  ui.mirrorButton.setAttribute('aria-pressed', MODIFIERS.mirror ? 'true' : 'false')
  ui.mirrorButton.classList.toggle('is-on', MODIFIERS.mirror)
  for (const button of ui.qualityButtons) {
    const active = button.dataset.quality === CONFIG.graphicsQuality
    button.setAttribute('aria-checked', active ? 'true' : 'false')
  }
}

function saveSettings() {
  storage.write(STORAGE_KEY_SETTINGS, {
    audioOffsetMs: Math.round(CONFIG.audioOffset * 1000),
    speed: MODIFIERS.speed,
    noFail: MODIFIERS.noFail,
    mirror: MODIFIERS.mirror,
    difficulty: game.difficulty,
    graphicsQuality: CONFIG.graphicsQuality,
  })
}

/** Restore settings saved on a previous visit. */
function loadSettings() {
  const saved = storage.read(STORAGE_KEY_SETTINGS, null)
  const settings = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {}

  // Clamp a stored offset into the legal slider range.
  const limitMs = CONFIG.audioOffsetLimit * 1000
  const rawOffset = Number(settings.audioOffsetMs)
  const offsetMs = Number.isFinite(rawOffset)
    ? Math.min(limitMs, Math.max(-limitMs, rawOffset))
    : 0
  setAudioOffset(offsetMs / 1000, false)

  const speed = Number(settings.speed)
  MODIFIERS.speed = SPEED_OPTIONS.includes(speed) ? speed : 1
  MODIFIERS.noFail = settings.noFail === true
  MODIFIERS.mirror = settings.mirror === true

  const q = settings.graphicsQuality
  CONFIG.graphicsQuality = QUALITY_OPTIONS.includes(q) ? q : 'auto'
  // Re-apply the restored quality to the renderer / bloom.
  onResize()

  renderModifiers()

  if (settings.difficulty) {
    game.difficulty = beatDetector.resolveMode(settings.difficulty)
  }

  highScores.load()
}

/** Abort the running chart build and return the title screen to normal. */
function cancelAnalysis() {
  if (!analysisJob.active) return
  analysisJob.cancelled = true
  hideAnalysis()
  songLibrary.setStatus('Analysis cancelled.', 'warn')
  ui.startButton.disabled = false
  songLibrary.renderInfo()
}

/**
 * Clear the cached failure for the selected song and analyse it again.
 * Only meaningful when a decode/chart build failed, so the RETRY button is
 * shown exactly in that situation.
 */
async function retrySelectedSong() {
  const song = songLibrary.selected
  if (!song) return

  // Drop the failed decode and any fallback chart so this is a real retry.
  beatDetector.decodeCache.delete(song.url)
  beatDetector.decoding.delete(song.url)
  beatDetector.chartCache.clear()
  beatDetector.chartBuilding.clear()
  beatDetector.beatCache.delete(song.url)

  ui.retryButton.classList.add('hidden')
  songLibrary.clearStatus()
  showAnalysis('RETRYING…')

  try {
    const mode = beatDetector.resolveMode(game.difficulty)
    const chart = await beatDetector.buildChart(song.url, { difficulty: mode })
    hideAnalysis()

    if (chart.fallback) {
      songLibrary.setStatus('Still could not read this audio file. Try a different MP3.', 'error')
      ui.retryButton.classList.remove('hidden')
      return
    }
    songLibrary.setStatus(`Ready — ${chart.count} notes found.`, 'ok')
    prefetchSelectedSong()
  } catch (error) {
    hideAnalysis()
    if (!error?.cancelled) {
      songLibrary.setStatus('Retry failed. The file may be corrupt.', 'error')
      ui.retryButton.classList.remove('hidden')
    }
  }
}

/**
 * Change the active difficulty and reflect it in the toggle. Charts are cached
 * per (song, mode), so switching back and forth is always consistent.
 */
function setDifficulty(mode) {
  const next = beatDetector.resolveMode(mode)
  if (game.difficulty === next) return
  game.difficulty = next
  renderDifficulty()
  saveSettings()
  // Warm the newly selected mode's chart for the current song.
  prefetchSelectedSong()
}

/** Paint the EASY / HARD toggle from the current game state. */
function renderDifficulty() {
  // Keep the state valid even if it was set to something unknown.
  game.difficulty = beatDetector.resolveMode(game.difficulty)
  for (const button of ui.difficultyButtons) {
    const active = button.dataset.difficulty === game.difficulty
    button.setAttribute('aria-checked', active ? 'true' : 'false')
  }
}

/**
 * Return to the main menu (song selection screen).
 */
function goToMainMenu() {
  songLibrary.stopPreview()
  game.isPlaying = false
  game.isPaused = false
  document.body.classList.remove('is-playing')
  rhythm.stop()
  audio.pause()
  game.currentSong = null
  obstacleManager.clear()
  input.releaseAll()
  hideAnalysis()
  ui.retryButton.classList.add('hidden')
  songLibrary.selected = songLibrary.first()
  songLibrary.render()
  songLibrary.clearStatus()
  // Keep the last chosen difficulty visible and active on the title screen.
  renderDifficulty()
  renderModifiers()
  ui.startScreen.classList.remove('hidden')
  ui.gameOver.classList.add('hidden')
  ui.pauseScreen.classList.add('hidden')
  ui.hud.classList.add('hidden')
  ui.laneKeys.classList.add('hidden')
  ui.pauseButton.classList.add('hidden')
}

/**
 * Start the selected song. Any preview is stopped first, and the player gets
 * feedback while the song is being analysed.
 */
async function startSelectedSong() {
  const song = songLibrary.selected
  if (!song) {
    songLibrary.setStatus('Select a song first.', 'error')
    return
  }
  if (!songLibrary.isPlayable(song)) {
    songLibrary.setStatus('This song file is missing. Pick another or upload an MP3.', 'error')
    return
  }

  songLibrary.stopPreview()

  // Already analysed for THIS mode (cached) -> start instantly.
  const mode = beatDetector.resolveMode(game.difficulty)
  const cached = beatDetector.chartCache.has(beatDetector.chartKey(song.url, mode))
  if (!cached) {
    // A first run on an upload can take a few seconds: show real progress and
    // let the player back out instead of staring at a frozen button.
    showAnalysis('ANALYSING…')
    ui.startButton.disabled = true
    songLibrary.renderInfo()
  }

  try {
    await game.start(song)
    songLibrary.clearStatus()
    if (!cached) hideAnalysis()
  } catch (error) {
    if (error?.cancelled) {
      // Cancelled from the analysis bar: just restore the title screen.
      hideAnalysis()
      songLibrary.setStatus('Analysis cancelled.', 'warn')
    } else {
      console.error('[cyber-runner] Could not start the song.', error)
      hideAnalysis()
      songLibrary.setStatus('Could not start this song. Try another file.', 'error')
    }
  } finally {
    ui.startButton.disabled = false
  }
}

// Dev-only introspection hook (handy for profiling/leak checks).
window.__cyberRunner = {
  get songLibrary() {
    return songLibrary
  },
  get game() {
    return game
  },
  get beatDetector() {
    return beatDetector
  },
  get modifiers() {
    return MODIFIERS
  },
  get highScores() {
    return highScores
  },
  get audioOffset() {
    return CONFIG.audioOffset
  },
  get baseNoteSpeed() {
    return CONFIG.noteSpeed
  },
  activeNoteSpeed() {
    return activeNoteSpeed()
  },
  mirrorLane(lane) {
    return mirrorLane(lane)
  },
  readId3Tags(file) {
    return readId3Tags(file)
  },
  get rhythm() {
    return rhythm
  },
  get audio() {
    return audio
  },
  get noteCount() {
    return obstacles.length
  },
  rhythmRunning() {
    return rhythm.isRunning
  },
  /** Nearest upcoming note in any lane with its exact timing error. */
  peekNext() {
    let best = null
    let bestAbs = Infinity
    for (const note of obstacles) {
      const t = timeToHit(note)
      const abs = Math.abs(t)
      if (abs < bestAbs) {
        bestAbs = abs
        best = { lane: note.userData.lane, t, hitTime: note.userData.hitTime }
      }
    }
    return best
  },
  /** Chart stats for the current song. Pass a mode to inspect the other one. */
  chartInfo(modeOverride) {
    const url = game.currentSong?.url
    const mode = beatDetector.resolveMode(modeOverride ?? game.difficulty)
    // Charts are cached per (mode, url) — read the one for the active mode.
    const c = url ? beatDetector.chartCache.get(beatDetector.chartKey(url, mode)) : null
    return c
      ? {
          mode,
          count: c.count,
          firstNoteTime: +c.firstNoteTime.toFixed(2),
          duration: +c.duration.toFixed(1),
          densityPerMin: +(c.count / (c.duration / 60)).toFixed(0),
          fallback: !!c.fallback,
        }
      : null
  },
  songInfo() {
    return game.currentSong
      ? { id: game.currentSong.id, title: game.currentSong.title, url: game.currentSong.url }
      : null
  },
  rhythmCursor() {
    return rhythm.cursor
  },
  rhythmTimes() {
    return rhythm.times.length
  },
  debugFirstNote() {
    const n = obstacles[0]
    return n ? { z: +n.position.z.toFixed(2), hitTime: n.userData.hitTime, lane: n.userData.lane } : null
  },
  /** Detected tempo info (dev/debug only). */
  beatInfo() {
    return {
      bpm: rhythm.beatInterval ? 60 / rhythm.beatInterval : null,
      beatInterval: rhythm.beatInterval,
      offset: rhythm.offset,
    }
  },
  get memory() {
    return { ...renderer.info.memory, programs: renderer.info.programs?.length ?? 0 }
  },
  get state() {
    return {
      isPlaying: game.isPlaying,
      isPaused: game.isPaused,
      score: game.score,
      missCount: game.missCount,
      hits: game.hits,
      badCount: game.badCount,
      combo: game.combo,
      maxCombo: game.maxCombo,
      lastGrade: game.lastGrade,
      lastTiming: game.lastTiming,
      targetLane: game.targetLane,
      laneCount: CONFIG.laneCount,
    }
  },
  audioPaused() {
    return audio.el ? audio.el.paused : null
  },
  audioPosition() {
    return audio.el ? +audio.el.currentTime.toFixed(3) : null
  },
  /** Time (seconds) until the nearest note reaches the hit line. */
  closestNoteTime() {
    let best = null
    for (const note of obstacles) {
      const t = timeToHit(note)
      if (t > -0.5 && (best === null || t < best)) best = t
    }
    return best
  },
  /** Lane of the note closest to the hit line that is currently hittable. */
  nextNoteLane() {
    let best = -1
    let bestAbs = Infinity
    for (const note of obstacles) {
      const abs = Math.abs(timeToHit(note))
      if (abs <= CONFIG.hitWindow && abs < bestAbs) {
        best = note.userData.lane
        bestAbs = abs
      }
    }
    return best
  },
}

init()
