import { CONFIG } from '../config.js'

export const ui = {
  score: document.getElementById('score'),
  misses: document.getElementById('misses'),
  combo: document.getElementById('combo'),
  beat: document.getElementById('beat'),
  hud: document.getElementById('hud'),
  laneKeys: document.getElementById('lane-keys'),
  startScreen: document.getElementById('start-screen'),
  startButton: document.getElementById('start-btn'),
  difficultyButtons: Array.from(document.querySelectorAll('[data-difficulty]')),

  // Modifiers & Settings
  speedButtons: Array.from(document.querySelectorAll('[data-speed]')),
  qualityButtons: Array.from(document.querySelectorAll('[data-quality]')),
  noFailButton: document.getElementById('mod-nofail'),
  mirrorButton: document.getElementById('mod-mirror'),
  offsetSlider: document.getElementById('offset-slider'),
  offsetReset: document.getElementById('offset-reset'),

  // Analysis progress
  analysis: document.getElementById('analysis'),
  analysisLabel: document.getElementById('analysis-label'),
  analysisBar: document.getElementById('analysis-bar'),
  analysisCancel: document.getElementById('analysis-cancel'),

  songSelect: document.getElementById('song-select'),
  songInfo: document.getElementById('song-info'),
  songStatus: document.getElementById('song-status'),
  songUpload: document.getElementById('song-upload'),
  songRemoveButton: document.getElementById('song-remove-btn'),
  retryButton: document.getElementById('song-retry'),
  previewButton: document.getElementById('preview-btn'),
  gameOver: document.getElementById('game-over'),
  finalScore: document.getElementById('final-score'),
  finalHits: document.getElementById('final-hits'),
  finalCombo: document.getElementById('final-combo'),
  bestScore: document.getElementById('best-score'),
  bestCombo: document.getElementById('best-combo'),
  bestScoreLabel: document.getElementById('best-score-label'),
  bestComboLabel: document.getElementById('best-combo-label'),
  noFailNote: document.getElementById('no-fail-note'),
  restartButton: document.getElementById('restart-btn'),
  overMenuButton: document.getElementById('over-menu-btn'),

  judgement: document.getElementById('judgement'),
  judgementText: document.getElementById('judgement-text'),
  judgementDetail: document.getElementById('judgement-detail'),
  countdown: document.getElementById('countdown'),
  countdownText: document.getElementById('countdown-text'),
  pauseButton: document.getElementById('pause-btn'),
  pauseScreen: document.getElementById('pause-screen'),
  resumeButton: document.getElementById('resume-btn'),
  quitButton: document.getElementById('quit-btn'),
  menuButton: document.getElementById('menu-btn'),

  touchZones: document.getElementById('touch-zones'),
  rotateOverlay: document.getElementById('rotate-overlay'),

  hideStartScreen() {
    this.startScreen.classList.add('hidden')
  },
}

export const laneKeyEls = Array.from(document.querySelectorAll('.lane-key'))

export function setLaneKeyActive(lane, active) {
  const el = laneKeyEls[lane]
  if (el) el.classList.toggle('active', active)
}

export function flashLaneKey(lane, kind) {
  const el = laneKeyEls[lane]
  if (!el) return

  const cls = kind === 'miss' ? 'miss' : kind === 'ok' ? 'ok' : 'hit'
  el.classList.remove('hit', 'miss', 'ok')
  void el.offsetWidth
  el.classList.add(cls)

  const timeout = kind === 'hit' ? 130 : kind === 'ok' ? 180 : 340
  setTimeout(() => el.classList.remove(cls), timeout)
}

const JUDGEMENT_LABEL = {
  perfect: 'PERFECT',
  good: 'GOOD',
  ok: 'OK',
  bad: 'BAD',
  miss: 'MISS',
}

let judgementTimer = 0

export function showJudgement(grade, timing = 0) {
  const el = ui.judgement
  if (!el) return

  ui.judgementText.textContent = JUDGEMENT_LABEL[grade] ?? grade.toUpperCase()

  const isHit = grade === 'perfect' || grade === 'good' || grade === 'ok'
  ui.judgementDetail.textContent = isHit
    ? `${timing >= 0 ? '+' : ''}${(timing * 1000).toFixed(0)} ms`
    : ''

  el.dataset.grade = grade

  el.classList.remove('show')
  void el.offsetWidth
  el.classList.add('show')

  clearTimeout(judgementTimer)
  judgementTimer = setTimeout(() => el.classList.remove('show'), 640)
}

export function clearJudgement() {
  if (!ui.judgement) return
  clearTimeout(judgementTimer)
  ui.judgement.classList.remove('show')
  ui.judgementText.textContent = ''
  ui.judgementDetail.textContent = ''
}

export function showCountdownValue(value, isGo = false) {
  const el = ui.countdownText
  if (!el) return

  el.textContent = value
  el.classList.toggle('go', isGo)
  el.style.animation = 'none'
  void el.offsetWidth
  el.style.animation = ''
}

export function runCountdown() {
  return new Promise((resolve) => {
    const total = CONFIG.countdownSeconds
    ui.countdown.classList.remove('hidden')
    showCountdownValue(String(total))

    let remaining = total

    const tickDown = () => {
      remaining -= 1
      if (remaining > 0) {
        showCountdownValue(String(remaining))
        setTimeout(tickDown, 1000)
      } else {
        showCountdownValue('GO', true)
        setTimeout(() => {
          ui.countdown.classList.add('hidden')
          resolve()
        }, 550)
      }
    }

    setTimeout(tickDown, 1000)
  })
}
