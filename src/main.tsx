import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { installButtonPop } from './lib/buttonPop'
import './index.css'

declare global {
  interface Window {
    __PRINTX_API_READY__?: Promise<void>
  }
}

async function boot() {
  // Wait for the cold-start shell to confirm /api/health (or resolve immediately if missing).
  if (window.__PRINTX_API_READY__) {
    await window.__PRINTX_API_READY__
  }

  installButtonPop()

  const root = document.getElementById('root')
  if (!root) throw new Error('Missing #root')

  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void boot()
