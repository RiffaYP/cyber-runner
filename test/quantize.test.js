import { describe, it, expect } from 'vitest'

/**
 * Mirrors the quantize/toGrid logic in beatDetector.buildChart.
 * Kept here so a regression in snapping is caught without decoding audio.
 *
 * Snapping is now CONSERVATIVE: a hit is only moved onto the grid when it is
 * already within a small, capped tolerance of a tick. A genuinely off-grid hit
 * keeps its real drum time (hard) or is dropped (easy), decided by dropOffGrid.
 */
function makeQuantizer(beatInterval, beatOffset, beatBpm, dropOffGrid = false) {
  const isSlow = (beatBpm ?? 60 / beatInterval) < 100
  const snapGrid = isSlow ? beatInterval : beatInterval / 2
  const snapTolerance = Math.min(snapGrid * 0.2, 0.06)

  const quantize = (time) => {
    const rel = time - beatOffset
    const snapped = beatOffset + Math.round(rel / snapGrid) * snapGrid
    if (Math.abs(snapped - time) <= snapTolerance) return snapped
    return dropOffGrid ? null : time
  }

  const toGrid = (list, mergeWindow = 0.055) => {
    const out = []
    for (const hit of list) {
      const snapped = quantize(hit.time)
      if (snapped === null) continue
      const last = out[out.length - 1]
      if (last && snapped - last.time < mergeWindow) {
        if (hit.strength > last.strength) {
          last.time = snapped
          last.strength = hit.strength
          last.type = hit.type
        }
        continue
      }
      out.push({ ...hit, time: snapped })
    }
    return out
  }

  return { quantize, toGrid, snapGrid, snapTolerance }
}

describe('Chart quantization (conservative snap)', () => {
  // 120 BPM: not slow, so an 8th-note grid (0.25 s). Capped snap tol 60 ms.
  const beatInterval = 0.5
  const { quantize, toGrid, snapGrid, snapTolerance } = makeQuantizer(beatInterval, 0)

  it('keeps an 8th-note grid at 120 BPM with a capped snap tolerance', () => {
    expect(snapGrid).toBeCloseTo(0.25, 5)
    expect(snapTolerance).toBeCloseTo(0.05, 5) // min(0.25*0.2, 0.06) = 0.05
  })

  it('snaps a hit that is already close to a tick', () => {
    expect(quantize(0.24)).toBeCloseTo(0.25, 5) // 10 ms away
    expect(quantize(0.26)).toBeCloseTo(0.25, 5)
  })

  it('leaves a genuinely off-grid hit at its real time (hard keeps drum)', () => {
    // 0.375 is 125 ms from either tick -> beyond tolerance -> kept as-is.
    expect(quantize(0.375)).toBeCloseTo(0.375, 5)
  })

  it('drops a genuinely off-grid hit when dropOffGrid is set (easy)', () => {
    const easy = makeQuantizer(beatInterval, 0, 120, true)
    expect(easy.quantize(0.375)).toBeNull()
  })

  it('exactly-on-grid hits stay put', () => {
    expect(quantize(0.5)).toBeCloseTo(0.5, 5)
    expect(quantize(0)).toBeCloseTo(0, 5)
  })

  it('respects the beat offset (first beat not at 0)', () => {
    const offset = 0.07
    const q = makeQuantizer(beatInterval, offset)
    // Ticks at 0.07, 0.32, 0.57, ... A hit at 0.10 (30 ms from 0.07) snaps.
    expect(q.quantize(0.1)).toBeCloseTo(0.07, 5)
    expect(q.quantize(0.32)).toBeCloseTo(0.32, 5)
  })

  it('collapses two hits snapped onto the same slot, keeping the stronger', () => {
    const hits = [
      { time: 0.24, strength: 0.5, type: 'kick' },
      { time: 0.26, strength: 0.9, type: 'snare' },
    ]
    const out = toGrid(hits)
    expect(out).toHaveLength(1)
    expect(out[0].time).toBeCloseTo(0.25, 5)
    expect(out[0].strength).toBe(0.9)
    expect(out[0].type).toBe('snare')
  })

  it('keeps off-grid hits at their drum time when dropOffGrid is off', () => {
    const hits = [
      { time: 0.25, strength: 0.9, type: 'kick' },
      { time: 0.375, strength: 0.9, type: 'snare' }, // off-grid, kept as-is
      { time: 0.5, strength: 0.9, type: 'kick' },
    ]
    const out = toGrid(hits)
    expect(out.map((h) => Math.round(h.time * 1000))).toEqual([250, 375, 500])
  })
})

describe('Adaptive grid density', () => {
  it('uses a quarter-note grid on a slow ballad (76 BPM)', () => {
    const beat = 60 / 76 // ~0.789 s
    const { snapGrid } = makeQuantizer(beat, 0, 76)
    expect(snapGrid).toBeCloseTo(beat, 6)
  })

  it('uses an 8th-note grid on a fast track (150 BPM)', () => {
    const beat = 60 / 150 // 0.4 s
    const { snapGrid } = makeQuantizer(beat, 0, 150)
    expect(snapGrid).toBeCloseTo(beat / 2, 6)
  })
})
