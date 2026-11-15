// Diagnostic runner for the drum chart pipeline. Runs in Node against a real
// MP3 using the same band/detect/quantize logic as src/chart/beatDetector.js,
// so chart problems (false hits, missed hits, off-grid notes) can be inspected
// without a browser.
//
//   node scripts/analyze-chart.mjs "public/songs/Avenged Sevenfold - So Far Away.mp3" easy
//
// Requires: nothing beyond Node (uses a WAV-free decode via a tiny mp3 decoder
// is not available), so this script expects a PCM WAV path instead. Convert
// once with: ffmpeg -i in.mp3 -ac 1 -ar 44100 out.wav

import fs from 'node:fs'

function readWav(file) {
  const buf = fs.readFileSync(file)
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Not a RIFF/WAVE file')
  }
  let offset = 12
  let fmt = null
  let data = null
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    const start = offset + 8
    if (id === 'fmt ') {
      fmt = {
        channels: buf.readUInt16LE(start + 2),
        sampleRate: buf.readUInt32LE(start + 4),
        bits: buf.readUInt16LE(start + 14),
      }
    } else if (id === 'data') {
      data = buf.subarray(start, start + size)
    }
    offset = start + size + (size % 2)
  }
  if (!fmt || !data) throw new Error('Missing fmt/data chunk')
  if (fmt.bits !== 16) throw new Error(`Expected 16-bit PCM, got ${fmt.bits}`)

  const frameCount = data.length / 2 / fmt.channels
  const mono = new Float32Array(frameCount)
  for (let i = 0; i < frameCount; i++) {
    let sum = 0
    for (let c = 0; c < fmt.channels; c++) {
      sum += data.readInt16LE((i * fmt.channels + c) * 2) / 32768
    }
    mono[i] = sum / fmt.channels
  }
  return { sampleRate: fmt.sampleRate, mono, duration: frameCount / fmt.sampleRate }
}

const MODES = {
  easy: { useHats: false, mergeWindow: 0.055, chartMinGap: 0.26 },
  hard: { useHats: true, mergeWindow: 0.055, chartMinGap: 0.14 },
}

const [file, modeArg = 'easy'] = process.argv.slice(2)
if (!file) {
  console.error('usage: node scripts/analyze-chart.mjs <file.wav> [easy|hard]')
  process.exit(1)
}
const preset = MODES[modeArg] ?? MODES.easy

const { sampleRate: sr, mono, duration } = readWav(file)
console.log(`Decoded ${file}: ${duration.toFixed(1)}s @ ${sr}Hz`)

const hop = Math.round(sr * 0.005)
const hopSec = hop / sr

const envelopeOf = (signal) => {
  const frames = Math.floor(signal.length / hop)
  const env = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    let sum = 0
    const start = i * hop
    for (let j = 0; j < hop; j++) sum += signal[start + j] * signal[start + j]
    env[i] = Math.sqrt(sum / hop)
  }
  return env
}

const biquad = (type, freq, q = 0.707) => {
  const w0 = (2 * Math.PI * freq) / sr
  const cos = Math.cos(w0)
  const alpha = Math.sin(w0) / (2 * q)
  let b0, b1, b2
  if (type === 'highpass') {
    b0 = (1 + cos) / 2
    b1 = -(1 + cos)
    b2 = (1 + cos) / 2
  } else {
    b0 = (1 - cos) / 2
    b1 = 1 - cos
    b2 = (1 - cos) / 2
  }
  const a0 = 1 + alpha
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 }
}

const applyBiquad = (input, c) => {
  const out = new Float32Array(input.length)
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let i = 0; i < input.length; i++) {
    const x = input[i]
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2
    x2 = x1; x1 = x; y2 = y1; y1 = y
    out[i] = y
  }
  return out
}

const bandEnvelope = (loHz, hiHz) =>
  envelopeOf(applyBiquad(applyBiquad(mono, biquad('highpass', loHz)), biquad('lowpass', hiHz)))

