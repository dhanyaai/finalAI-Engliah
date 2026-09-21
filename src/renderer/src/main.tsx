import './assets/main.css'
// Web-mode adapter first (injects a real HTTP-backed window.api when not in
// Electron), then the no-op stub as a fallback for any remaining gaps.
import './api-web'
import './api-stub'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClerkProvider } from '@clerk/react'
import { publishableKeyFromHost } from '@clerk/react/internal'
import App from './App'

const clerkPubKey=publishableKeyFromHost(window.location.hostname,import.meta.env.VITE_CLERK_PUBLISHABLE_KEY)
const clerkProxyUrl=import.meta.env.VITE_CLERK_PROXY_URL
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} signInUrl="/sign-in" signUpUrl="/sign-up" appearance={{variables:{colorPrimary:'#6f4bf2',colorForeground:'#211a3a',colorMutedForeground:'#766f91',colorBackground:'#fffaf2',colorInput:'#ffffff',colorInputForeground:'#211a3a',colorDanger:'#d94d3b',colorNeutral:'#e9e1f3',fontFamily:"'Plus Jakarta Sans', ui-sans-serif, system-ui",borderRadius:'14px'}}} localization={{signIn:{start:{title:'Welcome back, grown-up',subtitle:'Sign in to keep every learner’s progress safe.'}},signUp:{start:{title:'Create your family account',subtitle:'One secure account for all your learners.'}}}}>
      <App />
    </ClerkProvider>
  </StrictMode>
)
