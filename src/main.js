import './style.css'

import * as THREE from 'three'
import { isMobile } from './device.js'
import { initTouch } from './touch.js'
import { CONFIG, mirrorLane, activeNoteSpeed } from './config.js'
import { loadSettings } from './storage.js'
import { audio } from './audio/audioEngine.js'
import { readId3Tags } from './audio/id3.js'
import {
  beatDetector,
  analysisJob,
  showAnalysis,
  hideAnalysis,
} from './chart/beatDetector.js'
import {
  renderer,
  camera,
  composer,
  onResize,
  applyOrientation,
  registerGeometryUpdate,
} from './render/scene.js'
import {
  updateGrid,
  updateLaneGeometry,
} from './render/road.js'
import {
  player,
  updatePlayer,
  updatePulses,
  shakeAmount,
  setShakeAmount,
} from './render/playerMesh.js'
import {
  obstacles,
  obstacleManager,
  timeToHit,
  resolveMisses,
} from './render/obstacles.js'
import { rhythm } from './game/rhythmEngine.js'
import { game } from './game/gameState.js'
import { input } from './game/input.js'
import { ui } from './ui/dom.js'
import { songLibrary } from './ui/songLibrary.js'
import {
  initSettingsUI,
  updateKeyLabels,
  renderDifficulty,
  renderModifiers,
} from './ui/settingsModal.js'

document.getElementById('app').appendChild(renderer.domElement)
registerGeometryUpdate(updateLaneGeometry)

// Wire progress callbacks
analysisJob.onProgress = (fraction, label) => {
  const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100)
  if (ui.analysisBar) ui.analysisBar.style.width = `${pct}%`
  if (label && ui.analysisLabel) ui.analysisLabel.textContent = label
}
analysisJob.onStateChange = (active, label) => {
  if (active) {
    if (ui.analysisLabel) ui.analysisLabel.textContent = label || 'ANALYSING…'
    if (ui.analysisBar) ui.analysisBar.style.width = '0%'
    ui.analysis?.classList.remove('hidden')
  } else {
    ui.analysis?.classList.add('hidden')
    if (ui.analysisBar) ui.analysisBar.style.width = '0%'
  }
}

// Connect dependencies
game.songLibraryRef = songLibrary
game.inputRef = input

function onBeat(noteIndex, hitTime) {
  if (!game.isPlaying || game.isPaused) return

  const lane = obstacleManager.pickLane(game.recentLanes)
  game.recentLanes.push(lane)
  if (game.recentLanes.length > 3) game.recentLanes.shift()

  obstacleManager.spawn(mirrorLane(lane), hitTime)

  const bar = Math.floor(hitTime / (rhythm.beatInterval * 4)) + 1
  ui.beat.textContent = String(bar).padStart(2, '0')
}

function updateRemoveButton() {
  const song = songLibrary.selected
  const canRemove = !!song && song.source === 'uploaded'
  ui.songRemoveButton?.classList.toggle('hidden', !canRemove)
}

function prefetchSelectedSong() {
  const song = songLibrary.selected
  if (!song || game.isPlaying || song.available === false) return
  const mode = beatDetector.resolveMode(game.difficulty)
  beatDetector.detect(song.url).catch(() => {})
  beatDetector
    .buildChart(song.url, { difficulty: mode })
    .then((chart) => {
      if (chart && chart.fallback && !game.isPlaying) {
        ui.retryButton?.classList.remove('hidden')
      } else {
        ui.retryButton?.classList.add('hidden')
      }
    })
    .catch(() => {
      if (!game.isPlaying) ui.retryButton?.classList.remove('hidden')
    })
}

function cancelAnalysis() {
  if (!analysisJob.active) return
  analysisJob.cancelled = true
  hideAnalysis()
  songLibrary.setStatus('Analysis cancelled.', 'warn')
  if (ui.startButton) ui.startButton.disabled = false
  songLibrary.renderInfo()
}

