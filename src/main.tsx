import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const shouldIgnoreFirebaseCoopWarning = (value: unknown): boolean => {
  if (typeof value !== 'string') {
    return false
  }

  return (
    value.includes('Cross-Origin-Opener-Policy policy would block the window.closed call')
    || value.includes('Cross-Origin-Opener-Policy policy would block the window.close call')
  )
}

const installConsoleNoiseFilter = (): void => {
  const originalWarn = console.warn.bind(console)
  const originalError = console.error.bind(console)

  console.warn = (...args: unknown[]) => {
    if (args.some((arg) => shouldIgnoreFirebaseCoopWarning(arg))) {
      return
    }
    originalWarn(...args)
  }

  console.error = (...args: unknown[]) => {
    if (args.some((arg) => shouldIgnoreFirebaseCoopWarning(arg))) {
      return
    }
    originalError(...args)
  }
}

installConsoleNoiseFilter()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
