// Bottom touch zones (one per lane). Taps call the game input API; the DOM
// mirrors the existing lane-key press/idle highlight.

export function initTouch(root, { pressLane, isPlaying, isPaused }) {
  if (!root) return

  let active = new Map() // pointerId -> lane

  function laneAt(target) {
    const zone = target?.closest?.('.touch-zone')
    if (!zone) return -1
    return Number(zone.dataset.lane)
  }

  function flash(lane, on) {
    const key = document.querySelector(`.lane-key[data-lane="${lane}"]`)
    key?.classList.toggle('active', on)
  }

  function onDown(event) {
    const lane = laneAt(event.target)
    if (lane < 0) return
    event.preventDefault()
    active.set(event.pointerId, lane)
    flash(lane, true)
    if (!isPlaying() || isPaused()) return
    pressLane(lane)
  }

  function onUp(event) {
    const lane = active.get(event.pointerId)
    if (lane === undefined) return
    active.delete(event.pointerId)
    flash(lane, false)
  }

  root.addEventListener('pointerdown', onDown, { passive: false })
  root.addEventListener('pointerup', onUp)
  root.addEventListener('pointercancel', onUp)
  root.addEventListener('pointerleave', onUp)
}