async function retrySelectedSong() {
  const song = songLibrary.selected
  if (!song) return

  beatDetector.decodeCache.delete(song.url)
  beatDetector.decoding.delete(song.url)
  beatDetector.chartCache.clear()
  beatDetector.chartBuilding.clear()
  beatDetector.beatCache.delete(song.url)

  ui.retryButton?.classList.add('hidden')
  songLibrary.clearStatus()
  showAnalysis('RETRYING…')

  try {
    const mode = beatDetector.resolveMode(game.difficulty)
    const chart = await beatDetector.buildChart(song.url, { difficulty: mode })
    hideAnalysis()

    if (chart.fallback) {
      songLibrary.setStatus(
        'Still could not read this audio file. Try a different MP3.',
        'error',
      )
      ui.retryButton?.classList.remove('hidden')
      return
    }
    songLibrary.setStatus(`Ready — ${chart.count} notes found.`, 'ok')
    prefetchSelectedSong()
  } catch (error) {
    hideAnalysis()
    if (!error?.cancelled) {
      songLibrary.setStatus('Retry failed. The file may be corrupt.', 'error')
      ui.retryButton?.classList.remove('hidden')
    }
  }
}

function goToMainMenu() {
  songLibrary.stopPreview()
  game.isPlaying = false
  game.isPaused = false
  document.body.classList.remove('is-playing')
  rhythm.stop()
  audio.pause()
  game.currentSong = null
  obstacleManager.clear()
  input.releaseAll()
  hideAnalysis()
  ui.retryButton?.classList.add('hidden')
  songLibrary.selected = songLibrary.first()
  songLibrary.render()
  songLibrary.clearStatus()
  renderDifficulty(game, beatDetector)
  renderModifiers()
  ui.startScreen?.classList.remove('hidden')
  ui.gameOver?.classList.add('hidden')
  ui.pauseScreen?.classList.add('hidden')
  ui.hud?.classList.add('hidden')
  ui.laneKeys?.classList.add('hidden')
  ui.pauseButton?.classList.add('hidden')
}

async function startSelectedSong() {
  const song = songLibrary.selected
  if (!song) {
    songLibrary.setStatus('Select a song first.', 'error')
    return
  }
  if (!songLibrary.isPlayable(song)) {
    songLibrary.setStatus(
      'This song file is missing. Pick another or upload an MP3.',
      'error',
    )
    return
  }

  songLibrary.stopPreview()

  const mode = beatDetector.resolveMode(game.difficulty)
  const cached = beatDetector.chartCache.has(
    beatDetector.chartKey(song.url, mode),
  )
  if (!cached) {
    showAnalysis('ANALYSING…')
    if (ui.startButton) ui.startButton.disabled = true
    songLibrary.renderInfo()
  }

  try {
    await game.start(song)
    songLibrary.clearStatus()
    if (!cached) hideAnalysis()
  } catch (error) {
    if (error?.cancelled) {
      hideAnalysis()
      songLibrary.setStatus('Analysis cancelled.', 'warn')
    } else {
      console.error('[cyber-runner] Could not start the song.', error)
      hideAnalysis()
      songLibrary.setStatus(
        'Could not start this song. Try another file.',
        'error',
      )
    }
  } finally {
    if (ui.startButton) ui.startButton.disabled = false
  }
}

const timer = new THREE.Timer()

function tick(timestamp) {
  timer.update(timestamp)
  const dt = Math.min(timer.getDelta(), 0.1)
  const sceneDt = game.isPaused ? 0 : dt

  // Poll Gamepad input on each animation frame
  input.pollGamepad()

  updateGrid(sceneDt)
  updatePlayer(sceneDt, game.targetLane, timer.getElapsed())
  updatePulses(sceneDt)

  if (game.isPlaying && !game.isPaused) {
    const audioTime = audio.getTime()
    rhythm.update(audioTime, onBeat)
    obstacleManager.update(dt)
    resolveMisses(game)
  } else if (!game.isPaused && obstacles.length > 0) {
    obstacleManager.update(dt)
  }

  // Camera shake & drift
  let currentShake = shakeAmount
  if (currentShake > 0.001) {
    currentShake *= 1 - dt * 7
    setShakeAmount(currentShake)
    camera.position.x = (Math.random() - 0.5) * currentShake
    camera.position.y = CONFIG.cameraY + (Math.random() - 0.5) * currentShake
  } else {
    camera.position.x += (0 - camera.position.x) * (1 - Math.exp(-6 * dt))
    camera.position.y +=
      (CONFIG.cameraY - camera.position.y) * (1 - Math.exp(-6 * dt))
  }
  camera.lookAt(
    player.position.x * 0.08,
    CONFIG.cameraLookAtY,
    CONFIG.cameraLookAtZ,
  )

  composer.render()
  requestAnimationFrame(tick)
}

