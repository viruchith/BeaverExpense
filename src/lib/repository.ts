import { initializeApp, type FirebaseApp } from 'firebase/app'

import { defaultCategories, defaultSites } from './defaultData'
import { createFirestoreRepository } from './firestoreRepository'
import { createLocalRepository } from './localRepository'
import type { BeaverRepository } from './types'

// Runtime Firebase configuration. If any value is missing, the app automatically
// falls back to local mode for development/offline continuity.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const hasFirebaseConfig = Object.values(firebaseConfig).every((value) => Boolean(value))

let firebaseApp: FirebaseApp | null = null

// Builds Firebase app once and reuses it across the full SPA lifetime.
const buildFirebaseApp = (): FirebaseApp | null => {
  if (!hasFirebaseConfig) {
    return null
  }

  if (!firebaseApp) {
    firebaseApp = initializeApp(firebaseConfig)
  }

  return firebaseApp
}

export const getFirebaseApp = (): FirebaseApp | null => buildFirebaseApp()

let repositoryCache: BeaverRepository | null = null

// Data access entry point used by hooks/components.
// Chooses Firestore repository when Firebase is configured, otherwise localStorage repository.
export const getRepository = (): BeaverRepository => {
  if (repositoryCache) {
    return repositoryCache
  }

  const app = getFirebaseApp()

  repositoryCache = app
    ? createFirestoreRepository(app, defaultSites, defaultCategories)
    : createLocalRepository(defaultSites, defaultCategories)

  return repositoryCache
}

export const isFirebaseMode = (): boolean => hasFirebaseConfig
