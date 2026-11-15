import { CONFIG, MODIFIERS, SPEED_OPTIONS } from '../config.js'
import { ui } from './dom.js'
import { saveSettings } from '../storage.js'
import { onResize } from '../render/scene.js'
import { openCalibration } from './calibrationModal.js'
import { setSfxVolume } from '../audio/sfx.js'
import { audio } from '../audio/audioEngine.js'
import { input } from '../game/input.js'

export function setSpeed(speed) {
  const next = SPEED_OPTIONS.includes(speed) ? speed : 1
  MODIFIERS.speed = next
  renderModifiers()
  saveSettings()
}

export function setNoFail(on) {
  MODIFIERS.noFail = !!on
  renderModifiers()
  saveSettings()
}

export function setMirror(on) {
  MODIFIERS.mirror = !!on
  renderModifiers()
  saveSettings()
}

const QUALITY_OPTIONS = ['auto', 'high', 'low']
export function setQuality(quality) {
  CONFIG.graphicsQuality = QUALITY_OPTIONS.includes(quality) ? quality : 'auto'
  onResize()
  renderModifiers()
  saveSettings()
}

export function setAudioOffset(seconds, persist = true) {
  const limit = CONFIG.audioOffsetLimit
  const clamped = Math.min(limit, Math.max(-limit, Number(seconds) || 0))
  CONFIG.audioOffset = clamped

  const ms = Math.round(clamped * 1000)
  if (ui.offsetSlider) ui.offsetSlider.value = String(ms)
  if (ui.offsetReset) {
    ui.offsetReset.textContent = ms === 0 ? '0 ms' : `${ms > 0 ? '+' : ''}${ms} ms`
    ui.offsetReset.classList.toggle('is-active', ms !== 0)
  }

  if (persist) saveSettings()
}

export function renderModifiers() {
  for (const button of ui.speedButtons) {
    const active = Number(button.dataset.speed) === MODIFIERS.speed
    button.setAttribute('aria-checked', active ? 'true' : 'false')
  }
  if (ui.noFailButton) {
    ui.noFailButton.setAttribute('aria-pressed', MODIFIERS.noFail ? 'true' : 'false')
    ui.noFailButton.classList.toggle('is-on', MODIFIERS.noFail)
  }
  if (ui.mirrorButton) {
    ui.mirrorButton.setAttribute('aria-pressed', MODIFIERS.mirror ? 'true' : 'false')
    ui.mirrorButton.classList.toggle('is-on', MODIFIERS.mirror)
  }
  for (const button of ui.qualityButtons) {
    const active = button.dataset.quality === CONFIG.graphicsQuality
    button.setAttribute('aria-checked', active ? 'true' : 'false')
  }
}

