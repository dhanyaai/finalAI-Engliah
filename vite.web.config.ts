/**
 * Standalone Vite config for running the HiKid renderer as a plain web app.
 * Proxies /api to the Express backend on port 3000.
 */
import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { webChatPlugin } from './src/web/chat-plugin'

// Web chat mode is on by default for the standalone web build.
// Set WEB_CHAT=false to fall back to the old no-op stubs.
const webChatEnabled = process.env.WEB_CHAT !== 'false'

export default defineConfig({
  root: 'src/renderer',
  plugins: [react(), ...(webChatEnabled ? [webChatPlugin()] : [])],
  define: {
    'import.meta.env.VITE_WEB_CHAT': JSON.stringify(webChatEnabled ? 'true' : 'false')
  },
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('src/shared')
    }
  },
  build: {
    outDir: 'dist',   // relative to root (src/renderer), so → src/renderer/dist
    emptyOutDir: true
  },
  server: {
    host: '0.0.0.0',
    port: 5000,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  }
})
