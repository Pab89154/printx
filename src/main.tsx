import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { installButtonPop } from './lib/buttonPop'
import './index.css'

installButtonPop()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