const kickEnv = bandEnvelope(40, 160)
const snareEnv = bandEnvelope(150, 500)
const hatEnv = bandEnvelope(6500, 9000)

const riseLag = Math.max(1, Math.round(0.02 / hopSec))
const dbRise = (env, i) => 20 * Math.log10((env[i] + 1e-9) / (env[i - riseLag] + 1e-9))

const detectBand = (env, minDb, minLevel) => {
  const found = []
  for (let i = riseLag + 2; i < env.length - 2; i++) {
    if (env[i] < minLevel) continue
    if (env[i] <= env[i - 1] || env[i] <= env[i + 1]) continue
    if (dbRise(env, i) < minDb) continue
    found.push({ index: i, time: i * hopSec, strength: env[i], rise: dbRise(env, i) })
  }
  const merged = []
  for (const hit of found) {
    const last = merged[merged.length - 1]
    if (last && hit.time - last.time < 0.06) {
      if (hit.strength > last.strength) {
        last.index = hit.index; last.time = hit.time; last.strength = hit.strength; last.rise = hit.rise
      }
      continue
    }
    merged.push(hit)
  }
  return merged
}

const percentile = (env, p) => {
  const sorted = Float32Array.from(env).sort()
  return sorted[Math.floor(sorted.length * p)] || 0
}
const kickRef = percentile(kickEnv, 0.9)
const snareRef = percentile(snareEnv, 0.9)
const hatRef = percentile(hatEnv, 0.9)

const kickHits = detectBand(kickEnv, 7, Math.max(0.004, kickRef * 0.06))
const snareHits = detectBand(snareEnv, 7, Math.max(0.003, snareRef * 0.06))
const hatHits = preset.useHats ? detectBand(hatEnv, 7, Math.max(0.002, hatRef * 0.06)) : []

console.log(`kick: ${kickHits.length}  snare: ${snareHits.length}  hat: ${hatHits.length}`)

const hits = [
  ...kickHits.map((h) => ({ ...h, type: 'kick' })),
  ...snareHits.map((h) => ({ ...h, type: 'snare' })),
  ...hatHits.map((h) => ({ ...h, type: 'hat' })),
].sort((a, b) => a.time - b.time)

const merged = []
for (const hit of hits) {
  const last = merged[merged.length - 1]
  if (last && hit.time - last.time < preset.mergeWindow) {
    if (hit.strength > last.strength) {
      last.time = hit.time; last.strength = hit.strength; last.type = hit.type
    }
    continue
  }
  merged.push({ ...hit })
}

// Tempo (mirrors analyse()).
const tempoHop = Math.round(sr * 0.01)
const tempoFrames = Math.floor(mono.length / tempoHop)
const rms = new Float32Array(tempoFrames)
for (let i = 0; i < tempoFrames; i++) {
  let sum = 0
  const start = i * tempoHop
  for (let j = 0; j < tempoHop; j++) sum += mono[start + j] * mono[start + j]
  rms[i] = Math.sqrt(sum / tempoHop)
}
const flux = new Float32Array(tempoFrames)
for (let i = 1; i < tempoFrames; i++) {
  const d = rms[i] - rms[i - 1]
  flux[i] = d > 0 ? d : 0
}
const onset = new Float32Array(tempoFrames)
const win = 50
for (let i = 0; i < tempoFrames; i++) {
  let sum = 0, count = 0
  for (let k = -win; k <= win; k++) {
    const idx = i + k
    if (idx >= 0 && idx < tempoFrames) { sum += flux[idx]; count++ }
  }
  onset[i] = flux[i] - sum / count
}
const MIN_LAG = Math.round(60 / 200 / 0.01) // 0.30 s
const MAX_LAG = Math.round(60 / 60 / 0.01) // 1.00 s
const autocorr = new Float64Array(MAX_LAG + 1)
for (let lag = MIN_LAG; lag <= MAX_LAG; lag++) {
  let sum = 0
  for (let i = 0; i + lag < tempoFrames; i++) sum += onset[i] * onset[i + lag]
  autocorr[lag] = sum / (tempoFrames - lag)
}
let bestLag = MIN_LAG, bestScore = -Infinity
for (let lag = MIN_LAG + 1; lag < MAX_LAG; lag++) {
  const isPeak = autocorr[lag] > autocorr[lag - 1] && autocorr[lag] >= autocorr[lag + 1]
  if (!isPeak || autocorr[lag] <= 0) continue
  if (autocorr[lag] > bestScore) { bestScore = autocorr[lag]; bestLag = lag }
}
const beatInterval = bestLag * 0.01
const bpm = 60 / beatInterval

