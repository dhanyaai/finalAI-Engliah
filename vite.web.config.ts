/**
 * Standalone Vite config for running the HiKid renderer as a plain web app.
 * This bypasses Electron entirely so the UI can be previewed on Replit.
 * All window.api calls are stubbed — the real audio/AI pipeline requires
 * the macOS desktop app (see README.md).
 */
import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'src/renderer',
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('src/shared')
    }
  },
  server: {
    host: '0.0.0.0',
    port: 5000,
    allowedHosts: true
  }
})