function init() {
  input.init(game)
  window.addEventListener('resize', () => {
    onResize()
    applyOrientation()
  })
  window.addEventListener('orientationchange', applyOrientation)
  onResize()
  applyOrientation()

  if (isMobile) {
    document.body.classList.add('is-touch')
    ui.touchZones?.classList.remove('hidden')
    initTouch(ui.touchZones, {
      pressLane: (lane) => input.pressLane(lane),
      isPlaying: () => game.isPlaying && !game.isStarting,
      isPaused: () => game.isPaused,
    })
  }

  songLibrary.init()

  ui.songSelect?.addEventListener('change', (event) => {
    songLibrary.select(event.target.value)
    songLibrary.clearStatus()
    updateRemoveButton()
    prefetchSelectedSong()
  })

  ui.previewButton?.addEventListener('click', () => songLibrary.togglePreview())

  ui.songUpload?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0]
    if (ui.songUpload) ui.songUpload.value = ''
    if (!file) return

    songLibrary.setStatus('READING FILE…', 'info')
    const result = await songLibrary.addFile(file)
    if (!result.ok) {
      songLibrary.setStatus(result.message, 'error')
      return
    }
    if (result.warning) {
      songLibrary.setStatus(result.warning, 'warn')
    } else {
      songLibrary.setStatus(
        result.duplicate ? 'Song already added.' : 'Song added.',
        'ok',
      )
    }
    updateRemoveButton()
    prefetchSelectedSong()
  })

  ui.songRemoveButton?.addEventListener('click', () => {
    const song = songLibrary.selected
    if (!song || song.source !== 'uploaded') return
    songLibrary.remove(song)
    songLibrary.setStatus('Uploaded song removed.', 'ok')
    updateRemoveButton()
    prefetchSelectedSong()
  })

  ui.startButton?.addEventListener('click', () => startSelectedSong())
  ui.restartButton?.addEventListener('click', () => game.start())
  ui.overMenuButton?.addEventListener('click', () => goToMainMenu())
  ui.quitButton?.addEventListener('click', () => game.start())
  ui.menuButton?.addEventListener('click', () => goToMainMenu())

  ui.analysisCancel?.addEventListener('click', () => cancelAnalysis())
  ui.retryButton?.addEventListener('click', () => retrySelectedSong())

  const saved = loadSettings()
  if (saved?.difficulty) {
    game.difficulty = beatDetector.resolveMode(saved.difficulty)
  }

  initSettingsUI(game, songLibrary, beatDetector, prefetchSelectedSong)
  updateKeyLabels()

  ui.pauseButton?.addEventListener('click', () => game.pause())
  ui.resumeButton?.addEventListener('click', () => game.resume())

  updateRemoveButton()
  prefetchSelectedSong()

  requestAnimationFrame(tick)
}

// Dev/Debug introspection hook
window.__cyberRunner = {
  get songLibrary() {
    return songLibrary
  },
  get game() {
    return game
  },
  get beatDetector() {
    return beatDetector
  },
  get rhythm() {
    return rhythm
  },
  get audio() {
    return audio
  },
  get noteCount() {
    return obstacles.length
  },
  activeNoteSpeed() {
    return activeNoteSpeed()
  },
  mirrorLane(lane) {
    return mirrorLane(lane)
  },
  readId3Tags(file) {
    return readId3Tags(file)
  },
  timeToHit,
}

init()
