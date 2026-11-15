import { describe, it, expect } from 'vitest'

const JUDGE = {
  perfect: 0.055,
  good: 0.11,
  ok: 0.2,
}

function judgeTiming(absError, config = JUDGE) {
  if (absError <= config.perfect) return 'perfect'
  if (absError <= config.good) return 'good'
  if (absError <= config.ok) return 'ok'
  return null
}

function calculateScore(baseScore, combo) {
  const multiplier = 1 + Math.min(combo, 20) * 0.05
  return Math.round(baseScore * multiplier)
}

describe('Rhythm Judgment & Scoring', () => {
  it('judges timing correctly across windows', () => {
    expect(judgeTiming(0.02)).toBe('perfect')
    expect(judgeTiming(0.055)).toBe('perfect')
    expect(judgeTiming(0.056)).toBe('good')
    expect(judgeTiming(0.11)).toBe('good')
    expect(judgeTiming(0.111)).toBe('ok')
    expect(judgeTiming(0.2)).toBe('ok')
    expect(judgeTiming(0.201)).toBeNull()
  })

  it('calculates score with combo multiplier capped at 20 combo', () => {
    expect(calculateScore(150, 0)).toBe(150)
    expect(calculateScore(150, 10)).toBe(225) // 150 * 1.5
    expect(calculateScore(150, 20)).toBe(300) // 150 * 2.0
    expect(calculateScore(150, 50)).toBe(300) // capped at 2.0
  })
})
