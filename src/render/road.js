import * as THREE from 'three'
import { CONFIG, COLORS } from '../config.js'
import { scene } from './scene.js'

export const grid = new THREE.GridHelper(
  CONFIG.gridLength,
  CONFIG.gridDivisionsZ,
  COLORS.cyan,
  COLORS.magenta,
)
grid.scale.x = CONFIG.gridWidth / CONFIG.gridLength
grid.position.set(0, -0.02, -CONFIG.gridLength / 2 + 10)
grid.material.transparent = true
grid.material.opacity = 0.18
grid.material.blending = THREE.AdditiveBlending
grid.material.depthWrite = false
scene.add(grid)

export const laneGroup = new THREE.Group()
scene.add(laneGroup)

export let laneCenter = (index) =>
  (index - (CONFIG.laneCount - 1) / 2) * CONFIG.laneWidth

let LANE_HALF = (CONFIG.laneCount * CONFIG.laneWidth) / 2
const RAIL_LENGTH = 130
const RAIL_FAR = -RAIL_LENGTH + 8

let railXs = [-LANE_HALF]
for (let i = 0; i < CONFIG.laneCount - 1; i++) {
  railXs.push(-LANE_HALF + (i + 1) * CONFIG.laneWidth)
}
railXs.push(LANE_HALF)

export const railLines = []
for (const x of railXs) {
  const rail = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x, 0.01, RAIL_FAR),
      new THREE.Vector3(x, 0.01, 6),
    ]),
    new THREE.LineBasicMaterial({
      color: 0x7fb6d9,
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  )
  laneGroup.add(rail)
  railLines.push(rail)
}

const BEAM_NEAR = 14
const BEAM_FAR = RAIL_FAR
const BEAM_LENGTH = BEAM_NEAR - BEAM_FAR

export const laneBeams = []
for (let i = 0; i < CONFIG.laneCount; i++) {
  const beam = new THREE.Mesh(
    new THREE.PlaneGeometry(CONFIG.laneWidth * 0.9, BEAM_LENGTH),
    new THREE.MeshBasicMaterial({
      color: COLORS.lanes[i],
      transparent: true,
      opacity: 0.07,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  )
  beam.rotation.x = -Math.PI / 2
  beam.position.set(laneCenter(i), 0.004, (BEAM_NEAR + BEAM_FAR) / 2)
  laneGroup.add(beam)
  laneBeams.push(beam)
}

let HIT_LINE_WIDTH = LANE_HALF * 2 + 1.2

export const hitLineMaterial = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0.5,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
})
export const hitLine = new THREE.Mesh(
  new THREE.PlaneGeometry(HIT_LINE_WIDTH, 0.16),
  hitLineMaterial,
)
hitLine.rotation.x = -Math.PI / 2
hitLine.position.set(0, 0.012, CONFIG.hitLineZ)
scene.add(hitLine)

export const hitEcho = new THREE.Mesh(
  new THREE.PlaneGeometry(HIT_LINE_WIDTH * 0.98, 0.07),
  new THREE.MeshBasicMaterial({
    color: COLORS.cyan,
    transparent: true,
    opacity: 0.16,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }),
)
hitEcho.rotation.x = -Math.PI / 2
hitEcho.position.set(0, 0.011, CONFIG.hitLineZ - 1.15)
scene.add(hitEcho)

let onPaddleGeometryUpdate = null
export function registerPaddleGeometryUpdate(cb) {
  onPaddleGeometryUpdate = cb
}

export function updateLaneGeometry() {
  laneCenter = (index) =>
    (index - (CONFIG.laneCount - 1) / 2) * CONFIG.laneWidth

  LANE_HALF = (CONFIG.laneCount * CONFIG.laneWidth) / 2

  railXs = [-LANE_HALF]
  for (let i = 0; i < CONFIG.laneCount - 1; i++) {
    railXs.push(-LANE_HALF + (i + 1) * CONFIG.laneWidth)
  }
  railXs.push(LANE_HALF)

  for (const rail of railLines) {
    laneGroup.remove(rail)
    rail.geometry.dispose()
  }
  railLines.length = 0

  for (const x of railXs) {
    const rail = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x, 0.01, RAIL_FAR),
        new THREE.Vector3(x, 0.01, 6),
      ]),
      new THREE.LineBasicMaterial({
        color: 0x7fb6d9,
        transparent: true,
        opacity: 0.16,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    )
    laneGroup.add(rail)
    railLines.push(rail)
  }

  for (let i = 0; i < CONFIG.laneCount; i++) {
    const beam = laneBeams[i]
    beam.geometry.dispose()
    beam.geometry = new THREE.PlaneGeometry(CONFIG.laneWidth * 0.9, BEAM_LENGTH)
    beam.position.set(laneCenter(i), 0.004, (BEAM_NEAR + BEAM_FAR) / 2)
  }

  HIT_LINE_WIDTH = LANE_HALF * 2 + 1.2
  hitLine.geometry.dispose()
  hitLine.geometry = new THREE.PlaneGeometry(HIT_LINE_WIDTH, 0.16)
  hitEcho.geometry.dispose()
  hitEcho.geometry = new THREE.PlaneGeometry(HIT_LINE_WIDTH * 0.98, 0.07)

  if (onPaddleGeometryUpdate) {
    onPaddleGeometryUpdate()
  }
}

export function updateGrid(dt) {
  const cell = CONFIG.gridLength / CONFIG.gridDivisionsZ
  grid.position.z += CONFIG.gridScrollSpeed * dt
  if (grid.position.z - CONFIG.gridLength / 2 > CONFIG.gridLength - 10) {
    grid.position.z -= cell * CONFIG.gridDivisionsZ
  }
}
