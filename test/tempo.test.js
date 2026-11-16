import { describe, it, expect } from 'vitest'
import { selectTempo } from '../src/chart/beatDetector.js'

/**
 * selectTempo picks the candidate whose grid the onsets fit best, rather than
 * the single strongest autocorrelation peak. These tests build synthetic onsets
 * on a known grid and check it recovers the right period even when a harmonic
 * candidate has a higher autocorrelation score.
 */

// Onsets every `beat` seconds from `offset`, with optional jitter (s).
function gridOnsets(beat, offset, count, jitter = 0) {
  const out = []
  for (let i = 0; i < count; i++) {
    const j = jitter ? (Math.random() - 0.5) * 2 * jitter : 0
    out.push(offset + i * beat + j)
  }
  return out
}

describe('selectTempo', () => {
  it('recovers the true period when onsets sit on its grid', () => {
    const beat = 0.5 // 120 BPM
    const onsets = gridOnsets(beat, 0.07, 60)

    // True tempo has a modest score; a half-tempo (1.0 s) harmonic and a
    // double-tempo (0.25 s) harmonic have HIGHER scores. Grid-fit must still
    // pick the 0.5 s grid because the onsets land on it.
    const candidates = [
      { lag: 100, score: 1.0 }, // 1.00 s (60 BPM) — strongest peak, wrong
      { lag: 25, score: 0.8 }, // 0.25 s (240 BPM) — dense, tempting
      { lag: 50, score: 0.3 }, // 0.50 s (120 BPM) — the truth
    ]
    const best = selectTempo(onsets, candidates)
    expect(best.beatInterval).toBeCloseTo(0.5, 2)
    expect(best.offset).toBeCloseTo(0.07, 1)
  })

  it('keeps the beat offset when the first beat is not at zero', () => {
    const beat = 0.4
    const onsets = gridOnsets(beat, 0.25, 50)
    const candidates = [{ lag: 40, score: 1 }] // 0.40 s
    const best = selectTempo(onsets, candidates)
    expect(best.beatInterval).toBeCloseTo(0.4, 2)
    expect(best.offset).toBeCloseTo(0.25, 1)
  })

  it('tolerates small human jitter without changing the period', () => {
    const beat = 0.789 // ~76 BPM ballad
    const onsets = gridOnsets(beat, 0.1, 80, 0.012) // ±12 ms
    const candidates = [
      { lag: 79, score: 0.6 }, // 0.79 s — true
      { lag: 40, score: 0.9 }, // 0.40 s — double time, stronger peak
    ]
    const best = selectTempo(onsets, candidates)
    expect(best.beatInterval).toBeCloseTo(0.79, 1)
  })

  it('handles missing onsets (dropped beats) on the true grid', () => {
    const beat = 0.5
    // Keep every 3rd beat — the grid is intact but sparse.
    const onsets = gridOnsets(beat, 0, 90).filter((_, i) => i % 3 === 0)
    const candidates = [
      { lag: 100, score: 1.0 }, // 1.0 s wrong
      { lag: 50, score: 0.2 }, // 0.5 s true
    ]
    const best = selectTempo(onsets, candidates)
    expect(best.beatInterval).toBeCloseTo(0.5, 2)
  })

  it('falls back safely with no data', () => {
    const best = selectTempo([], [])
    expect(best.beatInterval).toBeGreaterThan(0)
  })
})
