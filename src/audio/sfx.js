import { CONFIG } from '../config.js'

let audioCtx = null
let noiseBuffer = null

function getAudioContext() {
  if (!audioCtx && typeof window !== 'undefined') {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (Ctx) {
      audioCtx = new Ctx()
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {})
  }
  return audioCtx
}

function getNoiseBuffer(ctx) {
  if (!noiseBuffer && ctx) {
    const bufferSize = Math.floor(ctx.sampleRate * 0.05)
    noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
    const data = noiseBuffer.getChannelData(0)
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1
  }
  return noiseBuffer
}

/**
 * Woodblock-style hit. A short pitched body (two detuned sines, fast decay)
 * plus a tiny stick-attack noise burst on top. Dry, percussive, low — no
 * pitch sweep, which is what made the old click sound like a laser.
 */
export function playHit(grade = 'perfect') {
  if (CONFIG.sfxVolume <= 0) return
  const ctx = getAudioContext()
  if (!ctx) return

  const now = ctx.currentTime
  const master = ctx.createGain()
  master.gain.setValueAtTime(CONFIG.sfxVolume, now)
  master.connect(ctx.destination)

  if (grade === 'miss' || grade === 'bad') {
    // Dead low thud for a whiff.
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(120, now)
    osc.frequency.exponentialRampToValueAtTime(55, now + 0.07)
    gain.gain.setValueAtTime(0.35, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09)
    osc.connect(gain).connect(master)
    osc.start(now)
    osc.stop(now + 0.09)
    return
  }

  // Woodblock body frequency: perfect highest, ok lowest. Short enough
  // (<= 60 ms) to stay a click rather than a tone.
  const bodyFreq = grade === 'perfect' ? 880 : grade === 'good' ? 740 : 620
  const decay = grade === 'perfect' ? 0.055 : 0.045

  const osc1 = ctx.createOscillator()
  const osc2 = ctx.createOscillator()
  const bodyGain = ctx.createGain()
  osc1.type = 'sine'
  osc2.type = 'sine'
  osc1.frequency.setValueAtTime(bodyFreq, now)
  // Slight detune gives the woody, hollow quality of a woodblock.
  osc2.frequency.setValueAtTime(bodyFreq * 2.71, now)

  bodyGain.gain.setValueAtTime(0.001, now)
  bodyGain.gain.exponentialRampToValueAtTime(0.55, now + 0.002)
  bodyGain.gain.exponentialRampToValueAtTime(0.001, now + decay)

  osc1.connect(bodyGain)
  osc2.connect(bodyGain)
  bodyGain.connect(master)
  osc1.start(now)
  osc2.start(now)
  osc1.stop(now + decay)
  osc2.stop(now + decay)

  // Stick attack: a very short band-passed noise tick, not a whoosh.
  const noise = ctx.createBufferSource()
  noise.buffer = getNoiseBuffer(ctx)
  const band = ctx.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.setValueAtTime(3200, now)
  band.Q.setValueAtTime(1.2, now)
  const tick = ctx.createGain()
  tick.gain.setValueAtTime(0.18, now)
  tick.gain.exponentialRampToValueAtTime(0.001, now + 0.012)

  noise.connect(band).connect(tick).connect(master)
  noise.start(now)
  noise.stop(now + 0.012)
}

/** Calibration metronome click: pure, dull, short — easy to tap against. */
export function playBeep(accent = false) {
  if (CONFIG.sfxVolume <= 0) return
  const ctx = getAudioContext()
  if (!ctx) return

  const now = ctx.currentTime
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()

  osc.type = 'square'
  osc.frequency.setValueAtTime(accent ? 1500 : 1000, now)

  const vol = Math.min(1, CONFIG.sfxVolume * 0.55)
  gain.gain.setValueAtTime(vol, now)
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03)

  osc.connect(gain).connect(ctx.destination)
  osc.start(now)
  osc.stop(now + 0.03)
}

export function setSfxVolume(volume) {
  CONFIG.sfxVolume = Math.max(0, Math.min(1, volume))
}
