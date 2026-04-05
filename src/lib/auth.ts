import {
  GoogleAuthProvider,
  getAuth,
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth'

import { getFirebaseApp, isFirebaseMode } from './repository'

let authSingleton: ReturnType<typeof getAuth> | null = null
let redirectResultResolved = false

// Returns a shared Firebase Auth instance when Firebase mode is enabled.
export const getFirebaseAuth = () => {
  const app = getFirebaseApp()
  if (!app) {
    return null
  }

  if (!authSingleton) {
    authSingleton = getAuth(app)
  }

  return authSingleton
}

export const canUseFirebaseAuth = (): boolean => isFirebaseMode() && Boolean(getFirebaseAuth())

// Subscribes to auth session updates and resolves redirect result once after app boot.
export const subscribeToAuth = (onChange: (user: User | null) => void): (() => void) => {
  const auth = getFirebaseAuth()
  if (!auth) {
    onChange(null)
    return () => {}
  }

  if (!redirectResultResolved) {
    redirectResultResolved = true
    void getRedirectResult(auth).catch(() => {
      // The auth hook already surfaces user-facing auth errors.
    })
  }

  return onAuthStateChanged(auth, onChange)
}

export const loginWithGoogle = async (): Promise<void> => {
  const auth = getFirebaseAuth()
  if (!auth) {
    throw new Error('Firebase auth is not configured.')
  }

  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ prompt: 'select_account' })
  try {
    await signInWithPopup(auth, provider)
    return
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
    const shouldFallbackToRedirect =
      code === 'auth/popup-blocked'
      || code === 'auth/popup-closed-by-user'
      || code === 'auth/cancelled-popup-request'

    if (!shouldFallbackToRedirect) {
      throw error
    }
  }

  await signInWithRedirect(auth, provider)
}

// Signs out current user in Firebase mode.
export const logoutCurrentUser = async (): Promise<void> => {
  const auth = getFirebaseAuth()
  if (!auth) {
    return
  }

  await signOut(auth)
}
