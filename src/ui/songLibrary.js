import { CONFIG } from '../config.js'
import { ui } from './dom.js'
import { audio } from '../audio/audioEngine.js'
import { readId3Tags } from '../audio/id3.js'
import { beatDetector } from '../chart/beatDetector.js'

export const songLibrary = {
  bundled: [],
  uploaded: [],
  selected: null,
  previewEl: null,
  previewTimer: 0,

  init() {
    this.bundled = [...CONFIG.songs]
      .map((song) => ({
        ...song,
        url: CONFIG.resolveAssetUrl(song.url),
        source: 'bundled',
        available: null,
      }))
      .sort((a, b) =>
        a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
      )

    this.selected = this.bundled[0] ?? null
    this.render()
    this.checkAvailability()
  },

  async checkAvailability() {
    await Promise.all(
      this.bundled.map(async (song) => {
        let available
        try {
          const response = await fetch(song.url, {
            method: 'GET',
            headers: { Range: 'bytes=0-0' },
          })
          const type = (
            response.headers.get('content-type') || ''
          ).toLowerCase()
          const isAudio =
            type.startsWith('audio/') ||
            type.includes('mpeg') ||
            type.includes('octet-stream')
          available = response.ok && isAudio
        } catch {
          available = true
        }

        if (!available) {
          console.warn(
            `[cyber-runner] Song file not served as audio: ${song.url}`,
          )
        }
        song.available = available
      }),
    )
    this.selected = this.availableSongs()[0] ?? this.all()[0] ?? null
    this.render()
  },

  isPlayable(song) {
    if (!song) return false
    return song.source === 'uploaded' || song.available !== false
  },

  all() {
    return [...this.bundled, ...this.uploaded]
  },

  availableSongs() {
    return this.all().filter((song) => this.isPlayable(song))
  },

  first() {
    return this.availableSongs()[0] ?? this.all()[0] ?? null
  },

  select(id) {
    const target = this.all().find((song) => song.id === id)
    if (!target) return
    this.selected = target
    this.stopPreview()
    this.renderInfo()
  },

  render() {
    if (!ui.songSelect) return
    const current = this.selected?.id
    ui.songSelect.innerHTML = ''

    const addOpt = (song) => {
      const opt = document.createElement('option')
      opt.value = song.id
      const artist = song.artist ? ` - ${song.artist}` : ''
      opt.textContent = `${song.title}${artist}`
      if (song.source === 'uploaded') opt.textContent += '  [uploaded]'
      if (song.available === false) opt.textContent += '  (file missing)'
      if (song.id === current) opt.selected = true
      ui.songSelect.appendChild(opt)
    }

    if (this.bundled.length) {
      const g = document.createElement('optgroup')
      g.label = 'TRACKS'
      for (const song of this.bundled) addOpt(song)
      ui.songSelect.appendChild(g)
    }

    if (this.uploaded.length) {
      const g = document.createElement('optgroup')
      g.label = 'YOUR UPLOADS'
      for (const song of this.uploaded) addOpt(song)
      ui.songSelect.appendChild(g)
    }

    // Keep the native control in sync with the model (a rebuild alone does not
    // always move the visible selection back).
    if (current) ui.songSelect.value = current

    this.renderInfo()
  },

  renderInfo() {
    const song = this.selected
    if (!song) {
      if (ui.songInfo) ui.songInfo.textContent = ''
      this.setStartEnabled(false)
      return
    }
    const bits = [song.title]
    if (song.artist) bits.push(song.artist)
    bits.push(song.source === 'uploaded' ? 'uploaded' : 'bundled')
    if (ui.songInfo) ui.songInfo.textContent = bits.join('  ·  ')

    const playable = this.isPlayable(song)
    this.setStartEnabled(playable)
    if (!playable) {
      this.setStatus(
        'This song file is missing. Pick another or upload an MP3.',
        'error',
      )
    }
  },

  setStartEnabled(enabled) {
    if (ui.startButton) ui.startButton.disabled = !enabled
    if (ui.previewButton) ui.previewButton.disabled = !enabled
  },

  async addFile(file) {
    if (!file) return { ok: false, message: 'No file selected.' }

    const isAudioType = file.type.startsWith('audio/')
    const isMp3Name = /\.(mp3|m4a|ogg|wav)$/i.test(file.name)
    if (!isAudioType && !isMp3Name) {
      return {
        ok: false,
        message: 'Please choose an audio file (MP3, M4A, OGG or WAV).',
      }
    }

    if (file.size > CONFIG.maxUploadBytes) {
      const maxMb = Math.round(CONFIG.maxUploadBytes / 1024 / 1024)
      const sizeMb = (file.size / 1024 / 1024).toFixed(1)
      return {
        ok: false,
        message: `File is ${sizeMb} MB — the limit is ${maxMb} MB.`,
      }
    }

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

  remove(song) {
    const index = this.uploaded.indexOf(song)
    if (index === -1) return
    this.uploaded.splice(index, 1)

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
    el.volume = typeof CONFIG.musicVolume === 'number' ? CONFIG.musicVolume : 0.8
    el.currentTime = 0

    this.previewEl = el

    el.play()
      .then(() => {
        ui.previewButton?.classList.add('playing')
        if (ui.previewButton) ui.previewButton.textContent = 'STOP'
        clearTimeout(this.previewTimer)
        this.previewTimer = setTimeout(
          () => this.stopPreview(),
          CONFIG.previewSeconds * 1000,
        )
      })
      .catch(() => {
        this.setStatus(
          'Could not play this song — the file may be missing.',
          'error',
        )
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

  setStatus(message, kind = 'info') {
    if (!ui.songStatus) return
    ui.songStatus.textContent = message
    ui.songStatus.dataset.kind = kind
  },

  clearStatus() {
    this.setStatus('', 'info')
  },
}
