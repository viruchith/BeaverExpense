import { useCallback, useEffect, useMemo, useState } from 'react'

import { canUseFirebaseAuth, loginWithGoogle, logoutCurrentUser, subscribeToAuth } from '../lib/auth'
import { secureAuthErrorMessage } from '../lib/security'

interface AuthDiagnostics {
  code: string
  message: string
  atIso: string
}

// Captures non-sensitive debug details for development diagnostics.
const getAuthDiagnostics = (error: unknown): AuthDiagnostics => {
  if (typeof error === 'object' && error !== null) {
    const maybeCode = 'code' in error ? String(error.code) : 'unknown'
    const maybeMessage = 'message' in error ? String(error.message) : 'No message'
    return {
      code: maybeCode,
      message: maybeMessage,
      atIso: new Date().toISOString(),
    }
  }

  return {
    code: 'unknown',
    message: String(error),
    atIso: new Date().toISOString(),
  }
}

export const useAuth = () => {
  // Firebase auth is enabled only when Firebase env config is complete.
  const isFirebaseAuthEnabled = useMemo(() => canUseFirebaseAuth(), [])
  const [user, setUser] = useState<{ uid: string; email: string; displayName: string } | null>(null)
  const [loading, setLoading] = useState(isFirebaseAuthEnabled)
  const [authError, setAuthError] = useState<string>('')
  const [authDiagnostics, setAuthDiagnostics] = useState<AuthDiagnostics | null>(null)

  useEffect(() => {
    if (!isFirebaseAuthEnabled) {
      return
    }

    // Keeps UI session state synced to Firebase auth state changes.
    const unsubscribe = subscribeToAuth((firebaseUser) => {
      if (!firebaseUser) {
        setUser(null)
      } else {
        setUser({
          uid: firebaseUser.uid,
          email: firebaseUser.email ?? '',
          displayName: firebaseUser.displayName ?? 'User',
        })
      }
      setLoading(false)
    })

    return unsubscribe
  }, [isFirebaseAuthEnabled])

  const login = useCallback(async () => {
    if (!isFirebaseAuthEnabled) {
      return
    }

    try {
      await loginWithGoogle()
      setAuthError('')
      setAuthDiagnostics(null)
    } catch (error) {
      // Show a safe user-facing message, keep details in dev diagnostics.
      setAuthError(secureAuthErrorMessage())
      setAuthDiagnostics(getAuthDiagnostics(error))
      throw error
    }
  }, [isFirebaseAuthEnabled])

  const logout = useCallback(async () => {
    await logoutCurrentUser()
  }, [])

  return {
    user,
    loading,
    isFirebaseAuthEnabled,
    authError,
    authDiagnostics,
    login,
    logout,
    clearAuthError: () => {
      setAuthError('')
      setAuthDiagnostics(null)
    },
  }
}