let onsetPeak = 0
for (let i = 1; i < tempoFrames; i++) if (onset[i] > onsetPeak) onsetPeak = onset[i]
const onsets = []
const onsetThreshold = onsetPeak * 0.25
for (let i = 1; i < tempoFrames; i++) if (onset[i] >= onsetThreshold) onsets.push(i * 0.01)
let bestOffset = 0, bestHits = -1
const tolerance = Math.min(0.05, beatInterval * 0.12)
for (let offset = 0; offset < beatInterval; offset += 0.005) {
  let h = 0
  for (const t of onsets) {
    const phase = (((t - offset) % beatInterval) + beatInterval) % beatInterval
    if (Math.min(phase, beatInterval - phase) < tolerance) h++
  }
  if (h > bestHits) { bestHits = h; bestOffset = offset }
}
console.log(`tempo: ${bpm.toFixed(1)} BPM, beat ${beatInterval.toFixed(4)}s, offset ${bestOffset.toFixed(3)}s`)

const isSlow = 60 / beatInterval < 100
const snapGrid = isSlow ? beatInterval : beatInterval / 2
const snapTolerance = snapGrid * 0.42
const quantize = (time) => {
  const rel = time - bestOffset
  const snapped = bestOffset + Math.round(rel / snapGrid) * snapGrid
  return Math.abs(snapped - time) <= snapTolerance ? snapped : null
}

const toGrid = (list) => {
  const out = []
  for (const hit of list) {
    const snapped = quantize(hit.time)
    if (snapped === null) continue
    const last = out[out.length - 1]
    if (last && snapped - last.time < preset.mergeWindow) {
      if (hit.strength > last.strength) {
        last.time = snapped; last.strength = hit.strength; last.type = hit.type
      }
      continue
    }
    out.push({ ...hit, time: snapped })
  }
  return out
}

const onGrid = toGrid(merged)

const chart = []
for (const hit of onGrid) {
  const last = chart[chart.length - 1]
  if (last && hit.time - last.time < preset.chartMinGap) continue
  chart.push(hit)
}

console.log(`\nchart (${modeArg}): ${chart.length} notes, ${(chart.length / (duration / 60)).toFixed(0)}/min`)

// Report how far each note moved, and any notes that were NOT snapped but
// landed far from the grid — those are the "doesn't match the beat" ones.
console.log('\ntime     type   strength  moved(ms)  distToGrid(ms)')
for (const [i, hit] of chart.slice(0, 60).entries()) {
  const raw = merged.find((m) => Math.abs(m.time - hit.time) < 0.12)
  const movedMs = raw ? (hit.time - raw.time) * 1000 : 0
  const rel = hit.time - bestOffset
  const nearest = Math.round(rel / snapGrid) * snapGrid + bestOffset
  const distMs = (hit.time - nearest) * 1000
  console.log(
    `${hit.time.toFixed(3).padStart(7)}  ${hit.type.padEnd(5)}  ${hit.strength.toFixed(4)}   ${movedMs.toFixed(0).padStart(6)}   ${distMs.toFixed(0).padStart(6)}` +
      (Math.abs(distMs) > 1 ? '   <-- OFF GRID' : ''),
  )
  if (i === 59) {
    console.log('... (truncated; first 60 notes shown)')
    break
  }
}
