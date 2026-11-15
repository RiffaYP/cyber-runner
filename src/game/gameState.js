import { CONFIG, MODIFIERS } from '../config.js'
import { ui, clearJudgement, showJudgement, runCountdown } from '../ui/dom.js'
import { highScores } from '../storage.js'
import { rhythm } from './rhythmEngine.js'
import { audio } from '../audio/audioEngine.js'
import { playHit } from '../audio/sfx.js'
import { beatDetector } from '../chart/beatDetector.js'
import {
  obstacleManager,
  obstacles,
} from '../render/obstacles.js'
import {
  flashPaddle,
  setShakeAmount,
  setPaddlePulse,
} from '../render/playerMesh.js'

export const game = {
  isPlaying: false,
  isStarting: false,
  isPaused: false,
  score: 0,
  missCount: 0,
  hits: 0,
  badCount: 0,
  combo: 0,
  maxCombo: 0,
  lastGrade: null,
  lastTiming: 0,
  targetLane: 1,
  recentLanes: [],
  currentSong: null,
  difficulty: CONFIG.defaultDifficulty,
  _popTimer: null,
  inputRef: null,
  songLibraryRef: null,

  reset() {
    obstacleManager.clear()
    rhythm.stop()
    rhythm.reset()
    if (this.inputRef) this.inputRef.reset()
    ui.hideStartScreen()

    this.score = 0
    this.missCount = 0
    this.hits = 0
    this.badCount = 0
    this.combo = 0
    this.maxCombo = 0
    this.lastGrade = null
    this.lastTiming = 0
    this.targetLane = 1
    this.recentLanes = []
    this.isPaused = false

    ui.beat.textContent = '--'
    this.updateHud()
    setPaddlePulse(0)
    setShakeAmount(0)
    clearJudgement()
  },

  async start(song) {
    if (this.isStarting) return
    this.isStarting = true

    const target = song ?? this.currentSong ?? (this.songLibraryRef ? this.songLibraryRef.first() : null)
    this.currentSong = target
    if (!target) {
      this.isStarting = false
      return
    }

    try {
      this.isPlaying = false
      this.isPaused = false
      rhythm.stop()
      obstacleManager.clear()
      if (this.inputRef) this.inputRef.releaseAll()

      audio.prime(target.url)

      const mode = beatDetector.resolveMode(this.difficulty)
      const beatPromise = beatDetector.detect(target.url)
      const chartPromise = beatDetector.buildChart(target.url, { difficulty: mode })

      ui.startScreen.classList.add('hidden')
      ui.gameOver.classList.add('hidden')
      ui.pauseScreen.classList.add('hidden')
      ui.hud.classList.remove('hidden')
      ui.laneKeys.classList.remove('hidden')
      document.body.classList.add('is-playing')

      rhythm.configure(await beatPromise)
      rhythm.setChart(await chartPromise)

      this.reset()

      audio.startFromBeginning(target.url)
      audio.pause()

      await runCountdown()

      rhythm.reset()
      this.isPlaying = true
      ui.pauseButton.classList.remove('hidden')
      audio.resume()
    } finally {
      this.isStarting = false
    }
  },

  requestLane(lane) {
    this.targetLane = lane
    setPaddlePulse(1)
  },

  addJudgement(grade, lane, timing = 0) {
    this.lastGrade = grade
    this.lastTiming = timing

    const isHit = grade === 'perfect' || grade === 'good' || grade === 'ok'

    playHit(grade)

    if (isHit) {
      this.hits += 1
      this.combo += 1
      this.maxCombo = Math.max(this.maxCombo, this.combo)

      const base = CONFIG.judgeScore[grade]
      const multiplier = 1 + Math.min(this.combo, 20) * 0.05
      this.score += Math.round(base * multiplier)

      flashPaddle(lane, 'hit')
      this.popScore()
    } else {
      this.combo = 0
      if (grade === 'bad') this.badCount += 1
      flashPaddle(lane, 'miss')
    }

    if (grade === 'miss') {
      this.missCount += 1
      if (!MODIFIERS.noFail && this.missCount >= CONFIG.maxMisses) {
        this.updateHud()
        showJudgement('miss', 0)
        this.gameOver()
        return
      }
    }

    this.updateHud()
    showJudgement(grade, timing)
  },

  addMiss(lane) {
    this.addJudgement('miss', lane)
  },

  gameOver() {
    if (!this.isPlaying) return
    this.isPlaying = false
    this.isPaused = false
    document.body.classList.remove('is-playing')
    ui.countdown.classList.add('hidden')
    if (this.songLibraryRef) this.songLibraryRef.stopPreview()

    rhythm.stop()
    audio.pause()
    if (this.inputRef) this.inputRef.releaseAll()

    for (const note of obstacles) note.userData.fading = true

    ui.finalScore.textContent = String(this.score)
    ui.finalHits.textContent = String(this.hits)
    this.renderGameOverRecords()
    ui.laneKeys.classList.add('hidden')
    ui.pauseButton.classList.add('hidden')
    ui.pauseScreen.classList.add('hidden')
    ui.gameOver.classList.remove('hidden')
    setShakeAmount(0.18)
  },

  renderGameOverRecords() {
    const mode = beatDetector.resolveMode(this.difficulty)
    const song = this.currentSong
    const runStats = { score: this.score, maxCombo: this.maxCombo }

    const result = MODIFIERS.noFail ? null : highScores.submit(song, mode, runStats)
    const best = highScores.get(song, mode)

    const scoreLabel = ui.bestScoreLabel
    const comboLabel = ui.bestComboLabel
    if (scoreLabel && comboLabel) {
      scoreLabel.classList.toggle('is-record', !!result?.isScore)
      comboLabel.classList.toggle('is-record', !!result?.isCombo)
    }

    ui.finalCombo.textContent = String(this.maxCombo)
    ui.bestScore.textContent = best ? String(best.score) : '—'
    ui.bestCombo.textContent = best ? String(best.combo) : '—'

    ui.noFailNote.classList.toggle('hidden', !MODIFIERS.noFail)
  },

  pause() {
    if (!this.isPlaying || this.isPaused) return
    this.isPaused = true

    audio.pause()
    rhythm.stop()
    if (this.inputRef) this.inputRef.releaseAll()

    document.body.classList.add('is-paused')
    ui.pauseScreen.classList.remove('hidden')
    ui.pauseButton.classList.add('hidden')
    ui.hud.classList.add('hidden')
    ui.laneKeys.classList.add('hidden')
  },

  resume() {
    if (!this.isPlaying || !this.isPaused) return
    this.isPaused = false

    this.rebaseRhythm()
    audio.resume()

    document.body.classList.remove('is-paused')
    ui.pauseScreen.classList.add('hidden')
    ui.pauseButton.classList.remove('hidden')
    ui.hud.classList.remove('hidden')
    ui.laneKeys.classList.remove('hidden')
  },

  togglePause() {
    if (this.isPaused) this.resume()
    else this.pause()
  },

  rebaseRhythm() {
    rhythm.startTime = performance.now() / 1000
    rhythm.isRunning = true
  },

  updateHud() {
    ui.score.textContent = String(this.score)
    ui.misses.textContent = `${this.missCount} / ${CONFIG.maxMisses}`
    ui.combo.textContent = this.combo > 0 ? `x${this.combo}` : '0'
    ui.misses.classList.toggle('danger', this.missCount >= CONFIG.maxMisses - 3)
  },

  popScore() {
    ui.score.classList.remove('hud-pop')
    void ui.score.offsetWidth
    ui.score.classList.add('hud-pop')
    clearTimeout(this._popTimer)
    this._popTimer = setTimeout(() => ui.score.classList.remove('hud-pop'), 160)
  },
}

audio.onEnded = () => {
  game.gameOver()
}