export function initSettingsUI(game, songLibrary, beatDetector, prefetchFn) {
  // Speed buttons
  for (const button of ui.speedButtons) {
    button.addEventListener('click', () => setSpeed(Number(button.dataset.speed)))
  }
  if (ui.noFailButton) {
    ui.noFailButton.addEventListener('click', () => setNoFail(!MODIFIERS.noFail))
  }
  if (ui.mirrorButton) {
    ui.mirrorButton.addEventListener('click', () => setMirror(!MODIFIERS.mirror))
  }
  for (const button of ui.qualityButtons) {
    button.addEventListener('click', () => setQuality(button.dataset.quality))
  }

  // Audio latency calibration
  if (ui.offsetSlider) {
    ui.offsetSlider.addEventListener('input', () => {
      setAudioOffset(Number(ui.offsetSlider.value) / 1000)
    })
  }
  if (ui.offsetReset) {
    ui.offsetReset.addEventListener('click', () => {
      setAudioOffset(0)
    })
  }

  // Calibration wizard button
  const calibBtn = document.getElementById('calib-open-btn')
  if (calibBtn) {
    calibBtn.addEventListener('click', () => {
      openCalibration()
    })
  }

  // SFX and Music volume sliders
  const sfxSlider = document.getElementById('sfx-volume-slider')
  if (sfxSlider) {
    sfxSlider.value = String(Math.round(CONFIG.sfxVolume * 100))
    sfxSlider.addEventListener('input', (e) => {
      const val = Number(e.target.value) / 100
      setSfxVolume(val)
      saveSettings()
    })
  }

  const musicSlider = document.getElementById('music-volume-slider')
  if (musicSlider) {
    musicSlider.value = String(Math.round(CONFIG.musicVolume * 100))
    musicSlider.addEventListener('input', (e) => {
      const val = Number(e.target.value) / 100
      audio.setVolume(val)
      saveSettings()
    })
  }

  // Keybind preset selector (1234 vs DFJK)
  const keybindSelect = document.getElementById('keybind-select')
  if (keybindSelect) {
    const isDFJK = CONFIG.laneKeys[0] === 'KeyD'
    keybindSelect.value = isDFJK ? 'dfjk' : 'digits'
    keybindSelect.addEventListener('change', (e) => {
      if (e.target.value === 'dfjk') {
        CONFIG.laneKeys = ['KeyD', 'KeyF', 'KeyJ', 'KeyK']
      } else {
        CONFIG.laneKeys = ['Digit1', 'Digit2', 'Digit3', 'Digit4']
      }
      updateKeyLabels()
      saveSettings()
    })
  }

  // Gamepad status indicator (reflects real connection state)
  const gamepadHint = document.getElementById('gamepad-hint')
  const syncGamepadHint = () => {
    if (!gamepadHint) return
    const pads =
      typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : []
    const connected = Array.from(pads || []).some((p) => p && p.connected)
    gamepadHint.textContent = connected ? '🎮 GAMEPAD CONNECTED' : '🎮 NO GAMEPAD'
    gamepadHint.classList.toggle('is-on', connected)
  }
  window.addEventListener('gamepadconnected', syncGamepadHint)
  window.addEventListener('gamepaddisconnected', () => {
    syncGamepadHint()
    // Release any lane held on the disconnected pad.
    for (let lane = 0; lane < CONFIG.laneCount; lane++) {
      document
        .querySelector(`.lane-key[data-lane="${lane}"]`)
        ?.classList.remove('active')
    }
    if (input?.gamepadButtonsState) input.gamepadButtonsState.clear()
  })
  syncGamepadHint()

  // Difficulty toggle
  for (const button of ui.difficultyButtons) {
    button.addEventListener('click', () => {
      setDifficulty(button.dataset.difficulty, game, beatDetector, prefetchFn)
    })
  }
  renderDifficulty(game, beatDetector)
}

export function updateKeyLabels() {
  const isDFJK = CONFIG.laneKeys[0] === 'KeyD'
  const labels = isDFJK ? ['D', 'F', 'J', 'K'] : ['1', '2', '3', '4']

  document.querySelectorAll('.lane-key').forEach((el) => {
    const lane = Number(el.dataset.lane)
    if (!isNaN(lane) && labels[lane]) {
      const span = el.querySelector('span')
      if (span) span.textContent = labels[lane]
    }
  })

  const keyGuideRow = document.querySelector('.key-guide-row')
  if (keyGuideRow) {
    keyGuideRow.innerHTML = labels
      .map((l, i) => `<kbd class="k-lane-${i}">${l}</kbd>`)
      .join('')
  }
}

export function setDifficulty(mode, game, beatDetector, prefetchFn) {
  const next = beatDetector.resolveMode(mode)
  if (game.difficulty === next) return
  game.difficulty = next
  renderDifficulty(game, beatDetector)
  saveSettings()
  if (prefetchFn) prefetchFn()
}

export function renderDifficulty(game, beatDetector) {
  game.difficulty = beatDetector.resolveMode(game.difficulty)
  for (const button of ui.difficultyButtons) {
    const active = button.dataset.difficulty === game.difficulty
    button.setAttribute('aria-checked', active ? 'true' : 'false')
  }
}
