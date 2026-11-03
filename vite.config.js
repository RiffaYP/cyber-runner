import { defineConfig } from 'vite'

export default defineConfig(({ command }) => ({
  // Dev stays at '/' so localhost:5173 works normally.
  // Production uses the repo subpath, because the site is served from
  // https://<user>.github.io/cyber-runner/ rather than the domain root.
  base: command === 'build' ? '/cyber-runner/' : '/',
}))
