import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { installButtonPop } from './lib/buttonPop'
import './index.css'

declare global {
  interface Window {
    __PRINTX_API_READY__?: Promise<void>
    __PRINTX_DISMISS_WAKE__?: () => void
  }
}

function boot() {
  // Paint the site immediately. Waiting on /api/health left the startup
  // screen over the catalog, so those buttons could not be clicked.
  const dismiss = window.__PRINTX_DISMISS_WAKE__
  if (typeof dismiss === 'function') dismiss()

  installButtonPop()

  const root = document.getElementById('root')
  if (!root) throw new Error('Missing #root')

  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

boot()
