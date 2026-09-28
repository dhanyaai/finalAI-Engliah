import './assets/main.css'
// Web-mode adapter first (injects a real HTTP-backed window.api when not in
// Electron), then the no-op stub as a fallback for any remaining gaps.
import './api-web'
import './api-stub'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
