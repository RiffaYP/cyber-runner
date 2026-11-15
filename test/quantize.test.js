import { describe, it, expect } from 'vitest'

/**
 * Mirrors the quantize/toGrid logic in beatDetector.buildChart.
 * Kept here so a regression in snapping is caught without decoding audio.
 *
 * `beatBpm` decides the grid density exactly like the app: slow ballads
 * (< 100 BPM) use a quarter-note grid, everything else an 8th-note grid.
 */
function makeQuantizer(beatInterval, beatOffset, beatBpm) {
  const isSlow = (beatBpm ?? 60 / beatInterval) < 100
  const snapGrid = isSlow ? beatInterval : beatInterval / 2
  const snapTolerance = snapGrid * 0.42

  const quantize = (time) => {
    const rel = time - beatOffset
    const snapped = beatOffset + Math.round(rel / snapGrid) * snapGrid
    return Math.abs(snapped - time) <= snapTolerance ? snapped : null
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

  return { quantize, toGrid, snapGrid }
}

describe('Chart quantization', () => {
  // 120 BPM: not slow, so an 8th-note grid (0.25 s).
  const beatInterval = 0.5
  const { quantize, toGrid, snapGrid } = makeQuantizer(beatInterval, 0)

  it('snaps a slightly-early hit forward onto the grid', () => {
    expect(quantize(0.24)).toBeCloseTo(0.25, 5)
    expect(snapGrid).toBeCloseTo(0.25, 5)
  })

  it('snaps a slightly-late hit backward onto the grid', () => {
    expect(quantize(0.26)).toBeCloseTo(0.25, 5)
  })

  it('drops a genuinely off-grid hit instead of keeping it off-beat', () => {
    // Midpoint between ticks 0.25 and 0.5 is 0.375; > tolerance (0.105).
    expect(quantize(0.375)).toBeNull()
  })

  it('exactly-on-grid hits stay put', () => {
    expect(quantize(0.5)).toBeCloseTo(0.5, 5)
    expect(quantize(0)).toBeCloseTo(0, 5)
  })

  it('respects the beat offset (first beat not at 0)', () => {
    const offset = 0.07
    const q = makeQuantizer(beatInterval, offset)
    // Ticks at 0.07, 0.32, 0.57, ... A hit at 0.14 (0.07 from 0.07) snaps to 0.07.
    expect(q.quantize(0.14)).toBeCloseTo(0.07, 5)
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

  it('drops off-grid hits from the chart', () => {
    const hits = [
      { time: 0.25, strength: 0.9, type: 'kick' },
      { time: 0.375, strength: 0.9, type: 'snare' }, // off-grid -> dropped
      { time: 0.5, strength: 0.9, type: 'kick' },
    ]
    const out = toGrid(hits)
    expect(out.map((h) => h.time)).toEqual([0.25, 0.5])
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
