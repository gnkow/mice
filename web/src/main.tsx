import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { applyAppearance } from './lib/appearance'
import './index.css'
import App from './App.tsx'

applyAppearance()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
