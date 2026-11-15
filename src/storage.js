import { CONFIG, MODIFIERS, SPEED_OPTIONS } from './config.js'

export const STORAGE_PREFIX = 'cyber-runner:'
export const STORAGE_KEY_SCORES = 'scores'
export const STORAGE_KEY_SETTINGS = 'settings'

export const storage = {
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

  readNumber(key, fallback, min, max) {
    const value = this.read(key, fallback)
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
    return Math.min(max, Math.max(min, value))
  },
}

export const highScores = {
  data: {},

  load() {
    const raw = storage.read(STORAGE_KEY_SCORES, {})
    this.data = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  },

  save() {
    storage.write(STORAGE_KEY_SCORES, this.data)
  },

  songKey(song) {
    if (!song) return null
    return song.id || song.url
  },

  get(song, mode) {
    const key = this.songKey(song)
    if (!key) return null
    return this.data[key]?.[mode] ?? null
  },

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

export function saveSettings(extra = {}) {
  storage.write(STORAGE_KEY_SETTINGS, {
    audioOffsetMs: Math.round(CONFIG.audioOffset * 1000),
    speed: MODIFIERS.speed,
    noFail: MODIFIERS.noFail,
    mirror: MODIFIERS.mirror,
    sfxVolume: CONFIG.sfxVolume,
    musicVolume: CONFIG.musicVolume,
    laneKeys: CONFIG.laneKeys,
    graphicsQuality: CONFIG.graphicsQuality,
    ...extra,
  })
}

export function loadSettings() {
  const saved = storage.read(STORAGE_KEY_SETTINGS, null)
  const settings = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {}

  const limitMs = CONFIG.audioOffsetLimit * 1000
  const rawOffset = Number(settings.audioOffsetMs)
  const offsetMs = Number.isFinite(rawOffset)
    ? Math.min(limitMs, Math.max(-limitMs, rawOffset))
    : 0
  CONFIG.audioOffset = offsetMs / 1000

  const speed = Number(settings.speed)
  MODIFIERS.speed = SPEED_OPTIONS.includes(speed) ? speed : 1
  MODIFIERS.noFail = settings.noFail === true
  MODIFIERS.mirror = settings.mirror === true

  if (typeof settings.sfxVolume === 'number') {
    CONFIG.sfxVolume = Math.max(0, Math.min(1, settings.sfxVolume))
  }
  if (typeof settings.musicVolume === 'number') {
    CONFIG.musicVolume = Math.max(0, Math.min(1, settings.musicVolume))
  }
  if (Array.isArray(settings.laneKeys) && settings.laneKeys.length === 4) {
    CONFIG.laneKeys = settings.laneKeys
  }

  const q = settings.graphicsQuality
  CONFIG.graphicsQuality = ['auto', 'high', 'low'].includes(q) ? q : 'auto'

  return settings
}
