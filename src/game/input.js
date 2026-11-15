import { CONFIG } from '../config.js'
import { setLaneKeyActive, flashLaneKey } from '../ui/dom.js'
import { findHittableNote, judgeTiming, removeObstacle } from '../render/obstacles.js'
import { laneCenter } from '../render/road.js'
import { player } from '../render/playerMesh.js'

export const input = {
  held: new Set(),
  gameRef: null,
  gamepadButtonsState: new Map(), // padIndex-buttonIndex -> boolean

  init(game) {
    this.gameRef = game
    game.inputRef = this

    window.addEventListener('keydown', (event) => this.onKeyDown(event))
    window.addEventListener('keyup', (event) => this.onKeyUp(event))
    window.addEventListener('blur', () => this.releaseAll())
    window.addEventListener('blur', () => this.gameRef?.pause())
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.gameRef?.pause()
    })
  },

  isPauseKey(code) {
    return code === 'Escape' || code === 'KeyP'
  },

  laneForCode(code) {
    return CONFIG.laneKeys.indexOf(code)
  },

  onKeyDown(event) {
    if (this.isPauseKey(event.code)) {
      event.preventDefault()
      if (this.gameRef?.isPlaying) this.gameRef.togglePause()
      return
    }

    const lane = this.laneForCode(event.code)
    if (lane === -1) return
    event.preventDefault()

    if (this.held.has(event.code)) return
    this.held.add(event.code)

    this.pressLane(lane)
  },

  onKeyUp(event) {
    const lane = this.laneForCode(event.code)
    if (lane === -1) return
    event.preventDefault()
    this.held.delete(event.code)
    setLaneKeyActive(lane, false)
  },

  pressLane(lane) {
    setLaneKeyActive(lane, true)
    if (!this.gameRef || !this.gameRef.isPlaying || this.gameRef.isPaused) return

    this.gameRef.requestLane(lane)

    const hit = findHittableNote(lane)
    if (!hit) {
      this.gameRef.addJudgement('bad', lane)
      flashLaneKey(lane, 'miss')
      return
    }

    const grade = judgeTiming(Math.abs(hit.timing))
    const finalGrade = grade ?? 'ok'

    removeObstacle(hit.note)
    this.gameRef.addJudgement(finalGrade, lane, hit.timing)
    flashLaneKey(
      lane,
      finalGrade === 'perfect' || finalGrade === 'good' ? 'hit' : 'ok',
    )
  },

  releaseLane(lane) {
    setLaneKeyActive(lane, false)
  },

  releaseAll() {
    this.held.clear()
    for (let lane = 0; lane < CONFIG.laneCount; lane++) {
      setLaneKeyActive(lane, false)
    }
  },

  reset() {
    this.releaseAll()
    if (this.gameRef) this.gameRef.targetLane = 1
    player.position.set(laneCenter(1), 0.02, CONFIG.hitLineZ)
  },

  /**
   * Poll Gamepad API on each frame.
   * Standard gamepad mapping:
   *  - Triggers/Shoulders: L2 (btn 6) -> 0, L1 (btn 4) -> 1, R1 (btn 5) -> 2, R2 (btn 7) -> 3
   *  - D-Pad: Left (btn 14) -> 0, Down (btn 13) -> 1, Up (btn 12) -> 2, Right (btn 15) -> 3
   *  - Start (btn 9) -> Pause toggle
   */
  pollGamepad() {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return

    const gamepads = navigator.getGamepads()
    for (let padIdx = 0; padIdx < gamepads.length; padIdx++) {
      const pad = gamepads[padIdx]
      if (!pad || !pad.connected) continue

      const buttonMap = [
        { lane: 0, buttons: [6, 14, 2] }, // L2, Dpad-Left, or X/Square
        { lane: 1, buttons: [4, 13, 3] }, // L1, Dpad-Down, or Y/Triangle
        { lane: 2, buttons: [5, 12, 0] }, // R1, Dpad-Up, or A/Cross
        { lane: 3, buttons: [7, 15, 1] }, // R2, Dpad-Right, or B/Circle
      ]

      for (const { lane, buttons } of buttonMap) {
        const isPressed = buttons.some((btnIndex) => {
          const btn = pad.buttons[btnIndex]
          return btn && (typeof btn === 'object' ? btn.pressed : btn > 0.5)
        })

        const key = `${padIdx}-${lane}`
        const wasPressed = !!this.gamepadButtonsState.get(key)

        if (isPressed && !wasPressed) {
          this.gamepadButtonsState.set(key, true)
          this.pressLane(lane)
        } else if (!isPressed && wasPressed) {
          this.gamepadButtonsState.set(key, false)
          this.releaseLane(lane)
        }
      }

      // Start button for pause
      const startBtn = pad.buttons[9]
      const isStartPressed =
        startBtn && (typeof startBtn === 'object' ? startBtn.pressed : startBtn > 0.5)
      const startKey = `${padIdx}-pause`
      const wasStartPressed = !!this.gamepadButtonsState.get(startKey)

      if (isStartPressed && !wasStartPressed) {
        this.gamepadButtonsState.set(startKey, true)
        if (this.gameRef?.isPlaying) {
          this.gameRef.togglePause()
        }
      } else if (!isStartPressed && wasStartPressed) {
        this.gamepadButtonsState.set(startKey, false)
      }
    }
  },
}
