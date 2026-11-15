import { LatencyCalibrator } from '../audio/calibration.js'
import { CONFIG } from '../config.js'
import { saveSettings } from '../storage.js'
import { ui } from './dom.js'

let calibrator = null
let modalEl = null
let pulseEl = null
let deltaEl = null
let progressEl = null
let avgEl = null
let actionBtn = null
let applyBtn = null

export function initCalibrationModal() {
  if (modalEl) return

  modalEl = document.createElement('div')
  modalEl.id = 'calibration-modal'
  modalEl.className = 'overlay-dialog hidden'
  modalEl.innerHTML = `
    <div class="overlay-card calibration-card">
      <h2 class="card-title">LATENCY CALIBRATION</h2>
      <p class="card-desc">Tap the button or press <strong>SPACEBAR</strong> exactly on the audio beat.</p>
      
      <div class="calib-visual-container">
        <div id="calib-pulse" class="calib-pulse-circle"></div>
      </div>

      <div class="calib-stats">
        <div class="calib-stat">
          <span class="label">PROGRESS</span>
          <span id="calib-progress" class="val">0 / 16</span>
        </div>
        <div class="calib-stat">
          <span class="label">LAST TAP</span>
          <span id="calib-delta" class="val">--</span>
        </div>
        <div class="calib-stat">
          <span class="label">SUGGESTED OFFSET</span>
          <span id="calib-avg" class="val">--</span>
        </div>
      </div>

      <div class="calib-actions">
        <button id="calib-action-btn" class="btn btn--primary">START TEST</button>
        <button id="calib-apply-btn" class="btn btn--accent" disabled>APPLY (+0 ms)</button>
        <button id="calib-close-btn" class="btn btn--secondary">CLOSE</button>
      </div>
    </div>
  `
  document.getElementById('ui').appendChild(modalEl)

  pulseEl = modalEl.querySelector('#calib-pulse')
  deltaEl = modalEl.querySelector('#calib-delta')
  progressEl = modalEl.querySelector('#calib-progress')
  avgEl = modalEl.querySelector('#calib-avg')
  actionBtn = modalEl.querySelector('#calib-action-btn')
  applyBtn = modalEl.querySelector('#calib-apply-btn')
  const closeBtn = modalEl.querySelector('#calib-close-btn')

  let suggestedOffsetSeconds = 0

  calibrator = new LatencyCalibrator({
    bpm: 120,
    maxTaps: 16,
    onBeat: (_index, isAccent) => {
      if (!pulseEl) return
      pulseEl.classList.remove('beat-accent', 'beat-normal')
      void pulseEl.offsetWidth
      pulseEl.classList.add(isAccent ? 'beat-accent' : 'beat-normal')
    },
    onTapRecorded: (stats) => {
      progressEl.textContent = `${stats.tapCount} / ${stats.maxTaps}`
      const sign = stats.lastDeltaMs > 0 ? '+' : ''
      deltaEl.textContent = `${sign}${stats.lastDeltaMs} ms`
      if (stats.lastDeltaMs > 20) {
        deltaEl.style.color = '#ffc443'
      } else if (stats.lastDeltaMs < -20) {
        deltaEl.style.color = '#2fd8ff'
      } else {
        deltaEl.style.color = '#4dff9e'
      }

      const avgSign = stats.averageMs > 0 ? '+' : ''
      avgEl.textContent = `${avgSign}${stats.averageMs} ms`
      suggestedOffsetSeconds = stats.averageMs / 1000

      applyBtn.disabled = false
      applyBtn.textContent = `APPLY (${avgSign}${stats.averageMs} ms)`
    },
    onComplete: (averageMs) => {
      actionBtn.textContent = 'TEST AGAIN'
      suggestedOffsetSeconds = averageMs / 1000
    },
  })

  actionBtn.addEventListener('click', () => {
    if (!calibrator.isRunning) {
      calibrator.start()
      actionBtn.textContent = 'TAP HERE'
      progressEl.textContent = '0 / 16'
      deltaEl.textContent = '--'
      avgEl.textContent = '--'
    } else {
      calibrator.recordTap()
    }
  })

  window.addEventListener('keydown', (e) => {
    if (modalEl.classList.contains('hidden')) return
    if (e.code === 'Space') {
      e.preventDefault()
      if (!calibrator.isRunning) {
        calibrator.start()
        actionBtn.textContent = 'TAP HERE'
      } else {
        calibrator.recordTap()
      }
    } else if (e.code === 'Escape') {
      closeCalibration()
    }
  })

  applyBtn.addEventListener('click', () => {
    CONFIG.audioOffset = suggestedOffsetSeconds
    const ms = Math.round(suggestedOffsetSeconds * 1000)
    if (ui.offsetSlider) ui.offsetSlider.value = String(ms)
    if (ui.offsetReset) {
      ui.offsetReset.textContent = ms === 0 ? '0 ms' : `${ms > 0 ? '+' : ''}${ms} ms`
      ui.offsetReset.classList.toggle('is-active', ms !== 0)
    }
    saveSettings()
    closeCalibration()
  })

  closeBtn.addEventListener('click', closeCalibration)
}

export function openCalibration() {
  initCalibrationModal()
  modalEl.classList.remove('hidden')
}

export function closeCalibration() {
  if (calibrator) calibrator.stop()
  if (modalEl) modalEl.classList.add('hidden')
  if (actionBtn) actionBtn.textContent = 'START TEST'
}
