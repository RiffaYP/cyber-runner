import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { CONFIG, COLORS } from '../config.js'
import { isMobile, prefersLandscape } from '../device.js'
import { ui } from '../ui/dom.js'

export function targetPixelRatio() {
  return Math.min(window.devicePixelRatio, 2)
}

export function bloomEnabled() {
  return true
}

export const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance',
})
renderer.setPixelRatio(targetPixelRatio())
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 0.68
renderer.outputColorSpace = THREE.SRGBColorSpace

export const scene = new THREE.Scene()
scene.background = new THREE.Color(COLORS.background)
scene.fog = new THREE.Fog(COLORS.background, 34, 110)

export const camera = new THREE.PerspectiveCamera(
  52,
  window.innerWidth / window.innerHeight,
  0.1,
  400,
)
camera.position.set(0, CONFIG.cameraY, CONFIG.cameraZ)
camera.lookAt(0, CONFIG.cameraLookAtY, CONFIG.cameraLookAtZ)

scene.add(new THREE.AmbientLight(0xffffff, 0.32))
const keyLight = new THREE.DirectionalLight(0xbfe9ff, 0.55)
keyLight.position.set(-4, 10, 6)
scene.add(keyLight)

export const composer = new EffectComposer(renderer)
composer.setSize(window.innerWidth, window.innerHeight)

const renderPass = new RenderPass(scene, camera)
composer.addPass(renderPass)

export const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.38,
  0.42,
  0.65,
)
composer.addPass(bloomPass)

let onGeometryUpdateCallback = null
export function registerGeometryUpdate(cb) {
  onGeometryUpdateCallback = cb
}

export function onResize() {
  const width = window.innerWidth
  const height = window.innerHeight

  const wasMobileLandscape = CONFIG.laneWidth > 2.5
  const isMobileLandscape = isMobile && width > height

  if (isMobileLandscape) {
    camera.fov = 68
    CONFIG.laneWidth = 3.6
  } else {
    camera.fov = 52
    CONFIG.laneWidth = 2.35
  }

  if (wasMobileLandscape !== isMobileLandscape && onGeometryUpdateCallback) {
    onGeometryUpdateCallback()
  }

  camera.aspect = width / height
  camera.updateProjectionMatrix()

  renderer.setPixelRatio(targetPixelRatio())
  renderer.setSize(width, height)
  composer.setSize(width, height)
  bloomPass.setSize(width, height)
  bloomPass.enabled = bloomEnabled()
}

export function applyOrientation() {
  if (!isMobile) return

  const portrait = window.innerHeight > window.innerWidth
  ui.rotateOverlay?.classList.toggle('hidden', !portrait)

  if (prefersLandscape() && screen.orientation && screen.orientation.lock) {
    screen.orientation.lock('landscape').catch(() => {})
  }
}
