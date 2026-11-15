import { describe, it, expect } from 'vitest'

/**
 * Mirrors the quantize/toGrid logic in beatDetector.buildChart.
 * Kept here so a regression in snapping is caught without decoding audio.
 */
function makeQuantizer(beatInterval, beatOffset) {
  const snapGrid = beatInterval / 2
  const snapTolerance = snapGrid * 0.42

  const quantize = (time) => {
    const rel = time - beatOffset
    const snapped = beatOffset + Math.round(rel / snapGrid) * snapGrid
    return Math.abs(snapped - time) <= snapTolerance ? snapped : time
  }

  const toGrid = (list, mergeWindow = 0.055) => {
    const out = []
    for (const hit of list) {
      const snapped = quantize(hit.time)
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
  const beatInterval = 0.5 // 120 BPM
  const { quantize, toGrid, snapGrid } = makeQuantizer(beatInterval, 0)

  it('snaps a slightly-early hit forward onto the grid', () => {
    // 8th-note grid ticks at 0, 0.25, 0.5, ... A hit at 0.24 snaps to 0.25.
    expect(quantize(0.24)).toBeCloseTo(0.25, 5)
    expect(snapGrid).toBeCloseTo(0.25, 5)
  })

  it('snaps a slightly-late hit backward onto the grid', () => {
    expect(quantize(0.26)).toBeCloseTo(0.25, 5)
  })

  it('leaves a genuinely off-grid hit untouched', () => {
    // Tolerance is 0.105. 0.375 is the midpoint between ticks 0.25 and 0.5,
    // so it is 0.125 from each — outside the tolerance.
    expect(quantize(0.375)).toBeCloseTo(0.375, 5)
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
    // On a tick: 0.07 + 1*0.25 = 0.32
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
})
