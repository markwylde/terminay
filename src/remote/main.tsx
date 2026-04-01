import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RemoteApp } from './App'

createRoot(document.getElementById('remote-root') as HTMLElement).render(
  <StrictMode>
    <RemoteApp />
  </StrictMode>,
)
