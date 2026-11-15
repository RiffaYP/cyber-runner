import { CONFIG } from '../config.js'

export const audio = {
  el: null,
  url: null,
  onEnded: null,

  ensure(url) {
    if (!url) url = this.url
    if (!url) throw new Error('audio.ensure() called without a song URL')

    if (!this.el || this.url !== url) {
      if (this.el) {
        this.el.pause()
        this.el.removeAttribute('src')
        this.el.load()
      }
      this.el = new Audio(url)
      this.el.preload = 'auto'
      this.el.loop = false
      this.el.volume = typeof CONFIG.musicVolume === 'number' ? CONFIG.musicVolume : 0.8
      this.el.addEventListener('ended', () => {
        if (typeof this.onEnded === 'function') {
          this.onEnded()
        }
      })
      this.url = url
    }
    this.el.volume = typeof CONFIG.musicVolume === 'number' ? CONFIG.musicVolume : 0.8
    return this.el
  },

  setVolume(vol) {
    CONFIG.musicVolume = Math.max(0, Math.min(1, vol))
    if (this.el) {
      this.el.volume = CONFIG.musicVolume
    }
  },

  async play(url) {
    const el = this.ensure(url)
    await el.play()
  },

  async restart(url) {
    const el = this.ensure(url)
    el.pause()
    el.currentTime = 0
    await el.play()
  },

  async prime(url) {
    const el = this.ensure(url)
    el.currentTime = 0
    try {
      await el.play()
    } catch {
      console.warn('[cyber-runner] Audio could not be unlocked.')
      return
    }
    el.pause()
    el.currentTime = 0
  },

  startFromBeginning(url) {
    const el = this.ensure(url)
    el.currentTime = 0
    return el.play().catch(() => {
      console.warn('[cyber-runner] Audio could not start.')
    })
  },

  pause() {
    if (this.el) this.el.pause()
  },

  resume() {
    if (!this.el) return
    this.el.play().catch(() => {
      console.warn('[cyber-runner] Could not resume audio.')
    })
  },

  getTime() {
    if (!this.el || this.el.paused) return null
    return this.el.currentTime - CONFIG.audioOffset
  },
}
