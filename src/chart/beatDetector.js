import { CONFIG } from '../config.js'

export const analysisJob = {
  active: false,
  cancelled: false,
  onProgress: null,
  onStateChange: null,
}

export function reportProgress(fraction, label) {
  if (!analysisJob.active) return
  if (typeof analysisJob.onProgress === 'function') {
    analysisJob.onProgress(fraction, label)
  }
}

export function throwIfCancelled() {
  if (analysisJob.cancelled) {
    const error = new Error('Analysis cancelled.')
    error.cancelled = true
    throw error
  }
}

export function showAnalysis(label = 'ANALYSING…') {
  analysisJob.active = true
  analysisJob.cancelled = false
  if (typeof analysisJob.onStateChange === 'function') {
    analysisJob.onStateChange(true, label)
  }
}

export function hideAnalysis() {
  analysisJob.active = false
  analysisJob.cancelled = false
  if (typeof analysisJob.onStateChange === 'function') {
    analysisJob.onStateChange(false)
  }
}

export const beatDetector = {
  beatCache: new Map(),
  analysing: new Map(),
  decodeCache: new Map(),
  decoding: new Map(),
  chartCache: new Map(),
  chartBuilding: new Map(),

  forget(url) {
    this.beatCache.delete(url)
    this.analysing.delete(url)
    for (const mode of Object.keys(CONFIG.difficulties)) {
      const key = this.chartKey(url, mode)
      this.chartCache.delete(key)
      this.chartBuilding.delete(key)
    }
  },

  chartKey(url, mode) {
    return `${mode}:${url}`
  },

  /** Detected tempo for a URL, cached with the rest of the beat analysis. */
  async getTempo(url) {
    const tempo = await this.detect(url)
    return {
      beatInterval: tempo.beatInterval,
      offset: tempo.offset,
    }
  },

  resolveMode(mode) {
    return CONFIG.difficulties[mode] ? mode : CONFIG.defaultDifficulty
  },

  async decode(url) {
    if (this.decodeCache.has(url)) return this.decodeCache.get(url)
    if (this.decoding.has(url)) return this.decoding.get(url)

    const job = (async () => {
      reportProgress(0.05, 'DOWNLOADING…')
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
      const buffer = await response.arrayBuffer()
      throwIfCancelled()

      reportProgress(0.3, 'DECODING AUDIO…')
      const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext
      const offline = new Ctx(1, 44100, 44100)
      const audio = await offline.decodeAudioData(buffer)
      throwIfCancelled()
      this.decodeCache.set(url, audio)
      reportProgress(0.45, 'ANALYSING…')
      return audio
    })()

    try {
      return await job
    } finally {
      this.decoding.delete(url)
    }
  },

  async detect(url) {
    if (this.beatCache.has(url)) return this.beatCache.get(url)
    if (this.analysing.has(url)) return this.analysing.get(url)

    const job = (async () => {
      try {
        const result = await this.analyse(url)
        this.beatCache.set(url, result)
        console.info(
          `[cyber-runner] Detected ${result.bpm.toFixed(1)} BPM ` +
            `(beat ${result.beatInterval.toFixed(4)}s, first beat ${result.offset.toFixed(3)}s)`,
        )
        return result
      } catch (error) {
        console.warn('[cyber-runner] Beat detection failed, using fallback.', error)
        const fallback = {
          bpm: CONFIG.bpm,
          beatInterval: 60 / CONFIG.bpm,
          offset: 0,
        }
        this.beatCache.set(url, fallback)
        return fallback
      } finally {
        this.analysing.delete(url)
      }
    })()

    this.analysing.set(url, job)
    return job
  },

  async analyse(url) {
    const audio = await this.decode(url)

    const sr = audio.sampleRate
    const left = audio.getChannelData(0)
    const right = audio.numberOfChannels > 1 ? audio.getChannelData(1) : left

    const hop = Math.round(sr * 0.01)
    const frames = Math.floor(left.length / hop)
    const rms = new Float32Array(frames)

    for (let i = 0; i < frames; i++) {
      let sum = 0
      const start = i * hop
      for (let j = 0; j < hop; j++) {
        const v = (left[start + j] + right[start + j]) * 0.5
        sum += v * v
      }
      rms[i] = Math.sqrt(sum / hop)
    }

    const flux = new Float32Array(frames)
    for (let i = 1; i < frames; i++) {
      const diff = rms[i] - rms[i - 1]
      flux[i] = diff > 0 ? diff : 0
    }

    const windowSize = 50
    const onset = new Float32Array(frames)
    for (let i = 0; i < frames; i++) {
      let sum = 0
      let count = 0
      for (let k = -windowSize; k <= windowSize; k++) {
        const idx = i + k
        if (idx >= 0 && idx < frames) {
          sum += flux[idx]
          count++
        }
      }
      onset[i] = flux[i] - sum / count
    }

    const MIN_LAG = 20
    const MAX_LAG = 150
    const autocorr = new Float64Array(MAX_LAG + 1)

    for (let lag = MIN_LAG; lag <= MAX_LAG; lag++) {
      let sum = 0
      for (let i = 0; i + lag < frames; i++) sum += onset[i] * onset[i + lag]
      autocorr[lag] = sum / (frames - lag)
    }

    let bestLag = MIN_LAG
    let bestScore = -Infinity

    for (let lag = MIN_LAG + 1; lag < MAX_LAG; lag++) {
      const isPeak = autocorr[lag] > autocorr[lag - 1] && autocorr[lag] >= autocorr[lag + 1]
      if (!isPeak || autocorr[lag] <= 0) continue
      const score = autocorr[lag] * Math.pow(lag, 0.25)
      if (score > bestScore) {
        bestScore = score
        bestLag = lag
      }
    }

    let beatInterval = bestLag * 0.01

    while (beatInterval < 60 / 170) beatInterval *= 2
    while (beatInterval > 60 / 80) beatInterval /= 2

    const bpm = 60 / beatInterval

    let onsetPeak = 0
    for (let i = 1; i < frames; i++) {
      if (onset[i] > onsetPeak) onsetPeak = onset[i]
    }

    const onsets = []
    const onsetThreshold = onsetPeak * 0.25
    for (let i = 1; i < frames; i++) {
      if (onset[i] >= onsetThreshold) onsets.push(i * 0.01)
    }

    let bestOffset = 0
    let bestHits = -1
    const tolerance = Math.min(0.05, beatInterval * 0.12)

    for (let offset = 0; offset < beatInterval; offset += 0.005) {
      let hits = 0
      for (const time of onsets) {
        const phase = (((time - offset) % beatInterval) + beatInterval) % beatInterval
        if (Math.min(phase, beatInterval - phase) < tolerance) hits++
      }
      if (hits > bestHits) {
        bestHits = hits
        bestOffset = offset
      }
    }

    return { bpm, beatInterval, offset: bestOffset, onsets: onsets.length }
  },

  async buildChart(url, options = {}) {
    const mode = this.resolveMode(options.difficulty)
    const preset = CONFIG.difficulties[mode]
    const useHats = options.useHats ?? preset.useHats
    const mergeWindow = options.mergeWindow ?? preset.mergeWindow
    const minGap = options.chartMinGap ?? preset.chartMinGap
    const key = this.chartKey(url, mode)

    if (this.chartCache.has(key)) return this.chartCache.get(key)
    if (this.chartBuilding.has(key)) return this.chartBuilding.get(key)

    const job = (async () => {
      try {
        const audio = await this.decode(url)

        const sr = audio.sampleRate
        const left = audio.getChannelData(0)
        const right = audio.numberOfChannels > 1 ? audio.getChannelData(1) : left
        const mono = new Float32Array(left.length)
        for (let i = 0; i < left.length; i++) mono[i] = (left[i] + right[i]) * 0.5

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
          return {
            b0: b0 / a0,
            b1: b1 / a0,
            b2: b2 / a0,
            a1: (-2 * cos) / a0,
            a2: (1 - alpha) / a0,
          }
        }

        const applyBiquad = (input, c) => {
          const out = new Float32Array(input.length)
          let x1 = 0
          let x2 = 0
          let y1 = 0
          let y2 = 0
          for (let i = 0; i < input.length; i++) {
            const x = input[i]
            const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2
            x2 = x1
            x1 = x
            y2 = y1
            y1 = y
            out[i] = y
          }
          return out
        }

        reportProgress(0.55, 'SPLITTING BANDS…')
        throwIfCancelled()

        const bandEnvelope = (loHz, hiHz) =>
          envelopeOf(
            applyBiquad(
              applyBiquad(mono, biquad('highpass', loHz)),
              biquad('lowpass', hiHz),
            ),
          )

        const kickEnv = bandEnvelope(40, 160)
        const snareEnv = bandEnvelope(150, 500)
        const hatEnv = bandEnvelope(6500, 9000)
        reportProgress(0.75, 'FINDING DRUM HITS…')
        throwIfCancelled()

        const riseLag = Math.max(1, Math.round(0.02 / hopSec))
        const dbRise = (env, i) =>
          20 * Math.log10((env[i] + 1e-9) / (env[i - riseLag] + 1e-9))

        const detectBand = (env, minDb, minLevel) => {
          const found = []
          for (let i = riseLag + 2; i < env.length - 2; i++) {
            if (env[i] < minLevel) continue
            if (env[i] <= env[i - 1] || env[i] <= env[i + 1]) continue
            if (dbRise(env, i) < minDb) continue
            found.push({
              index: i,
              time: i * hopSec,
              strength: env[i],
              rise: dbRise(env, i),
            })
          }
          const merged = []
          for (const hit of found) {
            const last = merged[merged.length - 1]
            if (last && hit.time - last.time < 0.06) {
              if (hit.strength > last.strength) {
                last.index = hit.index
                last.time = hit.time
                last.strength = hit.strength
                last.rise = hit.rise
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
        const hatHits = useHats
          ? detectBand(hatEnv, 7, Math.max(0.002, hatRef * 0.06))
          : []

        const hits = [
          ...kickHits.map((h) => ({ ...h, type: 'kick' })),
          ...snareHits.map((h) => ({ ...h, type: 'snare' })),
          ...hatHits.map((h) => ({ ...h, type: 'hat' })),
        ].sort((a, b) => a.time - b.time)

        const merged = []
        for (const hit of hits) {
          const last = merged[merged.length - 1]
          if (last && hit.time - last.time < mergeWindow) {
            if (hit.strength > last.strength) {
              last.time = hit.time
              last.strength = hit.strength
              last.type = hit.type
            }
            continue
          }
          merged.push({ ...hit })
        }

        // --- Snap each hit to the nearest beat subdivision -----------------
        // Free-floating onset times feel random: the player hears "click" but
        // cannot predict WHERE the next note lands. Snapping to a musical grid
        // (beat, half, quarter-beat) keeps every note on something the ear can
        // count while still following the real drum moments. Snaps only apply
        // within a small tolerance — a genuinely off-grid hit is left alone.
        const tempo = await this.getTempo(url)
        const beatInterval = tempo.beatInterval
        const beatOffset = tempo.offset
        const snapGrid = beatInterval / 4 // 16th notes
        const snapTolerance = snapGrid * 0.42

        const quantize = (time) => {
          const rel = time - beatOffset
          const snapped = beatOffset + Math.round(rel / snapGrid) * snapGrid
          return Math.abs(snapped - time) <= snapTolerance ? snapped : time
        }

        const toGrid = (list) => {
          const out = []
          for (const hit of list) {
            const snapped = quantize(hit.time)
            const last = out[out.length - 1]
            // After snapping, two hits may collapse onto the same grid slot.
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

        const onGrid = toGrid(merged)

        const chart = []
        for (const hit of onGrid) {
          const last = chart[chart.length - 1]
          if (last && hit.time - last.time < minGap) continue
          chart.push(hit)
        }

        const firstNote = chart.length ? chart[0].time : 0

        const result = {
          times: chart.map((c) => c.time),
          count: chart.length,
          firstNoteTime: firstNote,
          duration: audio.duration,
          mode,
        }

        this.chartCache.set(key, result)
        reportProgress(1, 'READY')
        console.info(
          `[cyber-runner] Drum chart (${mode}): ${result.count} notes ` +
            `(${(result.count / (audio.duration / 60)).toFixed(0)}/min), first at ${firstNote.toFixed(2)}s`,
        )
        return result
      } catch (error) {
        if (error.cancelled) {
          throw error
        }
        console.warn(
          '[cyber-runner] Drum chart failed; falling back to the beat grid.',
          error,
        )
        const fallback = {
          times: [],
          count: 0,
          firstNoteTime: 0,
          duration: 0,
          fallback: true,
          mode,
        }
        this.chartCache.set(key, fallback)
        return fallback
      } finally {
        this.chartBuilding.delete(key)
      }
    })()

    this.chartBuilding.set(key, job)
    return job
  },
}
