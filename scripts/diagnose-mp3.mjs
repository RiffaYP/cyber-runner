// Drum-chart diagnostic for a real MP3, no external tools.
//
// Decodes the MP3 in pure JS (mpg123 WASM), then runs the SAME tempo + band +
// quantize pipeline as src/chart/beatDetector.js so chart problems (wrong BPM,
// off-grid notes, notes away from the real drum) can be inspected offline:
//
//   node scripts/diagnose-mp3.mjs "public/songs/<song>.mp3" [easy|hard]
//
// It prints:
//   - detected tempo and the top autocorrelation candidates with their scores
//   - a grid-fit score (how many onsets land on each candidate's grid)
//   - per-band hit counts
//   - note-vs-nearest-real-drum drift, so "note doesn't match the drum" is
//     measurable instead of guessed.
//
// Requires the optional dev dependency `mpg123-decoder`:
//   npm i -D mpg123-decoder

import fs from 'node:fs'
import path from 'node:path'

let MPEGDecoder
try {
  ;({ MPEGDecoder } = await import('mpg123-decoder'))
} catch {
  console.error(
    'Missing dependency. Install it with:  npm i -D mpg123-decoder',
  )
  process.exit(1)
}

const MODES = {
  easy: { useHats: false, mergeWindow: 0.055, chartMinGap: 0.26, dropOffGrid: true },
  hard: { useHats: true, mergeWindow: 0.055, chartMinGap: 0.14, dropOffGrid: false },
}

const [file, modeArg = 'easy'] = process.argv.slice(2)
if (!file) {
  console.error('usage: node scripts/diagnose-mp3.mjs <file.mp3> [easy|hard]')
  process.exit(1)
}
const preset = MODES[modeArg] ?? MODES.easy

async function decodeMp3(file) {
  const buf = fs.readFileSync(file)
  const decoder = new MPEGDecoder()
  await decoder.ready
  const { channelData, samplesDecoded, sampleRate } = decoder.decode(
    new Uint8Array(buf),
  )
  decoder.free()
  const left = channelData[0]
  const right = channelData[1] ?? left
  const mono = new Float32Array(samplesDecoded)
  for (let i = 0; i < samplesDecoded; i++) mono[i] = (left[i] + right[i]) * 0.5
  return { sr: sampleRate, mono, duration: samplesDecoded / sampleRate }
}

const { sr, mono, duration } = await decodeMp3(file)
console.log(
  `Decoded ${path.basename(file)}: ${duration.toFixed(1)}s @ ${sr}Hz\n`,
)

// ---------------------------------------------------------------------------
// Tempo (mirrors analyse(), plus candidates + parabolic interpolation)
// ---------------------------------------------------------------------------
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
const onsetTempo = new Float32Array(tempoFrames)
const win = 50
for (let i = 0; i < tempoFrames; i++) {
  let sum = 0
  let count = 0
  for (let k = -win; k <= win; k++) {
    const idx = i + k
    if (idx >= 0 && idx < tempoFrames) {
      sum += flux[idx]
      count++
    }
  }
  onsetTempo[i] = flux[i] - sum / count
}

const MIN_LAG = Math.round(60 / 200 / 0.01) // 0.30 s (200 BPM)
const MAX_LAG = Math.round(60 / 60 / 0.01) // 1.00 s (60 BPM)
const autocorr = new Float64Array(MAX_LAG + 2)
for (let lag = MIN_LAG; lag <= MAX_LAG; lag++) {
  let sum = 0
  for (let i = 0; i + lag < tempoFrames; i++) sum += onsetTempo[i] * onsetTempo[i + lag]
  autocorr[lag] = sum / (tempoFrames - lag)
}

// Collect every local peak so we can compare candidates instead of trusting the
// single strongest one.
const peaks = []
for (let lag = MIN_LAG + 1; lag < MAX_LAG; lag++) {
  const isPeak = autocorr[lag] > autocorr[lag - 1] && autocorr[lag] >= autocorr[lag + 1]
  if (!isPeak || autocorr[lag] <= 0) continue
  peaks.push({ lag, score: autocorr[lag] })
}
peaks.sort((a, b) => b.score - a.score)
const topPeaks = peaks.slice(0, 6)

function parabolicLag(lag) {
  const y0 = autocorr[lag - 1]
  const y1 = autocorr[lag]
  const y2 = autocorr[lag + 1]
  const denom = y0 - 2 * y1 + y2
  const delta = denom === 0 ? 0 : (0.5 * (y0 - y2)) / denom
  return lag + Math.max(-0.5, Math.min(0.5, delta))
}

function gridFit(beatInterval, onsetTimes) {
  // Best phase for this interval, then the fraction of onsets that land on it.
  const tolerance = Math.min(0.05, beatInterval * 0.12)
  let bestOffset = 0
  let bestHits = -1
  for (let offset = 0; offset < beatInterval; offset += 0.005) {
    let hits = 0
    for (const t of onsetTimes) {
      const phase = ((((t - offset) % beatInterval) + beatInterval) % beatInterval)
      if (Math.min(phase, beatInterval - phase) < tolerance) hits++
    }
    if (hits > bestHits) {
      bestHits = hits
      bestOffset = offset
    }
  }
  return { offset: bestOffset, hits: bestHits, total: onsetTimes.length }
}

let onsetPeak = 0
for (let i = 1; i < tempoFrames; i++) if (onsetTempo[i] > onsetPeak) onsetPeak = onsetTempo[i]
const onsetTimes = []
const onsetThreshold = onsetPeak * 0.25
for (let i = 1; i < tempoFrames; i++) if (onsetTempo[i] >= onsetThreshold) onsetTimes.push(i * 0.01)

