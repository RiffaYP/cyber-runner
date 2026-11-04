import { defineConfig } from 'vite'

export default defineConfig(({ command, isPreview }) => ({
  // Dev stays at '/' so localhost:5173 works normally.
  // Production uses the repo subpath, because the site is served from
  // https://<user>.github.io/cyber-runner/ rather than the domain root.
  // `vite preview` serves the production build, so it must use the same base —
  // otherwise the built index.html requests /cyber-runner/assets/*.js from a
  // server rooted at '/', every asset 404s and only the raw HTML shows up.
  base: command === 'build' || isPreview ? '/cyber-runner/' : '/',
}))
