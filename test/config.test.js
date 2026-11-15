import { describe, it, expect } from 'vitest'
import { CONFIG, MODIFIERS, mirrorLane, activeNoteSpeed } from '../src/config.js'

describe('Config and Modifier Utilities', () => {
  it('normalizes song URLs properly', () => {
    const url = "/songs/Oasis - Don't Look Back In Anger.mp3"
    const normalized = CONFIG.normalizeSongUrl(url)
    expect(normalized).toBe("/songs/Oasis%20-%20Don't%20Look%20Back%20In%20Anger.mp3")
  })

  it('mirrors lanes correctly based on modifier state', () => {
    MODIFIERS.mirror = false
    expect(mirrorLane(0)).toBe(0)
    expect(mirrorLane(1)).toBe(1)
    expect(mirrorLane(2)).toBe(2)
    expect(mirrorLane(3)).toBe(3)

    MODIFIERS.mirror = true
    expect(mirrorLane(0)).toBe(3)
    expect(mirrorLane(1)).toBe(2)
    expect(mirrorLane(2)).toBe(1)
    expect(mirrorLane(3)).toBe(0)

    MODIFIERS.mirror = false
  })

  it('multiplies active note speed by speed modifier', () => {
    MODIFIERS.speed = 1
    expect(activeNoteSpeed()).toBe(CONFIG.noteSpeed)

    MODIFIERS.speed = 1.5
    expect(activeNoteSpeed()).toBe(CONFIG.noteSpeed * 1.5)

    MODIFIERS.speed = 2
    expect(activeNoteSpeed()).toBe(CONFIG.noteSpeed * 2)

    MODIFIERS.speed = 1
  })
})