console.log('Tempo candidates (autocorrelation peaks):')
console.log('  BPM      lag(s)   score     grid-fit')
for (const p of topPeaks) {
  const fineLag = parabolicLag(p.lag)
  const bi = fineLag * 0.01
  const fit = gridFit(bi, onsetTimes, 0.05)
  console.log(
    `  ${(60 / bi).toFixed(2).padStart(6)}  ${bi.toFixed(4).padStart(7)}  ${p.score.toFixed(5).padStart(8)}  ` +
      `${((fit.hits / fit.total) * 100).toFixed(1)}%  (offset ${fit.offset.toFixed(3)})`,
  )
}

// Choose the candidate whose grid the onsets cluster on most tightly (mirrors
// analyse()). Mean distance from each onset to its nearest tick, normalised by
// tick spacing so a dense grid cannot win just by having more slots.
function meanGridDistance(beatInterval, offset, onsetTimes) {
  let sum = 0
  for (const t of onsetTimes) {
    const phase = (((t - offset) % beatInterval) + beatInterval) % beatInterval
    sum += Math.min(phase, beatInterval - phase)
  }
  return sum / onsetTimes.length
}
let chosen = null
const maxScore = peaks.reduce((m, p) => Math.max(m, p.score), 0) || 1
for (const p of peaks) {
  const bi = parabolicLag(p.lag) * 0.01
  const { offset } = gridFit(bi, onsetTimes)
  const meanDist = meanGridDistance(bi, offset, onsetTimes)
  const fitQuality = Math.max(0, 1 - meanDist / (bi * 0.5))
  const strength = fitQuality + 0.05 * (p.score / maxScore)
  if (!chosen || strength > chosen.strength) {
    chosen = { bi, g: { offset }, strength }
  }
}

const beatInterval = chosen ? chosen.bi : MIN_LAG * 0.01
const bpm = 60 / beatInterval
const bestOffset = chosen ? chosen.g.offset : 0
console.log(
  `\nChosen (grid-fit): ${bpm.toFixed(2)} BPM, beat ${beatInterval.toFixed(4)}s, offset ${bestOffset.toFixed(3)}s\n`,
)

// ---------------------------------------------------------------------------
// Band split + onset detect (mirrors buildChart)
// ---------------------------------------------------------------------------
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
console.log(`Bands: kick ${kickHits.length}  snare ${snareHits.length}  hat ${hatHits.length}`)

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

// Drop weak hits (mirrors buildChart).
const maxStrength = hits.reduce((max, h) => Math.max(max, h.strength), 0)
const weakFloor = maxStrength * 0.12
const strong = merged.filter((h) => h.strength >= weakFloor)

// Snap conservatively (mirrors buildChart).
const isSlow = 60 / beatInterval < 100
const snapGrid = isSlow ? beatInterval : beatInterval / 2
const snapTolerance = Math.min(snapGrid * 0.2, 0.06)
const quantize = (time) => {
  const rel = time - bestOffset
  const snapped = bestOffset + Math.round(rel / snapGrid) * snapGrid
  if (Math.abs(snapped - time) <= snapTolerance) return snapped
  return preset.dropOffGrid ? null : time
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

const onGrid = toGrid(strong)
const chart = []
for (const hit of onGrid) {
  const last = chart[chart.length - 1]
  if (last && hit.time - last.time < preset.chartMinGap) continue
  chart.push(hit)
}

console.log(
  `Grid: ${isSlow ? 'quarter' : '8th'} (${(snapGrid * 1000).toFixed(0)}ms), snap tol ${(snapTolerance * 1000).toFixed(0)}ms`,
)
console.log(`Chart (${modeArg}): ${chart.length} notes, ${(chart.length / (duration / 60)).toFixed(0)}/min\n`)

// ---------------------------------------------------------------------------
// Drift: how far each note sits from the nearest ORIGINAL drum onset.
// A big drift = the note no longer lines up with the real drum.
// ---------------------------------------------------------------------------
const rawTimes = merged.map((m) => m.time)
const nearestDrum = (t) => {
  let lo = 0
  let hi = rawTimes.length - 1
  let best = Infinity
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const dt = rawTimes[mid] - t
    if (Math.abs(dt) < Math.abs(best)) best = dt
    if (dt < 0) lo = mid + 1
    else hi = mid - 1
  }
  return best
}

let sumAbs = 0
let over50 = 0
let over100 = 0
const drifts = []
for (const hit of chart) {
  const d = nearestDrum(hit.time)
  drifts.push({ time: hit.time, type: hit.type, drift: d * 1000 })
  sumAbs += Math.abs(d) * 1000
  if (Math.abs(d) > 0.05) over50++
  if (Math.abs(d) > 0.1) over100++
}
const meanAbs = chart.length ? sumAbs / chart.length : 0
console.log('Note-to-nearest-drum drift:')
console.log(`  mean |drift| ${meanAbs.toFixed(1)}ms   >50ms ${over50}   >100ms ${over100}  /${chart.length} notes`)
console.log('\n  time     type   drift(ms)  [worst first]')
const worst = [...drifts].sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift)).slice(0, 25)
for (const d of worst) {
  console.log(
    `  ${d.time.toFixed(3).padStart(7)}  ${d.type.padEnd(5)}  ${d.drift.toFixed(0).padStart(6)}${Math.abs(d.drift) > 50 ? '  <-- AWAY FROM DRUM' : ''}`,
  )
}
