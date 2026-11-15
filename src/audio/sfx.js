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
    const bufferSize = ctx.sampleRate * 0.05 // 50ms of white noise
    noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
    const data = noiseBuffer.getChannelData(0)
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1
    }
  }
  return noiseBuffer
}

export function playHit(grade = 'perfect') {
  if (CONFIG.sfxVolume <= 0) return
  const ctx = getAudioContext()
  if (!ctx) return

  const now = ctx.currentTime
  const masterGain = ctx.createGain()
  masterGain.gain.setValueAtTime(CONFIG.sfxVolume, now)
  masterGain.connect(ctx.destination)

  if (grade === 'miss' || grade === 'bad') {
    // Low dull thud
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = 'sine'
    osc.frequency.setValueAtTime(140, now)
    osc.frequency.exponentialRampToValueAtTime(50, now + 0.08)

    gain.gain.setValueAtTime(0.4, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08)

    osc.connect(gain)
    gain.connect(masterGain)

    osc.start(now)
    osc.stop(now + 0.08)
    return
  }

  // Pitch settings for hit sound
  let freq = 1100
  let gainLevel = 0.6
  if (grade === 'good') {
    freq = 900
    gainLevel = 0.5
  } else if (grade === 'ok') {
    freq = 750
    gainLevel = 0.4
  }

  // 1. Tonal click (woodblock/rimshot harmonic)
  const osc = ctx.createOscillator()
  const oscGain = ctx.createGain()
  osc.type = 'triangle'
  osc.frequency.setValueAtTime(freq, now)
  osc.frequency.exponentialRampToValueAtTime(freq * 0.4, now + 0.04)

  oscGain.gain.setValueAtTime(gainLevel, now)
  oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.045)

  osc.connect(oscGain)
  oscGain.connect(masterGain)

  osc.start(now)
  osc.stop(now + 0.045)

  // 2. High-frequency noise snap (crisp acoustic click)
  const noise = ctx.createBufferSource()
  noise.buffer = getNoiseBuffer(ctx)

  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.setValueAtTime(2500, now)
  filter.Q.setValueAtTime(1.5, now)

  const noiseGain = ctx.createGain()
  noiseGain.gain.setValueAtTime(gainLevel * 0.7, now)
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.035)

  noise.connect(filter)
  filter.connect(noiseGain)
  noiseGain.connect(masterGain)

  noise.start(now)
  noise.stop(now + 0.035)
}

export function playBeep(accent = false) {
  if (CONFIG.sfxVolume <= 0) return
  const ctx = getAudioContext()
  if (!ctx) return

  const now = ctx.currentTime
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()

  osc.type = 'sine'
  osc.frequency.setValueAtTime(accent ? 900 : 600, now)

  const vol = Math.min(1, CONFIG.sfxVolume * 0.8)
  gain.gain.setValueAtTime(vol, now)
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04)

  osc.connect(gain)
  gain.connect(ctx.destination)

  osc.start(now)
  osc.stop(now + 0.04)
}

export function setSfxVolume(volume) {
  CONFIG.sfxVolume = Math.max(0, Math.min(1, volume))
}
