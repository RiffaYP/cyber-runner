import { playBeep } from './sfx.js'

export class LatencyCalibrator {
  constructor(options = {}) {
    this.bpm = options.bpm || 120
    this.interval = 60 / this.bpm // seconds per beat
    this.maxTaps = options.maxTaps || 16
    this.minWarmupTaps = 2

    this.isRunning = false
    this.startTime = 0
    this.nextBeatTime = 0
    this.beatIndex = 0
    this.timerId = null

    this.samples = [] // array of offsets in seconds
    this.onBeat = options.onBeat || null
    this.onTapRecorded = options.onTapRecorded || null
    this.onComplete = options.onComplete || null
  }

  start() {
    this.stop()
    this.isRunning = true
    this.samples = []
    this.beatIndex = 0
    this.startTime = performance.now() / 1000
    this.nextBeatTime = this.startTime + 0.2 // slight lead-in

    this.scheduleLoop()
  }

  stop() {
    this.isRunning = false
    if (this.timerId) {
      clearTimeout(this.timerId)
      this.timerId = null
    }
  }

  scheduleLoop() {
    if (!this.isRunning) return

    const now = performance.now() / 1000
    while (this.nextBeatTime <= now + 0.05) {
      const isAccent = this.beatIndex % 4 === 0
      playBeep(isAccent)

      if (this.onBeat) {
        this.onBeat(this.beatIndex, isAccent)
      }

      this.beatIndex++
      this.nextBeatTime += this.interval
    }

    const delay = Math.max(5, (this.nextBeatTime - now) * 1000 - 20)
    this.timerId = setTimeout(() => this.scheduleLoop(), delay)
  }

  recordTap() {
    if (!this.isRunning) return null

    const tapTime = performance.now() / 1000
    // Find closest beat
    const timeSinceStart = tapTime - (this.startTime + 0.2)
    const closestBeatNumber = Math.round(timeSinceStart / this.interval)
    const closestBeatTime = this.startTime + 0.2 + closestBeatNumber * this.interval

    const delta = tapTime - closestBeatTime // positive = tapped late

    // Ignore taps that are off by more than half an interval (mis-tap)
    if (Math.abs(delta) > this.interval * 0.5) {
      return null
    }

    this.samples.push(delta)

    const validSamples = this.samples.slice(this.minWarmupTaps)
    let averageMs = 0
    if (validSamples.length > 0) {
      const sum = validSamples.reduce((acc, v) => acc + v, 0)
      averageMs = Math.round((sum / validSamples.length) * 1000)
    }

    const result = {
      tapCount: this.samples.length,
      maxTaps: this.maxTaps,
      lastDeltaMs: Math.round(delta * 1000),
      averageMs,
      completed: this.samples.length >= this.maxTaps,
    }

    if (this.onTapRecorded) {
      this.onTapRecorded(result)
    }

    if (result.completed) {
      this.stop()
      if (this.onComplete) {
        this.onComplete(averageMs)
      }
    }

    return result
  }
}
