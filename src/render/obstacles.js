import * as THREE from 'three'
import { CONFIG, COLORS, activeNoteSpeed } from '../config.js'
import { scene } from './scene.js'
import { laneCenter } from './road.js'
import { audio } from '../audio/audioEngine.js'
import { playHit } from '../audio/sfx.js'
import { flashLaneKey } from '../ui/dom.js'

export const obstacles = []

const noteGeometry = new THREE.BoxGeometry(
  CONFIG.noteSize * 0.76,
  CONFIG.noteSize * 0.6,
  CONFIG.noteSize * 0.66,
)
noteGeometry.userData.shared = true

const noteMaterials = COLORS.lanes.map((hex, i) => {
  const params = [
    { colorMul: 0.32, emissive: 1.35 },
    { colorMul: 0.28, emissive: 1.1 },
    { colorMul: 0.28, emissive: 1.1 },
    { colorMul: 0.55, emissive: 2.2 },
  ][i]
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(hex).multiplyScalar(params.colorMul),
    emissive: hex,
    emissiveIntensity: params.emissive,
    metalness: 0.1,
    roughness: 0.6,
    transparent: true,
    opacity: 0.95,
  })
  material.userData.shared = true
  return material
})

const noteEdgeMaterials = COLORS.lanes.map((hex) => {
  const material = new THREE.LineBasicMaterial({
    color: hex,
    transparent: true,
    opacity: 0.9,
  })
  material.userData.shared = true
  return material
})

export function disposeObstacle(obstacle) {
  scene.remove(obstacle)
  obstacle.traverse((child) => {
    if (!child.isMesh && !child.isLineSegments) return

    if (child.geometry && !child.geometry.userData?.shared) {
      child.geometry.dispose()
    }
    if (child.material && !child.material.userData?.shared) {
      child.material.dispose()
    }
  })
}

export function removeObstacle(obstacle) {
  const index = obstacles.indexOf(obstacle)
  if (index !== -1) obstacles.splice(index, 1)
  disposeObstacle(obstacle)
}

export const obstacleManager = {
  spawn(laneIndex, hitTime = 0) {
    const group = new THREE.Group()

    group.add(new THREE.Mesh(noteGeometry, noteMaterials[laneIndex]))
    group.add(
      new THREE.LineSegments(
        new THREE.EdgesGeometry(noteGeometry),
        noteEdgeMaterials[laneIndex],
      ),
    )

    group.position.set(laneCenter(laneIndex), CONFIG.noteSize * 0.42, CONFIG.spawnZ)
    group.userData = { lane: laneIndex, hitTime }

    scene.add(group)
    obstacles.push(group)
  },

  pickLane(recentLanes) {
    const last = recentLanes[recentLanes.length - 1] ?? 1
    const prev = recentLanes[recentLanes.length - 2]

    if (prev !== undefined && prev === last) {
      const candidates = []
      for (let lane = 0; lane < CONFIG.laneCount; lane++) {
        if (lane !== last) candidates.push(lane)
      }
      return candidates[Math.floor(Math.random() * candidates.length)]
    }

    const roll = Math.random()
    if (roll < 0.72) {
      const neighbours = []
      if (last - 1 >= 0) neighbours.push(last - 1)
      if (last + 1 < CONFIG.laneCount) neighbours.push(last + 1)
      return neighbours[Math.floor(Math.random() * neighbours.length)]
    }
    return Math.floor(Math.random() * CONFIG.laneCount)
  },

  update(dt) {
    const audioTime = audio.getTime()

    for (let i = obstacles.length - 1; i >= 0; i--) {
      const note = obstacles[i]

      if (note.userData.fading) {
        note.position.z += CONFIG.noteSpeed * 0.25 * dt
        note.scale.multiplyScalar(1 - dt * 2.2)
        if (note.scale.x < 0.08) removeObstacle(note)
        continue
      }

      if (audioTime !== null && note.userData.hitTime) {
        const timeUntilHit = note.userData.hitTime - audioTime
        note.position.z = CONFIG.hitLineZ - timeUntilHit * activeNoteSpeed()
      } else {
        note.position.z += activeNoteSpeed() * dt
      }

      if (note.position.z > CONFIG.despawnZ) {
        removeObstacle(note)
      }
    }
  },

  clear() {
    for (let i = obstacles.length - 1; i >= 0; i--) {
      disposeObstacle(obstacles[i])
    }
    obstacles.length = 0
  },
}

export const MISS_Z = CONFIG.hitLineZ + CONFIG.missZThreshold

export function timeToHit(note) {
  const audioTime = audio.getTime()

  if (audioTime !== null && note.userData.hitTime) {
    return note.userData.hitTime - audioTime
  }

  return (note.position.z - CONFIG.hitLineZ) / activeNoteSpeed()
}

export function findHittableNote(lane) {
  let best = null
  let bestAbs = Infinity
  let bestTiming = 0

  for (const note of obstacles) {
    if (note.userData.lane !== lane) continue
    const t = timeToHit(note)
    const abs = Math.abs(t)
    if (abs <= CONFIG.hitWindow && abs < bestAbs) {
      best = note
      bestAbs = abs
      bestTiming = t
    }
  }
  return best ? { note: best, timing: bestTiming } : null
}

export function judgeTiming(absError) {
  const { perfect, good, ok } = CONFIG.judge
  if (absError <= perfect) return 'perfect'
  if (absError <= good) return 'good'
  if (absError <= ok) return 'ok'
  return null
}

export function resolveMisses(game) {
  const audioTime = audio.getTime()

  for (let i = obstacles.length - 1; i >= 0; i--) {
    const note = obstacles[i]

    const isMissed =
      audioTime !== null && note.userData.hitTime
        ? audioTime - note.userData.hitTime > CONFIG.judge.ok
        : note.position.z > MISS_Z

    if (!isMissed) continue

    const lane = note.userData.lane
    removeObstacle(note)
    playHit('miss')
    game.addMiss(lane)
    flashLaneKey(lane, 'miss')

    if (!game.isPlaying) return
  }
}
