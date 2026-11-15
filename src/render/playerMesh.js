import * as THREE from 'three'
import { CONFIG, COLORS } from '../config.js'
import { scene } from './scene.js'
import { laneCenter, laneBeams, registerPaddleGeometryUpdate } from './road.js'

export const player = new THREE.Group()
player.position.set(laneCenter(1), 0.02, CONFIG.hitLineZ)
scene.add(player)

let paddleWidth = CONFIG.laneWidth * 0.9
export const PADDLE_LENGTH = 1.5

const paddlePadGeo = new THREE.PlaneGeometry(paddleWidth, PADDLE_LENGTH)
export const paddleMaterial = new THREE.MeshBasicMaterial({
  color: COLORS.lanes[0],
  transparent: true,
  opacity: 0.14,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  side: THREE.DoubleSide,
})
export const paddlePad = new THREE.Mesh(paddlePadGeo, paddleMaterial)
paddlePad.rotation.x = -Math.PI / 2
player.add(paddlePad)

export const paddleRing = new THREE.LineSegments(
  new THREE.EdgesGeometry(paddlePadGeo),
  new THREE.LineBasicMaterial({
    color: COLORS.lanes[0],
    transparent: true,
    opacity: 0.95,
  }),
)
paddleRing.rotation.x = -Math.PI / 2
paddleRing.position.y = 0.004
player.add(paddleRing)

export const strikeMarker = new THREE.Mesh(
  new THREE.PlaneGeometry(paddleWidth * 0.94, 0.16),
  new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }),
)
strikeMarker.rotation.x = -Math.PI / 2
strikeMarker.position.set(0, 0.008, 0)
player.add(strikeMarker)

registerPaddleGeometryUpdate(() => {
  paddleWidth = CONFIG.laneWidth * 0.9
  paddlePad.geometry.dispose()
  paddlePad.geometry = new THREE.PlaneGeometry(paddleWidth, PADDLE_LENGTH)
  paddleRing.geometry.dispose()
  paddleRing.geometry = new THREE.EdgesGeometry(paddlePad.geometry)
  strikeMarker.geometry.dispose()
  strikeMarker.geometry = new THREE.PlaneGeometry(paddleWidth * 0.94, 0.16)
})

export let shakeAmount = 0
export function setShakeAmount(val) {
  shakeAmount = val
}

export let paddlePulse = 0
export function setPaddlePulse(val) {
  paddlePulse = val
}

const paddleFlash = { value: 0, color: new THREE.Color(0xffffff) }
const PADDLE_FLASH = {
  hit: new THREE.Color(0xffffff),
  miss: new THREE.Color(0xff4d6d),
}

const PULSE_POOL_SIZE = 5
const pulsePool = []
const pulseGeometry = new THREE.RingGeometry(0.5, 0.62, 40)

for (let i = 0; i < PULSE_POOL_SIZE; i++) {
  const ring = new THREE.Mesh(
    pulseGeometry,
    new THREE.MeshBasicMaterial({
      color: COLORS.cyan,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  )
  ring.rotation.x = -Math.PI / 2
  ring.visible = false
  player.add(ring)
  pulsePool.push({ mesh: ring, life: 0 })
}

export function spawnPulse(lane, kind) {
  const slot = pulsePool.find((p) => p.life <= 0) ?? pulsePool[0]
  slot.life = 1
  slot.mesh.visible = true
  slot.mesh.scale.setScalar(0.5)
  slot.mesh.material.color.setHex(
    kind === 'hit' ? COLORS.lanes[lane] : 0xff4d6d,
  )
  slot.mesh.material.opacity = kind === 'hit' ? 0.65 : 0.45
}

export function updatePulses(dt) {
  for (const slot of pulsePool) {
    if (slot.life <= 0) continue
    slot.life = Math.max(0, slot.life - dt * 2.6)
    const t = 1 - slot.life
    slot.mesh.scale.setScalar(0.5 + t * 2.4)
    slot.mesh.material.opacity *= Math.max(0, 1 - dt * 4)
    if (slot.life <= 0) slot.mesh.visible = false
  }
}

export function flashPaddle(lane, kind) {
  spawnPulse(lane, kind)

  if (kind === 'hit') {
    paddleFlash.value = 1
    paddleFlash.color.copy(PADDLE_FLASH.hit)
    shakeAmount = Math.min(shakeAmount + 0.045, 0.1)
  } else {
    paddleFlash.value = 0.6
    paddleFlash.color.copy(PADDLE_FLASH.miss)
  }
}

export function updatePlayer(dt, targetLane, elapsedTime) {
  const targetX = laneCenter(targetLane)
  const slideSpeed = 22
  const t = 1 - Math.exp(-slideSpeed * dt)
  player.position.x += (targetX - player.position.x) * t

  player.position.y = 0.02 + Math.sin(elapsedTime * 2.4) * 0.008

  paddleFlash.value = Math.max(0, paddleFlash.value - dt * 5)
  paddlePulse = Math.max(0, paddlePulse - dt * 4)

  const flash = paddleFlash.value
  const laneColor = COLORS.lanes[targetLane]
  const blink = 0.16 + paddlePulse * 0.26

  paddleMaterial.color.setHex(laneColor).lerp(paddleFlash.color, flash * 0.85)
  paddleMaterial.opacity = blink + flash * 0.4
  paddleRing.material.color.setHex(laneColor).lerp(paddleFlash.color, flash)
  paddleRing.material.opacity = 0.8 + flash * 0.2

  for (let i = 0; i < laneBeams.length; i++) {
    const target = i === targetLane ? 0.17 + paddlePulse * 0.1 : 0.055
    laneBeams[i].material.opacity +=
      (target - laneBeams[i].material.opacity) * (1 - Math.exp(-12 * dt))
  }

  const bump = 1 + paddlePulse * 0.06
  paddlePad.scale.set(bump, bump, 1)
  paddleRing.scale.set(bump, bump, 1)
}
