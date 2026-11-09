// Device detection for mobile quality presets + touch.

const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''

export const isIOS =
  /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in document)

export const isAndroid = /Android/i.test(ua)

export const isMobile =
  isIOS ||
  isAndroid ||
  ('ontouchstart' in window && window.matchMedia('(pointer: coarse)').matches) ||
  window.innerWidth < 768

export function prefersLandscape() {
  return window.matchMedia('(pointer: coarse)').matches
}
