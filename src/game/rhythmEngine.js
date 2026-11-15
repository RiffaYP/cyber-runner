import { CONFIG, activeNoteSpeed } from '../config.js'

export const rhythm = {
  startTime: 0,
  beatIndex: 0,
  isRunning: false,
  beatInterval: 60 / CONFIG.bpm,
  offset: 0,
  times: [],
  cursor: 0,
  finished: false,

  configure({ beatInterval, offset }) {
    this.beatInterval = beatInterval
    this.offset = offset
  },

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

  update(audioTime, onNote) {
    if (!this.isRunning || audioTime === null) return 0
    if (this.cursor >= this.times.length) {
      this.finished = true
      return 0
    }

    let emitted = 0
    const travel = Math.abs(CONFIG.spawnZ - CONFIG.hitLineZ) / activeNoteSpeed()

    while (this.cursor < this.times.length) {
      const hitTime = this.times[this.cursor]
      const spawnAt = hitTime - travel

      if (audioTime < spawnAt) break

      if (audioTime > hitTime + CONFIG.judge.ok) {
        this.cursor += 1
        continue
      }

      this.cursor += 1
      this.beatIndex += 1
      onNote(this.beatIndex, hitTime)
      emitted += 1
      if (emitted > 8) break
    }
    return emitted
  },

  stop() {
    this.isRunning = false
  },
}
