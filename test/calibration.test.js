import { describe, it, expect } from 'vitest'
import { LatencyCalibrator } from '../src/audio/calibration.js'

describe('Latency Calibration Engine', () => {
  it('initializes with default settings', () => {
    const calib = new LatencyCalibrator({ bpm: 120 })
    expect(calib.bpm).toBe(120)
    expect(calib.interval).toBe(0.5) // 60 / 120
    expect(calib.maxTaps).toBe(16)
  })

  it('records taps and discards warmup taps in average calculation', () => {
    const calib = new LatencyCalibrator({ bpm: 120, maxTaps: 4 })
    calib.startTime = 0
    calib.nextBeatTime = 0.2
    calib.isRunning = true

    // Simulating tap: beat 0 is at 0.2s.
    // Tap 1 at 0.230s (+30ms) -> warmup 1
    // Tap 2 at 0.730s (+30ms) -> warmup 2
    // Tap 3 at 1.250s (+50ms) -> valid sample 1
    // Tap 4 at 1.750s (+50ms) -> valid sample 2
    // Expected average of valid samples: (50 + 50) / 2 = 50ms

    // Override performance.now to simulate timestamps
    const origNow = performance.now

    performance.now = () => 230
    calib.recordTap()

    performance.now = () => 730
    calib.recordTap()

    performance.now = () => 1250
    calib.recordTap()

    performance.now = () => 1750
    const res = calib.recordTap()

    performance.now = origNow

    expect(res.tapCount).toBe(4)
    expect(res.completed).toBe(true)
    expect(res.averageMs).toBe(50)
  })
})
